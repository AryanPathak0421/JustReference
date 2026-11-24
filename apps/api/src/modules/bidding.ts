import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { acceptBidSchema, bidSchema, cancelSchema, PROJECT_REQUEST_STATUSES, projectRequestSchema, requestDecisionSchema, type BidView, type ProjectRequestView } from '@jr/shared';
import { authenticate, requirePermission, requireRole } from '../middleware/auth';
import { BidModel, ProjectRequestModel, type Bid, type ProjectRequest } from '../models/commerce';
import { CategoryModel } from '../models/catalog';
import { VendorModel } from '../models/vendor';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { badRequest, conflict, forbidden, notFound } from '../core/errors';
import { assertObjectId, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { activeGateway } from '../services/gateway';
import { getSettings } from '../services/settings';
import { advanceShare, createOrder, priceLine } from '../services/orders';
import { notify } from '../services/notify';
import { audit } from '../services/audit';

const me = (req: Request) => new Types.ObjectId(req.auth!.user.id);
type LeanReq = ProjectRequest & { _id: Types.ObjectId; createdAt: Date };
type LeanBid = Bid & { _id: Types.ObjectId; createdAt: Date };

async function bidViews(bids: LeanBid[]): Promise<BidView[]> {
  const vendors = await VendorModel.find({ _id: { $in: bids.map((b) => b.vendorId) } }, { businessName: 1, slug: 1, city: 1, gstin: 1 }).lean();
  return bids.map((b) => {
    const v = vendors.find((x) => x._id.equals(b.vendorId!));
    const p = priceLine(b.amountPaise, 1, b.gstRatePct, !!v?.gstin);
    return {
      id: String(b._id), vendor: { id: String(b.vendorId), name: v?.businessName ?? '—', slug: v?.slug ?? '', city: v?.city ?? '' }, amountPaise: b.amountPaise, advancePaise: b.advancePaise,
      gstRatePct: v?.gstin ? b.gstRatePct : 0, gstPaise: p.gstPaise, totalPaise: p.totalPaise, estimatedDays: b.estimatedDays, proposal: b.proposal, status: b.status, createdAt: b.createdAt.toISOString(),
    };
  });
}

/** `bids: 'all'` for the owner and admins; a vendor only ever sees their own bid. */
async function views(rows: LeanReq[], opts: { bids: 'all' | 'none'; vendorId?: Types.ObjectId; owner: boolean }): Promise<ProjectRequestView[]> {
  const ids = rows.map((r) => r._id);
  const owners = rows.map((r) => r.ownerUserId);
  const [cats, bids, counts, users, members] = await Promise.all([
    CategoryModel.find({ _id: { $in: rows.map((r) => r.categoryId) } }, { name: 1 }).lean(),
    opts.bids === 'all' ? BidModel.find({ requestId: { $in: ids } }).sort({ amountPaise: 1 }).lean() : opts.vendorId ? BidModel.find({ requestId: { $in: ids }, vendorId: opts.vendorId }).lean() : [],
    BidModel.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { requestId: { $in: ids }, status: { $ne: 'withdrawn' } } }, { $group: { _id: '$requestId', n: { $sum: 1 } } }]),
    opts.owner ? UserModel.find({ _id: { $in: owners } }, { name: 1 }).lean() : [],
    opts.owner ? MemberModel.find({ userId: { $in: owners } }, { userId: 1, memberId: 1 }).lean() : [],
  ]);
  const bv = await bidViews(bids as never);
  const byReq = (id: Types.ObjectId) => bv.filter((b) => bids.some((x) => String(x._id) === b.id && id.equals(x.requestId!)));
  return rows.map((r) => ({
    id: String(r._id), kind: r.kind, title: r.title, description: r.description, category: cats.find((c) => c._id.equals(r.categoryId!))?.name ?? '', budgetPaise: r.budgetPaise, timelineDays: r.timelineDays, city: r.city,
    status: r.status, rejectionReason: r.rejectionReason ?? null, createdAt: r.createdAt.toISOString(),
    owner: opts.owner ? { name: users.find((u) => u._id.equals(r.ownerUserId!))?.name ?? '—', memberId: members.find((m) => m.userId.equals(r.ownerUserId!))?.memberId } : null,
    bidCount: counts.find((c) => c._id.equals(r._id))?.n ?? 0, bids: opts.bids === 'all' ? byReq(r._id).filter((b) => b.status !== 'withdrawn') : [], myBid: opts.vendorId ? (byReq(r._id)[0] ?? null) : null,
    orderId: r.orderId && opts.bids === 'all' ? String(r.orderId) : null,
  }));
}

const listQuery = paginationSchema.extend({ status: z.enum(PROJECT_REQUEST_STATUSES).optional(), q: z.string().trim().max(80).optional() });

/* ================================================================ Member: post requests, choose bids */

export const projectRequestsRouter = Router();
projectRequestsRouter.use(authenticate, requireRole('member'));

async function own(req: Request) {
  const r = await ProjectRequestModel.findOne({ _id: assertObjectId(req.params.id, 'Project request'), ownerUserId: me(req) });
  if (!r) throw notFound('Project request');
  return r;
}
const ownView = async (id: unknown) => (await views([(await ProjectRequestModel.findById(id).lean()) as never], { bids: 'all', owner: true }))[0];

projectRequestsRouter.get('/', async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter = { ownerUserId: me(req), ...(q.status ? { status: q.status } : {}) };
  const [rows, total] = await Promise.all([ProjectRequestModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), ProjectRequestModel.countDocuments(filter)]);
  res.json(paged(await views(rows as never, { bids: 'none', owner: true }), q.page, q.pageSize, total));
});

projectRequestsRouter.post('/', async (req, res) => {
  const input = parse(projectRequestSchema, req.body);
  const cat = await CategoryModel.findOne({ _id: input.categoryId, kind: input.kind, parentId: null, isActive: true }).lean();
  if (!cat) throw badRequest('Choose a category from the list', { categoryId: 'Choose a category from the list' });
  const since = new Date(Date.now() - 86_400_000);
  if ((await ProjectRequestModel.countDocuments({ ownerUserId: me(req), createdAt: { $gte: since } })) >= 10) throw conflict('You can post up to 10 requests a day');
  const { projectRequestsNeedApproval } = await getSettings('commerce');
  const r = await ProjectRequestModel.create({ ...input, ownerUserId: me(req), budgetPaise: input.budget, status: projectRequestsNeedApproval ? 'pending_approval' : 'open' });
  await audit(req, { action: 'project_request.create', entity: 'project_request', entityId: r.id, summary: `Posted "${r.title}"` });
  res.status(201).json(await ownView(r._id));
});

projectRequestsRouter.get('/:id', async (req, res) => void res.json(await ownView((await own(req))._id)));

projectRequestsRouter.post('/:id/cancel', async (req, res) => {
  const r = await own(req);
  const done = await ProjectRequestModel.updateOne({ _id: r._id, status: { $in: ['pending_approval', 'open'] } }, { status: 'cancelled' });
  if (!done.modifiedCount) throw conflict('This request can no longer be withdrawn. Cancel the order instead.');
  await BidModel.updateMany({ requestId: r._id, status: 'submitted' }, { status: 'rejected' });
  res.json(await ownView(r._id));
});

projectRequestsRouter.post('/:id/bids/:bidId/reject', async (req, res) => {
  const r = await own(req);
  if (r.status !== 'open') throw conflict('This request is no longer open');
  const done = await BidModel.updateOne({ _id: assertObjectId(req.params.bidId, 'Bid'), requestId: r._id, status: 'submitted' }, { status: 'rejected' });
  if (!done.matchedCount) throw conflict('This bid can’t be rejected');
  res.json(await ownView(r._id));
});

/** Accepting a bid closes bidding and creates the order in one transaction. The buyer then pays the advance or full amount. */
projectRequestsRouter.post('/:id/bids/:bidId/accept', async (req, res) => {
  const input = parse(acceptBidSchema, req.body);
  const r = await own(req);
  const gw = activeGateway();
  if (!gw) throw conflict('Online payments aren’t available yet', undefined, 'PAYMENTS_OFF');
  const bidId = assertObjectId(req.params.bidId, 'Bid');
  const order = await mongoose.connection.transaction(async (session) => {
    const open = await ProjectRequestModel.findOneAndUpdate({ _id: r._id, status: 'open' }, { status: 'awarded', awardedBidId: bidId }, { session });
    if (!open) throw conflict('This request is no longer open');
    const bid = await BidModel.findOneAndUpdate({ _id: bidId, requestId: r._id, status: 'submitted' }, { status: 'accepted' }, { session });
    if (!bid) throw conflict('This bid is no longer available');
    const v = await VendorModel.findById(bid.vendorId).session(session).lean();
    if (!v || v.status !== 'approved') throw conflict('This vendor isn’t currently approved');
    await BidModel.updateMany({ requestId: r._id, status: 'submitted' }, { status: 'rejected' }, { session });
    const p = priceLine(bid.amountPaise, 1, bid.gstRatePct, !!v.gstin);
    const advance = input.plan === 'advance' && bid.advancePaise > 0 && bid.advancePaise < bid.amountPaise;
    const o = await createOrder({
      buyerUserId: me(req), vendorId: v._id, kind: r.kind, plan: advance ? 'advance' : 'full', advancePaise: advance ? advanceShare(bid.advancePaise, bid.amountPaise, p.totalPaise) : 0,
      items: [{ name: r.title, type: r.kind, qty: 1, unitPricePaise: bid.amountPaise, gstRatePct: v.gstin ? bid.gstRatePct : 0, ...p, note: `Accepted bid, about ${bid.estimatedDays} days` }],
      address: input.address, projectRequestId: r._id, isTest: gw.testMode,
    }, { userId: req.auth!.user.id, name: req.auth!.user.name }, session);
    await ProjectRequestModel.updateOne({ _id: r._id }, { orderId: o._id }, { session });
    return o;
  });
  const bidDoc = await BidModel.findById(bidId, { vendorId: 1 }).lean();
  const winner = bidDoc && (await VendorModel.findById(bidDoc.vendorId, { userId: 1 }).lean());
  await notify(winner?.userId, { event: 'bid', title: 'Your bid was accepted', body: r.title, link: `/vendor/bids/${r.id}`, key: `bid:${bidId}:accepted` });
  await audit(req, { action: 'bid.accept', entity: 'project_request', entityId: r.id, summary: `Accepted a bid; created ${order.orderNo}` });
  res.status(201).json({ orderId: String(order._id), orderNo: order.orderNo });
});

/* ================================================================ Vendor: find requests, bid (mounted after /vendor authentication) */

export const vendorBiddingRouter = Router();
const canBid = requirePermission('vendor.bids.submit');
async function approvedVendor(req: Request) {
  const v = await VendorModel.findOne({ userId: me(req) }, { status: 1 }).lean();
  if (!v) throw notFound('Business profile');
  if (v.status !== 'approved') throw forbidden('Your business must be approved before you can bid', 'VENDOR_NOT_APPROVED');
  return v;
}

vendorBiddingRouter.get('/project-requests', canBid, async (req, res) => {
  const v = await approvedVendor(req);
  const q = parse(paginationSchema.extend({ q: z.string().trim().max(80).optional(), mine: z.enum(['yes']).optional() }), req.query);
  const filter: Record<string, unknown> = { ownerUserId: { $ne: me(req) } };
  if (q.mine) filter._id = { $in: await BidModel.distinct('requestId', { vendorId: v._id }) };
  else filter.status = 'open';
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ title: rx }, { city: rx }]; }
  const [rows, total] = await Promise.all([ProjectRequestModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), ProjectRequestModel.countDocuments(filter)]);
  res.json(paged(await views(rows as never, { bids: 'none', vendorId: v._id, owner: false }), q.page, q.pageSize, total));
});

vendorBiddingRouter.get('/project-requests/:id', canBid, async (req, res) => {
  const v = await approvedVendor(req);
  const r = await ProjectRequestModel.findById(assertObjectId(req.params.id, 'Project request')).lean();
  const bid = r && (await BidModel.exists({ requestId: r._id, vendorId: v._id }));
  if (!r || (r.status !== 'open' && !bid)) throw notFound('Project request');
  res.json((await views([r as never], { bids: 'none', vendorId: v._id, owner: false }))[0]);
});

/** Submit, or change while the request is open and the bid hasn't been decided. */
vendorBiddingRouter.put('/project-requests/:id/bid', canBid, async (req, res) => {
  const v = await approvedVendor(req);
  const input = parse(bidSchema, req.body);
  const id = assertObjectId(req.params.id, 'Project request');
  await mongoose.connection.transaction(async (session) => {
    // Writing to the request makes this conflict with a simultaneous "accept", so no bid lands after closing.
    const r = await ProjectRequestModel.findOneAndUpdate({ _id: id, status: 'open' }, { $set: { updatedAt: new Date() } }, { session });
    if (!r) throw conflict('This request is no longer open for bids');
    if (r.ownerUserId!.equals(me(req))) throw forbidden('You can’t bid on your own request');
    const existing = await BidModel.findOne({ requestId: id, vendorId: v._id }).session(session);
    if (existing && !['submitted', 'withdrawn'].includes(existing.status)) throw conflict('This bid has already been decided');
    const fields = { amountPaise: input.amount, advancePaise: input.advance, gstRatePct: input.gstRatePct, estimatedDays: input.estimatedDays, proposal: input.proposal, status: 'submitted' as const };
    if (existing) await existing.set(fields).save({ session });
    else await BidModel.create([{ requestId: id, vendorId: v._id, ...fields }], { session });
  });
  const request = await ProjectRequestModel.findById(id, { ownerUserId: 1, title: 1 }).lean();
  await notify(request?.ownerUserId, { event: 'bid', title: 'New bid on your request', body: request?.title, link: `/member/projects/requests/${id}`, key: `bid:${id}:${v._id}` });
  await audit(req, { action: 'bid.submit', entity: 'project_request', entityId: id, summary: 'Submitted or updated a bid' });
  res.json((await views([(await ProjectRequestModel.findById(id).lean()) as never], { bids: 'none', vendorId: v._id, owner: false }))[0]);
});

vendorBiddingRouter.delete('/project-requests/:id/bid', canBid, async (req, res) => {
  const v = await approvedVendor(req);
  const id = assertObjectId(req.params.id, 'Project request');
  const done = await BidModel.updateOne({ requestId: id, vendorId: v._id, status: 'submitted' }, { status: 'withdrawn' });
  if (!done.modifiedCount) throw conflict('This bid can’t be withdrawn');
  res.json((await views([(await ProjectRequestModel.findById(id).lean()) as never], { bids: 'none', vendorId: v._id, owner: false }))[0]);
});

/* ================================================================ Admin: monitor and moderate */

export const adminBiddingRouter = Router();
adminBiddingRouter.get('/project-requests', requirePermission('bids.view'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = q.status ? { status: q.status } : {};
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ title: rx }, { city: rx }]; }
  const [rows, total] = await Promise.all([ProjectRequestModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), ProjectRequestModel.countDocuments(filter)]);
  res.json(paged(await views(rows as never, { bids: 'none', owner: true }), q.page, q.pageSize, total));
});
adminBiddingRouter.get('/project-requests/:id', requirePermission('bids.view'), async (req, res) => {
  const r = await ProjectRequestModel.findById(assertObjectId(req.params.id, 'Project request')).lean();
  if (!r) throw notFound('Project request');
  res.json(await ownView(r._id));
});
adminBiddingRouter.post('/project-requests/:id/decision', requirePermission('bids.view', 'bids.moderate'), async (req, res) => {
  const input = parse(requestDecisionSchema, req.body);
  const id = assertObjectId(req.params.id, 'Project request');
  const done = await ProjectRequestModel.updateOne({ _id: id, status: 'pending_approval' }, input.decision === 'approve' ? { status: 'open' } : { status: 'rejected', rejectionReason: input.reason });
  if (!done.modifiedCount) throw conflict('This request isn’t waiting for approval');
  const pr = await ProjectRequestModel.findById(id, { ownerUserId: 1, title: 1 }).lean();
  await notify(pr?.ownerUserId, { event: 'bid', title: input.decision === 'approve' ? 'Your project request is live' : 'Your project request wasn’t approved', body: pr?.title, link: `/member/projects/requests/${id}`, key: `request:${id}:${input.decision}` });
  await audit(req, { action: 'project_request.decision', entity: 'project_request', entityId: id, summary: `Project request: ${input.decision}` });
  res.json(await ownView(id));
});
adminBiddingRouter.post('/project-requests/:id/close', requirePermission('bids.view', 'bids.moderate'), async (req, res) => {
  const { reason } = parse(cancelSchema, req.body);
  const id = assertObjectId(req.params.id, 'Project request');
  const done = await ProjectRequestModel.updateOne({ _id: id, status: 'open' }, { status: 'cancelled', rejectionReason: reason });
  if (!done.modifiedCount) throw conflict('Only open requests can be closed');
  await BidModel.updateMany({ requestId: id, status: 'submitted' }, { status: 'rejected' });
  await audit(req, { action: 'project_request.close', entity: 'project_request', entityId: id, summary: `Closed a project request: ${reason}` });
  res.json(await ownView(id));
});
