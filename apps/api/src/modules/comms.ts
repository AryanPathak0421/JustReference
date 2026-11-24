import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  contactSchema, feedbackDecisionSchema, feedbackSchema, messageSchema, ticketReplySchema, ticketSchema, ticketUpdateSchema, TICKET_STATUSES,
  type AttachmentInfo, type FeedbackRow, type MessageRow, type NotificationRow, type TicketDetail, type TicketRow,
} from '@jr/shared';
import { authenticate, requirePermission, requireRole } from '../middleware/auth';
import { publicFormLimiter, uploadLimiter } from '../middleware/security';
import { DOCUMENT_MAX_BYTES, processImage, requireFile, singleFile, sniff } from '../middleware/upload';
import { AttachmentModel, FeedbackModel, MessageModel, NotificationModel, TicketModel, type Message, type Ticket } from '../models/comms';
import { OrderModel } from '../models/commerce';
import { VendorModel } from '../models/vendor';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { nextSequence } from '../models/system';
import { AppError, badRequest, conflict, notFound } from '../core/errors';
import { assertObjectId, dateRangeFilter, dateRangeSchema, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { newKey, storage } from '../services/storage';
import { notify } from '../services/notify';
import { audit } from '../services/audit';
import { sendPrivate } from './vendor';

const me = (req: Request) => new Types.ObjectId(req.auth!.user.id);
const isStaff = (req: Request) => req.auth!.user.roles.some((r) => r === 'admin' || r === 'super_admin');
const has = (req: Request, p: string) => isStaff(req) && req.auth!.permissions.has(p);
const base = (roles: string[]) => (roles.includes('super_admin') ? '/super-admin' : roles.includes('admin') ? '/admin' : roles.includes('vendor') ? '/vendor' : '/member');

async function names(ids: unknown[]) {
  const [u, m] = await Promise.all([UserModel.find({ _id: { $in: ids } }, { name: 1, roles: 1 }).lean(), MemberModel.find({ userId: { $in: ids } }, { userId: 1, memberId: 1 }).lean()]);
  const mm = new Map(m.map((x) => [String(x.userId), x.memberId]));
  const um = new Map(u.map((x) => [String(x._id), { name: x.name, roles: x.roles as string[], memberId: mm.get(String(x._id)) }]));
  return (id: unknown) => um.get(String(id)) ?? { name: '—', roles: [] as string[], memberId: undefined };
}
async function files(ids: unknown[]): Promise<(id: unknown) => AttachmentInfo | undefined> {
  const rows = await AttachmentModel.find({ _id: { $in: ids } }).lean();
  const map = new Map(rows.map((a) => [String(a._id), { id: String(a._id), name: a.name, mime: a.mime, size: a.size }]));
  return (id) => map.get(String(id));
}
/** Only files the sender uploaded themselves can be attached. */
async function ownFiles(req: Request, ids: string[]) {
  if (ids.length && (await AttachmentModel.countDocuments({ _id: { $in: ids }, ownerUserId: me(req) })) !== new Set(ids).size) throw badRequest('One of the files is missing. Upload it again.', { attachments: 'Upload the file again' });
  return [...new Set(ids)];
}
async function dailyLimit(count: Promise<number>, max: number, what: string) {
  if ((await count) >= max) throw new AppError(429, 'DAILY_LIMIT', `You can send up to ${max} ${what} a day`);
}
const dayAgo = () => new Date(Date.now() - 86_400_000);

/* ================================================================ Notifications */
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema.extend({ unread: z.enum(['yes']).optional() }), req.query);
  const filter = { userId: me(req), ...(q.unread ? { readAt: null } : {}) };
  const [rows, total] = await Promise.all([NotificationModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), NotificationModel.countDocuments(filter)]);
  res.json(paged(rows.map((n): NotificationRow => ({ id: String(n._id), event: n.event, title: n.title, body: n.body, link: n.link ?? null, read: !!n.readAt, createdAt: n.createdAt.toISOString() })), q.page, q.pageSize, total));
});
notificationsRouter.get('/counts', async (req, res) => {
  const toMe = { draft: false, readAt: null, ...(has(req, 'messages.manage') ? { $or: [{ toUserId: me(req) }, { toUserId: null }], fromUserId: { $ne: me(req) } } : { toUserId: me(req) }) };
  const [notifications, messages] = await Promise.all([NotificationModel.countDocuments({ userId: me(req), readAt: null }), MessageModel.countDocuments(toMe)]);
  res.json({ notifications, messages });
});
notificationsRouter.post('/read', async (req, res) => {
  const { id } = parse(z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i).optional() }), req.body);
  await NotificationModel.updateMany({ userId: me(req), readAt: null, ...(id ? { _id: id } : {}) }, { readAt: new Date() });
  res.json({ ok: true });
});

/* ================================================================ Attachments */
export const attachmentsRouter = Router();
attachmentsRouter.use(authenticate);
attachmentsRouter.post('/', uploadLimiter, singleFile('file', DOCUMENT_MAX_BYTES), async (req, res) => {
  await dailyLimit(AttachmentModel.countDocuments({ ownerUserId: me(req), createdAt: { $gte: dayAgo() } }), 30, 'files');
  const file = requireFile(req.file);
  const kind = sniff(file.buffer);
  if (!kind) throw badRequest('Upload a PDF, JPG, PNG or WebP file', { file: 'Only PDF, JPG, PNG or WebP' });
  const data = kind === 'pdf' ? file.buffer : await processImage(file.buffer, 2000);
  const ext = kind === 'pdf' ? 'pdf' : 'webp';
  const key = newKey(ext);
  await storage.put(key, data, 'private');
  const a = await AttachmentModel.create({ ownerUserId: me(req), key, name: file.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120) || `file.${ext}`, mime: kind === 'pdf' ? 'application/pdf' : 'image/webp', size: data.length });
  res.status(201).json({ id: a.id, name: a.name, mime: a.mime, size: a.size } satisfies AttachmentInfo);
});
attachmentsRouter.get('/:id/file', async (req, res) => {
  const id = assertObjectId(req.params.id, 'File');
  const a = await AttachmentModel.findById(id).lean();
  if (!a) throw notFound('File');
  const allowed =
    a.ownerUserId!.equals(me(req)) ||
    (await MessageModel.exists({ attachments: id, draft: false, $or: [{ toUserId: me(req) }, { fromUserId: me(req) }, ...(has(req, 'messages.manage') ? [{ toUserId: null }] : [])] })) ||
    (await TicketModel.exists({ 'messages.attachments': id, ...(has(req, 'tickets.manage') ? {} : { userId: me(req) }) }));
  if (!allowed) throw notFound('File');
  await sendPrivate(res, a.key, a.mime, a.name);
});

/* ================================================================ Messages */
export const messagesRouter = Router();
messagesRouter.use(authenticate);

async function messageRows(rows: (Message & { _id: Types.ObjectId; createdAt: Date })[], req: Request): Promise<MessageRow[]> {
  const [who, file] = await Promise.all([names(rows.flatMap((r) => [r.fromUserId, r.toUserId]).filter(Boolean)), files(rows.flatMap((r) => r.attachments))]);
  const viewerStaff = isStaff(req);
  const show = (id: unknown) => (id ? `${who(id).name}${who(id).memberId ? ` (${who(id).memberId})` : ''}` : 'JustReference team');
  return rows.map((r) => ({
    id: String(r._id), subject: r.subject, body: r.body, fromMe: r.fromUserId!.equals(me(req)),
    // Outside the team, staff appear as the team rather than by personal name.
    from: r.fromStaff && !viewerStaff ? 'JustReference team' : show(r.fromUserId), to: r.draft ? (r.toText || 'JustReference team') : show(r.toUserId), read: !!r.readAt || r.fromUserId!.equals(me(req)), draft: r.draft, createdAt: r.createdAt.toISOString(),
    attachments: r.attachments.map(file).filter((x): x is AttachmentInfo => !!x), replyTo: r.replyTo ? String(r.replyTo) : null, toAddress: r.draft ? (r.toText ?? '') : null, canReply: !r.draft && !r.fromUserId!.equals(me(req)),
  }));
}
const inbox = (req: Request): Record<string, unknown> => ({ draft: false, ...(has(req, 'messages.manage') ? { $or: [{ toUserId: me(req) }, { toUserId: null }], fromUserId: { $ne: me(req) } } : { toUserId: me(req) }) });

messagesRouter.get('/', async (req, res) => {
  const q = parse(paginationSchema.extend({ box: z.enum(['inbox', 'outbox', 'drafts']).default('inbox'), q: z.string().trim().max(60).optional(), kind: z.enum(['member', 'vendor']).optional() }), req.query);
  const filter: Record<string, unknown> = q.box === 'inbox' ? inbox(req) : { fromUserId: me(req), draft: q.box === 'drafts' };
  const and: Record<string, unknown>[] = [];
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); and.push({ $or: [{ subject: rx }, { body: rx }] }); }
  if (q.kind && has(req, 'messages.manage') && q.box === 'inbox') and.push({ fromUserId: { $in: await UserModel.distinct('_id', { roles: q.kind }) } });
  if (and.length) filter.$and = and;
  const [rows, total] = await Promise.all([MessageModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), MessageModel.countDocuments(filter)]);
  res.json(paged(await messageRows(rows as never, req), q.page, q.pageSize, total));
});

async function visible(req: Request) {
  const id = assertObjectId(req.params.id, 'Message');
  const m = await MessageModel.findOne({ _id: id, $or: [{ fromUserId: me(req) }, { draft: false, toUserId: me(req) }, ...(has(req, 'messages.manage') ? [{ draft: false, toUserId: null }] : [])] });
  if (!m) throw notFound('Message');
  return m;
}
messagesRouter.get('/:id', async (req, res) => {
  const m = await visible(req);
  if (!m.readAt && !m.draft && !m.fromUserId!.equals(me(req))) { m.readAt = new Date(); await m.save(); }
  res.json((await messageRows([m.toObject() as never], req))[0]);
});

/** Members and vendors write to the team. Administrators with messages.manage can write to anyone. */
async function recipient(req: Request, to: string | undefined, replyTo: string | undefined): Promise<Types.ObjectId | null> {
  if (replyTo) {
    const src = await MessageModel.findOne({ _id: replyTo, draft: false, $or: [{ toUserId: me(req) }, ...(has(req, 'messages.manage') ? [{ toUserId: null }] : [])] }).lean();
    if (!src) throw notFound('Message');
    // A reply to staff goes to the whole team, so it isn't lost if that person is away.
    return src.fromStaff && !isStaff(req) ? null : src.fromUserId!;
  }
  if (!has(req, 'messages.manage')) return null;
  if (!to) throw badRequest('Enter who to send this to', { to: 'Enter a member ID or email' });
  const m = await MemberModel.findOne({ memberId: to.toUpperCase() }, { userId: 1 }).lean();
  const u = m?.userId ?? (await UserModel.findOne({ email: to.toLowerCase() }, { _id: 1 }).lean())?._id;
  if (!u) throw badRequest('Nobody found with this member ID or email', { to: 'Nobody found with this member ID or email' });
  if (u.equals(me(req))) throw badRequest('That’s you', { to: 'That’s you' });
  return u as Types.ObjectId;
}
async function write(req: Request, draftId?: string) {
  const input = parse(messageSchema, req.body);
  const attachments = await ownFiles(req, input.attachments);
  const doc: Record<string, unknown> = { fromUserId: me(req), fromStaff: isStaff(req), subject: input.subject, body: input.body, attachments, replyTo: input.replyTo ?? null, toText: input.to, draft: input.draft };
  if (!input.draft) {
    if (!isStaff(req)) await dailyLimit(MessageModel.countDocuments({ fromUserId: me(req), draft: false, createdAt: { $gte: dayAgo() } }), 30, 'messages');
    doc.toUserId = await recipient(req, input.to, input.replyTo);
  } else if ((await MessageModel.countDocuments({ fromUserId: me(req), draft: true })) >= 50 && !draftId) throw conflict('You have too many drafts');
  const m = draftId ? await MessageModel.findOneAndUpdate({ _id: draftId, fromUserId: me(req), draft: true }, doc, { new: true }) : await MessageModel.create(doc);
  if (!m) throw notFound('Draft');
  if (!m.draft && m.toUserId) {
    const to = await UserModel.findById(m.toUserId, { roles: 1 }).lean();
    await notify(m.toUserId, { event: 'message', title: `New message: ${m.subject}`, body: isStaff(req) ? 'From the JustReference team' : `From ${req.auth!.user.name}`, link: `${base((to?.roles as string[]) ?? [])}/messages/inbox?open=${m.id}`, key: `message:${m.id}` });
  }
  return (await messageRows([m.toObject() as never], req))[0];
}
messagesRouter.post('/', async (req, res) => void res.status(201).json(await write(req)));
messagesRouter.put('/:id', async (req, res) => void res.json(await write(req, assertObjectId(req.params.id, 'Draft'))));
messagesRouter.delete('/:id', async (req, res) => {
  const r = await MessageModel.deleteOne({ _id: assertObjectId(req.params.id, 'Draft'), fromUserId: me(req), draft: true });
  if (!r.deletedCount) throw notFound('Draft');
  res.status(204).end();
});

/* ================================================================ Tickets */
type LeanTicket = Ticket & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
async function ticketRows(rows: LeanTicket[]): Promise<TicketRow[]> {
  const who = await names(rows.map((r) => r.userId).filter(Boolean));
  return rows.map((t) => ({ id: String(t._id), ticketNo: t.ticketNo, subject: t.subject, category: t.category, priority: t.priority, status: t.status, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), user: t.userId ? { name: who(t.userId).name, memberId: who(t.userId).memberId, guest: false } : { name: t.guest?.name ?? '', guest: true, email: t.guest?.email ?? '' } }));
}
async function ticketDetail(t: LeanTicket, staffView: boolean): Promise<TicketDetail> {
  const [[row], file] = await Promise.all([ticketRows([t]), files(t.messages.flatMap((m) => m.attachments))]);
  return { ...row!, messages: t.messages.map((m) => ({ id: String((m as unknown as { _id: unknown })._id), from: m.staff && !staffView ? 'JustReference support' : (m.from ?? ''), staff: !!m.staff, body: m.body ?? '', createdAt: m.at!.toISOString(), attachments: m.attachments.map(file).filter((x): x is AttachmentInfo => !!x) })) };
}
const ticketNo = async () => `TKT${String(await nextSequence('ticket')).padStart(7, '0')}`;
const ticketQuery = paginationSchema.extend(dateRangeSchema.shape).extend({ status: z.enum([...TICKET_STATUSES, 'active', 'done']).optional(), q: z.string().trim().max(60).optional() });
function ticketFilter(q: z.output<typeof ticketQuery>, f: Record<string, unknown>) {
  if (q.status === 'active') f.status = { $in: ['open', 'in_progress'] };
  else if (q.status === 'done') f.status = { $in: ['resolved', 'closed'] };
  else if (q.status) f.status = q.status;
  const range = dateRangeFilter(q.from, q.to);
  if (range) f.createdAt = range;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); f.$or = [{ ticketNo: rx }, { subject: rx }]; }
  return f;
}
export const ticketsRouter = Router();
ticketsRouter.use(authenticate, requireRole('member', 'vendor'));
ticketsRouter.get('/', async (req, res) => {
  const q = parse(ticketQuery, req.query);
  const f = ticketFilter(q, { userId: me(req) });
  const [rows, total] = await Promise.all([TicketModel.find(f).sort({ updatedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), TicketModel.countDocuments(f)]);
  res.json(paged(await ticketRows(rows as never), q.page, q.pageSize, total));
});
ticketsRouter.post('/', async (req, res) => {
  const input = parse(ticketSchema, req.body);
  await dailyLimit(TicketModel.countDocuments({ userId: me(req), createdAt: { $gte: dayAgo() } }), 10, 'tickets');
  const t = await TicketModel.create({ ticketNo: await ticketNo(), userId: me(req), subject: input.subject, category: input.category, messages: [{ userId: me(req), from: req.auth!.user.name, staff: false, body: input.body, attachments: await ownFiles(req, input.attachments), at: new Date() }] });
  await notify(me(req), { event: 'support', title: `We received ${t.ticketNo}`, body: t.subject, link: `${base(req.auth!.user.roles)}/support/tickets/${t.id}`, key: `ticket:${t.id}:new` });
  res.status(201).json(await ticketDetail(t.toObject() as never, false));
});
const myTicket = async (req: Request) => {
  const t = await TicketModel.findOne({ _id: assertObjectId(req.params.id, 'Ticket'), userId: me(req) });
  if (!t) throw notFound('Ticket');
  return t;
};
ticketsRouter.get('/:id', async (req, res) => void res.json(await ticketDetail((await myTicket(req)).toObject() as never, false)));
ticketsRouter.post('/:id/replies', async (req, res) => {
  const input = parse(ticketReplySchema, req.body);
  const t = await myTicket(req);
  if (t.status === 'closed') throw conflict('This ticket is closed. Open a new one if you still need help.');
  if (t.messages.length >= 200) throw conflict('This ticket is too long. Please open a new one.');
  await TicketModel.updateOne({ _id: t._id }, { $push: { messages: { userId: me(req), from: req.auth!.user.name, staff: false, body: input.body, attachments: await ownFiles(req, input.attachments), at: new Date() } }, ...(t.status === 'resolved' ? { status: 'open' } : {}) });
  res.json(await ticketDetail((await myTicket(req)).toObject() as never, false));
});
ticketsRouter.post('/:id/close', async (req, res) => {
  const t = await myTicket(req);
  await TicketModel.updateOne({ _id: t._id }, { status: 'closed' });
  res.json(await ticketDetail((await myTicket(req)).toObject() as never, false));
});

/* Public contact form → a guest ticket */
export const contactRouter = Router();
contactRouter.post('/', publicFormLimiter, async (req, res) => {
  const input = parse(contactSchema, req.body);
  // Bots fill the hidden field: pretend it worked.
  if (input.website) return void res.status(201).json({ ticketNo: 'TKT0000000' });
  const t = await TicketModel.create({ ticketNo: await ticketNo(), userId: null, guest: { name: input.name, email: input.email }, subject: input.subject, category: 'other', messages: [{ from: input.name, staff: false, body: input.body, at: new Date() }] });
  res.status(201).json({ ticketNo: t.ticketNo });
});

/* ================================================================ Feedback */
export const feedbackRouter = Router();
feedbackRouter.post('/:orderId', authenticate, requireRole('member'), async (req, res) => {
  const input = parse(feedbackSchema, req.body);
  const o = await OrderModel.findOne({ _id: assertObjectId(req.params.orderId, 'Order'), buyerUserId: me(req), status: 'completed' }).lean();
  if (!o) throw conflict('You can review an order once it is completed');
  await FeedbackModel.findOneAndUpdate({ orderId: o._id }, { orderNo: o.orderNo, buyerUserId: me(req), vendorId: o.vendorId, ...input, status: 'pending' }, { upsert: true });
  res.status(201).json({ ok: true });
});
feedbackRouter.get('/mine/:orderId', authenticate, requireRole('member'), async (req, res) => {
  const f = await FeedbackModel.findOne({ orderId: assertObjectId(req.params.orderId, 'Order'), buyerUserId: me(req) }).lean();
  res.json(f ? { rating: f.rating, comment: f.comment, status: f.status } : null);
});
feedbackRouter.get('/vendor/:slug', async (req, res) => {
  const v = await VendorModel.findOne({ slug: String(req.params.slug), status: 'approved' }, { _id: 1 }).lean();
  if (!v) throw notFound('Vendor');
  const [rows, agg] = await Promise.all([FeedbackModel.find({ vendorId: v._id, status: 'published' }).sort({ createdAt: -1 }).limit(20).lean(), FeedbackModel.aggregate<{ n: number; avg: number }>([{ $match: { vendorId: v._id, status: 'published' } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$rating' } } }])]);
  const who = await names(rows.map((r) => r.buyerUserId));
  res.json({ count: agg[0]?.n ?? 0, average: agg[0] ? Math.round(agg[0].avg * 10) / 10 : null, data: rows.map((r) => { const [first, ...rest] = who(r.buyerUserId).name.split(' '); return { id: String(r._id), name: `${first}${rest.length ? ` ${rest.at(-1)![0]}.` : ''}`, rating: r.rating, comment: r.comment, createdAt: r.createdAt.toISOString() }; }) });
});

/* ================================================================ Admin (mounted after /admin authentication) */
export const adminCommsRouter = Router();
const tickets = requirePermission('tickets.manage');
adminCommsRouter.get('/tickets', tickets, async (req, res) => {
  const q = parse(ticketQuery, req.query);
  const f = ticketFilter(q, {});
  const [rows, total] = await Promise.all([TicketModel.find(f).sort({ updatedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), TicketModel.countDocuments(f)]);
  res.json(paged(await ticketRows(rows as never), q.page, q.pageSize, total));
});
const anyTicket = async (req: Request) => {
  const t = await TicketModel.findById(assertObjectId(req.params.id, 'Ticket'));
  if (!t) throw notFound('Ticket');
  return t;
};
adminCommsRouter.get('/tickets/:id', tickets, async (req, res) => void res.json(await ticketDetail((await anyTicket(req)).toObject() as never, true)));
async function tellOwner(t: { id: string; userId?: Types.ObjectId | null; ticketNo: string; subject: string; messages: unknown[]; status: string }, title: string, key: string) {
  if (!t.userId) return;
  const u = await UserModel.findById(t.userId, { roles: 1 }).lean();
  await notify(t.userId, { event: 'support', title, body: t.subject, link: `${base((u?.roles as string[]) ?? [])}/support/tickets/${t.id}`, key });
}
adminCommsRouter.post('/tickets/:id/replies', tickets, async (req, res) => {
  const input = parse(ticketReplySchema, req.body);
  const t0 = await anyTicket(req);
  if (t0.status === 'closed') throw conflict('This ticket is closed');
  await TicketModel.updateOne({ _id: t0._id }, { $push: { messages: { userId: me(req), from: req.auth!.user.name, staff: true, body: input.body, attachments: await ownFiles(req, input.attachments), at: new Date() } }, ...(t0.status === 'open' ? { status: 'in_progress' } : {}) });
  const t = await anyTicket(req);
  await tellOwner(t as never, `New reply on ${t.ticketNo}`, `ticket:${t.id}:reply:${t.messages.length}`);
  await audit(req, { action: 'ticket.reply', entity: 'ticket', entityId: t.id, summary: `Replied to ${t.ticketNo}` });
  res.json(await ticketDetail(t.toObject() as never, true));
});
adminCommsRouter.patch('/tickets/:id', tickets, async (req, res) => {
  const input = parse(ticketUpdateSchema, req.body);
  const t0 = await anyTicket(req);
  await TicketModel.updateOne({ _id: t0._id }, input);
  const t = await anyTicket(req);
  if (input.status && input.status !== t0.status) await tellOwner(t as never, `${t.ticketNo} is ${input.status.replace('_', ' ')}`, `ticket:${t.id}:${input.status}:${t.updatedAt.getTime()}`);
  await audit(req, { action: 'ticket.update', entity: 'ticket', entityId: t.id, summary: `${t.ticketNo}: ${Object.entries(input).map(([k, v]) => `${k} → ${v}`).join(', ')}` });
  res.json(await ticketDetail(t.toObject() as never, true));
});

const feedback = requirePermission('feedback.moderate');
adminCommsRouter.get('/feedback', feedback, async (req, res) => {
  const q = parse(paginationSchema.extend({ status: z.enum(['pending', 'published', 'hidden']).optional() }), req.query);
  const f = q.status ? { status: q.status } : {};
  const [rows, total] = await Promise.all([FeedbackModel.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), FeedbackModel.countDocuments(f)]);
  const [who, vendors] = await Promise.all([names(rows.map((r) => r.buyerUserId)), VendorModel.find({ _id: { $in: rows.map((r) => r.vendorId) } }, { businessName: 1 }).lean()]);
  res.json(paged(rows.map((r): FeedbackRow => ({ id: String(r._id), orderNo: r.orderNo ?? '', vendor: vendors.find((v) => v._id.equals(r.vendorId!))?.businessName ?? '—', buyer: who(r.buyerUserId).name, rating: r.rating, comment: r.comment, status: r.status, createdAt: r.createdAt.toISOString() })), q.page, q.pageSize, total));
});
adminCommsRouter.post('/feedback/:id', feedback, async (req, res) => {
  const { status } = parse(feedbackDecisionSchema, req.body);
  const r = await FeedbackModel.findByIdAndUpdate(assertObjectId(req.params.id, 'Feedback'), { status });
  if (!r) throw notFound('Feedback');
  await audit(req, { action: 'feedback.decide', entity: 'feedback', entityId: r.id, summary: `Review for ${r.orderNo}: ${status}` });
  res.json({ ok: true });
});
