import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, auth, login, makeFullAdmin, makeSuperAdmin, makeUser, PASSWORD } from './helpers';
import { seedDefaultCategories } from '../src/seed/catalog';
import { CategoryModel, ListingModel } from '../src/models/catalog';
import { CommissionModel, EpinModel, LedgerModel, RedemptionModel, SettlementModel, SubscriptionModel, TdsModel, WalletModel, WithdrawalModel, CouponModel } from '../src/models/finance';
import { OrderModel, PaymentModel } from '../src/models/commerce';
import { BankAccountModel, DocumentModel } from '../src/models/vendor';
import { ProfileModel } from '../src/models/member';
import { createVendorShell } from '../src/services/vendors';
import { ensureWallets, post, reconcile, runMoneyJobs, tx } from '../src/services/finance';
import { SETTINGS_DEFAULTS, saveSettings } from '../src/services/settings';
import { expireUnpaid } from '../src/services/orders';
import type { EarningsSettings, WalletSettings } from '@jr/shared';

const api = (t: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set(auth(t)),
  post: (p: string, b: object = {}) => request(app).post(`/api/v1${p}`).set(auth(t)).send(b),
  put: (p: string, b: object) => request(app).put(`/api/v1${p}`).set(auth(t)).send(b),
});
type Api = ReturnType<typeof api>;
const ADDRESS = { name: 'Asha Rao', mobile: '9812345678', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
const PIN = '482915';
let n = 0;
const key = () => `fin-key-${String(++n).padStart(12, '0')}`;
const actor = new mongoose.Types.ObjectId().toString();
const wallet = (v: Partial<WalletSettings>) => saveSettings('wallet', { ...SETTINGS_DEFAULTS.wallet, ...v }, actor);
const earnings = (v: Partial<EarningsSettings>) => saveSettings('earnings', { ...SETTINGS_DEFAULTS.earnings, ...v }, actor);

async function member(opts: { ref?: string; pin?: boolean } = {}) {
  const { user, member: m } = await makeUser({ referralCode: opts.ref });
  const t = api((await login(user.email)).token);
  if (opts.pin !== false) await t.put('/me/transaction-pin', { currentPassword: PASSWORD, pin: PIN, confirmPin: PIN });
  return { user, m: m!, t };
}
async function give(userId: unknown, amountPaise: number, walletType: 'main' | 'earnings' = 'main') {
  await ensureWallets([String(userId)], true);
  await tx((s) => post({ userId: String(userId), isTest: true, wallet: walletType, direction: 'credit', amountPaise, category: 'topup', key: key(), description: 'Test money' }, s));
}
const bal = async (t: Api) => (await t.get('/finance/wallet')).body as { mainPaise: number; earningsPaise: number };
async function vendor() {
  const { user } = await makeUser({ roles: ['vendor'], member: false });
  const v = await mongoose.connection.transaction((s) => createVendorShell(user._id, `Shop ${++n}`, s, { status: 'approved', city: 'Pune', state: 'Maharashtra' } as never));
  return { user, v, t: api((await login(user.email)).token) };
}
async function listing(vendorId: unknown, pricePaise = 100_000, type: 'product' | 'service' = 'service') {
  const c = await CategoryModel.findOne({ kind: type, parentId: null });
  return ListingModel.create({ type, vendorId, name: `item ${++n}`, slug: `f-${n}`, categoryId: c!._id, summary: 'A test listing here', city: 'Pune', pricePaise, gstRatePct: 18, status: 'published', vendorActive: true });
}
async function order(b: Api, listingId: string) {
  await b.post('/cart/items', { listingId });
  const cart = (await b.get('/cart')).body;
  return b.post('/checkout', { address: ADDRESS, expectedTotalPaise: cart.totalPaise, idempotencyKey: key() });
}
/** Buy a service and take it all the way to completed. */
async function sale(b: Api, v: Awaited<ReturnType<typeof vendor>>, pricePaise = 100_000) {
  const p = await order(b, (await listing(v.v._id, pricePaise)).id);
  await b.post(`/payments/${p.body.id}/simulate`, { outcome: 'success' });
  const id = p.body.orders[0].id as string;
  await v.t.post(`/vendor/orders/${id}/status`, { to: 'processing' });
  expect((await v.t.post(`/vendor/orders/${id}/status`, { to: 'completed' })).status).toBe(200);
  return id;
}
async function rule(sup: Api, levels: object[], extra: object = {}) {
  const r = await sup.post('/admin/commission-rules', { name: 'Standard', listingTypes: ['service', 'product', 'project'], basis: 'before_gst', levels, ...extra });
  expect(r.status).toBe(201);
  expect((await sup.post(`/admin/commission-rules/${r.body.id}/active`, { active: true })).status).toBe(200);
  return r.body.id as string;
}
const superAdmin = async () => api((await login((await makeSuperAdmin()).user.email)).token);
const fullAdmin = async () => api((await login((await makeFullAdmin()).user.email)).token);

beforeEach(async () => { await seedDefaultCategories(); });
/** Every test must leave the books balanced. */
const balanced = async () => expect((await reconcile()).mismatches).toEqual([]);

describe('ledger', () => {
  it('is immutable, idempotent and never overdraws under concurrency', async () => {
    const a = await member();
    await give(a.user._id, 10_000);
    const row = (await LedgerModel.findOne())!;
    await expect(LedgerModel.updateOne({ _id: row._id }, { amountPaise: 1 })).rejects.toThrow('immutable');
    await expect(LedgerModel.deleteOne({ _id: row._id })).rejects.toThrow('immutable');
    row.amountPaise = 5;
    await expect(row.save()).rejects.toThrow('immutable');
    await wallet({ transferEnabled: true, transferMaxPaise: 10_000 });
    const b = await member();
    const send = (k: string) => a.t.post('/finance/transfer', { memberId: b.m.memberId, amount: 60, pin: PIN, idempotencyKey: k });
    const rs = await Promise.all([send(key()), send(key()), send(key())]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const k = key();
    const twice = [await a.t.post('/finance/transfer', { memberId: b.m.memberId, amount: 10, pin: PIN, idempotencyKey: k }), await a.t.post('/finance/transfer', { memberId: b.m.memberId, amount: 10, pin: PIN, idempotencyKey: k })];
    expect(twice.map((r) => r.status)).toEqual([200, 200]);
    expect(await bal(a.t)).toMatchObject({ mainPaise: 3_000 });
    expect(await bal(b.t)).toMatchObject({ mainPaise: 7_000 });
    await balanced();
  });
  it('reconciliation notices a tampered balance', async () => {
    const a = await member();
    await give(a.user._id, 5_000);
    await WalletModel.updateOne({ userId: a.user._id, type: 'main' }, { balancePaise: 999_999 });
    expect((await reconcile()).mismatches).toMatchObject([{ balancePaise: 999_999, ledgerPaise: 5_000 }]);
  });
});

describe('wallet', () => {
  it('everything is off by default and limited when on', async () => {
    const a = await member();
    expect((await a.t.post('/finance/topup', { amount: 100, idempotencyKey: key() })).status).toBe(403);
    expect((await a.t.post('/finance/transfer', { memberId: 'JR0000001', amount: 1, pin: PIN, idempotencyKey: key() })).status).toBe(403);
    expect((await a.t.post('/finance/withdrawals', { amount: 100, pin: PIN, idempotencyKey: key() })).status).toBe(403);
    await wallet({ topUpEnabled: true, topUpMinPaise: 10_000, topUpMaxPaise: 50_000 });
    expect((await a.t.post('/finance/topup', { amount: 99, idempotencyKey: key() })).status).toBe(400);
    const p = await a.t.post('/finance/topup', { amount: 500, idempotencyKey: key() });
    expect(p.body).toMatchObject({ purpose: 'topup', status: 'created' });
    expect(await bal(a.t)).toMatchObject({ mainPaise: 0 });
    await a.t.post(`/payments/${p.body.id}/simulate`, { outcome: 'success' });
    expect(await bal(a.t)).toMatchObject({ mainPaise: 50_000, earningsPaise: 0 });
    expect(await WalletModel.countDocuments({ isTest: false, balancePaise: { $ne: 0 } })).toBe(0); // sandbox money never touches real wallets
    await balanced();
  });

  it('locks the wallet password after five wrong tries, even in parallel', async () => {
    const a = await member();
    await give(a.user._id, 5_000, 'earnings');
    const move = (pin: string) => a.t.post('/finance/move', { amount: 1, pin, idempotencyKey: key() });
    const wrong = await Promise.all(Array.from({ length: 8 }, () => move('111222')));
    expect(wrong.filter((r) => r.body.error.code === 'WRONG_PIN').length).toBeLessThanOrEqual(5);
    expect((await move(PIN)).body.error.code).toBe('PIN_LOCKED');
    expect(await bal(a.t)).toMatchObject({ earningsPaise: 5_000 });
    await a.t.put('/me/transaction-pin', { currentPassword: PASSWORD, pin: PIN, confirmPin: PIN });
    expect((await move(PIN)).status).toBe(200);
    expect(await bal(a.t)).toMatchObject({ earningsPaise: 4_900, mainPaise: 100 });
  });

  it('pays an order from the wallet once, and refunds go back to the wallet', async () => {
    const v = await vendor();
    const a = await member();
    await give(a.user._id, 100_000);
    const p = await order(a.t, (await listing(v.v._id)).id);
    expect((await a.t.post(`/payments/${p.body.id}/wallet`, { pin: '999111' })).body.error.code).toBe('WRONG_PIN');
    const [x, y] = await Promise.all([a.t.post(`/payments/${p.body.id}/wallet`, { pin: PIN }), a.t.post(`/payments/${p.body.id}/wallet`, { pin: PIN })]);
    expect([x.status, y.status]).toContain(200);
    expect(await bal(a.t)).toMatchObject({ mainPaise: 0 });
    const o = (await OrderModel.findById(p.body.orders[0].id))!;
    expect(o).toMatchObject({ status: 'confirmed', paidPaise: 100_000, capturedPaise: 100_000 });
    // The abandoned gateway payment succeeding later is kept for refund.
    await a.t.post(`/payments/${p.body.id}/simulate`, { outcome: 'success' });
    expect((await OrderModel.findById(o.id))!).toMatchObject({ paidPaise: 100_000, capturedPaise: 200_000, refundRequestedPaise: 100_000 });
    const adm = await fullAdmin();
    expect((await adm.post(`/admin/orders/${o.id}/refunds`, { amount: 2000, reason: 'Order abandoned', idempotencyKey: key() })).body.status).toBe('refunded');
    expect(await bal(a.t)).toMatchObject({ mainPaise: 100_000 });
    expect(await PaymentModel.countDocuments({ status: 'refunded' })).toBe(2);
    await balanced();
  });
});

describe('withdrawals', () => {
  async function ready() {
    await wallet({ withdrawEnabled: true, withdrawMinPaise: 10_000, withdrawFeePaise: 500 });
    const a = await member();
    await give(a.user._id, 50_000, 'earnings');
    await give(a.user._id, 90_000, 'main');
    return a;
  }
  const bank = (userId: unknown) => BankAccountModel.create({ userId, holderName: 'A', accountNumberEncrypted: 'x', accountLast4: '1234', ifsc: 'SBIN0001234', bankName: 'SBI', branchAddress: 'Pune' });
  const ask = (t: Api, amount: number) => t.post('/finance/withdrawals', { amount, pin: PIN, idempotencyKey: key() });

  it('needs bank, KYC and earnings; topped-up money can’t be withdrawn', async () => {
    const a = await ready();
    expect((await ask(a.t, 100)).body.error.code).toBe('NO_BANK');
    await bank(a.user._id);
    expect((await ask(a.t, 100)).body.error.code).toBe('KYC_REQUIRED');
    await ProfileModel.updateOne({ userId: a.user._id }, { panMasked: 'AB••••••4F' });
    await DocumentModel.create({ userId: a.user._id, type: 'pan_card', storageKey: 'k', originalName: 'p', mime: 'application/pdf', size: 1, status: 'approved' });
    expect((await ask(a.t, 50)).status).toBe(400);
    expect((await ask(a.t, 600)).body.error.code).toBe('INSUFFICIENT_BALANCE'); // 500 earnings + 900 main
    const rs = await Promise.all([ask(a.t, 400), ask(a.t, 400)]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await bal(a.t)).toMatchObject({ earningsPaise: 10_000, pendingWithdrawalPaise: 40_000 });
    await balanced();
  });

  it('approve → paid with a unique UTR; reject returns the money once', async () => {
    const a = await ready();
    await wallet({ withdrawEnabled: true, withdrawMinPaise: 10_000, withdrawFeePaise: 500, withdrawRequiresKyc: false });
    await bank(a.user._id);
    await ask(a.t, 100);
    await ask(a.t, 150);
    const [w1, w2] = await WithdrawalModel.find().sort({ createdAt: 1 });
    const adm = await fullAdmin();
    expect((await a.t.post(`/admin/finance/withdrawals/${w1!.id}/decision`, { decision: 'approve' })).status).toBe(403);
    expect((await adm.post(`/admin/finance/withdrawals/${w1!.id}/paid`, { utr: 'UTR12345678' })).status).toBe(409);
    await adm.post(`/admin/finance/withdrawals/${w1!.id}/decision`, { decision: 'approve' });
    expect((await adm.post(`/admin/finance/withdrawals/${w1!.id}/paid`, { utr: 'utr12345678' })).body.status).toBe('paid');
    expect((await adm.post(`/admin/finance/withdrawals/${w1!.id}/decision`, { decision: 'reject', reason: 'Too late now' })).status).toBe(409);
    await adm.post(`/admin/finance/withdrawals/${w2!.id}/decision`, { decision: 'approve' });
    expect((await adm.post(`/admin/finance/withdrawals/${w2!.id}/paid`, { utr: 'UTR12345678' })).status).toBe(409);
    const rej = await Promise.all([1, 2].map(() => adm.post(`/admin/finance/withdrawals/${w2!.id}/decision`, { decision: 'reject', reason: 'Wrong account' })));
    expect(rej.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await bal(a.t)).toMatchObject({ earningsPaise: 40_000, pendingWithdrawalPaise: 0 });
    const list = (await a.t.get('/finance/withdrawals')).body.data;
    expect(list).toHaveLength(2);
    expect(list.find((x: { status: string }) => x.status === 'paid')).toMatchObject({ amountPaise: 10_000, feePaise: 500, netPaise: 9_500 });
    await balanced();
  });
});

describe('commissions', () => {
  it('only a Super Admin sets rules, they start inactive, and overlapping rules are refused', async () => {
    const adm = await fullAdmin();
    const body = { name: 'Plan', listingTypes: ['product'], basis: 'before_gst', levels: [{ kind: 'percent', value: 5 }] };
    expect((await adm.post('/admin/commission-rules', body)).status).toBe(403);
    expect((await adm.put('/settings/earnings', SETTINGS_DEFAULTS.earnings)).status).toBe(403);
    const sup = await superAdmin();
    expect((await sup.put('/settings/earnings', SETTINGS_DEFAULTS.earnings)).status).toBe(200);
    expect((await sup.post('/admin/commission-rules', { ...body, levels: [{ kind: 'percent', value: 60 }, { kind: 'percent', value: 60 }] })).status).toBe(400);
    const r = (await sup.post('/admin/commission-rules', body)).body;
    expect(r.active).toBe(false);
    await sup.post(`/admin/commission-rules/${r.id}/active`, { active: true });
    const r2 = (await sup.post('/admin/commission-rules', body)).body;
    expect((await sup.post(`/admin/commission-rules/${r2.id}/active`, { active: true })).status).toBe(409);
  });

  it('pays each level once, after the waiting period, less TDS; refunds take it back', async () => {
    const sup = await superAdmin();
    const top = await member();
    const mid = await member({ ref: top.m.referralCode });
    const buyer = await member({ ref: mid.m.referralCode });
    const v = await vendor();
    await earnings({ commissionHoldDays: 7, tdsEnabled: true, tdsRatePct: 5, tdsNoPanRatePct: 20, tdsThresholdPaise: 0 });
    await ProfileModel.updateOne({ userId: mid.user._id }, { panMasked: 'AB••••••4F' });
    await rule(sup, [{ kind: 'percent', value: 10 }, { kind: 'flat', value: 20 }]);
    const orderId = await sale(buyer.t, v);
    await runMoneyJobs();
    await runMoneyJobs();
    const rows = await CommissionModel.find().sort({ level: 1 });
    expect(rows.map((r) => [String(r.earnerUserId), r.grossPaise])).toEqual([[String(mid.user._id), 10_000], [String(top.user._id), 2_000]]);
    const adm = await fullAdmin();
    const ids = rows.map((r) => r.id);
    expect((await adm.post('/admin/finance/commissions/pay', { ids })).body.paid).toBe(0); // waiting period
    await CommissionModel.updateMany({}, { availableAt: new Date() });
    const both = await Promise.all([adm.post('/admin/finance/commissions/pay', { ids }), adm.post('/admin/finance/commissions/pay', { ids })]);
    expect(both.reduce((a, r) => a + r.body.paid, 0)).toBe(2);
    expect(await bal(mid.t)).toMatchObject({ earningsPaise: 9_500 }); // 5% TDS
    expect(await bal(top.t)).toMatchObject({ earningsPaise: 1_600 }); // 20%: no PAN
    expect((await mid.t.get('/finance/earnings')).body).toMatchObject({ paidPaise: 9_500, directPaise: 9_500, tdsPaise: 500 });
    expect((await top.t.get('/finance/business')).body.summary).toMatchObject({ indirect: { orders: 1, valuePaise: 100_000 } });

    await adm.post(`/admin/orders/${orderId}/refunds`, { amount: 400, reason: 'Part refund', idempotencyKey: key() });
    expect(await bal(mid.t)).toMatchObject({ earningsPaise: 5_700 }); // 40% of 9,500 taken back
    await adm.post(`/admin/orders/${orderId}/refunds`, { amount: 600, reason: 'Rest of it', idempotencyKey: key() });
    expect(await bal(mid.t)).toMatchObject({ earningsPaise: 0 });
    expect(await bal(top.t)).toMatchObject({ earningsPaise: 0 });
    expect((await CommissionModel.find()).every((c) => c.status === 'reversed')).toBe(true);
    const tds = await TdsModel.aggregate([{ $group: { _id: null, n: { $sum: '$tdsPaise' } } }]);
    expect(tds[0].n).toBe(0);
    await balanced();
  });

  it('reversal can make a balance negative, and then nothing can be withdrawn', async () => {
    const sup = await superAdmin();
    const up = await member();
    const buyer = await member({ ref: up.m.referralCode });
    const v = await vendor();
    await rule(sup, [{ kind: 'percent', value: 10 }]);
    const orderId = await sale(buyer.t, v);
    const adm = await fullAdmin();
    await adm.post('/admin/finance/commissions/pay', { ids: (await CommissionModel.find()).map((c) => c.id) });
    await up.t.post('/finance/move', { amount: 100, pin: PIN, idempotencyKey: key() });
    await adm.post(`/admin/orders/${orderId}/refunds`, { amount: 1000, reason: 'Full refund', idempotencyKey: key() });
    expect(await bal(up.t)).toMatchObject({ earningsPaise: -10_000, mainPaise: 10_000 });
    expect((await up.t.post('/finance/move', { amount: 1, pin: PIN, idempotencyKey: key() })).body.error.code).toBe('INSUFFICIENT_BALANCE');
    await balanced();
  });

  it('skips blocked members, caps the payout at the sale, and does nothing without rules', async () => {
    const top = await member();
    const mid = await member({ ref: top.m.referralCode });
    const buyer = await member({ ref: mid.m.referralCode });
    const v = await vendor();
    await sale(buyer.t, v);
    expect(await CommissionModel.countDocuments()).toBe(0);
    const sup = await superAdmin();
    await rule(sup, [{ kind: 'percent', value: 10 }, { kind: 'flat', value: 5000 }]);
    mid.user.status = 'blocked';
    await mid.user.save();
    await sale(buyer.t, v);
    const rows = await CommissionModel.find();
    expect(rows).toHaveLength(1); // the earlier sale isn't paid retroactively
    expect(rows[0]).toMatchObject({ level: 2, grossPaise: 100_000 });
  });
});

describe('vendor settlement', () => {
  it('waits for a configured fee, pays once, and reverses in proportion', async () => {
    const v = await vendor();
    const b = await member();
    const id = await sale(b.t, v);
    await runMoneyJobs();
    expect(await SettlementModel.countDocuments()).toBe(0);
    await earnings({ platformFeePct: 10 });
    await Promise.all([runMoneyJobs(), runMoneyJobs()]);
    await runMoneyJobs();
    expect(await bal(v.t)).toMatchObject({ earningsPaise: 90_000 });
    expect((await v.t.get('/finance/settlements')).body.data[0]).toMatchObject({ grossPaise: 100_000, feePaise: 10_000, netPaise: 90_000 });
    const adm = await fullAdmin();
    await adm.post(`/admin/orders/${id}/refunds`, { amount: 250, reason: 'Part refund', idempotencyKey: key() });
    expect(await bal(v.t)).toMatchObject({ earningsPaise: 67_500 });
    await balanced();
  });
});

describe('coupons', () => {
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const body = (o: object = {}) => ({ code: `SAVE${++n}`, name: 'Save', kind: 'percent', value: 10, minOrder: 0, maxDiscount: '', listingTypes: ['service'], fundedBy: 'vendor', validFrom: today, validTo: today, totalLimit: '', perUserLimit: 1, audience: 'everyone', ...o });

  it('discounts before GST, shows on the order, counts once and is released if unpaid', async () => {
    const adm = await fullAdmin();
    const c = (await adm.post('/admin/coupons', body())).body;
    const v = await vendor();
    await mongoose.model('Vendor').updateOne({ _id: v.v._id }, { gstin: '27ABCDE1234F1Z5' });
    const b = await member();
    await b.t.post('/cart/items', { listingId: (await listing(v.v._id)).id });
    expect((await b.t.put('/cart/coupon', { code: 'NOPE' })).status).toBe(400);
    const cart = await b.t.put('/cart/coupon', { code: c.code.toLowerCase() });
    expect(cart.body).toMatchObject({ subtotalPaise: 100_000, discountPaise: 10_000, gstPaise: 16_200, totalPaise: 106_200 });
    const p = await b.t.post('/checkout', { address: ADDRESS, expectedTotalPaise: 106_200, idempotencyKey: key() });
    expect(p.status).toBe(201);
    expect((await b.t.get(`/orders/${p.body.orders[0].id}`)).body).toMatchObject({ subtotalPaise: 100_000, discountPaise: 10_000, couponCode: c.code, totalPaise: 106_200 });
    expect((await b.t.get('/finance/coupons')).body.data).toMatchObject([{ status: 'used', discountPaise: 10_000 }]);
    await b.t.post('/cart/items', { listingId: (await listing(v.v._id)).id });
    expect((await b.t.put('/cart/coupon', { code: c.code })).body.error.message).toMatch(/already used/);
    await expireUnpaid(new Date(Date.now() + 2 * 3_600_000));
    expect((await CouponModel.findById(c.id))!.usedCount).toBe(0);
    expect((await b.t.put('/cart/coupon', { code: c.code })).status).toBe(200);
  });

  it('enforces assignment, minimum, caps, types and the total limit under simultaneous checkouts', async () => {
    const adm = await fullAdmin();
    const v = await vendor();
    const [a, b] = [await member(), await member()];
    const only = (await adm.post('/admin/coupons', body({ audience: 'assigned', kind: 'flat', value: 5000, totalLimit: 1 }))).body;
    const l = await listing(v.v._id);
    for (const x of [a, b]) await x.t.post('/cart/items', { listingId: l.id });
    expect((await a.t.put('/cart/coupon', { code: only.code })).status).toBe(400);
    expect((await adm.post(`/admin/coupons/${only.id}/assign`, { memberIds: ['JR9999999'] })).status).toBe(400);
    await adm.post(`/admin/coupons/${only.id}/assign`, { memberIds: [a.m.memberId, b.m.memberId] });
    const cart = (await a.t.put('/cart/coupon', { code: only.code })).body;
    expect(cart.totalPaise).toBe(100); // never below ₹1
    await b.t.put('/cart/coupon', { code: only.code });
    const rs = await Promise.all([a, b].map((x) => x.t.post('/checkout', { address: ADDRESS, expectedTotalPaise: 100, idempotencyKey: key() })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await RedemptionModel.countDocuments()).toBe(1);
    const min = (await adm.post('/admin/coupons', body({ minOrder: 5000 }))).body;
    const loser = rs[0]!.status === 409 ? a : b;
    expect((await loser.t.put('/cart/coupon', { code: min.code })).body.error.message).toMatch(/Spend at least/);
    const other = (await adm.post('/admin/coupons', body({ listingTypes: ['product'] }))).body;
    expect((await loser.t.put('/cart/coupon', { code: other.code })).status).toBe(400);
  });

  it('a platform-funded coupon doesn’t reduce the vendor’s proceeds', async () => {
    await earnings({ platformFeePct: 0 });
    const adm = await fullAdmin();
    const c = (await adm.post('/admin/coupons', body({ fundedBy: 'platform' }))).body;
    const v = await vendor();
    const b = await member();
    await b.t.post('/cart/items', { listingId: (await listing(v.v._id)).id });
    await b.t.put('/cart/coupon', { code: c.code });
    const p = await b.t.post('/checkout', { address: ADDRESS, expectedTotalPaise: 90_000, idempotencyKey: key() });
    await b.t.post(`/payments/${p.body.id}/simulate`, { outcome: 'success' });
    const id = p.body.orders[0].id;
    await v.t.post(`/vendor/orders/${id}/status`, { to: 'processing' });
    await v.t.post(`/vendor/orders/${id}/status`, { to: 'completed' });
    await runMoneyJobs();
    expect(await bal(v.t)).toMatchObject({ earningsPaise: 100_000 });
  });
});

describe('rewards', () => {
  it('pays cash once per key and records other rewards', async () => {
    const adm = await fullAdmin();
    const a = await member();
    const r = { memberId: a.m.memberId, kind: 'cash', title: 'Festival bonus', reason: 'Top buyer this month', amount: 250, idempotencyKey: key() };
    await Promise.all([adm.post('/admin/finance/rewards', r), adm.post('/admin/finance/rewards', r)]);
    await adm.post('/admin/finance/rewards', { ...r, kind: 'other', title: 'Trophy', amount: undefined, idempotencyKey: key() });
    expect(await bal(a.t)).toMatchObject({ earningsPaise: 25_000 });
    expect((await a.t.get('/finance/rewards')).body.meta.total).toBe(2);
    expect((await a.t.post('/admin/finance/rewards', r)).status).toBe(403);
    await balanced();
  });
});

describe('subscriptions & E-PINs', () => {
  const plan = async (o: object = {}) => (await (await superAdmin()).post('/admin/plans', { name: 'Gold', kind: 'yearly', durationDays: '', price: 499, benefits: ['Support'], active: true, ...o })).body;

  it('activates by payment or wallet, stacks periods, and special plans aren’t for sale', async () => {
    const p1 = await plan();
    const special = await plan({ name: 'Invite', kind: 'special', durationDays: 30 });
    const a = await member();
    await give(a.user._id, 49_900);
    expect((await a.t.post('/finance/subscriptions', { planId: special.id, idempotencyKey: key() })).status).toBe(404);
    const pay = await a.t.post('/finance/subscriptions', { planId: p1.id, idempotencyKey: key() });
    expect(pay.body).toMatchObject({ purpose: 'subscription', amountPaise: 49_900 });
    expect(await SubscriptionModel.countDocuments()).toBe(0);
    await a.t.post(`/payments/${pay.body.id}/simulate`, { outcome: 'success' });
    const pay2 = await a.t.post('/finance/subscriptions', { planId: p1.id, idempotencyKey: key() });
    expect((await a.t.post(`/payments/${pay2.body.id}/wallet`, { pin: PIN })).status).toBe(200);
    const subs = (await a.t.get('/finance/subscriptions')).body.data;
    expect(subs.map((s: { status: string }) => s.status)).toEqual(['upcoming', 'active']);
    expect(subs[0].startAt).toBe(subs[1].endAt);
    await balanced();
  });

  it('E-PINs: generated once, issued, redeemed once, revealed only to the owner', async () => {
    const p = await plan({ kind: 'lifetime' });
    const adm = await fullAdmin();
    const [a, b] = [await member(), await member()];
    const k = key();
    const gen = await adm.post('/admin/epins', { planId: p.id, count: 3, expiresOn: '', idempotencyKey: k });
    expect(gen.body.codes[0]).toMatch(/^([A-Z2-9]{4}-){3}[A-Z2-9]{4}$/);
    expect((await adm.post('/admin/epins', { planId: p.id, count: 3, expiresOn: '', idempotencyKey: k })).status).toBe(409);
    const raw = JSON.stringify(await EpinModel.find().select('+codeEncrypted').lean());
    expect(raw).not.toContain(gen.body.codes[0].replace(/-/g, ''));
    const last = (await EpinModel.findOne({ seq: 2 }))!;
    await adm.post(`/admin/epins/${last.id}/issue`, { memberId: a.m.memberId });
    expect((await b.t.post(`/finance/epins/${last.id}/reveal`, { pin: PIN })).status).toBe(404);
    expect((await a.t.post(`/finance/epins/${last.id}/reveal`, { pin: PIN })).body.code).toBe(gen.body.codes[2]);
    const redeem = (t: Api, code: string) => t.post('/finance/epins/redeem', { code });
    const rs = await Promise.all([redeem(a.t, gen.body.codes[0]), redeem(b.t, gen.body.codes[0])]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner = rs[0]!.status === 200 ? a : b;
    expect((await redeem(winner.t, gen.body.codes[1])).status).toBe(409); // already lifetime
    const second = (await EpinModel.findOne({ seq: 1 }))!;
    await adm.post(`/admin/epins/${second.id}/block`);
    expect((await redeem(winner === a ? b.t : a.t, gen.body.codes[1])).status).toBe(400);
  });

  it('members buy E-PINs from the wallet only when allowed', async () => {
    const p = await plan();
    const a = await member();
    await give(a.user._id, 60_000);
    const buy = () => a.t.post('/finance/epins', { planId: p.id, pin: PIN, idempotencyKey: key() });
    expect((await buy()).status).toBe(403);
    await wallet({ memberEpinEnabled: true });
    expect((await buy()).status).toBe(201);
    expect((await buy()).body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await EpinModel.countDocuments()).toBe(1); // the failed purchase left nothing behind
    await balanced();
  });
});

describe('access', () => {
  it('reports are private to each person; admin views need permission', async () => {
    const [a, b] = [await member(), await member()];
    await give(a.user._id, 5_000);
    expect((await b.t.get('/finance/transactions')).body.meta.total).toBe(0);
    expect((await a.t.get('/finance/transactions?direction=credit')).body).toMatchObject({ creditPaise: 5_000, debitPaise: 0 });
    const csv = await a.t.get('/finance/transactions?format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    for (const p of ['/admin/finance/summary', '/admin/finance/transactions', '/admin/finance/withdrawals', '/admin/finance/commissions', '/admin/finance/tds', '/admin/coupons', '/admin/epins']) expect((await a.t.get(p)).status, p).toBe(403);
    const adm = await fullAdmin();
    for (const p of ['/admin/finance/summary', '/admin/finance/transactions', '/admin/finance/balances', '/admin/finance/withdrawals', '/admin/finance/commissions', '/admin/finance/tds', '/admin/finance/rewards', '/admin/coupons', '/admin/epins', '/admin/plans']) expect((await adm.get(p)).status, p).toBe(200);
    for (const p of ['/admin/commission-rules', '/admin/finance/reconciliation']) expect((await adm.get(p)).status, p).toBe(403);
    const v = await vendor();
    expect((await v.t.post('/finance/topup', { amount: 1, idempotencyKey: key() })).status).toBe(403);
    expect((await v.t.get('/finance/wallet')).status).toBe(200);
  });
});
