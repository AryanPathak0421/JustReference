import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, auth, login, makeFullAdmin, makeUser } from './helpers';
import { seedDefaultCategories } from '../src/seed/catalog';
import { CategoryModel, ListingModel } from '../src/models/catalog';
import { InvoiceModel, OrderModel, PaymentModel, RefundModel } from '../src/models/commerce';
import { VendorModel } from '../src/models/vendor';
import { RoleModel } from '../src/models/security';
import { createVendorShell } from '../src/services/vendors';
import { sandboxSign } from '../src/services/gateway';
import { expireUnpaid } from '../src/services/orders';
import { financialYear } from '../src/services/invoices';

const api = (t: string) => ({
  get: (p: string) => request(app).get(`/api/v1${p}`).set(auth(t)),
  post: (p: string, b: object = {}) => request(app).post(`/api/v1${p}`).set(auth(t)).send(b),
  put: (p: string, b: object) => request(app).put(`/api/v1${p}`).set(auth(t)).send(b),
  patch: (p: string, b: object) => request(app).patch(`/api/v1${p}`).set(auth(t)).send(b),
  del: (p: string) => request(app).delete(`/api/v1${p}`).set(auth(t)),
});
const ADDRESS = { name: 'Asha Rao', mobile: '9812345678', line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
let n = 0;
const key = () => `test-key-${String(++n).padStart(12, '0')}`;

async function vendor(opts: { gstin?: string; state?: string; name?: string } = {}) {
  const { user } = await makeUser({ roles: ['vendor'], member: false });
  const v = await mongoose.connection.transaction((s) => createVendorShell(user._id, opts.name ?? `Shop ${++n}`, s, { status: 'approved', city: 'Pune', state: opts.state ?? 'Maharashtra', gstin: opts.gstin, officeAddress: 'FC Road', pincode: '411005' } as never));
  return { user, v, t: api((await login(user.email)).token) };
}
async function listing(vendorId: unknown, type: 'product' | 'service' | 'project', extra: Record<string, unknown> = {}) {
  const c = await CategoryModel.findOne({ kind: type, parentId: null });
  return ListingModel.create({ type, vendorId, name: `${type} ${++n}`, slug: `l-${n}`, categoryId: c!._id, summary: 'A test listing here', city: 'Pune', pricePaise: 100_000, gstRatePct: 18, status: 'published', vendorActive: true, ...(type === 'product' ? { product: { availability: 'in_stock', stockQty: 5 } } : {}), ...extra });
}
async function buyer() {
  const { user, member } = await makeUser();
  return { user, member, t: api((await login(user.email)).token) };
}
async function checkout(t: ReturnType<typeof api>, k = key()) {
  const cart = (await t.get('/cart')).body;
  return t.post('/checkout', { address: ADDRESS, expectedTotalPaise: cart.totalPaise, idempotencyKey: k });
}
const pay = (t: ReturnType<typeof api>, id: string, outcome = 'success') => t.post(`/payments/${id}/simulate`, { outcome });
async function paidOrder(type: 'product' | 'service' = 'product', vOpts: Parameters<typeof vendor>[0] = {}) {
  const v = await vendor(vOpts);
  const l = await listing(v.v._id, type);
  const b = await buyer();
  await b.t.post('/cart/items', { listingId: l.id, qty: 2 });
  const p = await checkout(b.t);
  expect(p.status).toBe(201);
  expect((await pay(b.t, p.body.id)).body.status).toBe('captured');
  return { v, l, b, orderId: p.body.orders[0].id as string, paymentId: p.body.id as string };
}
async function webhook(ev: object, sign = true) {
  const raw = JSON.stringify(ev);
  return request(app).post('/api/v1/payments/webhook/sandbox').set('Content-Type', 'application/json').set('x-webhook-signature', sign ? sandboxSign(Buffer.from(raw)) : 'bad').send(raw);
}

beforeEach(async () => { await seedDefaultCategories(); });

describe('cart & checkout', () => {
  it('prices from the database, adds GST only for registered sellers, and splits orders by vendor and type', async () => {
    const a = await vendor({ gstin: '27ABCDE1234F1Z5' });
    const c = await vendor();
    const p1 = await listing(a.v._id, 'product');
    const p2 = await listing(c.v._id, 'product');
    const s1 = await listing(c.v._id, 'service');
    const b = await buyer();
    await b.t.post('/cart/items', { listingId: p1.id, qty: 1, pricePaise: 1 });
    await b.t.post('/cart/items', { listingId: p1.id, qty: 1 });
    await b.t.post('/cart/items', { listingId: p2.id });
    const cart = (await b.t.post('/cart/items', { listingId: s1.id, qty: 9 })).body;
    expect(cart).toMatchObject({ count: 3, subtotalPaise: 400_000, gstPaise: 36_000, totalPaise: 436_000, canCheckout: true, testMode: true });
    const res = await checkout(b.t);
    expect(res.body.orders).toHaveLength(3);
    expect(res.body.amountPaise).toBe(436_000);
    expect((await b.t.get('/cart')).body.count).toBe(0);
    expect((await ListingModel.findById(p1.id))!.product!.stockQty).toBe(3);
    expect(res.body.orders[0].orderNo).toMatch(/^JR-ORD-\d{4}-\d{6}$/);
  });

  it('refuses a changed price, too much quantity, unavailable listings and the seller’s own listing', async () => {
    const v = await vendor();
    const l = await listing(v.v._id, 'product');
    const b = await buyer();
    await b.t.post('/cart/items', { listingId: l.id });
    const cart = (await b.t.get('/cart')).body;
    await ListingModel.updateOne({ _id: l.id }, { pricePaise: 200_000 });
    const stale = await b.t.post('/checkout', { address: ADDRESS, expectedTotalPaise: cart.totalPaise, idempotencyKey: key() });
    expect(stale.body.error.code).toBe('PRICE_CHANGED');
    const over = await b.t.patch(`/cart/items/${cart.groups[0].lines[0].id}`, { qty: 6 });
    expect(over.body.groups[0].lines[0].problem).toBe('Only 5 left');
    expect((await checkout(b.t)).body.error.code).toBe('CART_PROBLEM');
    await ListingModel.updateOne({ _id: l.id }, { vendorActive: false });
    expect((await b.t.post('/cart/items', { listingId: l.id })).status).toBe(404);
    expect(await OrderModel.countDocuments()).toBe(0);

    const both = await makeUser({ roles: ['member', 'vendor'] });
    const own = await mongoose.connection.transaction((s) => createVendorShell(both.user._id, 'Own Shop', s, { status: 'approved' } as never));
    const mineListing = await listing(own._id, 'product');
    expect((await api((await login(both.user.email)).token).post('/cart/items', { listingId: mineListing.id })).status).toBe(400);
  });

  it('is idempotent and never oversells', async () => {
    const v = await vendor();
    const l = await listing(v.v._id, 'product', { product: { availability: 'in_stock', stockQty: 1 } });
    const [b1, b2] = [await buyer(), await buyer()];
    for (const b of [b1, b2]) await b.t.post('/cart/items', { listingId: l.id });
    const k = key();
    const cart = (await b1.t.get('/cart')).body;
    const body = { address: ADDRESS, expectedTotalPaise: cart.totalPaise, idempotencyKey: k };
    const [x, y] = await Promise.all([b1.t.post('/checkout', body), b1.t.post('/checkout', body)]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(x.body.id).toBe(y.body.id);
    expect((await checkout(b2.t)).body.error.code).toBe('CART_PROBLEM');
    expect(await OrderModel.countDocuments()).toBe(1);
    expect((await ListingModel.findById(l.id))!.product!.stockQty).toBe(0);
  });

  it('expires unpaid orders and returns the stock', async () => {
    const v = await vendor();
    const l = await listing(v.v._id, 'product');
    const b = await buyer();
    await b.t.post('/cart/items', { listingId: l.id, qty: 4 });
    await checkout(b.t);
    expect(await expireUnpaid()).toBe(0);
    expect(await expireUnpaid(new Date(Date.now() + 2 * 3_600_000))).toBe(1);
    expect((await OrderModel.findOne())!.status).toBe('cancelled');
    expect((await ListingModel.findById(l.id))!.product!.stockQty).toBe(5);
  });
});

describe('payments', () => {
  it('only a correctly signed notification with the right amount confirms an order, once', async () => {
    const v = await vendor();
    const l = await listing(v.v._id, 'product');
    const b = await buyer();
    await b.t.post('/cart/items', { listingId: l.id });
    const p = await checkout(b.t);
    const doc = (await PaymentModel.findById(p.body.id))!;
    const ev = { eventId: 'e1', type: 'captured', providerOrderId: doc.providerOrderId, providerPaymentId: 'pp1', amountPaise: doc.amountPaise, currency: 'INR' };
    expect((await webhook(ev, false)).body.error.code).toBe('BAD_SIGNATURE');
    expect((await webhook({ ...ev, eventId: 'e0', amountPaise: 1 })).body.result).toBe('ignored');
    expect((await OrderModel.findOne())!.status).toBe('pending');
    const both = await Promise.all([webhook(ev), webhook(ev)]);
    expect(both.map((r) => r.body.result).sort()).toEqual(['applied', 'duplicate']);
    expect((await webhook({ ...ev, eventId: 'e2' })).body.result).toBe('duplicate');
    expect((await OrderModel.findOne())!).toMatchObject({ status: 'confirmed', paidPaise: 100_000, capturedPaise: 100_000 });
    expect(await InvoiceModel.countDocuments()).toBe(1);
    expect((await request(app).post('/api/v1/payments/webhook/razorpay').send(ev)).status).toBe(404);
  });

  it('a failed payment can be retried; another member can’t see or pay it', async () => {
    const v = await vendor();
    const l = await listing(v.v._id, 'service');
    const b = await buyer();
    await b.t.post('/cart/items', { listingId: l.id });
    const p = await checkout(b.t);
    expect((await pay(b.t, p.body.id, 'failure')).body.status).toBe('failed');
    const orderId = p.body.orders[0].id;
    expect((await v.t.get(`/vendor/orders/${orderId}`)).status).toBe(404); // unpaid orders are hidden from vendors
    const other = await buyer();
    expect((await other.t.get(`/orders/${orderId}`)).status).toBe(404);
    expect((await other.t.post(`/orders/${orderId}/pay`)).status).toBe(404);
    expect((await pay(other.t, p.body.id)).status).toBe(404);
    const again = await b.t.post(`/orders/${orderId}/pay`);
    expect(again.body.id).not.toBe(p.body.id);
    expect((await pay(b.t, again.body.id)).body.status).toBe('captured');
    expect((await v.t.get(`/vendor/orders/${orderId}`)).body).toMatchObject({ status: 'confirmed', address: { city: 'Pune' } });
    // The first attempt succeeding late is kept as money to refund, not applied twice.
    const first = (await PaymentModel.findById(p.body.id))!;
    await webhook({ eventId: 'late', type: 'captured', providerOrderId: first.providerOrderId, providerPaymentId: 'late', amountPaise: first.amountPaise, currency: 'INR' });
    expect((await OrderModel.findById(orderId))!).toMatchObject({ paidPaise: 100_000, capturedPaise: 200_000, refundRequestedPaise: 100_000 });
    const admin = api((await login((await makeFullAdmin()).user.email)).token);
    const r = await admin.post(`/admin/orders/${orderId}/refunds`, { amount: 1000, reason: 'Paid twice', idempotencyKey: key() });
    expect(r.body).toMatchObject({ status: 'confirmed', refundedPaise: 100_000, refundRequestedPaise: 0 });
    expect(await InvoiceModel.countDocuments({ type: 'credit_note' })).toBe(0); // the extra money was never invoiced
  });

  it('a payment arriving after cancellation is flagged for refund', async () => {
    const v = await vendor();
    const l = await listing(v.v._id, 'product');
    const b = await buyer();
    await b.t.post('/cart/items', { listingId: l.id });
    const p = await checkout(b.t);
    const id = p.body.orders[0].id;
    expect((await b.t.post(`/orders/${id}/cancel`, { reason: 'Changed my mind' })).body.status).toBe('cancelled');
    await pay(b.t, p.body.id);
    expect((await OrderModel.findById(id))!).toMatchObject({ status: 'cancelled', paidPaise: 0, capturedPaise: 100_000, refundRequestedPaise: 100_000 });
    expect(await InvoiceModel.countDocuments()).toBe(0);
  });
});

describe('order lifecycle', () => {
  it('product: confirmed → processing → shipped with tracking → completed', async () => {
    const { v, b, orderId } = await paidOrder();
    const go = (body: object) => v.t.post(`/vendor/orders/${orderId}/status`, body);
    expect((await go({ to: 'completed' })).status).toBe(409);
    expect((await go({ to: 'processing' })).body.status).toBe('processing');
    expect((await go({ to: 'shipped' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await go({ to: 'shipped', tracking: { carrier: 'Delhivery', number: 'D1', url: 'javascript:alert(1)' } })).status).toBe(400);
    const shipped = await go({ to: 'shipped', tracking: { carrier: 'Delhivery', number: 'DL123' } });
    expect(shipped.body.tracking).toMatchObject({ carrier: 'Delhivery', number: 'DL123' });
    expect((await b.t.post(`/orders/${orderId}/cancel`, { reason: 'Too late now' })).status).toBe(409);
    const done = await b.t.post(`/orders/${orderId}/complete`);
    expect(done.body.status).toBe('completed');
    expect((await b.t.get('/orders/stats')).body).toMatchObject({ total: 1, completed: 1, valuePaise: 200_000 });
    const other = await vendor();
    expect((await other.t.get(`/vendor/orders/${orderId}`)).status).toBe(404);
    expect((await v.t.get('/vendor/customers')).body.data[0]).toMatchObject({ name: b.user.name, orders: 1, valuePaise: 200_000 });
  });

  it('paid orders: the buyer asks, the seller decides, and an admin decides the refund', async () => {
    const { v, l, b, orderId } = await paidOrder('product', { gstin: '27ABCDE1234F1Z5' });
    const ask = await b.t.post(`/orders/${orderId}/cancel`, { reason: 'Ordered by mistake' });
    expect(ask.body).toMatchObject({ status: 'confirmed', cancellationRequested: true });
    expect((await v.t.post(`/vendor/orders/${orderId}/status`, { to: 'processing' })).status).toBe(409);
    expect((await v.t.post(`/vendor/orders/${orderId}/cancellation`, { decision: 'accept' })).body).toMatchObject({ status: 'cancelled', refundRequestedPaise: 236_000, refundedPaise: 0 });
    expect((await ListingModel.findById(l.id))!.product!.stockQty).toBe(5);
    expect((await v.t.post(`/vendor/orders/${orderId}/refunds`, { amount: 1 })).status).toBe(404);

    const admin = api((await login((await makeFullAdmin()).user.email)).token);
    const k = key();
    const refund = { amount: 1180, reason: 'Half back per policy', idempotencyKey: k };
    const [r1, r2] = await Promise.all([admin.post(`/admin/orders/${orderId}/refunds`, refund), admin.post(`/admin/orders/${orderId}/refunds`, refund)]);
    expect([r1.status, r2.status].filter((s) => s === 200).length).toBeGreaterThan(0);
    const o = (await OrderModel.findById(orderId))!;
    expect(o).toMatchObject({ refundedPaise: 118_000, refundReservedPaise: 118_000, status: 'cancelled' });
    expect(await RefundModel.countDocuments()).toBe(1);
    const note = (await InvoiceModel.findOne({ type: 'credit_note' }))!;
    expect(note).toMatchObject({ totalPaise: 118_000, taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000 });
    expect((await admin.post(`/admin/orders/${orderId}/refunds`, { amount: 1180.01, reason: 'Too much', idempotencyKey: key() })).status).toBe(400);
    expect((await admin.post(`/admin/orders/${orderId}/refunds`, { ...refund, idempotencyKey: key() })).body).toMatchObject({ status: 'refunded', paymentStatus: 'refunded' });
    expect((await PaymentModel.findOne())!.status).toBe('refunded');
  });

  it('two different refunds at once can’t exceed what was paid', async () => {
    const { orderId } = await paidOrder();
    const admin = api((await login((await makeFullAdmin()).user.email)).token);
    const rs = await Promise.all([1, 2, 3].map(() => admin.post(`/admin/orders/${orderId}/refunds`, { amount: 1500, reason: 'Concurrent refund', idempotencyKey: key() })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await OrderModel.findById(orderId))!.refundedPaise).toBe(150_000);
  });

  it('enforces permissions', async () => {
    const { v, b, orderId } = await paidOrder();
    expect((await b.t.get('/admin/orders')).status).toBe(403);
    expect((await v.t.get('/cart')).status).toBe(403);
    const role = await RoleModel.create({ key: 'ops', name: 'Ops', permissions: ['orders.view'] });
    const ops = api((await login((await makeUser({ roles: ['admin'], roleIds: [role.id], member: false })).user.email)).token);
    expect((await ops.get(`/admin/orders/${orderId}`)).body.actions).toEqual([]);
    expect((await ops.post(`/admin/orders/${orderId}/status`, { to: 'processing' })).status).toBe(403);
    expect((await ops.post(`/admin/orders/${orderId}/refunds`, { amount: 1, reason: 'Not allowed', idempotencyKey: key() })).status).toBe(403);
    await RoleModel.updateOne({ key: 'vendor_standard' }, { permissions: ['vendor.listings.manage'] });
    expect((await v.t.post(`/vendor/orders/${orderId}/status`, { to: 'processing' })).status).toBe(403);
  });

  it('project listing: advance first, balance before completion, invoice when fully paid', async () => {
    const v = await vendor({ gstin: '27ABCDE1234F1Z5' });
    const l = await listing(v.v._id, 'project', { project: { durationDays: 10, advancePaise: 30_000, allowFullPayment: false } });
    const b = await buyer();
    const cart = await b.t.post('/cart/items', { listingId: l.id });
    expect(cart.body).toMatchObject({ totalPaise: 118_000, dueNowPaise: 35_400 });
    const p = await checkout(b.t);
    await pay(b.t, p.body.id);
    const id = p.body.orders[0].id;
    await v.t.post(`/vendor/orders/${id}/status`, { to: 'processing' });
    expect((await v.t.post(`/vendor/orders/${id}/status`, { to: 'completed' })).body.error.code).toBe('BALANCE_DUE');
    expect(await InvoiceModel.countDocuments()).toBe(0);
    const bal = await b.t.post(`/orders/${id}/pay`);
    expect(bal.body.amountPaise).toBe(82_600);
    await pay(b.t, bal.body.id);
    expect(await InvoiceModel.countDocuments()).toBe(1);
    expect((await v.t.post(`/vendor/orders/${id}/status`, { to: 'completed' })).body.status).toBe('completed');
  });
});

describe('invoices', () => {
  it('splits CGST/SGST or IGST by state, numbers per seller, and serves the PDF only to the parties', async () => {
    const intra = await paidOrder('service', { gstin: '27ABCDE1234F1Z5' });
    const inter = await paidOrder('service', { gstin: '29ABCDE1234F1Z5', state: 'Karnataka' });
    const a = (await InvoiceModel.findOne({ orderId: intra.orderId }))!;
    const c = (await InvoiceModel.findOne({ orderId: inter.orderId }))!;
    expect(a).toMatchObject({ cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0 });
    expect(c).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000 });
    expect(a.invoiceNo).toMatch(/^TV\d+\/\d{4}\/0001$/); // T = sandbox series
    expect(a.invoiceNo.length).toBeLessThanOrEqual(16);
    expect(a.invoiceNo).not.toBe(c.invoiceNo);
    const pdf = await intra.b.t.get(`/invoices/${a.id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    expect((await inter.b.t.get(`/invoices/${a.id}/pdf`)).status).toBe(404);
    expect((await inter.v.t.get(`/vendor/invoices/${a.id}/pdf`)).status).toBe(404);
    expect((await intra.v.t.get(`/vendor/invoices/${a.id}/pdf`)).status).toBe(200);
    expect((await intra.b.t.get('/invoices/gst-summary')).body.data[0]).toMatchObject({ invoices: 1, totalPaise: 118_000 });
  });
  it('uses the Indian financial year', () => {
    expect(financialYear(new Date('2027-03-31T18:29:00Z'))).toBe('2627');
    expect(financialYear(new Date('2027-03-31T18:31:00Z'))).toBe('2728');
  });
});

describe('project requests & bidding', () => {
  const post = async (t: ReturnType<typeof api>) => {
    const c = await CategoryModel.findOne({ kind: 'project', parentId: null });
    return t.post('/project-requests', { kind: 'project', categoryId: c!.id, title: 'Build a shop website', description: 'An online shop with about fifty products and payments.', budget: 50000, timelineDays: 30, city: 'Pune' });
  };
  const bid = (amount: number, advance = 0) => ({ amount, advance, gstRatePct: 18, estimatedDays: 20, proposal: 'We will design, build and host the shop for you.' });

  it('runs from approval to bids, award, payment and completion', async () => {
    const b = await buyer();
    const r = await post(b.t);
    expect(r.body).toMatchObject({ status: 'pending_approval', budgetPaise: 5_000_000 });
    const id = r.body.id;
    const [v1, v2] = [await vendor({ gstin: '27ABCDE1234F1Z5' }), await vendor()];
    expect((await v1.t.get('/vendor/project-requests')).body.data).toHaveLength(0);
    expect((await v1.t.put(`/vendor/project-requests/${id}/bid`, bid(40000))).status).toBe(409);
    const admin = api((await login((await makeFullAdmin()).user.email)).token);
    expect((await admin.post(`/admin/project-requests/${id}/decision`, { decision: 'approve' })).body.status).toBe('open');
    await v1.t.put(`/vendor/project-requests/${id}/bid`, bid(45000));
    expect((await v1.t.put(`/vendor/project-requests/${id}/bid`, bid(40000, 10000))).body.myBid.amountPaise).toBe(4_000_000);
    const seen = (await v2.t.get(`/vendor/project-requests/${id}`)).body;
    expect(seen).toMatchObject({ bidCount: 1, bids: [], myBid: null, owner: null }); // competitors and buyers stay private
    await v2.t.put(`/vendor/project-requests/${id}/bid`, bid(42000));
    expect((await v2.t.put(`/vendor/project-requests/${id}/bid`, bid(100, 200))).status).toBe(400);
    const mine = (await b.t.get(`/project-requests/${id}`)).body;
    expect(mine.bids.map((x: { amountPaise: number }) => x.amountPaise)).toEqual([4_000_000, 4_200_000]);

    const accept = (i: number) => b.t.post(`/project-requests/${id}/bids/${mine.bids[i].id}/accept`, { address: ADDRESS, plan: 'advance' });
    const [x, y] = await Promise.all([accept(0), accept(1)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    if (x.status !== 201) return; // whichever bid won, only one order may exist
    expect(await OrderModel.countDocuments()).toBe(1);
    expect((await v2.t.get(`/vendor/project-requests/${id}`)).body.myBid.status).toBe('rejected');
    const p = await b.t.post(`/orders/${x.body.orderId}/pay`);
    expect(p.body.amountPaise).toBe(1_180_000); // 10,000 advance + its share of 18% GST
    await pay(b.t, p.body.id);
    expect((await b.t.get(`/project-requests/${id}`)).body.status).toBe('running');
    await pay(b.t, (await b.t.post(`/orders/${x.body.orderId}/pay`)).body.id);
    await v1.t.post(`/vendor/orders/${x.body.orderId}/status`, { to: 'processing' });
    await v1.t.post(`/vendor/orders/${x.body.orderId}/status`, { to: 'completed' });
    expect((await b.t.get(`/project-requests/${id}`)).body.status).toBe('completed');
  });

  it('only approved vendors with the right can bid, and owners only see their own requests', async () => {
    const b = await buyer();
    const { body } = await post(b.t);
    const admin = api((await login((await makeFullAdmin()).user.email)).token);
    await admin.post(`/admin/project-requests/${body.id}/decision`, { decision: 'approve' });
    const v = await vendor();
    await VendorModel.updateOne({ _id: v.v._id }, { status: 'suspended' });
    expect((await v.t.put(`/vendor/project-requests/${body.id}/bid`, bid(1000))).body.error.code).toBe('VENDOR_NOT_APPROVED');
    await VendorModel.updateOne({ _id: v.v._id }, { status: 'approved' });
    await RoleModel.updateOne({ key: 'vendor_standard' }, { permissions: [] });
    expect((await v.t.put(`/vendor/project-requests/${body.id}/bid`, bid(1000))).status).toBe(403);
    expect((await b.t.put(`/vendor/project-requests/${body.id}/bid`, bid(1000))).status).toBe(403);
    expect((await (await buyer()).t.get(`/project-requests/${body.id}`)).status).toBe(404);
    expect((await b.t.post(`/project-requests/${body.id}/cancel`)).body.status).toBe('cancelled');
  });
});
