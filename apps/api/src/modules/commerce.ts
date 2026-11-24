import { Router, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  applyCouponSchema, pinSchema, cancellationDecisionSchema, cancelSchema, cartItemSchema, cartUpdateSchema, checkoutSchema, LISTING_TYPES, ORDER_STATUSES, orderTransitionSchema, refundSchema, sandboxOutcomeSchema,
  type CustomerRow,
} from '@jr/shared';
import { authenticate, requirePermission, requireRecentAuth, requireRole } from '../middleware/auth';
import { CartModel, InvoiceModel, OrderModel, PaymentModel, type Order } from '../models/commerce';
import { VendorModel } from '../models/vendor';
import { ListingModel } from '../models/catalog';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { AppError, badRequest, conflict, forbidden, notFound } from '../core/errors';
import { assertObjectId, dateRangeFilter, dateRangeSchema, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { randomToken } from '../core/crypto';
import { VISIBLE } from '../services/catalog';
import { getSettings } from '../services/settings';
import { activeGateway, gatewayByName, sandboxSign, type GatewayEvent } from '../services/gateway';
import {
  applyGatewayEvent, buildCart, buyerCancel, checkout, decideCancellation, dismissRefundRequest, orderStats, payFromWallet, payOrder, refundOrder, sellerCancel, toOrderDetail, toPaymentView, toRows, transition,
  type Actor, type Viewer,
} from '../services/orders';
import { gstSummary, invoicePdf, toInvoiceRow } from '../services/invoices';
import { checkPin } from '../services/finance';
import { audit } from '../services/audit';

const me = (req: Request) => new Types.ObjectId(req.auth!.user.id);
const actor = (req: Request, label?: string): Actor => ({ userId: req.auth!.user.id, name: label ?? req.auth!.user.name });

const GROUPS: Record<string, string[]> = { active: ['confirmed', 'processing', 'shipped'], cancelled: ['cancelled', 'refunded'] };
const listQuery = paginationSchema.extend(dateRangeSchema.shape).extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum([...ORDER_STATUSES, 'active']).optional(),
  kind: z.enum(LISTING_TYPES).optional(),
  attention: z.enum(['cancellation', 'refund']).optional(),
  group: z.enum(['active', 'cancelled']).optional(),
});

async function listOrders(req: Request, res: Response, base: Record<string, unknown>) {
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = { ...base };
  const group = q.group ?? (q.status === 'active' ? 'active' : undefined);
  if (group) filter.status = { $in: GROUPS[group] };
  else if (q.status) filter.status = q.status;
  if (q.kind) filter.kind = q.kind;
  if (q.attention === 'cancellation') filter['cancellation.status'] = 'open';
  if (q.attention === 'refund') filter.refundRequestedPaise = { $gt: 0 };
  const range = dateRangeFilter(q.from, q.to);
  if (range) filter.createdAt = range;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ orderNo: rx }, { 'items.name': rx }, { 'tracking.number': rx }];
  }
  const [rows, total] = await Promise.all([
    OrderModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    OrderModel.countDocuments(filter),
  ]);
  res.json(paged(await toRows(rows as never), q.page, q.pageSize, total));
}

async function listInvoices(req: Request, res: Response, base: Record<string, unknown>) {
  const q = parse(paginationSchema.extend(dateRangeSchema.shape).extend({ q: z.string().trim().max(60).optional() }), req.query);
  const filter: Record<string, unknown> = { ...base };
  const range = dateRangeFilter(q.from, q.to);
  if (range) filter.issuedAt = range;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ invoiceNo: rx }, { orderNo: rx }, { 'buyer.name': rx }, { 'seller.name': rx }];
  }
  const [rows, total] = await Promise.all([
    InvoiceModel.find(filter).sort({ issuedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    InvoiceModel.countDocuments(filter),
  ]);
  res.json(paged(rows.map((r) => toInvoiceRow(r as never)), q.page, q.pageSize, total));
}

async function sendInvoice(req: Request, res: Response, base: Record<string, unknown>) {
  const inv = await InvoiceModel.findOne({ ...base, _id: assertObjectId(req.params.id, 'Invoice') }).lean();
  if (!inv) throw notFound('Invoice');
  const pdf = await invoicePdf(inv as never);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.invoiceNo.replace(/\//g, '-')}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
}

async function detail(id: string, viewer: Viewer) {
  const o = await OrderModel.findById(id).lean();
  if (!o) throw notFound('Order');
  return toOrderDetail(o as never, viewer);
}

/* ================================================================ Buyer (members) */

export const buyerRouter = Router();
const buyer = [authenticate, requireRole('member')];

buyerRouter.get('/cart', ...buyer, async (req, res) => void res.json(await buildCart(me(req))));

buyerRouter.post('/cart/items', ...buyer, async (req, res) => {
  const input = parse(cartItemSchema, req.body);
  const l = await ListingModel.findOne({ _id: input.listingId, ...VISIBLE }, { type: 1, vendorId: 1 }).lean();
  if (!l) throw notFound('Listing');
  if (await VendorModel.exists({ _id: l.vendorId, userId: me(req) })) throw badRequest('You can’t buy your own listing');
  const qty = l.type === 'product' ? input.qty : 1;
  await CartModel.updateOne({ userId: me(req) }, { $setOnInsert: { items: [] } }, { upsert: true });
  // Merge with the same listing if it's already there; otherwise add a line. Both steps are atomic.
  const line = { $elemMatch: { listingId: l._id, ...(l.type === 'product' ? { qty: { $lte: 999 - qty } } : {}) } };
  const merged = await CartModel.updateOne(
    { userId: me(req), items: line },
    l.type === 'product' ? { $inc: { 'items.$.qty': qty } } : { $set: { 'items.$.plan': input.plan, 'items.$.note': input.note ?? '' } },
  );
  if (!merged.matchedCount) {
    const added = await CartModel.updateOne(
      { userId: me(req), 'items.listingId': { $ne: l._id }, 'items.49': { $exists: false } },
      { $push: { items: { listingId: l._id, qty, plan: input.plan, note: input.note } } },
    );
    if (!added.matchedCount) throw conflict('Your cart is full, or this item is at its maximum quantity');
  }
  res.status(201).json(await buildCart(me(req)));
});

buyerRouter.patch('/cart/items/:itemId', ...buyer, async (req, res) => {
  const input = parse(cartUpdateSchema, req.body);
  const id = assertObjectId(req.params.itemId, 'Cart item');
  const cart = await CartModel.findOne({ userId: me(req), 'items._id': id }).lean();
  const item = cart?.items.find((i) => String(i._id) === id);
  if (!item) throw notFound('Cart item');
  const l = await ListingModel.findById(item.listingId, { type: 1 }).lean();
  const set: Record<string, unknown> = {};
  if (input.qty !== undefined && l?.type === 'product') set['items.$.qty'] = input.qty;
  if (input.plan) set['items.$.plan'] = input.plan;
  if (input.note !== undefined) set['items.$.note'] = input.note;
  if (Object.keys(set).length) await CartModel.updateOne({ userId: me(req), 'items._id': id }, { $set: set });
  res.json(await buildCart(me(req)));
});

buyerRouter.delete('/cart/items/:itemId', ...buyer, async (req, res) => {
  await CartModel.updateOne({ userId: me(req) }, { $pull: { items: { _id: assertObjectId(req.params.itemId, 'Cart item') } } });
  res.json(await buildCart(me(req)));
});

buyerRouter.put('/cart/coupon', ...buyer, async (req, res) => {
  const { code } = parse(applyCouponSchema, req.body);
  await CartModel.updateOne({ userId: me(req) }, { couponCode: code }, { upsert: true });
  const cart = await buildCart(me(req));
  if (cart.coupon?.problem) {
    await CartModel.updateOne({ userId: me(req) }, { $unset: { couponCode: 1 } });
    throw badRequest(cart.coupon.problem, { code: cart.coupon.problem });
  }
  res.json(cart);
});
buyerRouter.delete('/cart/coupon', ...buyer, async (req, res) => {
  await CartModel.updateOne({ userId: me(req) }, { $unset: { couponCode: 1 } });
  res.json(await buildCart(me(req)));
});

buyerRouter.post('/payments/:id/wallet', ...buyer, async (req, res) => {
  const { pin } = parse(pinSchema, req.body);
  const p = await myPayment(req);
  await checkPin(me(req), pin);
  const paid = await payFromWallet(p._id);
  await audit(req, { action: 'wallet.pay', entity: 'payment', entityId: paid.id, summary: `Paid ${paid.paymentNo} from the wallet` });
  res.json(toPaymentView(paid as never));
});

buyerRouter.post('/checkout', ...buyer, async (req, res) => {
  const input = parse(checkoutSchema, req.body);
  const p = await checkout(me(req), input, actor(req));
  await audit(req, { action: 'order.checkout', entity: 'payment', entityId: p.id, summary: `Placed ${p.allocations.length} order(s): ${p.allocations.map((a) => a.orderNo).join(', ')}` });
  res.status(201).json(toPaymentView(p as never));
});

const mine = (req: Request) => ({ buyerUserId: me(req) });
async function myOrder(req: Request) {
  const o = await OrderModel.findOne({ _id: assertObjectId(req.params.id, 'Order'), ...mine(req) });
  if (!o) throw notFound('Order');
  return o;
}

buyerRouter.get('/orders', ...buyer, (req, res) => listOrders(req, res, mine(req)));
buyerRouter.get('/orders/stats', ...buyer, async (req, res) => void res.json(await orderStats(mine(req))));
buyerRouter.get('/orders/last-address', ...buyer, async (req, res) => {
  const o = await OrderModel.findOne(mine(req), { address: 1 }).sort({ createdAt: -1 }).lean();
  res.json({ address: o?.address ?? null });
});
buyerRouter.get('/orders/:id', ...buyer, async (req, res) => {
  const o = await myOrder(req);
  res.json(await detail(o.id, { as: 'buyer' }));
});
buyerRouter.post('/orders/:id/pay', ...buyer, async (req, res) => void res.json(toPaymentView((await payOrder(await myOrder(req))) as never)));
buyerRouter.post('/orders/:id/cancel', ...buyer, async (req, res) => {
  const { reason } = parse(cancelSchema, req.body);
  const o = await myOrder(req);
  await buyerCancel(o._id, actor(req), reason);
  await audit(req, { action: 'order.buyer_cancel', entity: 'order', entityId: o.id, summary: `Cancelled or asked to cancel ${o.orderNo}` });
  res.json(await detail(o.id, { as: 'buyer' }));
});
buyerRouter.post('/orders/:id/complete', ...buyer, async (req, res) => {
  if ((await getSettings('commerce')).completionBy === 'vendor') throw forbidden('The vendor marks orders as completed');
  const o = await myOrder(req);
  await transition(o._id, actor(req), 'completed', { note: 'Buyer confirmed' });
  res.json(await detail(o.id, { as: 'buyer' }));
});

buyerRouter.get('/payments', ...buyer, async (req, res) => {
  const q = parse(paginationSchema, req.query);
  const [rows, total] = await Promise.all([
    PaymentModel.find(mine(req)).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    PaymentModel.countDocuments(mine(req)),
  ]);
  res.json(paged(rows.map((r) => toPaymentView(r as never)), q.page, q.pageSize, total));
});
async function myPayment(req: Request) {
  const p = await PaymentModel.findOne({ _id: assertObjectId(req.params.id, 'Payment'), ...mine(req) });
  if (!p) throw notFound('Payment');
  return p;
}
buyerRouter.get('/payments/:id', ...buyer, async (req, res) => void res.json(toPaymentView((await myPayment(req)) as never)));

/** Process a notification exactly as the gateway sent it. Used by the webhook and by the sandbox simulator. */
async function handleNotification(provider: string, raw: Buffer, signature: string | undefined) {
  const gw = gatewayByName(provider);
  if (!gw) throw notFound('Payment provider');
  const ev = gw.verifyWebhook(raw, signature);
  if (!ev) throw new AppError(400, 'BAD_SIGNATURE', 'Invalid signature');
  return applyGatewayEvent(gw.name, ev);
}

/** Sandbox only: play the part of the gateway's payment page, then notify ourselves through the signed webhook path. */
buyerRouter.post('/payments/:id/simulate', ...buyer, async (req, res) => {
  if (activeGateway()?.name !== 'sandbox') throw notFound('Sandbox');
  const { outcome } = parse(sandboxOutcomeSchema, req.body);
  const p = await myPayment(req);
  if (!p.providerOrderId || !['created', 'failed'].includes(p.status)) throw conflict('This payment is already finished');
  const ev: GatewayEvent = { eventId: `sbx_evt_${randomToken(10)}`, type: outcome === 'success' ? 'captured' : 'failed', providerOrderId: p.providerOrderId, providerPaymentId: `sbx_pay_${p.paymentNo}`, amountPaise: p.amountPaise, currency: 'INR' };
  const raw = Buffer.from(JSON.stringify(ev));
  await handleNotification('sandbox', raw, sandboxSign(raw));
  res.json(toPaymentView((await PaymentModel.findById(p._id).lean()) as never));
});

/** Gateway → server. No login: trusted only through the signature over the raw body. */
buyerRouter.post('/payments/webhook/:provider', async (req: Request & { rawBody?: Buffer }, res) => {
  const result = await handleNotification(String(req.params.provider), req.rawBody ?? Buffer.alloc(0), req.get('x-webhook-signature'));
  res.json({ result });
});

buyerRouter.get('/invoices', ...buyer, (req, res) => listInvoices(req, res, mine(req)));
buyerRouter.get('/invoices/gst-summary', ...buyer, async (req, res) => void res.json({ data: await gstSummary(mine(req)) }));
buyerRouter.get('/invoices/:id/pdf', ...buyer, (req, res) => sendInvoice(req, res, mine(req)));

/* ================================================================ Vendor (mounted after /vendor authentication) */

export const vendorCommerceRouter = Router();
/** Vendors only ever see orders that have been paid for. */
async function vendorBase(req: Request) {
  const v = await VendorModel.findOne({ userId: me(req) }, { businessName: 1 }).lean();
  if (!v) throw notFound('Business profile');
  return { vendor: v, filter: { vendorId: v._id, confirmedAt: { $exists: true, $ne: null } } };
}
const vendorViewer = (req: Request): Viewer => ({ as: 'vendor', canManage: req.auth!.permissions.has('vendor.orders.manage') });
async function vendorOrder(req: Request) {
  const { vendor, filter } = await vendorBase(req);
  const o = await OrderModel.findOne({ _id: assertObjectId(req.params.id, 'Order'), ...filter });
  if (!o) throw notFound('Order');
  return { o, vendor };
}
const canManage = requirePermission('vendor.orders.manage');

vendorCommerceRouter.get('/orders', async (req, res) => listOrders(req, res, (await vendorBase(req)).filter));
vendorCommerceRouter.get('/orders/stats', async (req, res) => void res.json(await orderStats((await vendorBase(req)).filter)));
vendorCommerceRouter.get('/orders/:id', async (req, res) => {
  const { o } = await vendorOrder(req);
  res.json(await detail(o.id, vendorViewer(req)));
});
vendorCommerceRouter.post('/orders/:id/status', canManage, async (req, res) => {
  const input = parse(orderTransitionSchema, req.body);
  const { o, vendor } = await vendorOrder(req);
  if (input.to === 'completed' && (await getSettings('commerce')).completionBy === 'buyer') throw forbidden('The buyer confirms completion');
  await transition(o._id, actor(req, vendor.businessName), input.to, input);
  await audit(req, { action: 'order.status', entity: 'order', entityId: o.id, summary: `${o.orderNo} → ${input.to}` });
  res.json(await detail(o.id, vendorViewer(req)));
});
vendorCommerceRouter.post('/orders/:id/cancel', canManage, async (req, res) => {
  const { reason } = parse(cancelSchema, req.body);
  const { o, vendor } = await vendorOrder(req);
  await sellerCancel(o._id, actor(req, vendor.businessName), reason);
  await audit(req, { action: 'order.vendor_cancel', entity: 'order', entityId: o.id, summary: `Vendor cancelled ${o.orderNo}` });
  res.json(await detail(o.id, vendorViewer(req)));
});
vendorCommerceRouter.post('/orders/:id/cancellation', canManage, async (req, res) => {
  const input = parse(cancellationDecisionSchema, req.body);
  const { o, vendor } = await vendorOrder(req);
  await decideCancellation(o._id, actor(req, vendor.businessName), input.decision, input.note);
  await audit(req, { action: 'order.cancellation', entity: 'order', entityId: o.id, summary: `Cancellation of ${o.orderNo}: ${input.decision}` });
  res.json(await detail(o.id, vendorViewer(req)));
});
vendorCommerceRouter.get('/customers', async (req, res) => {
  const { filter } = await vendorBase(req);
  const q = parse(paginationSchema, req.query);
  const [r] = await OrderModel.aggregate<{ rows: { _id: Types.ObjectId; orders: number; value: number; last: Date }[]; total: { n: number }[] }>([
    { $match: filter },
    { $group: { _id: '$buyerUserId', orders: { $sum: 1 }, value: { $sum: { $subtract: ['$capturedPaise', '$refundedPaise'] } }, last: { $max: '$createdAt' } } },
    { $sort: { last: -1, _id: 1 } },
    { $facet: { rows: [{ $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }], total: [{ $count: 'n' }] } },
  ]);
  const ids = r!.rows.map((x) => x._id);
  const [users, members] = await Promise.all([UserModel.find({ _id: { $in: ids } }, { name: 1 }).lean(), MemberModel.find({ userId: { $in: ids } }, { userId: 1, memberId: 1 }).lean()]);
  const data: CustomerRow[] = r!.rows.map((x) => ({
    userId: String(x._id), name: users.find((u) => u._id.equals(x._id))?.name ?? '—', memberId: members.find((m) => m.userId.equals(x._id))?.memberId, orders: x.orders, valuePaise: x.value, lastOrderAt: x.last.toISOString(),
  }));
  res.json(paged(data, q.page, q.pageSize, r!.total[0]?.n ?? 0));
});
const vendorInvoices = async (req: Request) => ({ vendorId: (await vendorBase(req)).vendor._id });
vendorCommerceRouter.get('/invoices', async (req, res) => listInvoices(req, res, await vendorInvoices(req)));
vendorCommerceRouter.get('/invoices/gst-summary', async (req, res) => void res.json({ data: await gstSummary({ ...(await vendorInvoices(req)), isTest: false }) }));
vendorCommerceRouter.get('/invoices/:id/pdf', async (req, res) => sendInvoice(req, res, await vendorInvoices(req)));

/* ================================================================ Admin (mounted after /admin authentication) */

export const adminCommerceRouter = Router();
const adminViewer = (req: Request): Viewer => ({ as: 'admin', canManage: req.auth!.permissions.has('orders.manage'), canRefund: req.auth!.permissions.has('orders.refund') });
const view = requirePermission('orders.view');
const manage = requirePermission('orders.view', 'orders.manage');
const refund = requirePermission('orders.view', 'orders.refund');
async function anyOrder(req: Request): Promise<Order & { id: string; _id: Types.ObjectId }> {
  const o = await OrderModel.findById(assertObjectId(req.params.id, 'Order'));
  if (!o) throw notFound('Order');
  return o as never;
}

adminCommerceRouter.get('/orders', view, (req, res) => listOrders(req, res, {}));
adminCommerceRouter.get('/orders/stats', view, async (_req, res) => void res.json(await orderStats({})));
adminCommerceRouter.get('/orders/:id', view, async (req, res) => void res.json(await detail(assertObjectId(req.params.id, 'Order'), adminViewer(req))));
adminCommerceRouter.post('/orders/:id/status', manage, async (req, res) => {
  const input = parse(orderTransitionSchema, req.body);
  const o = await anyOrder(req);
  await transition(o._id, actor(req, 'JustReference admin'), input.to, input);
  await audit(req, { action: 'order.status', entity: 'order', entityId: o.id, summary: `${o.orderNo} → ${input.to}` });
  res.json(await detail(o.id, adminViewer(req)));
});
adminCommerceRouter.post('/orders/:id/cancel', manage, async (req, res) => {
  const { reason } = parse(cancelSchema, req.body);
  const o = await anyOrder(req);
  await sellerCancel(o._id, actor(req, 'JustReference admin'), reason);
  await audit(req, { action: 'order.admin_cancel', entity: 'order', entityId: o.id, summary: `Cancelled ${o.orderNo}: ${reason}` });
  res.json(await detail(o.id, adminViewer(req)));
});
adminCommerceRouter.post('/orders/:id/cancellation', manage, async (req, res) => {
  const input = parse(cancellationDecisionSchema, req.body);
  const o = await anyOrder(req);
  await decideCancellation(o._id, actor(req, 'JustReference admin'), input.decision, input.note);
  await audit(req, { action: 'order.cancellation', entity: 'order', entityId: o.id, summary: `Cancellation of ${o.orderNo}: ${input.decision}` });
  res.json(await detail(o.id, adminViewer(req)));
});
adminCommerceRouter.post('/orders/:id/refunds', requireRecentAuth, refund, async (req, res) => {
  const input = parse(refundSchema, req.body);
  const o = await anyOrder(req);
  await refundOrder(o._id, input, req.auth!.user.id, actor(req, 'JustReference admin'));
  await audit(req, { action: 'order.refund', entity: 'order', entityId: o.id, summary: `Refunded ₹${(input.amount / 100).toFixed(2)} on ${o.orderNo}`, meta: { amountPaise: input.amount } });
  res.json(await detail(o.id, adminViewer(req)));
});
adminCommerceRouter.post('/orders/:id/refund-request/dismiss', refund, async (req, res) => {
  const { reason } = parse(cancelSchema, req.body);
  const o = await anyOrder(req);
  await dismissRefundRequest(o._id, actor(req, 'JustReference admin'), reason);
  await audit(req, { action: 'order.refund_dismiss', entity: 'order', entityId: o.id, summary: `Closed the refund request on ${o.orderNo}: ${reason}` });
  res.json(await detail(o.id, adminViewer(req)));
});
adminCommerceRouter.get('/invoices', view, (req, res) => listInvoices(req, res, {}));
adminCommerceRouter.get('/invoices/:id/pdf', view, (req, res) => sendInvoice(req, res, {}));
adminCommerceRouter.get('/payment-gateway', requirePermission('settings.view'), (_req, res) => {
  const gw = activeGateway();
  res.json({ provider: gw?.name ?? null, testMode: !!gw?.testMode, webhookPath: gw ? `/api/v1/payments/webhook/${gw.name}` : null });
});
