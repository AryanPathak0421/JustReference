import { createHmac } from 'node:crypto';
import mongoose, { Types, type ClientSession } from 'mongoose';
import type { LedgerCategory, ReconciliationView, WalletType } from '@jr/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, badRequest, conflict, notFound } from '../core/errors';
import { decryptField, encryptField, randomCode, verifySecret } from '../core/crypto';
import { CommissionModel, CommissionRuleModel, CouponModel, EpinModel, LedgerModel, PlanModel, RedemptionModel, RewardModel, SettlementModel, SubscriptionModel, TdsModel, WalletModel, WithdrawalModel } from '../models/finance';
import { OrderModel, type Order, type OrderDoc } from '../models/commerce';
import { VendorModel, BankAccountModel, DocumentModel } from '../models/vendor';
import { MemberModel, ProfileModel } from '../models/member';
import { UserModel } from '../models/user';
import { SecurityCodeModel } from '../models/security';
import { JobRunModel } from '../models/referral';
import { nextSequence } from '../models/system';
import { activeGateway } from './gateway';
import { financialYear } from './invoices';
import { getSettings } from './settings';
import { notify } from './notify';

type Id = Types.ObjectId | string;
export const tx = <T>(fn: (s: ClientSession) => Promise<T>) => mongoose.connection.transaction(fn);
/** Sandbox gateway = test money, kept in separate wallets. */
export const testMode = () => !!activeGateway()?.testMode;
const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/* ================================================================ Ledger */

interface Posting { userId: Id; wallet: WalletType; isTest: boolean; direction: 'credit' | 'debit'; amountPaise: number; category: LedgerCategory; key: string; description: string; refId?: string; allowNegative?: boolean }

/** Call before a transaction that posts to these users, so the wallet documents already exist. */
export async function ensureWallets(userIds: Id[], isTest: boolean) {
  for (const userId of new Set(userIds.map(String))) {
    for (const type of ['main', 'earnings'] as const) {
      await WalletModel.updateOne({ userId, type, isTest }, { $setOnInsert: { balancePaise: 0 } }, { upsert: true }).catch((e) => { if (e.code !== 11000) throw e; });
    }
  }
}

/** The only code that changes a balance. Writes the ledger entry in the same transaction; a repeated key is refused by the unique index. */
export async function post(p: Posting, session: ClientSession) {
  if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) throw new Error('Ledger amounts must be positive whole paise');
  const debit = p.direction === 'debit';
  const w = await WalletModel.findOneAndUpdate(
    { userId: p.userId, type: p.wallet, isTest: p.isTest, ...(debit && !p.allowNegative ? { balancePaise: { $gte: p.amountPaise } } : {}) },
    { $inc: { balancePaise: debit ? -p.amountPaise : p.amountPaise } },
    { session, new: true },
  );
  if (!w) throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Not enough balance', { amount: 'Not enough balance' });
  const seq = await nextSequence('txn', session);
  await LedgerModel.create([{ ...p, txnId: `TXN${String(seq).padStart(10, '0')}`, balanceAfterPaise: w.balancePaise }], { session });
}

export async function balances(userId: Id, isTest = testMode()) {
  const rows = await WalletModel.find({ userId, isTest }).lean();
  const of = (t: WalletType) => rows.find((r) => r.type === t)?.balancePaise ?? 0;
  return { mainPaise: of('main'), earningsPaise: of('earnings') };
}

/** Wallet password (the transaction PIN): five wrong tries lock it for 15 minutes. */
export async function checkPin(userId: Id, pin: string) {
  const c = await SecurityCodeModel.findOne({ userId, type: 'transaction_pin' }).select('+hash');
  if (!c) throw new AppError(400, 'PIN_NOT_SET', 'Set a wallet password first', { pin: 'Set a wallet password first' });
  // Count the attempt before checking it, so parallel guesses can't get past the limit.
  const now = new Date();
  const slot = await SecurityCodeModel.findOneAndUpdate({ _id: c._id, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }, { $inc: { failedAttempts: 1 }, $set: { lockedUntil: null } }, { new: true });
  if (!slot) throw new AppError(429, 'PIN_LOCKED', 'Too many wrong tries. Try again in 15 minutes.', { pin: 'Locked for 15 minutes' });
  if (slot.failedAttempts > 5) {
    await SecurityCodeModel.updateOne({ _id: c._id }, { failedAttempts: 0, lockedUntil: new Date(now.getTime() + 15 * 60_000) });
    throw new AppError(429, 'PIN_LOCKED', 'Too many wrong tries. Try again in 15 minutes.', { pin: 'Locked for 15 minutes' });
  }
  if (!(await verifySecret(c.hash, pin))) throw new AppError(400, 'WRONG_PIN', 'Wrong wallet password', { pin: 'Wrong wallet password' });
  await SecurityCodeModel.updateOne({ _id: c._id }, { failedAttempts: 0 });
}

const dupKey = (e: unknown) => (e as { code?: number }).code === 11000;
/** Run once per idempotency key: a repeat of a finished request succeeds without doing anything. */
async function once(key: string, userId: Id, fn: (s: ClientSession) => Promise<void>) {
  const seen = () => LedgerModel.findOne({ key }, { userId: 1 }).lean();
  const prior = await seen();
  if (prior) { if (String(prior.userId) !== String(userId)) throw conflict('This request was already used'); return; }
  try { await tx(fn); } catch (e) { if (dupKey(e) && (await seen())) return; throw e; }
}

export async function memberByCode(memberId: string) {
  const m = await MemberModel.findOne({ memberId }).lean();
  const u = m && (await UserModel.findById(m.userId, { name: 1, status: 1 }).lean());
  if (!m || !u) throw badRequest('No member with this ID', { memberId: 'No member with this ID' });
  return { userId: m.userId!, memberId: m.memberId, name: u.name, active: u.status === 'active' };
}

export async function transfer(userId: Id, input: { memberId: string; amount: number; note?: string; pin: string; idempotencyKey: string }) {
  const s = await getSettings('wallet');
  if (!s.transferEnabled) throw new AppError(403, 'DISABLED', 'Transfers are switched off');
  if (input.amount > s.transferMaxPaise) throw badRequest('Over the transfer limit', { amount: `At most ₹${s.transferMaxPaise / 100}` });
  const to = await memberByCode(input.memberId);
  if (String(to.userId) === String(userId)) throw badRequest('You can’t transfer to yourself', { memberId: 'That’s your own ID' });
  if (!to.active) throw badRequest('This member can’t receive money', { memberId: 'This member can’t receive money' });
  await checkPin(userId, input.pin);
  const isTest = testMode();
  await ensureWallets([userId, to.userId], isTest);
  const me = await MemberModel.findOne({ userId }, { memberId: 1 }).lean();
  const key = `transfer:${userId}:${input.idempotencyKey}`;
  const send = () => once(key, userId, async (session) => {
    const common = { isTest, wallet: 'main' as const, amountPaise: input.amount, refId: key };
    await post({ ...common, userId, direction: 'debit', category: 'transfer_out', key, description: `Transfer to ${to.memberId}${input.note ? `: ${input.note}` : ''}` }, session);
    await post({ ...common, userId: to.userId, direction: 'credit', category: 'transfer_in', key: `${key}:in`, description: `Transfer from ${me?.memberId ?? 'a member'}${input.note ? `: ${input.note}` : ''}` }, session);
  });
  await send();
  await notify(to.userId, { event: 'wallet', title: `₹${(input.amount / 100).toFixed(2)} received`, body: `From ${me?.memberId ?? 'a member'}`, link: '/member/wallet/transactions', key: `${key}:in` });
}

/** Earnings → main wallet (own money). Never the other way, so topped-up money can't be withdrawn. */
export async function moveEarnings(userId: Id, input: { amount: number; pin: string; idempotencyKey: string }) {
  await checkPin(userId, input.pin);
  const isTest = testMode();
  await ensureWallets([userId], isTest);
  const key = `move:${userId}:${input.idempotencyKey}`;
  await once(key, userId, async (session) => {
    const c = { userId, isTest, amountPaise: input.amount, category: 'move' as const };
    await post({ ...c, wallet: 'earnings', direction: 'debit', key, description: 'Moved to main wallet' }, session);
    await post({ ...c, wallet: 'main', direction: 'credit', key: `${key}:in`, description: 'Moved from earnings' }, session);
  });
}

/* ================================================================ Withdrawals (earnings only) */

export async function kycDone(userId: Id) {
  const v = await VendorModel.findOne({ userId }, { status: 1 }).lean();
  if (v) return v.status === 'approved';
  const [p, d] = await Promise.all([ProfileModel.findOne({ userId }, { panMasked: 1 }).lean(), DocumentModel.exists({ userId, type: { $in: ['aadhaar', 'pan_card'] }, status: 'approved' })]);
  return !!p?.panMasked && !!d;
}

export async function withdraw(userId: Id, input: { amount: number; pin: string; idempotencyKey: string }) {
  const s = await getSettings('wallet');
  if (!s.withdrawEnabled) throw new AppError(403, 'DISABLED', 'Withdrawals are switched off');
  if (input.amount < s.withdrawMinPaise) throw badRequest('Below the minimum', { amount: `At least ₹${s.withdrawMinPaise / 100}` });
  const bank = await BankAccountModel.findOne({ userId }).lean();
  if (!bank) throw conflict('Add your bank account first', undefined, 'NO_BANK');
  if (s.withdrawRequiresKyc && !(await kycDone(userId))) throw conflict('Your KYC must be approved before you can withdraw', undefined, 'KYC_REQUIRED');
  await checkPin(userId, input.pin);
  const isTest = testMode();
  await ensureWallets([userId], isTest);
  const key = `withdraw:${userId}:${input.idempotencyKey}`;
  await once(key, userId, async (session) => {
    const seq = await nextSequence('withdrawal', session);
    const [w] = await WithdrawalModel.create([{
      requestNo: `WD${String(seq).padStart(8, '0')}`, userId, key, amountPaise: input.amount, feePaise: s.withdrawFeePaise, netPaise: input.amount - s.withdrawFeePaise, isTest,
      bank: { holderName: bank.holderName, accountLast4: bank.accountLast4, ifsc: bank.ifsc, bankName: bank.bankName },
    }], { session });
    // Taken from the balance at once, so the same money can't be requested twice.
    await post({ userId, isTest, wallet: 'earnings', direction: 'debit', amountPaise: input.amount, category: 'withdrawal', key, refId: w!.id, description: `Withdrawal ${w!.requestNo}` }, session);
  });
}

export async function decideWithdrawal(id: Id, by: Id, decision: 'approve' | 'reject', reason?: string) {
  const w0 = await WithdrawalModel.findById(id).lean();
  if (!w0) throw notFound('Withdrawal');
  if (String(w0.userId) === String(by)) throw conflict('You can’t decide your own withdrawal');
  const done = await tx(async (session) => {
    const w = await WithdrawalModel.findOneAndUpdate(
      { _id: id, status: decision === 'approve' ? 'requested' : { $in: ['requested', 'approved'] } },
      { status: decision === 'approve' ? 'approved' : 'rejected', reason, processedBy: by }, { session, new: true },
    );
    if (!w) throw conflict('This request has already been processed');
    if (decision === 'reject') await post({ userId: w.userId, isTest: w.isTest, wallet: 'earnings', direction: 'credit', amountPaise: w.amountPaise, category: 'withdrawal_return', key: `withdraw-return:${w.id}`, refId: w.id, description: `Withdrawal ${w.requestNo} returned` }, session);
    return w;
  });
  await tellWithdrawal(done);
  return done;
}

async function tellWithdrawal(w: { id?: string; _id: Types.ObjectId; userId?: Types.ObjectId | null; requestNo: string; status: string; reason?: string | null }) {
  const u = await UserModel.findById(w.userId, { roles: 1 }).lean();
  await notify(w.userId, { event: 'wallet', title: `Withdrawal ${w.requestNo} is ${w.status}`, body: w.reason ?? '', link: u?.roles.includes('member') ? '/member/wallet/payouts' : '/vendor/payouts', key: `withdrawal:${w._id}:${w.status}` });
}

export async function markWithdrawalPaid(id: Id, by: Id, utr: string) {
  const w0 = await WithdrawalModel.findById(id).lean();
  if (w0 && String(w0.userId) === String(by)) throw conflict('You can’t process your own withdrawal');
  try {
    const w = await WithdrawalModel.findOneAndUpdate({ _id: id, status: 'approved' }, { status: 'paid', utr, paidAt: new Date(), processedBy: by }, { new: true });
    if (!w) throw conflict('Only approved requests can be marked paid');
    await tellWithdrawal(w);
    return w;
  } catch (e) {
    if (dupKey(e)) throw conflict('This UTR is already recorded', { utr: 'This UTR is already recorded' });
    throw e;
  }
}

/* ================================================================ TDS */

async function takeTds(userId: Id, gross: number, source: 'commission' | 'reward', refId: string, isTest: boolean, session: ClientSession) {
  const s = await getSettings('earnings');
  const fy = financialYear(new Date());
  const profile = await ProfileModel.findOne({ userId }, { panMasked: 1 }).session(session).lean();
  const vendor = profile?.panMasked ? null : await VendorModel.findOne({ userId }, { panMasked: 1 }).session(session).lean();
  const pan = profile?.panMasked ?? vendor?.panMasked ?? null;
  const prior = await TdsModel.aggregate<{ n: number }>([{ $match: { userId: new Types.ObjectId(String(userId)), financialYear: fy, isTest } }, { $group: { _id: null, n: { $sum: '$grossPaise' } } }]).session(session);
  const applies = s.tdsEnabled && (source === 'commission' || s.tdsOnRewards) && (prior[0]?.n ?? 0) + gross > s.tdsThresholdPaise;
  const ratePct = applies ? (pan ? s.tdsRatePct : s.tdsNoPanRatePct) : 0;
  const tdsPaise = Math.round((gross * ratePct) / 100);
  // Recorded even at 0, so the yearly threshold counts every payout.
  await TdsModel.create([{ userId, financialYear: fy, source, refId, grossPaise: gross, ratePct, tdsPaise, panMasked: pan, isTest }], { session });
  return tdsPaise;
}

/* ================================================================ Commissions & vendor settlement */

/** Part of the price actually paid that has been refunded (extra money returned doesn't count). */
export const refundedOfPaid = (o: Pick<Order, 'refundedPaise' | 'capturedPaise' | 'paidPaise'>) => Math.min(o.paidPaise, Math.max(0, o.refundedPaise - (o.capturedPaise - o.paidPaise)));

/** Create pending commissions for a completed order, once, from the rules in force now. */
export async function createCommissions(orderId: Id) {
  const s = await getSettings('earnings');
  await tx(async (session) => {
    const o = await OrderModel.findOneAndUpdate({ _id: orderId, status: 'completed', commissionsDone: { $ne: true } }, { commissionsDone: true }, { session, new: true });
    if (!o) return;
    const today = istDate();
    const rules = (await CommissionRuleModel.find({ active: true, listingTypes: o.kind }).session(session).lean()).filter((r) => (!r.effectiveFrom || r.effectiveFrom <= today) && (!r.effectiveTo || r.effectiveTo >= today));
    if (!rules.length) return;
    const buyer = await MemberModel.findOne({ userId: o.buyerUserId }).session(session).lean();
    const upline = buyer?.ancestorIds ?? [];
    const active = new Set((await UserModel.find({ _id: { $in: upline }, status: 'active' }, { _id: 1 }).session(session).lean()).map((u) => String(u._id)));
    for (const r of rules) {
      const base = r.basis === 'with_gst' ? o.totalPaise : o.subtotalPaise;
      let left = r.maxPayoutPaise ?? Infinity;
      // Never pay out more than the sale itself, whatever flat amounts are configured.
      left = Math.min(left, base);
      for (const [i, l] of r.levels.entries()) {
        const earner = upline[i];
        if (!earner || !active.has(String(earner))) continue; // a blocked member's share is not passed up
        const gross = Math.min(left, l.kind === 'percent' ? Math.round((base * l.value) / 100) : Math.round(l.value * 100));
        if (gross <= 0) continue;
        left -= gross;
        await CommissionModel.create([{ orderId: o._id, orderNo: o.orderNo, earnerUserId: earner, fromUserId: o.buyerUserId, level: i + 1, ruleId: r._id, ruleVersion: r.version, ruleName: r.name, grossPaise: gross, availableAt: new Date((o.completedAt ?? new Date()).getTime() + s.commissionHoldDays * 86_400_000), isTest: o.isTest }], { session });
      }
    }
    await reverseForRefund(o, session);
  });
}

export async function payCommission(id: Id, by: Id) {
  const c0 = await CommissionModel.findById(id).lean();
  if (!c0) throw notFound('Commission');
  const earner = await UserModel.findById(c0.earnerUserId, { roles: 1 }).lean();
  if (String(c0.earnerUserId) === String(by)) throw conflict('You can’t pay your own commission');
  await ensureWallets([c0.earnerUserId!], c0.isTest);
  await tx(async (session) => {
    const c = await CommissionModel.findById(id).session(session);
    if (!c || c.status !== 'pending') throw conflict('Already processed');
    if (c.availableAt > new Date()) throw conflict('Still in the waiting period');
    if (!(await UserModel.exists({ _id: c.earnerUserId, status: 'active' }).session(session))) throw conflict('This member’s account is not active');
    // Writing to the order makes this conflict with a refund happening at the same moment.
    const o = await OrderModel.findOneAndUpdate({ _id: c.orderId }, { $set: { updatedAt: new Date() } }, { session, new: true });
    if (!o || o.refundRequestedPaise > 0) throw conflict('A refund on this order is waiting for a decision');
    const gross = c.grossPaise - c.reversedPaise;
    const tds = await takeTds(c.earnerUserId!, gross, 'commission', c.id, c.isTest, session);
    c.set({ status: 'paid', paidAt: new Date(), paidGrossPaise: gross, tdsPaise: tds, netPaise: gross - tds });
    await c.save({ session });
    if (gross - tds > 0) await post({ userId: c.earnerUserId!, isTest: c.isTest, wallet: 'earnings', direction: 'credit', amountPaise: gross - tds, category: 'commission', key: `commission:${c.id}`, refId: c.id, description: `Level ${c.level} commission, ${c.orderNo}` }, session);
  });
  await notify(c0.earnerUserId, { event: 'commission', title: 'Commission paid', body: `Level ${c0.level}, ${c0.orderNo}`, link: earner?.roles.includes('vendor') && !earner.roles.includes('member') ? '/vendor/earnings/commissions' : '/member/earnings/commissions', key: `commission:${c0._id}` });
}

/** Take back commission and vendor proceeds in proportion to what has been refunded. Safe to call after every refund. */
export async function reverseForRefund(o: OrderDoc, session: ClientSession) {
  const back = refundedOfPaid(o);
  if (back <= 0 || o.paidPaise <= 0) return;
  for (const c of await CommissionModel.find({ orderId: o._id }).session(session)) {
    const target = Math.round((c.grossPaise * back) / o.paidPaise);
    const delta = target - c.reversedPaise;
    if (delta <= 0) continue;
    if (c.status === 'paid' && c.paidGrossPaise > 0) {
      const net = Math.round((c.netPaise * delta) / c.paidGrossPaise);
      const tds = delta - net;
      if (net > 0) await post({ userId: c.earnerUserId!, isTest: c.isTest, wallet: 'earnings', direction: 'debit', allowNegative: true, amountPaise: net, category: 'commission_reversal', key: `commission-reversal:${c.id}:${target}`, refId: c.id, description: `Commission reversed: refund on ${c.orderNo}` }, session);
      await TdsModel.create([{ userId: c.earnerUserId, financialYear: financialYear(new Date()), source: 'commission_reversal', refId: c.id, grossPaise: -delta, ratePct: 0, tdsPaise: -tds, isTest: c.isTest }], { session });
    }
    c.reversedPaise = target;
    if (target >= c.grossPaise) c.status = 'reversed';
    await c.save({ session });
  }
  const st = await SettlementModel.findOne({ orderId: o._id }).session(session);
  if (st && o.paidPaise > st.baseRefundedPaise) {
    const target = Math.round((st.netPaise * (back - st.baseRefundedPaise)) / (o.paidPaise - st.baseRefundedPaise));
    const delta = target - st.reversedPaise;
    if (delta > 0) {
      await post({ userId: st.userId, isTest: st.isTest, wallet: 'earnings', direction: 'debit', allowNegative: true, amountPaise: delta, category: 'sale_reversal', key: `settlement-reversal:${st.id}:${target}`, refId: st.id, description: `Sale reversed: refund on ${st.orderNo}` }, session);
      st.reversedPaise = target;
      await st.save({ session });
    }
  }
}

/** Credit vendors for completed orders past the waiting period. Does nothing until a platform fee is set. */
export async function settleOrder(orderId: Id) {
  const s = await getSettings('earnings');
  if (s.platformFeePct == null) return false;
  const o0 = await OrderModel.findById(orderId).lean();
  const v = o0 && (await VendorModel.findById(o0.vendorId, { userId: 1 }).lean());
  if (!v) return false;
  await ensureWallets([v.userId!], o0.isTest);
  return tx(async (session) => {
    const o = await OrderModel.findOneAndUpdate(
      { _id: orderId, status: 'completed', settled: { $ne: true }, refundRequestedPaise: 0, completedAt: { $lte: new Date(Date.now() - s.settlementHoldDays * 86_400_000) } }, { settled: true }, { session, new: true },
    );
    if (!o) return false;
    const back = refundedOfPaid(o);
    const kept = o.paidPaise - back;
    // A platform-funded coupon doesn't cost the vendor anything.
    const gross = kept + (o.couponFundedBy === 'platform' && o.paidPaise ? Math.round((o.discountPaise * kept) / o.paidPaise) : 0);
    if (gross <= 0) return false;
    const fee = Math.round((gross * s.platformFeePct!) / 100);
    const [st] = await SettlementModel.create([{ orderId: o._id, orderNo: o.orderNo, vendorId: o.vendorId, userId: v.userId, grossPaise: gross, feePct: s.platformFeePct, feePaise: fee, netPaise: gross - fee, baseRefundedPaise: back, isTest: o.isTest }], { session });
    if (gross - fee > 0) await post({ userId: v.userId!, isTest: o.isTest, wallet: 'earnings', direction: 'credit', amountPaise: gross - fee, category: 'sale', key: `settlement:${st!.id}`, refId: st!.id, description: `Sale ${o.orderNo}${fee ? ` less fee ₹${(fee / 100).toFixed(2)}` : ''}` }, session);
    return true;
  });
}

export async function runMoneyJobs() {
  for (const o of await OrderModel.find({ status: 'completed', commissionsDone: { $ne: true } }, { _id: 1 }).limit(200).lean()) await createCommissions(o._id).catch((err) => logger.error({ err, orderId: String(o._id) }, 'Commission calculation failed'));
  const s = await getSettings('earnings');
  if (s.platformFeePct != null) {
    const due = await OrderModel.find({ status: 'completed', settled: { $ne: true }, refundRequestedPaise: 0, completedAt: { $lte: new Date(Date.now() - s.settlementHoldDays * 86_400_000) } }, { _id: 1 }).limit(200).lean();
    for (const o of due) await settleOrder(o._id).catch((err) => logger.error({ err, orderId: String(o._id) }, 'Settlement failed'));
  }
}

/* ================================================================ Coupons */

export async function releaseCoupon(orderId: Id, session: ClientSession) {
  const r = await RedemptionModel.findOneAndUpdate({ orderIds: orderId }, { $pull: { orderIds: orderId } }, { session, new: true });
  if (!r || r.orderIds.length) return;
  await RedemptionModel.deleteOne({ _id: r._id }, { session });
  await CouponModel.updateOne({ _id: r.couponId }, { $inc: { usedCount: -1 } }, { session });
}

/** Inside checkout: count the use, respecting the total and per-member limits even under simultaneous checkouts. */
export async function redeemCoupon(couponId: Id, userId: Id, orderIds: Types.ObjectId[], discountPaise: number, session: ClientSession) {
  const now = new Date();
  const c = await CouponModel.findOneAndUpdate(
    { _id: couponId, active: true, validFrom: { $lte: now }, validTo: { $gte: now }, $or: [{ totalLimit: null }, { $expr: { $lt: ['$usedCount', '$totalLimit'] } }] }, { $inc: { usedCount: 1 } }, { session, new: true },
  );
  if (!c || (await RedemptionModel.countDocuments({ couponId, userId }).session(session)) >= c.perUserLimit) throw conflict('This coupon is no longer available', undefined, 'COUPON_GONE');
  await RedemptionModel.create([{ couponId, userId, orderIds, discountPaise }], { session });
}

/** Why a coupon can't be used by this member right now, or null. */
export async function couponProblem(c: { _id: Types.ObjectId; active: boolean; validFrom: Date; validTo: Date; totalLimit?: number | null; usedCount: number; perUserLimit: number; audience: string; assignedUserIds: Types.ObjectId[] } | null, userId: Id, session?: ClientSession): Promise<string | null> {
  const now = new Date();
  if (!c || !c.active || (c.audience === 'assigned' && !c.assignedUserIds.some((x) => String(x) === String(userId)))) return 'This coupon isn’t valid';
  if (c.validFrom > now) return 'This coupon isn’t valid yet';
  if (c.validTo < now) return 'This coupon has expired';
  if (c.totalLimit != null && c.usedCount >= c.totalLimit) return 'This coupon has been used up';
  if ((await RedemptionModel.countDocuments({ couponId: c._id, userId }).session(session ?? null)) >= c.perUserLimit) return 'You’ve already used this coupon';
  return null;
}

/* ================================================================ Rewards */

export async function payReward(by: Id, input: { memberId: string; kind: 'cash' | 'other'; title: string; reason: string; amount?: number; idempotencyKey: string }) {
  const to = await memberByCode(input.memberId);
  if (String(to.userId) === String(by)) throw conflict('You can’t reward yourself');
  if (!to.active) throw badRequest('This member’s account is not active', { memberId: 'Account not active' });
  const isTest = testMode();
  await ensureWallets([to.userId], isTest);
  const key = `reward:${input.idempotencyKey}`;
  if (await RewardModel.exists({ key })) return;
  try {
    await tx(async (session) => {
      const amount = input.kind === 'cash' ? input.amount! : 0;
      const [r] = await RewardModel.create([{ userId: to.userId, kind: input.kind, title: input.title, reason: input.reason, amountPaise: amount, key, byUserId: by, isTest }], { session });
      if (!amount) return;
      const tds = await takeTds(to.userId, amount, 'reward', r!.id, isTest, session);
      r!.tdsPaise = tds;
      await r!.save({ session });
      if (amount - tds > 0) await post({ userId: to.userId, isTest, wallet: 'earnings', direction: 'credit', amountPaise: amount - tds, category: 'reward', key, refId: r!.id, description: `Reward: ${input.title}` }, session);
    });
  } catch (e) { if (!dupKey(e)) throw e; return; }
  await notify(to.userId, { event: 'wallet', title: `Reward: ${input.title}`, body: input.reason, link: `/member/rewards/${input.kind}`, key });
}

/* ================================================================ Subscriptions & E-PINs */

export async function hasLifetime(userId: Id, isTest: boolean) {
  return !!(await SubscriptionModel.exists({ userId, isTest, endAt: null }));
}

/** Starts now, or when the current subscription ends. */
export async function activateSubscription(userId: Id, planId: Id, via: 'payment' | 'epin', ref: string, isTest: boolean, session: ClientSession) {
  const plan = await PlanModel.findById(planId).session(session).lean();
  if (!plan) throw notFound('Plan');
  // Touch the user so two activations at once can't overlap.
  await UserModel.updateOne({ _id: userId }, { $set: { updatedAt: new Date() } }, { session });
  const last = await SubscriptionModel.findOne({ userId, isTest, endAt: { $gt: new Date() } }).sort({ endAt: -1 }).session(session).lean();
  const startAt = last?.endAt ?? new Date();
  let endAt: Date | null = null;
  if (plan.kind === 'yearly') { endAt = new Date(startAt); endAt.setUTCFullYear(endAt.getUTCFullYear() + 1); }
  else if (plan.kind !== 'lifetime') endAt = new Date(startAt.getTime() + plan.durationDays! * 86_400_000);
  await SubscriptionModel.create([{ userId, planId, planName: plan.name, startAt, endAt, via, ref, isTest }], { session });
}

const epinHash = (code: string) => createHmac('sha256', createHmac('sha256', env.JWT_ACCESS_SECRET).update('epin').digest()).update(code).digest('hex');
const pretty = (c: string) => c.match(/.{4}/g)!.join('-');
const newEpin = (extra: Record<string, unknown>) => { const code = randomCode(16); return { code, doc: { ...extra, codeHash: epinHash(code), codeEncrypted: encryptField(code), suffix: code.slice(-4) } }; };

export async function generateEpins(input: { planId: string; count: number; memberId?: string; expiresOn: string | null; idempotencyKey: string }) {
  if (!(await PlanModel.exists({ _id: input.planId }))) throw notFound('Plan');
  const owner = input.memberId ? await memberByCode(input.memberId.toUpperCase()) : null;
  const expiresAt = input.expiresOn ? new Date(`${input.expiresOn}T23:59:59+05:30`) : undefined;
  if (expiresAt && expiresAt < new Date()) throw badRequest('The expiry date has passed', { expiresOn: 'Choose a future date' });
  const made = Array.from({ length: input.count }, (_, seq) => newEpin({ planId: input.planId, batchKey: input.idempotencyKey, seq, status: owner ? 'issued' : 'fresh', issuedToUserId: owner?.userId ?? null, expiresAt, isTest: testMode() }));
  try { await tx((session) => EpinModel.create(made.map((m) => m.doc), { session, ordered: true })); } catch (e) { if (dupKey(e)) throw conflict('These E-PINs were already generated'); throw e; }
  return made.map((m) => pretty(m.code));
}

export async function buyEpin(userId: Id, input: { planId: string; pin: string; idempotencyKey: string }) {
  if (!(await getSettings('wallet')).memberEpinEnabled) throw new AppError(403, 'DISABLED', 'Members can’t generate E-PINs at the moment');
  const plan = await PlanModel.findOne({ _id: input.planId, active: true, kind: { $ne: 'special' } }).lean();
  if (!plan) throw notFound('Plan');
  await checkPin(userId, input.pin);
  const isTest = testMode();
  await ensureWallets([userId], isTest);
  const key = `epin:${userId}:${input.idempotencyKey}`;
  await once(key, userId, async (session) => {
    const { doc } = newEpin({ planId: plan._id, batchKey: key, seq: 0, status: 'issued', issuedToUserId: userId, isTest });
    await EpinModel.create([doc], { session });
    await post({ userId, isTest, wallet: 'main', direction: 'debit', amountPaise: plan.pricePaise, category: 'epin', key, description: `E-PIN for ${plan.name}` }, session);
  });
}

export async function redeemEpin(userId: Id, code: string) {
  const isTest = testMode();
  if (await hasLifetime(userId, isTest)) throw conflict('You already have a lifetime subscription');
  await tx(async (session) => {
    const e = await EpinModel.findOneAndUpdate(
      { codeHash: epinHash(code), isTest, status: { $in: ['fresh', 'issued'] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }, { status: 'used', usedByUserId: userId, usedAt: new Date() }, { session, new: true },
    );
    if (!e) throw badRequest('This E-PIN is not valid, already used or expired', { code: 'Not valid, already used or expired' });
    await activateSubscription(userId, e.planId!, 'epin', `epin:${e.id}`, isTest, session);
  });
}

export async function revealEpin(filter: Record<string, unknown>) {
  const e = await EpinModel.findOne(filter).select('+codeEncrypted');
  if (!e) throw notFound('E-PIN');
  return pretty(decryptField(e.codeEncrypted));
}

/* ================================================================ Reconciliation */

/** Compare every balance with the sum of its ledger entries, on one consistent snapshot. */
export async function reconcile(): Promise<ReconciliationView> {
  const session = await mongoose.startSession();
  try {
    session.startTransaction({ readConcern: { level: 'snapshot' } });
    const wallets = await WalletModel.find().session(session).lean();
    const sums = await LedgerModel.aggregate<{ _id: { u: Types.ObjectId; w: string; t: boolean }; n: number }>([
      { $group: { _id: { u: '$userId', w: '$wallet', t: '$isTest' }, n: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] } } } },
    ]).session(session);
    await session.commitTransaction();
    const k = (u: unknown, w: string, t: boolean) => `${u}:${w}:${t}`;
    const ledger = new Map(sums.map((r) => [k(r._id.u, r._id.w, r._id.t), r.n]));
    const mismatches = [];
    for (const w of wallets) {
      const id = k(w.userId, w.type, w.isTest);
      const n = ledger.get(id) ?? 0;
      ledger.delete(id);
      if (n !== w.balancePaise) mismatches.push({ user: String(w.userId), wallet: `${w.type}${w.isTest ? ' (test)' : ''}`, balancePaise: w.balancePaise, ledgerPaise: n });
    }
    for (const [id, n] of ledger) if (n !== 0) mismatches.push({ user: id.split(':')[0]!, wallet: `${id.split(':')[1]} (missing)`, balancePaise: 0, ledgerPaise: n });
    if (mismatches.length) logger.error({ count: mismatches.length }, 'Ledger reconciliation found mismatches');
    const result = { ranAt: new Date().toISOString(), wallets: wallets.length, mismatches: mismatches.slice(0, 100) };
    await JobRunModel.updateOne({ key: 'reconcile:latest' }, { $set: { startedAt: new Date(), finishedAt: new Date(), result } }, { upsert: true });
    return result;
  } finally { await session.endSession(); }
}

export function scheduleMoneyJobs() {
  const tick = async () => {
    try {
      await runMoneyJobs();
      const key = `reconcile:${istDate()}`;
      if (!(await JobRunModel.exists({ key }))) { await JobRunModel.create({ key }); await reconcile(); }
    } catch (err) { if (!dupKey(err)) logger.error({ err }, 'Money jobs failed'); }
  };
  void tick();
  return setInterval(() => void tick(), 60_000).unref();
}
