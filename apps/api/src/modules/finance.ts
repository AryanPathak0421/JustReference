import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  activeSchema, commissionRuleSchema, couponAssignSchema, couponSchema, epinBuySchema, epinGenerateSchema, epinIssueSchema, epinRedeemSchema, idsSchema, LEDGER_CATEGORIES, moveSchema, planSchema,
  rewardSchema, subscribeSchema, topUpSchema, transferSchema, WALLET_TYPES, WITHDRAWAL_STATES, withdrawalDecisionSchema, withdrawalPaidSchema, withdrawSchema,
  type BusinessRow, type BusinessSummary, type CommissionRow, type CommissionRuleRow, type CouponRow, type EarningsSummary, type EpinRow, type LedgerRow, type MoneySummary, type MyCoupon, type PlanRow, type RewardRow,
  type SettlementRow, type SubscriptionView, type TdsRow, type WalletView, type WithdrawalRow,
} from '@jr/shared';
import { authenticate, requirePermission, requireRecentAuth, requireRole } from '../middleware/auth';
import { otpLimiter } from '../middleware/security';
import { CommissionModel, CommissionRuleModel, CouponModel, EpinModel, LedgerModel, PlanModel, RedemptionModel, RewardModel, SettlementModel, SubscriptionModel, TdsModel, WalletModel, WithdrawalModel, type CommissionRule, type Coupon, type Plan } from '../models/finance';
import { OrderModel } from '../models/commerce';
import { BankAccountModel } from '../models/vendor';
import { MemberModel } from '../models/member';
import { UserModel } from '../models/user';
import { SecurityCodeModel } from '../models/security';
import { JobRunModel } from '../models/referral';
import { AppError, badRequest, conflict, notFound } from '../core/errors';
import { assertObjectId, csvCell, dateRangeFilter, dateRangeSchema, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { activeGateway } from '../services/gateway';
import { getSettings } from '../services/settings';
import { startPayment, toPaymentView } from '../services/orders';
import {
  balances, buyEpin, checkPin, couponProblem, decideWithdrawal, generateEpins, hasLifetime, kycDone, markWithdrawalPaid, memberByCode, moveEarnings, payCommission, payReward, reconcile, redeemEpin, revealEpin, testMode, transfer, withdraw,
} from '../services/finance';
import { audit } from '../services/audit';

const me = (req: Request) => new Types.ObjectId(req.auth!.user.id);
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
const iso = (d?: Date | null) => d?.toISOString() ?? null;

type Person = { name: string; memberId?: string };
async function people(ids: unknown[]) {
  const [users, members] = await Promise.all([UserModel.find({ _id: { $in: ids } }, { name: 1 }).lean(), MemberModel.find({ userId: { $in: ids } }, { userId: 1, memberId: 1 }).lean()]);
  const mm = new Map(members.map((m) => [String(m.userId), m.memberId]));
  const map = new Map(users.map((u) => [String(u._id), { name: u.name, memberId: mm.get(String(u._id)) }]));
  return (id: unknown): Person => map.get(String(id)) ?? { name: '—' };
}
/** Turn a free-text search into user ids (name or member ID). */
async function searchUsers(q: string) {
  const rx = new RegExp(escapeRegex(q), 'i');
  const [u, m] = await Promise.all([UserModel.find({ name: rx }, { _id: 1 }).limit(500).lean(), MemberModel.find({ memberId: rx }, { userId: 1 }).limit(500).lean()]);
  return [...u.map((x) => x._id), ...m.map((x) => x.userId!)];
}
const listQuery = paginationSchema.extend(dateRangeSchema.shape).extend({ q: z.string().trim().max(60).optional(), status: z.string().trim().max(20).optional() });

/* ================================================================ Ledger reports */

const ledgerQuery = listQuery.extend({ wallet: z.enum(WALLET_TYPES).optional(), direction: z.enum(['credit', 'debit']).optional(), category: z.enum(LEDGER_CATEGORIES).optional(), format: z.enum(['json', 'csv']).default('json') });
async function ledgerReport(req: Request, res: Response, userId?: Types.ObjectId) {
  const q = parse(ledgerQuery, req.query);
  const filter: Record<string, unknown> = { isTest: testMode() };
  if (userId) filter.userId = userId;
  if (q.wallet) filter.wallet = q.wallet;
  if (q.direction) filter.direction = q.direction;
  if (q.category) filter.category = q.category;
  const range = dateRangeFilter(q.from, q.to);
  if (range) filter.createdAt = range;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ txnId: rx }, { description: rx }, ...(userId ? [] : [{ userId: { $in: await searchUsers(q.q) } }])];
  }
  const csv = q.format === 'csv';
  const [rows, total, sums] = await Promise.all([
    LedgerModel.find(filter).sort({ _id: -1 }).skip(csv ? 0 : (q.page - 1) * q.pageSize).limit(csv ? 10_000 : q.pageSize).lean(),
    LedgerModel.countDocuments(filter),
    LedgerModel.aggregate<{ _id: string; n: number }>([{ $match: filter }, { $group: { _id: '$direction', n: { $sum: '$amountPaise' } } }]),
  ]);
  const who = userId ? null : await people(rows.map((r) => r.userId));
  if (csv) {
    const lines = [['Transaction ID', 'Date', ...(who ? ['Member'] : []), 'Wallet', 'Type', 'Category', 'Description', 'Amount', 'Balance after'], ...rows.map((r) => [r.txnId, r.createdAt.toISOString(), ...(who ? [`${who(r.userId).name} ${who(r.userId).memberId ?? ''}`] : []), r.wallet, r.direction, r.category, r.description, (r.amountPaise / 100).toFixed(2), (r.balanceAfterPaise / 100).toFixed(2)])];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="transactions.csv"' });
    return void res.send(`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`);
  }
  const data: LedgerRow[] = rows.map((r) => ({ id: String(r._id), txnId: r.txnId, wallet: r.wallet, direction: r.direction, amountPaise: r.amountPaise, balanceAfterPaise: r.balanceAfterPaise, category: r.category, description: r.description, createdAt: r.createdAt.toISOString(), ...(who ? { user: who(r.userId) } : {}) }));
  const sum = (d: string) => sums.find((s) => s._id === d)?.n ?? 0;
  res.json({ ...paged(data, q.page, q.pageSize, total), creditPaise: sum('credit'), debitPaise: sum('debit') });
}

async function withdrawalList(req: Request, res: Response, base: Record<string, unknown>, withUser: boolean) {
  const q = parse(listQuery.extend({ status: z.enum([...WITHDRAWAL_STATES, 'open']).optional() }), req.query);
  const filter: Record<string, unknown> = { isTest: testMode(), ...base };
  if (q.status) filter.status = q.status === 'open' ? { $in: ['requested', 'approved'] } : q.status;
  const range = dateRangeFilter(q.from, q.to);
  if (range) filter.createdAt = range;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ requestNo: rx }, { utr: rx }, ...(withUser ? [{ userId: { $in: await searchUsers(q.q) } }] : [])]; }
  const [rows, total] = await Promise.all([WithdrawalModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), WithdrawalModel.countDocuments(filter)]);
  const who = withUser ? await people(rows.map((r) => r.userId)) : null;
  const data: WithdrawalRow[] = rows.map((r) => ({
    id: String(r._id), requestNo: r.requestNo, amountPaise: r.amountPaise, feePaise: r.feePaise, netPaise: r.netPaise, status: r.status, bank: r.bank as WithdrawalRow['bank'], utr: r.utr ?? null, reason: r.reason ?? null, createdAt: r.createdAt.toISOString(), paidAt: iso(r.paidAt), isTest: r.isTest,
    ...(who ? { user: { id: String(r.userId), ...who(r.userId) } } : {}),
  }));
  res.json(paged(data, q.page, q.pageSize, total));
}

async function commissionList(req: Request, res: Response, base: Record<string, unknown>, admin: boolean) {
  const q = parse(listQuery.extend({ status: z.enum(['pending', 'ready', 'paid', 'reversed']).optional(), scope: z.enum(['direct', 'indirect']).optional() }), req.query);
  const filter: Record<string, unknown> = { isTest: testMode(), ...base };
  if (q.status) filter.status = q.status === 'ready' ? 'pending' : q.status;
  if (q.status === 'ready') filter.availableAt = { $lte: new Date() };
  if (q.scope) filter.level = q.scope === 'direct' ? 1 : { $gt: 1 };
  const range = dateRangeFilter(q.from, q.to);
  if (range) filter.createdAt = range;
  if (q.q) filter.$or = [{ orderNo: new RegExp(escapeRegex(q.q), 'i') }, ...(admin ? [{ earnerUserId: { $in: await searchUsers(q.q) } }] : [])];
  const [rows, total] = await Promise.all([CommissionModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), CommissionModel.countDocuments(filter)]);
  const who = await people(rows.flatMap((r) => [r.earnerUserId, r.fromUserId]));
  const data: CommissionRow[] = rows.map((r) => ({
    id: String(r._id), orderNo: r.orderNo ?? '', level: r.level, grossPaise: r.grossPaise, tdsPaise: r.tdsPaise, netPaise: r.netPaise, reversedPaise: r.reversedPaise, status: r.status, availableAt: r.availableAt.toISOString(), createdAt: r.createdAt.toISOString(), from: who(r.fromUserId),
    ...(admin ? { earner: who(r.earnerUserId) } : {}), ruleName: r.ruleName ?? '', isTest: r.isTest,
  }));
  res.json(paged(data, q.page, q.pageSize, total));
}

async function tdsList(req: Request, res: Response, userId?: Types.ObjectId) {
  const q = parse(listQuery.extend({ fy: z.string().regex(/^\d{4}$/).optional() }), req.query);
  const filter: Record<string, unknown> = { isTest: testMode(), ...(userId ? { userId } : {}), ...(q.fy ? { financialYear: q.fy } : {}) };
  const range = dateRangeFilter(q.from, q.to);
  if (range) filter.createdAt = range;
  if (q.q && !userId) filter.userId = { $in: await searchUsers(q.q) };
  const [rows, total] = await Promise.all([TdsModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), TdsModel.countDocuments(filter)]);
  const who = await people(rows.map((r) => r.userId));
  const data: TdsRow[] = rows.map((r) => ({ id: String(r._id), financialYear: r.financialYear, source: r.source, grossPaise: r.grossPaise, ratePct: r.ratePct, tdsPaise: r.tdsPaise, panMasked: r.panMasked ?? null, createdAt: r.createdAt.toISOString(), ...(userId ? {} : { user: who(r.userId) }) }));
  res.json(paged(data, q.page, q.pageSize, total));
}

async function rewardList(req: Request, res: Response, userId?: Types.ObjectId) {
  const q = parse(listQuery.extend({ kind: z.enum(['cash', 'other']).optional() }), req.query);
  const filter: Record<string, unknown> = { isTest: testMode(), ...(userId ? { userId } : {}), ...(q.kind ? { kind: q.kind } : {}) };
  if (q.q && !userId) filter.userId = { $in: await searchUsers(q.q) };
  const [rows, total] = await Promise.all([RewardModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), RewardModel.countDocuments(filter)]);
  const who = await people(rows.map((r) => r.userId));
  const data: RewardRow[] = rows.map((r) => ({ id: String(r._id), kind: r.kind, title: r.title, reason: r.reason, amountPaise: r.amountPaise, tdsPaise: r.tdsPaise, createdAt: r.createdAt.toISOString(), ...(userId ? {} : { user: who(r.userId) }) }));
  res.json(paged(data, q.page, q.pageSize, total));
}

const toPlan = (p: Plan & { _id: unknown }): PlanRow => ({ id: String(p._id), name: p.name, kind: p.kind, durationDays: p.durationDays ?? null, pricePaise: p.pricePaise, benefits: p.benefits, active: p.active });

async function epinRows(req: Request, res: Response, filter: Record<string, unknown>) {
  const q = parse(listQuery, req.query);
  const f: Record<string, unknown> = { isTest: testMode(), ...filter };
  if (q.q) f.$or = [{ suffix: q.q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-4) }, { issuedToUserId: { $in: await searchUsers(q.q) } }, { usedByUserId: { $in: await searchUsers(q.q) } }];
  const [rows, total] = await Promise.all([EpinModel.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), EpinModel.countDocuments(f)]);
  const [who, plans] = await Promise.all([people(rows.flatMap((r) => [r.issuedToUserId, r.usedByUserId]).filter(Boolean)), PlanModel.find({ _id: { $in: rows.map((r) => r.planId) } }, { name: 1 }).lean()]);
  const data: EpinRow[] = rows.map((r) => ({
    id: String(r._id), suffix: r.suffix, plan: plans.find((p) => p._id.equals(r.planId!))?.name ?? '', status: r.status !== 'used' && r.expiresAt && r.expiresAt < new Date() ? 'expired' : r.status,
    issuedTo: r.issuedToUserId ? who(r.issuedToUserId) : null, usedBy: r.usedByUserId ? who(r.usedByUserId) : null, createdAt: r.createdAt.toISOString(), usedAt: iso(r.usedAt), expiresAt: iso(r.expiresAt),
  }));
  res.json(paged(data, q.page, q.pageSize, total));
}

/* ================================================================ Self-service (/finance) */

export const financeRouter = Router();
financeRouter.use(authenticate, requireRole('member', 'vendor'));
const memberOnly = requireRole('member');

financeRouter.get('/wallet', async (req, res) => {
  const [b, s, pinDoc, bank, kyc, pending] = await Promise.all([
    balances(me(req)), getSettings('wallet'), SecurityCodeModel.exists({ userId: me(req), type: 'transaction_pin' }), BankAccountModel.findOne({ userId: me(req) }).lean(), kycDone(me(req)),
    WithdrawalModel.aggregate<{ n: number }>([{ $match: { userId: me(req), isTest: testMode(), status: { $in: ['requested', 'approved'] } } }, { $group: { _id: null, n: { $sum: '$amountPaise' } } }]),
  ]);
  const view: WalletView = {
    ...b, testMode: testMode(), pinSet: !!pinDoc, pendingWithdrawalPaise: pending[0]?.n ?? 0, kycDone: kyc, settings: { ...s, canPay: !!activeGateway() },
    bank: bank ? { holderName: bank.holderName, accountLast4: bank.accountLast4, ifsc: bank.ifsc, bankName: bank.bankName } : null,
  };
  res.json(view);
});
financeRouter.get('/transactions', (req, res) => ledgerReport(req, res, me(req)));
financeRouter.post('/topup', memberOnly, async (req, res) => {
  const input = parse(topUpSchema, req.body);
  const s = await getSettings('wallet');
  if (!s.topUpEnabled) throw new AppError(403, 'DISABLED', 'Top-ups are switched off');
  if (input.amount < s.topUpMinPaise || input.amount > s.topUpMaxPaise) throw badRequest('Outside the top-up limits', { amount: `Between ${rs(s.topUpMinPaise)} and ${rs(s.topUpMaxPaise)}` });
  res.status(201).json(toPaymentView((await startPayment(me(req), { amountPaise: input.amount, purpose: 'topup', idempotencyKey: `topup:${input.idempotencyKey}` })) as never));
});
/** Confirm who will receive the money before sending it. Only the first name is shown. */
financeRouter.get('/recipient/:memberId', memberOnly, async (req, res) => {
  if (!(await getSettings('wallet')).transferEnabled) throw new AppError(403, 'DISABLED', 'Transfers are switched off');
  const to = await memberByCode(String(req.params.memberId).toUpperCase().slice(0, 20));
  const [first, ...rest] = to.name.split(' ');
  res.json({ name: `${first}${rest.length ? ` ${rest.at(-1)![0]}.` : ''}`, memberId: to.memberId });
});
financeRouter.post('/transfer', memberOnly, async (req, res) => {
  const input = parse(transferSchema, req.body);
  await transfer(me(req), input);
  await audit(req, { action: 'wallet.transfer', entity: 'user', entityId: req.auth!.user.id, summary: `Transferred ${rs(input.amount)} to ${input.memberId}` });
  res.json(await balances(me(req)));
});
financeRouter.post('/move', async (req, res) => {
  const input = parse(moveSchema, req.body);
  await moveEarnings(me(req), input);
  res.json(await balances(me(req)));
});
financeRouter.post('/withdrawals', async (req, res) => {
  const input = parse(withdrawSchema, req.body);
  await withdraw(me(req), input);
  await audit(req, { action: 'wallet.withdraw', entity: 'user', entityId: req.auth!.user.id, summary: `Requested a withdrawal of ${rs(input.amount)}` });
  res.status(201).json(await balances(me(req)));
});
financeRouter.get('/withdrawals', (req, res) => withdrawalList(req, res, { userId: me(req) }, false));
financeRouter.get('/commissions', (req, res) => commissionList(req, res, { earnerUserId: me(req) }, false));
financeRouter.get('/tds', (req, res) => tdsList(req, res, me(req)));
financeRouter.get('/rewards', (req, res) => rewardList(req, res, me(req)));
financeRouter.get('/settlements', requireRole('vendor'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = { userId: me(req), isTest: testMode() };
  const range = dateRangeFilter(q.from, q.to);
  if (range) filter.createdAt = range;
  const [rows, total] = await Promise.all([SettlementModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), SettlementModel.countDocuments(filter)]);
  res.json(paged(rows.map((r): SettlementRow => ({ id: String(r._id), orderNo: r.orderNo ?? '', grossPaise: r.grossPaise, feePaise: r.feePaise, netPaise: r.netPaise, reversedPaise: r.reversedPaise, createdAt: r.createdAt.toISOString(), isTest: r.isTest })), q.page, q.pageSize, total));
});

/** Earnings = commissions, rewards and (for vendors) settled sales, straight from the records. */
financeRouter.get('/earnings', async (req, res) => {
  const isTest = testMode();
  const userId = me(req);
  const [c, r, tds, months] = await Promise.all([
    CommissionModel.aggregate<{ _id: { s: string; d: boolean }; gross: number; net: number; rev: number }>([{ $match: { earnerUserId: userId, isTest } }, { $group: { _id: { s: '$status', d: { $eq: ['$level', 1] } }, gross: { $sum: '$grossPaise' }, net: { $sum: '$netPaise' }, rev: { $sum: '$reversedPaise' } } }]),
    RewardModel.aggregate<{ n: number }>([{ $match: { userId, isTest } }, { $group: { _id: null, n: { $sum: { $subtract: ['$amountPaise', '$tdsPaise'] } } } }]),
    TdsModel.aggregate<{ n: number }>([{ $match: { userId, isTest } }, { $group: { _id: null, n: { $sum: '$tdsPaise' } } }]),
    LedgerModel.aggregate<{ _id: string; n: number }>([
      { $match: { userId, isTest, category: { $in: ['commission', 'commission_reversal', 'reward', 'sale', 'sale_reversal'] }, createdAt: { $gte: new Date(Date.now() - 366 * 86_400_000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } }, n: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] } } } },
    ]),
  ]);
  const paid = await LedgerModel.aggregate<{ n: number }>([{ $match: { userId, isTest, category: { $in: ['commission', 'commission_reversal', 'reward', 'sale', 'sale_reversal'] } } }, { $group: { _id: null, n: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] } } } }]);
  const sum = (f: (x: (typeof c)[number]) => boolean, v: (x: (typeof c)[number]) => number) => c.filter(f).reduce((a, x) => a + v(x), 0);
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  const out: EarningsSummary = {
    paidPaise: paid[0]?.n ?? 0, pendingPaise: sum((x) => x._id.s === 'pending', (x) => x.gross - x.rev), directPaise: sum((x) => x._id.d && x._id.s !== 'pending', (x) => x.net), indirectPaise: sum((x) => !x._id.d && x._id.s !== 'pending', (x) => x.net),
    reversedPaise: sum(() => true, (x) => x.rev), rewardsPaise: r[0]?.n ?? 0, tdsPaise: tds[0]?.n ?? 0,
    months: Array.from({ length: 12 }, (_, i) => { const k = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7); return { month: k, valuePaise: months.find((m) => m._id === k)?.n ?? 0 }; }),
  };
  res.json(out);
});

/** Completed purchases by the member and their referral network. */
financeRouter.get('/business', async (req, res) => {
  const q = parse(listQuery.extend({ scope: z.enum(['direct', 'indirect', 'all']).default('all') }), req.query);
  const network = await MemberModel.find({ ancestorIds: me(req) }, { userId: 1, memberId: 1, ancestorIds: 1 }).limit(20_000).lean();
  const level = new Map(network.map((m) => [String(m.userId), m.ancestorIds.findIndex((a) => String(a) === String(me(req))) + 1]));
  const match: Record<string, unknown> = { status: 'completed', isTest: testMode(), buyerUserId: { $in: [me(req), ...network.map((m) => m.userId!)] } };
  const range = dateRangeFilter(q.from, q.to);
  if (range) match.completedAt = range;
  const rows = await OrderModel.aggregate<{ _id: Types.ObjectId; orders: number; value: number }>([{ $match: match }, { $group: { _id: '$buyerUserId', orders: { $sum: 1 }, value: { $sum: { $subtract: ['$paidPaise', '$creditedPaise'] } } } }, { $sort: { value: -1, _id: 1 } }]);
  const sum: BusinessSummary = { own: { orders: 0, valuePaise: 0 }, direct: { orders: 0, valuePaise: 0 }, indirect: { orders: 0, valuePaise: 0 } };
  for (const r of rows) { const l = level.get(String(r._id)); const k = !l ? 'own' : l === 1 ? 'direct' : 'indirect'; sum[k].orders += r.orders; sum[k].valuePaise += r.value; }
  const who = await people(rows.map((r) => r._id));
  let list: BusinessRow[] = rows.filter((r) => level.has(String(r._id))).map((r) => ({ name: who(r._id).name, memberId: who(r._id).memberId ?? '', level: level.get(String(r._id))!, orders: r.orders, valuePaise: r.value }));
  if (q.scope !== 'all') list = list.filter((r) => (q.scope === 'direct' ? r.level === 1 : r.level > 1));
  if (q.q) { const s = q.q.toLowerCase(); list = list.filter((r) => r.name.toLowerCase().includes(s) || r.memberId.toLowerCase().includes(s)); }
  res.json({ summary: sum, ...paged(list.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), q.page, q.pageSize, list.length) });
});

financeRouter.get('/coupons', memberOnly, async (req, res) => {
  const [coupons, used] = await Promise.all([
    CouponModel.find({ active: true, $or: [{ audience: 'everyone' }, { assignedUserIds: me(req) }] }).sort({ validTo: 1 }).limit(200).lean(),
    RedemptionModel.find({ userId: me(req) }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);
  const extra = await CouponModel.find({ _id: { $in: used.map((u) => u.couponId) } }).lean();
  const offer = (c: Coupon) => (c.kind === 'percent' ? `${c.value}% off${c.maxDiscountPaise ? `, up to ${rs(c.maxDiscountPaise)}` : ''}` : `₹${c.value} off`);
  const base = (c: Coupon & { _id: unknown }) => ({ code: c.code, name: c.name, offer: offer(c), minOrderPaise: c.minOrderPaise, validTo: c.validTo.toISOString() });
  const data: MyCoupon[] = [];
  for (const c of coupons) {
    const problem = await couponProblem(c as never, me(req));
    if (!problem) data.push({ id: String(c._id), ...base(c as never), status: 'unused' });
    else if (c.validTo < new Date() && !used.some((u) => u.couponId!.equals(c._id))) data.push({ id: String(c._id), ...base(c as never), status: 'expired' });
  }
  for (const u of used) { const c = extra.find((x) => x._id.equals(u.couponId!)); if (c) data.push({ id: String(u._id), ...base(c as never), status: 'used', discountPaise: u.discountPaise, usedAt: u.createdAt.toISOString() }); }
  res.json({ data });
});

financeRouter.get('/plans', async (_req, res) => void res.json({ data: (await PlanModel.find({ active: true, kind: { $ne: 'special' } }).sort({ pricePaise: 1 }).lean()).map((p) => toPlan(p as never)) }));
financeRouter.get('/subscriptions', memberOnly, async (req, res) => {
  const now = new Date();
  const rows = await SubscriptionModel.find({ userId: me(req), isTest: testMode() }).sort({ startAt: -1 }).lean();
  res.json({ data: rows.map((s): SubscriptionView => ({ id: String(s._id), plan: s.planName ?? '', startAt: s.startAt.toISOString(), endAt: iso(s.endAt), status: s.startAt > now ? 'upcoming' : s.endAt && s.endAt <= now ? 'expired' : 'active', via: s.via })) });
});
financeRouter.post('/subscriptions', memberOnly, async (req, res) => {
  const input = parse(subscribeSchema, req.body);
  const plan = await PlanModel.findOne({ _id: input.planId, active: true, kind: { $ne: 'special' } }).lean();
  if (!plan) throw notFound('Plan');
  if (await hasLifetime(me(req), testMode())) throw conflict('You already have a lifetime subscription');
  res.status(201).json(toPaymentView((await startPayment(me(req), { amountPaise: plan.pricePaise, purpose: 'subscription', planId: plan._id, idempotencyKey: `sub:${input.idempotencyKey}` })) as never));
});
financeRouter.get('/epins', memberOnly, (req, res) => epinRows(req, res, { issuedToUserId: me(req) }));
financeRouter.post('/epins', memberOnly, async (req, res) => {
  await buyEpin(me(req), parse(epinBuySchema, req.body));
  await audit(req, { action: 'epin.buy', entity: 'user', entityId: req.auth!.user.id, summary: 'Bought an E-PIN from the wallet' });
  res.status(201).json(await balances(me(req)));
});
financeRouter.post('/epins/redeem', memberOnly, otpLimiter, async (req, res) => {
  await redeemEpin(me(req), parse(epinRedeemSchema, req.body).code);
  await audit(req, { action: 'epin.redeem', entity: 'user', entityId: req.auth!.user.id, summary: 'Redeemed an E-PIN' });
  res.json({ redeemed: true });
});
financeRouter.post('/epins/:id/reveal', memberOnly, async (req, res) => {
  const { pin } = parse(z.object({ pin: z.string().max(6) }), req.body);
  await checkPin(me(req), pin);
  const code = await revealEpin({ _id: assertObjectId(req.params.id, 'E-PIN'), issuedToUserId: me(req), status: 'issued' });
  await audit(req, { action: 'epin.reveal', entity: 'epin', entityId: String(req.params.id), summary: 'Viewed own E-PIN' });
  res.json({ code });
});

/* ================================================================ Admin (mounted after /admin authentication) */

export const adminFinanceRouter = Router();
const perm = requirePermission;
const superOnly = perm('money.manage');

adminFinanceRouter.get('/finance/summary', perm('wallet.view'), async (_req, res) => {
  const isTest = testMode();
  const [w, wd, c, rules] = await Promise.all([
    WalletModel.aggregate<{ _id: string; n: number }>([{ $match: { isTest } }, { $group: { _id: '$type', n: { $sum: '$balancePaise' } } }]),
    WithdrawalModel.aggregate<{ _id: string; n: number; v: number }>([{ $match: { isTest } }, { $group: { _id: '$status', n: { $sum: 1 }, v: { $sum: '$amountPaise' } } }]),
    CommissionModel.aggregate<{ _id: string; g: number; net: number }>([{ $match: { isTest } }, { $group: { _id: '$status', g: { $sum: { $subtract: ['$grossPaise', '$reversedPaise'] } }, net: { $sum: '$netPaise' } } }]),
    CommissionRuleModel.countDocuments({ active: true }),
  ]);
  const open = wd.filter((x) => x._id === 'requested' || x._id === 'approved');
  const out: MoneySummary = {
    mainPaise: w.find((x) => x._id === 'main')?.n ?? 0, earningsPaise: w.find((x) => x._id === 'earnings')?.n ?? 0, withdrawalsPending: open.reduce((a, x) => a + x.n, 0), withdrawalsPendingPaise: open.reduce((a, x) => a + x.v, 0), withdrawnPaise: wd.find((x) => x._id === 'paid')?.v ?? 0,
    commissionsPendingPaise: c.find((x) => x._id === 'pending')?.g ?? 0, commissionsPaidPaise: c.filter((x) => x._id !== 'pending').reduce((a, x) => a + x.net, 0), activeRules: rules,
  };
  res.json(out);
});
adminFinanceRouter.get('/finance/transactions', perm('wallet.view'), (req, res) => ledgerReport(req, res));
adminFinanceRouter.get('/finance/balances', perm('wallet.view'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const match: Record<string, unknown> = { isTest: testMode(), ...(q.q ? { userId: { $in: await searchUsers(q.q) } } : {}) };
  const [r] = await WalletModel.aggregate<{ rows: { _id: Types.ObjectId; main: number; earnings: number }[]; total: { n: number }[] }>([
    { $match: match }, { $group: { _id: '$userId', main: { $sum: { $cond: [{ $eq: ['$type', 'main'] }, '$balancePaise', 0] } }, earnings: { $sum: { $cond: [{ $eq: ['$type', 'earnings'] }, '$balancePaise', 0] } } } },
    { $addFields: { t: { $add: ['$main', '$earnings'] } } }, { $sort: { t: -1, _id: 1 } }, { $facet: { rows: [{ $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }], total: [{ $count: 'n' }] } },
  ]);
  const who = await people(r!.rows.map((x) => x._id));
  res.json(paged(r!.rows.map((x) => ({ id: String(x._id), ...who(x._id), mainPaise: x.main, earningsPaise: x.earnings })), q.page, q.pageSize, r!.total[0]?.n ?? 0));
});
adminFinanceRouter.get('/finance/withdrawals', perm('wallet.view'), (req, res) => withdrawalList(req, res, {}, true));
adminFinanceRouter.post('/finance/withdrawals/:id/decision', requireRecentAuth, perm('wallet.view', 'wallet.payout'), async (req, res) => {
  const input = parse(withdrawalDecisionSchema, req.body);
  const w = await decideWithdrawal(assertObjectId(req.params.id, 'Withdrawal'), me(req), input.decision, input.reason);
  await audit(req, { action: 'withdrawal.decision', entity: 'withdrawal', entityId: w.id, summary: `${input.decision === 'approve' ? 'Approved' : 'Rejected'} ${w.requestNo} (${rs(w.amountPaise)})` });
  res.json({ status: w.status });
});
adminFinanceRouter.post('/finance/withdrawals/:id/paid', requireRecentAuth, perm('wallet.view', 'wallet.payout'), async (req, res) => {
  const { utr } = parse(withdrawalPaidSchema, req.body);
  const w = await markWithdrawalPaid(assertObjectId(req.params.id, 'Withdrawal'), me(req), utr);
  await audit(req, { action: 'withdrawal.paid', entity: 'withdrawal', entityId: w.id, summary: `Marked ${w.requestNo} paid (${rs(w.netPaise)}), UTR ${utr}` });
  res.json({ status: w.status });
});
adminFinanceRouter.get('/finance/commissions', perm('commissions.view'), (req, res) => commissionList(req, res, {}, true));
adminFinanceRouter.post('/finance/commissions/pay', requireRecentAuth, perm('commissions.view', 'commissions.pay'), async (req, res) => {
  const { ids } = parse(idsSchema, req.body);
  let paid = 0;
  const failed: { id: string; message: string }[] = [];
  for (const id of new Set(ids)) {
    try { await payCommission(id, me(req)); paid++; } catch (e) { if (!(e instanceof AppError)) throw e; failed.push({ id, message: e.message }); }
  }
  await audit(req, { action: 'commission.pay', entity: 'commission', entityId: '', summary: `Paid ${paid} commission(s)${failed.length ? `, ${failed.length} skipped` : ''}`, meta: { ids } });
  res.json({ paid, failed });
});
adminFinanceRouter.get('/finance/tds', perm('tds.view'), (req, res) => tdsList(req, res));
adminFinanceRouter.get('/finance/rewards', perm('rewards.manage'), (req, res) => rewardList(req, res));
adminFinanceRouter.post('/finance/rewards', requireRecentAuth, perm('rewards.manage'), async (req, res) => {
  const input = parse(rewardSchema, req.body);
  await payReward(me(req), input);
  await audit(req, { action: 'reward.pay', entity: 'member', entityId: input.memberId, summary: `Reward for ${input.memberId}: ${input.title}${input.kind === 'cash' ? ` (${rs(input.amount!)})` : ''}` });
  res.status(201).json({ ok: true });
});

/* Coupons */
const toCoupon = (c: Coupon & { _id: unknown }): CouponRow => ({
  id: String(c._id), code: c.code, name: c.name, kind: c.kind, value: c.value, minOrderPaise: c.minOrderPaise, maxDiscountPaise: c.maxDiscountPaise ?? null, listingTypes: c.listingTypes, fundedBy: c.fundedBy, validFrom: c.validFrom.toISOString(), validTo: c.validTo.toISOString(),
  totalLimit: c.totalLimit ?? null, perUserLimit: c.perUserLimit, usedCount: c.usedCount, audience: c.audience, assignedCount: c.assignedUserIds.length, active: c.active, expired: c.validTo < new Date(),
});
adminFinanceRouter.get('/coupons', perm('coupons.manage'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const rx = q.q ? new RegExp(escapeRegex(q.q), 'i') : null;
  const filter = rx ? { $or: [{ code: rx }, { name: rx }] } : {};
  const [rows, total] = await Promise.all([CouponModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), CouponModel.countDocuments(filter)]);
  res.json(paged(rows.map((r) => toCoupon(r as never)), q.page, q.pageSize, total));
});
adminFinanceRouter.post('/coupons', requireRecentAuth, perm('coupons.manage'), async (req, res) => {
  const i = parse(couponSchema, req.body);
  const c = await CouponModel.create({ ...i, minOrderPaise: i.minOrder, maxDiscountPaise: i.maxDiscount, validFrom: new Date(`${i.validFrom}T00:00:00+05:30`), validTo: new Date(`${i.validTo}T23:59:59.999+05:30`) });
  await audit(req, { action: 'coupon.create', entity: 'coupon', entityId: c.id, summary: `Created coupon ${c.code}` });
  res.status(201).json(toCoupon(c as never));
});
adminFinanceRouter.post('/coupons/:id/active', perm('coupons.manage'), async (req, res) => {
  const { active } = parse(activeSchema, req.body);
  const c = await CouponModel.findByIdAndUpdate(assertObjectId(req.params.id, 'Coupon'), { active }, { new: true });
  if (!c) throw notFound('Coupon');
  await audit(req, { action: 'coupon.active', entity: 'coupon', entityId: c.id, summary: `${active ? 'Switched on' : 'Switched off'} coupon ${c.code}` });
  res.json(toCoupon(c as never));
});
adminFinanceRouter.post('/coupons/:id/assign', perm('coupons.manage'), async (req, res) => {
  const { memberIds } = parse(couponAssignSchema, req.body);
  const members = await MemberModel.find({ memberId: { $in: memberIds } }, { userId: 1, memberId: 1 }).lean();
  const missing = memberIds.filter((id) => !members.some((m) => m.memberId === id));
  if (missing.length) throw badRequest(`No such member: ${missing.join(', ')}`, { memberIds: `Not found: ${missing.join(', ')}` });
  const c = await CouponModel.findByIdAndUpdate(assertObjectId(req.params.id, 'Coupon'), { $addToSet: { assignedUserIds: { $each: members.map((m) => m.userId) } } }, { new: true });
  if (!c) throw notFound('Coupon');
  await audit(req, { action: 'coupon.assign', entity: 'coupon', entityId: c.id, summary: `Assigned ${c.code} to ${members.length} member(s)` });
  res.json(toCoupon(c as never));
});

/* E-PINs */
adminFinanceRouter.get('/epins', perm('epins.manage'), async (req, res) => {
  const status = parse(z.enum(['fresh', 'issued', 'used', 'blocked']).optional(), req.query.status || undefined);
  await epinRows(req, res, status ? { status } : {});
});
adminFinanceRouter.post('/epins', requireRecentAuth, perm('epins.manage'), async (req, res) => {
  const input = parse(epinGenerateSchema, req.body);
  const codes = await generateEpins(input);
  await audit(req, { action: 'epin.generate', entity: 'plan', entityId: input.planId, summary: `Generated ${codes.length} E-PIN(s)${input.memberId ? ` for ${input.memberId}` : ''}` });
  res.status(201).json({ codes });
});
adminFinanceRouter.post('/epins/:id/issue', perm('epins.manage'), async (req, res) => {
  const { memberId } = parse(epinIssueSchema, req.body);
  const to = await memberByCode(memberId);
  const e = await EpinModel.findOneAndUpdate({ _id: assertObjectId(req.params.id, 'E-PIN'), status: 'fresh' }, { status: 'issued', issuedToUserId: to.userId });
  if (!e) throw conflict('Only fresh E-PINs can be issued');
  await audit(req, { action: 'epin.issue', entity: 'epin', entityId: e.id, summary: `Issued E-PIN ••••${e.suffix} to ${memberId}` });
  res.json({ ok: true });
});
adminFinanceRouter.post('/epins/:id/block', perm('epins.manage'), async (req, res) => {
  const e = await EpinModel.findOneAndUpdate({ _id: assertObjectId(req.params.id, 'E-PIN'), status: { $in: ['fresh', 'issued'] } }, { status: 'blocked' });
  if (!e) throw conflict('This E-PIN can’t be blocked');
  await audit(req, { action: 'epin.block', entity: 'epin', entityId: e.id, summary: `Blocked E-PIN ••••${e.suffix}` });
  res.json({ ok: true });
});

/* Plans: admins with E-PIN rights can read them; only the Super Admin changes them */
adminFinanceRouter.get('/plans', perm('epins.manage'), async (_req, res) => void res.json({ data: (await PlanModel.find().sort({ createdAt: -1 }).lean()).map((p) => toPlan(p as never)) }));
const planFields = (i: z.output<typeof planSchema>) => ({ name: i.name, kind: i.kind, durationDays: i.kind === 'lifetime' || i.kind === 'yearly' ? null : i.durationDays, pricePaise: i.price, benefits: i.benefits, active: i.active });
adminFinanceRouter.post('/plans', superOnly, async (req, res) => {
  const p = await PlanModel.create(planFields(parse(planSchema, req.body)));
  await audit(req, { action: 'plan.create', entity: 'plan', entityId: p.id, summary: `Created plan ${p.name} (${rs(p.pricePaise)})` });
  res.status(201).json(toPlan(p as never));
});
adminFinanceRouter.put('/plans/:id', superOnly, async (req, res) => {
  const id = assertObjectId(req.params.id, 'Plan');
  const before = await PlanModel.findById(id).lean();
  if (!before) throw notFound('Plan');
  const fields = planFields(parse(planSchema, req.body));
  // E-PINs already sold promise a kind and duration.
  if ((fields.kind !== before.kind || fields.durationDays !== before.durationDays) && (await EpinModel.exists({ planId: id, status: { $in: ['fresh', 'issued'] } }))) throw conflict('This plan has unused E-PINs, so its type and duration can’t change. Create a new plan.');
  const p = await PlanModel.findByIdAndUpdate(id, fields, { new: true });
  await audit(req, { action: 'plan.update', entity: 'plan', entityId: id, summary: `Updated plan ${fields.name}` });
  res.json(toPlan(p as never));
});

/* Commission rules (Super Admin) */
const toRule = (r: CommissionRule & { _id: unknown }): CommissionRuleRow => ({ id: String(r._id), name: r.name, listingTypes: r.listingTypes, basis: r.basis, levels: r.levels.map((l) => ({ kind: l.kind as 'percent' | 'flat', value: l.value })), maxPayoutPaise: r.maxPayoutPaise ?? null, effectiveFrom: r.effectiveFrom ?? null, effectiveTo: r.effectiveTo ?? null, active: r.active, version: r.version });
const ruleFields = (i: z.output<typeof commissionRuleSchema>) => ({ name: i.name, listingTypes: i.listingTypes, basis: i.basis, levels: i.levels, maxPayoutPaise: i.maxPayout, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo });
/** Two active rules may not cover the same listing type on the same day, so nobody is paid twice for one sale. */
async function assertNoOverlap(r: { listingTypes: string[]; effectiveFrom?: string | null; effectiveTo?: string | null }, exceptId: string) {
  const others = await CommissionRuleModel.find({ _id: { $ne: exceptId }, active: true, listingTypes: { $in: r.listingTypes } }).lean();
  const hit = others.find((o) => (o.effectiveFrom ?? '0') <= (r.effectiveTo ?? '9') && (r.effectiveFrom ?? '0') <= (o.effectiveTo ?? '9'));
  if (hit) throw conflict(`“${hit.name}” is already active for the same listing type and dates`);
}
adminFinanceRouter.get('/commission-rules', superOnly, async (_req, res) => void res.json({ data: (await CommissionRuleModel.find().sort({ createdAt: -1 }).lean()).map((r) => toRule(r as never)) }));
adminFinanceRouter.post('/commission-rules', superOnly, async (req, res) => {
  const r = await CommissionRuleModel.create({ ...ruleFields(parse(commissionRuleSchema, req.body)), active: false });
  await audit(req, { action: 'commission_rule.create', entity: 'commission_rule', entityId: r.id, summary: `Created commission rule ${r.name} (inactive)` });
  res.status(201).json(toRule(r as never));
});
adminFinanceRouter.put('/commission-rules/:id', requireRecentAuth, superOnly, async (req, res) => {
  const id = assertObjectId(req.params.id, 'Rule');
  const fields = ruleFields(parse(commissionRuleSchema, req.body));
  const before = await CommissionRuleModel.findById(id).lean();
  if (!before) throw notFound('Rule');
  if (before.active) await assertNoOverlap(fields, id);
  const r = await CommissionRuleModel.findByIdAndUpdate(id, { ...fields, $inc: { version: 1 } }, { new: true });
  await audit(req, { action: 'commission_rule.update', entity: 'commission_rule', entityId: id, summary: `Updated commission rule ${fields.name}`, meta: { before: before.levels, after: fields.levels } });
  res.json(toRule(r as never));
});
adminFinanceRouter.post('/commission-rules/:id/active', requireRecentAuth, superOnly, async (req, res) => {
  const { active } = parse(activeSchema, req.body);
  const id = assertObjectId(req.params.id, 'Rule');
  const before = await CommissionRuleModel.findById(id).lean();
  if (!before) throw notFound('Rule');
  if (active) await assertNoOverlap(before, id);
  const r = await CommissionRuleModel.findByIdAndUpdate(id, { active }, { new: true });
  await audit(req, { action: 'commission_rule.active', entity: 'commission_rule', entityId: id, summary: `${active ? 'Activated' : 'Deactivated'} commission rule ${before.name}` });
  res.json(toRule(r as never));
});

/* Reconciliation */
adminFinanceRouter.get('/finance/reconciliation', superOnly, async (_req, res) => {
  const job = await JobRunModel.findOne({ key: 'reconcile:latest' }).lean();
  res.json(job?.result ?? { ranAt: null, wallets: 0, mismatches: [] });
});
adminFinanceRouter.post('/finance/reconciliation', superOnly, async (_req, res) => void res.json(await reconcile()));
