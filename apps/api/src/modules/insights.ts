import { Router, type Request, type Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { REPORT_KEYS, testMessageSchema, type AdminStats, type HealthView, type ReportKey, type ReportResult, type SearchHit } from '@jr/shared';
import { authenticate, requirePermission, requireRole } from '../middleware/auth';
import { exportLimiter } from '../middleware/security';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { VendorModel } from '../models/vendor';
import { CategoryModel, ListingModel } from '../models/catalog';
import { OrderModel, ProjectRequestModel } from '../models/commerce';
import { FeedbackModel, TicketModel } from '../models/comms';
import { JobRunModel } from '../models/referral';
import { forbidden, notFound } from '../core/errors';
import { csvCell, dateRangeSchema, escapeRegex, paginationSchema, parse } from '../core/http';
import { env } from '../config/env';
import { testMode } from '../services/finance';
import { activeGateway } from '../services/gateway';
import { channelsReady, messaging } from '../services/messaging';
import { cell, runReport, toPdf, toXlsx, type Scope } from '../services/reports';
import { VISIBLE } from '../services/catalog';
import { audit } from '../services/audit';

const me = (req: Request) => new Types.ObjectId(req.auth!.user.id);
const EXPORT_MAX = 5_000;

/* ================================================================ Reports */
const reportQuery = paginationSchema.extend(dateRangeSchema.shape).extend({ q: z.string().trim().max(60).optional(), sort: z.string().max(20).optional(), dir: z.enum(['asc', 'desc']).default('desc'), format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') });

async function report(req: Request, res: Response, key: ReportKey, scope: Scope, personal: boolean) {
  const q = parse(reportQuery, req.query);
  const rx = q.q ? new RegExp(escapeRegex(q.q), 'i') : undefined;
  let people: Types.ObjectId[] | undefined;
  if (rx && !personal) {
    const [u, m] = await Promise.all([UserModel.find({ name: rx }, { _id: 1 }).limit(500).lean(), MemberModel.find({ memberId: rx }, { userId: 1 }).limit(500).lean()]);
    people = [...u.map((x) => x._id), ...m.map((x) => x.userId!)] as Types.ObjectId[];
  }
  const exporting = q.format !== 'json';
  const r = await runReport(key, scope, {
    from: q.from ? new Date(`${q.from}T00:00:00+05:30`) : undefined, to: q.to ? new Date(`${q.to}T23:59:59.999+05:30`) : undefined, q: rx, people, sort: q.sort, dir: q.dir === 'asc' ? 1 : -1, skip: exporting ? 0 : (q.page - 1) * q.pageSize, limit: exporting ? EXPORT_MAX : q.pageSize,
  });
  const limited = exporting && r.total > EXPORT_MAX;
  if (!exporting) return void res.json({ title: r.title, columns: r.columns, data: r.data, meta: { page: q.page, pageSize: q.pageSize, total: r.total }, totals: r.totals, limited: r.total > EXPORT_MAX } satisfies ReportResult);
  const period = q.from || q.to ? `${q.from ?? 'start'} to ${q.to ?? 'today'}` : 'All dates';
  // If the file is cut short, totals would not match the rows shown, so they are left out and the file says so.
  const built = { title: r.title, columns: r.columns, data: r.data, totals: limited ? {} : r.totals, subtitle: `${period} | ${r.total} records${limited ? ` (first ${EXPORT_MAX} shown, narrow the dates)` : ''}${scope.isTest ? ' | TEST DATA' : ''}` };
  const name = `${key}-${new Date().toISOString().slice(0, 10)}.${q.format}`;
  res.set({ 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' });
  if (!personal) await audit(req, { action: 'report.export', entity: 'report', entityId: key, summary: `Exported ${r.title} (${q.format}, ${r.data.length} rows)` });
  if (q.format === 'xlsx') return void res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await toXlsx(built));
  if (q.format === 'pdf') return void res.type('application/pdf').send(await toPdf(built));
  res.type('text/csv; charset=utf-8').send(`﻿${[r.columns.map((c) => c.label), ...r.data.map((d) => r.columns.map((c) => cell(c, d[c.key])))].map((l) => l.map(csvCell).join(',')).join('\r\n')}`);
}
const keyParam = z.enum(REPORT_KEYS as [ReportKey, ...ReportKey[]]);
const MEMBER_REPORTS: ReportKey[] = ['credit', 'debit', 'wallet', 'earnings', 'tds', 'withdrawals', 'purchases', 'invoices', 'rewards'];
const VENDOR_REPORTS: ReportKey[] = ['sales', 'invoices', 'settlements', 'credit', 'debit', 'wallet', 'earnings', 'tds', 'withdrawals'];

export const reportsRouter = Router();
reportsRouter.use(authenticate, requireRole('member', 'vendor'));
reportsRouter.get('/vendor/:key', requireRole('vendor'), exportLimiter, async (req, res) => {
  const key = parse(keyParam, req.params.key);
  if (!VENDOR_REPORTS.includes(key)) throw notFound('Report');
  const v = await VendorModel.findOne({ userId: me(req) }, { _id: 1 }).lean();
  if (!v) throw notFound('Business profile');
  await report(req, res, key, { userId: me(req), vendorId: v._id as Types.ObjectId, isTest: testMode() }, true);
});
reportsRouter.get('/:key', requireRole('member'), exportLimiter, async (req, res) => {
  const key = parse(keyParam, req.params.key);
  if (!MEMBER_REPORTS.includes(key)) throw notFound('Report');
  await report(req, res, key, { userId: me(req), isTest: testMode() }, true);
});

/* ================================================================ Search */
export const searchRouter = Router();
searchRouter.get('/', authenticate, async (req, res) => {
  const { q, panel } = parse(z.object({ q: z.string().trim().min(2).max(60), panel: z.enum(['member', 'vendor', 'admin', 'super-admin']) }), req.query);
  const rx = new RegExp(escapeRegex(q), 'i');
  const can = (p: string) => req.auth!.permissions.has(p);
  const roles = req.auth!.user.roles;
  const staff = panel === 'admin' || panel === 'super-admin';
  if (staff ? !roles.some((r) => r === 'admin' || r === 'super_admin') : !roles.includes(panel as 'member')) throw forbidden();
  const hits: SearchHit[] = [];
  const ordersIn = async (f: Record<string, unknown>, base: string) => { for (const o of await OrderModel.find({ ...f, $or: [{ orderNo: rx }, { 'items.name': rx }] }, { orderNo: 1, items: 1, status: 1 }).sort({ createdAt: -1 }).limit(5).lean()) hits.push({ group: 'Orders', title: o.orderNo, sub: `${o.items[0]?.name ?? ''} · ${o.status}`, to: `${base}/orders/${o._id}` }); };
  if (staff) {
    if (can('members.view')) {
      const ids = (await MemberModel.find({ memberId: rx }, { userId: 1 }).limit(5).lean()).map((m) => m.userId);
      for (const u of await UserModel.find({ roles: 'member', $or: [{ name: rx }, { email: rx }, { mobile: rx }, { _id: { $in: ids } }] }, { name: 1, email: 1 }).limit(5).lean()) hits.push({ group: 'Members', title: u.name, sub: u.email, to: `/${panel}/members/${u._id}` });
    }
    if (can('vendors.view')) for (const v of await VendorModel.find({ $or: [{ businessName: rx }, { city: rx }] }, { businessName: 1, city: 1 }).limit(5).lean()) hits.push({ group: 'Vendors', title: v.businessName, sub: v.city ?? '', to: `/${panel}/vendors/${v._id}` });
    if (can('orders.view')) await ordersIn({}, '/admin');
    if (can('tickets.manage')) for (const t of await TicketModel.find({ $or: [{ ticketNo: rx }, { subject: rx }] }, { ticketNo: 1, subject: 1 }).sort({ updatedAt: -1 }).limit(5).lean()) hits.push({ group: 'Tickets', title: t.ticketNo, sub: t.subject, to: `/admin/tickets/${t._id}` });
    if (can('catalog.view')) for (const l of await ListingModel.find({ name: rx }, { name: 1, type: 1, status: 1 }).limit(5).lean()) hits.push({ group: 'Listings', title: l.name, sub: `${l.type} · ${l.status}`, to: `/${panel}/${l.type}s/${l._id}` });
  } else if (panel === 'vendor') {
    const v = await VendorModel.findOne({ userId: me(req) }, { _id: 1 }).lean();
    if (v) {
      for (const l of await ListingModel.find({ vendorId: v._id, name: rx }, { name: 1, type: 1, status: 1 }).limit(5).lean()) hits.push({ group: 'My listings', title: l.name, sub: `${l.type} · ${l.status}`, to: `/vendor/${l.type}s/${l._id}` });
      await ordersIn({ vendorId: v._id, confirmedAt: { $ne: null } }, '/vendor');
    }
  } else {
    await ordersIn({ buyerUserId: me(req) }, '/member');
    for (const t of await TicketModel.find({ userId: me(req), $or: [{ ticketNo: rx }, { subject: rx }] }, { ticketNo: 1, subject: 1 }).limit(5).lean()) hits.push({ group: 'My tickets', title: t.ticketNo, sub: t.subject, to: `/member/support/tickets/${t._id}` });
    for (const l of await ListingModel.find({ ...VISIBLE, name: rx }, { name: 1, type: 1, slug: 1, city: 1 }).limit(6).lean()) hits.push({ group: 'Marketplace', title: l.name, sub: `${l.type} · ${l.city}`, to: `/${l.type}s/${l.slug}` });
  }
  res.json({ data: hits });
});

/* ================================================================ Admin */
export const adminInsightsRouter = Router();
const ADMIN_REPORTS: ReportKey[] = REPORT_KEYS;
adminInsightsRouter.get('/reports/:key', requirePermission('reports.view'), exportLimiter, async (req, res) => {
  const key = parse(keyParam, req.params.key);
  if (!ADMIN_REPORTS.includes(key)) throw notFound('Report');
  // A report never shows more than its module does.
  const needs: Partial<Record<ReportKey, string>> = { members: 'members.view', tds: 'tds.view', earnings: 'commissions.view', withdrawals: 'wallet.view', credit: 'wallet.view', debit: 'wallet.view', wallet: 'wallet.view', settlements: 'wallet.view', rewards: 'rewards.manage', sales: 'orders.view', purchases: 'orders.view', invoices: 'orders.view' };
  if (!req.auth!.permissions.has(needs[key]!)) throw forbidden('You don’t have permission to view this report', 'FORBIDDEN', { missing: [needs[key]] });
  await report(req, res, key, { isTest: testMode() }, false);
});

adminInsightsRouter.get('/stats', async (req, res) => {
  const now = new Date(Date.now() + 5.5 * 3_600_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 5.5 * 3_600_000);
  const yearAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const can = (p: string) => req.auth!.permissions.has(p);
  const n = (perm: string, f: () => Promise<number>) => (can(perm) ? f() : Promise.resolve(0));
  const paid = { isTest: testMode(), confirmedAt: { $ne: null } };
  const [members, membersThisMonth, vendors, vendorsPending, byType, listingsPending, referralsThisMonth, referred, openTickets, projectRequestsPending, feedbackPending, growth, recent, topV, topC] = await Promise.all([
    n('members.view', () => UserModel.countDocuments({ roles: 'member' })), n('members.view', () => UserModel.countDocuments({ roles: 'member', createdAt: { $gte: monthStart } })), n('vendors.view', () => VendorModel.countDocuments()), n('vendors.view', () => VendorModel.countDocuments({ status: 'pending' })),
    can('catalog.view') ? ListingModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$type', n: { $sum: 1 } } }]) : [], n('catalog.view', () => ListingModel.countDocuments({ status: 'pending_approval' })),
    n('members.view', () => MemberModel.countDocuments({ sponsorUserId: { $ne: null }, createdAt: { $gte: monthStart } })), n('members.view', () => MemberModel.countDocuments({ sponsorUserId: { $ne: null } })), n('tickets.manage', () => TicketModel.countDocuments({ status: { $in: ['open', 'in_progress'] } })),
    n('bids.view', () => ProjectRequestModel.countDocuments({ status: 'pending_approval' })), n('feedback.moderate', () => FeedbackModel.countDocuments({ status: 'pending' })),
    can('members.view') ? UserModel.aggregate<{ _id: { m: string; r: string }; n: number }>([{ $match: { createdAt: { $gte: yearAgo }, roles: { $in: ['member', 'vendor'] } } }, { $unwind: '$roles' }, { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } }, r: '$roles' }, n: { $sum: 1 } } }]) : [],
    can('members.view') ? UserModel.find({ roles: { $in: ['member', 'vendor'] } }, { name: 1, roles: 1, status: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(8).lean() : [],
    can('orders.view') ? OrderModel.aggregate<{ _id: Types.ObjectId; n: number; v: number }>([{ $match: paid }, { $group: { _id: '$vendorId', n: { $sum: 1 }, v: { $sum: { $subtract: ['$paidPaise', '$creditedPaise'] } } } }, { $sort: { v: -1 } }, { $limit: 5 }]) : [],
    can('orders.view') ? OrderModel.aggregate<{ _id: Types.ObjectId | null; n: number; v: number }>([{ $match: paid }, { $unwind: '$items' }, { $lookup: { from: ListingModel.collection.name, localField: 'items.listingId', foreignField: '_id', as: 'l', pipeline: [{ $project: { categoryId: 1 } }] } }, { $group: { _id: { $first: '$l.categoryId' }, n: { $sum: 1 }, v: { $sum: '$items.totalPaise' } } }, { $match: { _id: { $ne: null } } }, { $sort: { v: -1 } }, { $limit: 5 }]) : [],
  ]);
  const memberDocs = await MemberModel.find({ userId: { $in: recent.map((r) => r._id) } }, { userId: 1, memberId: 1, sponsorUserId: 1 }).lean();
  const sponsors = await MemberModel.find({ userId: { $in: memberDocs.map((m) => m.sponsorUserId).filter(Boolean) } }, { userId: 1, memberId: 1 }).lean();
  const [vn, cn] = await Promise.all([VendorModel.find({ _id: { $in: topV.map((t) => t._id) } }, { businessName: 1 }).lean(), CategoryModel.find({ _id: { $in: topC.map((t) => t._id) } }, { name: 1 }).lean()]);
  const type = (t: string) => byType.find((x) => x._id === t)?.n ?? 0;
  const out: AdminStats = {
    members, membersThisMonth, vendors, vendorsPending, products: type('product'), services: type('service'), projects: type('project'), listingsPending, referralsThisMonth, referredPct: members ? Math.round((referred / members) * 100) : 0, openTickets, projectRequestsPending, feedbackPending,
    growth: Array.from({ length: 12 }, (_, i) => { const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7); const g = (r: string) => growth.find((x) => x._id.m === m && x._id.r === r)?.n ?? 0; return { month: m, members: g('member'), vendors: g('vendor') }; }),
    recent: recent.map((u) => { const m = memberDocs.find((x) => x.userId!.equals(u._id)); return { id: String(u._id), name: u.name, role: (u.roles as string[]).includes('vendor') ? 'vendor' : 'member', memberId: m?.memberId ?? null, sponsor: m?.sponsorUserId ? (sponsors.find((s) => s.userId!.equals(m.sponsorUserId!))?.memberId ?? null) : null, status: u.status, date: u.createdAt.toISOString() }; }),
    topVendors: topV.map((t) => ({ name: vn.find((v) => v._id.equals(t._id))?.businessName ?? '—', orders: t.n, valuePaise: t.v })), topCategories: topC.map((t) => ({ name: cn.find((c) => c._id.equals(t._id!))?.name ?? '—', orders: t.n, valuePaise: t.v })),
  };
  res.json(out);
});

adminInsightsRouter.get('/health', requirePermission('settings.view'), async (_req, res) => {
  const t = performance.now();
  let ok = true;
  try { await mongoose.connection.db!.admin().ping(); } catch { ok = false; }
  const pingMs = Math.round(performance.now() - t);
  const jobs = await JobRunModel.find({ key: { $in: [/^birthday:/, /^reconcile:\d/] } }).sort({ startedAt: -1 }).limit(20).lean();
  const last = (p: string) => jobs.find((j) => j.key.startsWith(p));
  const out: HealthView = {
    database: { ok, pingMs, name: mongoose.connection.name }, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), node: process.version,
    jobs: [['Birthday greetings', 'birthday:'], ['Ledger check', 'reconcile:']].map(([key, p]) => ({ key: key!, at: last(p!)?.startedAt?.toISOString() ?? null })), messaging: channelsReady(), messagingDriver: env.MESSAGING_DRIVER, payments: activeGateway()?.name ?? 'off', storage: env.STORAGE_DRIVER, version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local',
  };
  res.json(out);
});
adminInsightsRouter.post('/messaging/test', requirePermission('settings.edit'), exportLimiter, async (req, res) => {
  const { channel } = parse(testMessageSchema, req.body);
  // Only ever to the administrator's own address, so this can't be used to send messages to others.
  const u = await UserModel.findById(me(req), { email: 1, mobile: 1 }).lean();
  await messaging.send({ channel, to: channel === 'email' ? u!.email : u!.mobile, subject: 'JustReference test message', text: 'This is a test message from JustReference.' });
  await audit(req, { action: 'messaging.test', entity: 'settings', entityId: channel, summary: `Sent a test ${channel} message to themselves` });
  res.json({ ok: true });
});
