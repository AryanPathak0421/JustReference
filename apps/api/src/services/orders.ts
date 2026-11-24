import mongoose, { type ClientSession, type Types } from 'mongoose';
import type { Address, CartLine, CartView, OrderDetail, OrderRow, OrderStats, OrderStatus, PaymentPlan, PaymentView } from '@jr/shared';
import { CartModel, InvoiceModel, OrderModel, PaymentModel, ProjectRequestModel, RefundModel, type Order, type OrderDoc, type Payment } from '../models/commerce';
import { ListingModel } from '../models/catalog';
import { VendorModel } from '../models/vendor';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { nextSequence } from '../models/system';
import { AppError, badRequest, conflict, notFound } from '../core/errors';
import { logger } from '../config/logger';
import { randomToken } from '../core/crypto';
import { getSettings } from './settings';
import { publicUrl } from './storage';
import { VISIBLE } from './catalog';
import { activeGateway, type GatewayEvent } from './gateway';
import { issueCreditNote, issueInvoice } from './invoices';
import { CouponModel } from '../models/finance';
import { activateSubscription, couponProblem, createCommissions, ensureWallets, post, redeemCoupon, releaseCoupon, reverseForRefund } from './finance';

type Id = Types.ObjectId | string;
export interface Actor { userId: Id | null; name: string }
export const SYSTEM: Actor = { userId: null, name: 'System' };

const istYear = () => new Date(Date.now() + 5.5 * 3_600_000).getUTCFullYear();
const hist = (status: string, actor: Actor, note = '') => ({ status, at: new Date(), byUserId: actor.userId ?? undefined, by: actor.name, note });

/** GST is added on top of the listed price, and only if the seller is GST registered. */
export function priceLine(unit: number, qty: number, rate: number, gstRegistered: boolean, discountPaise = 0) {
  const taxablePaise = unit * qty - discountPaise;
  const gstPaise = gstRegistered ? Math.round((taxablePaise * rate) / 100) : 0;
  return { taxablePaise, gstPaise, totalPaise: taxablePaise + gstPaise };
}
/** The advance is quoted before GST; the amount collected carries the same share of the GST. */
export const advanceShare = (advance: number, price: number, total: number) => (price > 0 ? Math.round((advance / price) * total) : 0);

/** Amount the buyer should pay next. */
export function dueNow(o: Pick<Order, 'status' | 'paidPaise' | 'totalPaise' | 'plan' | 'advancePaise'>) {
  if (o.status === 'cancelled' || o.status === 'refunded') return 0;
  if (o.paidPaise === 0 && o.plan === 'advance' && o.advancePaise > 0) return o.advancePaise;
  return o.totalPaise - o.paidPaise;
}

/* ================================================================ Cart */

/** Everything is re-priced from the database; nothing the browser sends about price is used. */
export async function buildCart(userId: Id, session?: ClientSession): Promise<CartView> {
  const gw = activeGateway();
  const cart = await CartModel.findOne({ userId }).session(session ?? null).lean();
  const items = cart?.items ?? [];
  const listings = await ListingModel.find({ _id: { $in: items.map((i) => i.listingId) } }).session(session ?? null).lean();
  const vendors = await VendorModel.find({ _id: { $in: listings.map((l) => l.vendorId) } }).session(session ?? null).lean();
  const view: CartView = { groups: [], coupon: null, discountPaise: 0, count: items.length, subtotalPaise: 0, gstPaise: 0, totalPaise: 0, dueNowPaise: 0, canCheckout: false, paymentsEnabled: !!gw, testMode: !!gw?.testMode };
  let problems = false;
  const meta = new Map<string, { advance: number; price: number; reg: boolean; rate: number }>();
  for (const it of items) {
    const l = listings.find((x) => String(x._id) === String(it.listingId));
    const v = l && vendors.find((x) => String(x._id) === String(l.vendorId));
    let problem: string | null = null;
    if (!l || !v || l.status !== VISIBLE.status || !l.vendorActive) problem = 'No longer available';
    else if (String(v.userId) === String(userId)) problem = 'You can’t buy your own listing';
    else if (l.pricePaise < 100) problem = 'This vendor hasn’t set a price yet';
    else if (l.isSample && gw && !gw.testMode) problem = 'Sample listings can’t be bought';
    else if (l.type === 'product' && l.product?.availability === 'out_of_stock') problem = 'Out of stock';
    else if (l.type === 'product' && l.product?.availability === 'in_stock' && l.product.stockQty != null && l.product.stockQty < it.qty) problem = l.product.stockQty ? `Only ${l.product.stockQty} left` : 'Out of stock';
    const reg = !!v?.gstin;
    const p = priceLine(l?.pricePaise ?? 0, it.qty, l?.gstRatePct ?? 0, reg);
    const allowAdvance = l?.type === 'project' && (l.project?.advancePaise ?? 0) > 0 && l.project!.advancePaise! < l.pricePaise;
    const allowFull = l?.type !== 'project' || !allowAdvance || !!l.project?.allowFullPayment;
    const plan: PaymentPlan = it.plan === 'advance' ? (allowAdvance ? 'advance' : 'full') : allowFull ? 'full' : 'advance';
    const due = plan === 'advance' ? advanceShare(l!.project!.advancePaise!, l!.pricePaise, p.totalPaise) : p.totalPaise;
    const line: CartLine = {
      id: String(it._id), listingId: String(it.listingId), type: l?.type ?? 'product', name: l?.name ?? 'Removed listing', slug: l?.slug ?? '', image: publicUrl(l?.images?.[0]?.key),
      qty: it.qty, plan, note: it.note ?? '', unitPricePaise: l?.pricePaise ?? 0, gstRatePct: reg ? (l?.gstRatePct ?? 0) : 0, ...p, discountPaise: 0, dueNowPaise: due, allowFull, allowAdvance, problem, isSample: !!l?.isSample,
    };
    let g = view.groups.find((x) => x.vendor.id === String(v?._id ?? ''));
    if (!g) view.groups.push((g = { vendor: { id: String(v?._id ?? ''), name: v?.businessName ?? 'Unavailable', slug: v?.slug ?? '', gstRegistered: reg }, lines: [], totalPaise: 0 }));
    g.lines.push(line);
    meta.set(line.id, { advance: l?.project?.advancePaise ?? 0, price: l?.pricePaise ?? 0, reg, rate: l?.gstRatePct ?? 0 });
    if (problem) problems = true;
  }
  const good = view.groups.flatMap((g) => g.lines).filter((l) => !l.problem);
  if (cart?.couponCode) {
    const c = await CouponModel.findOne({ code: cart.couponCode }).session(session ?? null).lean();
    const eligible = c ? good.filter((l) => c.listingTypes.includes(l.type)) : [];
    const base = eligible.reduce((a, l) => a + l.taxablePaise, 0);
    let problem = await couponProblem(c as never, userId, session);
    if (!problem && !base) problem = 'This coupon doesn’t apply to these items';
    if (!problem && base < c!.minOrderPaise) problem = `Spend at least ₹${c!.minOrderPaise / 100} on eligible items`;
    let discount = 0;
    if (!problem) {
      discount = c!.kind === 'percent' ? Math.floor((base * c!.value) / 100) : Math.round(c!.value * 100);
      // Every line keeps at least ₹1, so each order stays payable.
      discount = Math.min(discount, c!.maxDiscountPaise ?? Infinity, base - 100 * eligible.length);
      if (discount <= 0) { discount = 0; problem = 'This coupon doesn’t apply to these items'; }
    }
    // Spread in proportion to what each line can give, without going below ₹1.
    let left = discount;
    let room = base - 100 * eligible.length;
    for (const l of eligible) {
      if (left <= 0) break;
      const cap = l.taxablePaise - 100;
      const share = cap >= room ? left : Math.min(cap, left, Math.round((left * cap) / room));
      room -= cap;
      left -= share;
      const m = meta.get(l.id)!;
      Object.assign(l, { discountPaise: share }, priceLine(l.unitPricePaise, l.qty, m.rate, m.reg, share));
      l.dueNowPaise = l.plan === 'advance' ? advanceShare(m.advance, m.price, l.totalPaise) : l.totalPaise;
    }
    view.discountPaise = discount - left;
    view.coupon = { code: cart.couponCode, discountPaise: view.discountPaise, problem };
  }
  for (const g of view.groups) for (const line of g.lines) {
    if (line.problem) continue;
    g.totalPaise += line.totalPaise;
    view.subtotalPaise += line.taxablePaise + line.discountPaise;
    view.gstPaise += line.gstPaise;
    view.totalPaise += line.totalPaise;
    view.dueNowPaise += line.dueNowPaise;
  }
  view.canCheckout = items.length > 0 && !problems && !!gw;
  return view;
}

/* ================================================================ Checkout */

type NewOrder = { buyerUserId: Id; vendorId: Id; kind: string; items: Order['items'][number][] | Record<string, unknown>[]; plan: PaymentPlan; advancePaise: number; address: Address; expiresAt?: Date; projectRequestId?: Id; isTest: boolean; discountPaise?: number; couponCode?: string; couponFundedBy?: string };

export async function createOrder(o: NewOrder, actor: Actor, session: ClientSession): Promise<OrderDoc> {
  const items = o.items as { taxablePaise: number; gstPaise: number }[];
  const year = istYear();
  const seq = await nextSequence(`order:${year}`, session);
  const subtotalPaise = items.reduce((a, i) => a + i.taxablePaise, 0);
  const gstPaise = items.reduce((a, i) => a + i.gstPaise, 0);
  const [doc] = await OrderModel.create([{
    ...o, orderNo: `JR-ORD-${year}-${String(seq).padStart(6, '0')}`, subtotalPaise, gstPaise, totalPaise: subtotalPaise + gstPaise, status: 'pending', history: [hist('pending', actor, 'Order placed')],
  }] as never, { session });
  return doc as unknown as OrderDoc;
}

export async function createPayment(buyerUserId: Id, orders: OrderDoc[], idempotencyKey: string, session?: ClientSession) {
  const gw = activeGateway();
  if (!gw) throw new AppError(503, 'PAYMENTS_OFF', 'Online payments aren’t available yet');
  const allocations = orders.map((o) => ({ orderId: o._id, orderNo: o.orderNo, amountPaise: dueNow(o) }));
  const year = istYear();
  const seq = await nextSequence(`payment:${year}`, session);
  const [p] = await PaymentModel.create([{
    paymentNo: `JR-PAY-${year}-${String(seq).padStart(6, '0')}`, buyerUserId, idempotencyKey, allocations, amountPaise: allocations.reduce((a, x) => a + x.amountPaise, 0), provider: gw.name,
  }], { session });
  return p!;
}

/** Register the payment with the gateway (outside the transaction: a gateway hiccup must not lose the order). */
export async function openWithGateway(paymentId: Id) {
  const p = await PaymentModel.findById(paymentId);
  if (!p) throw notFound('Payment');
  if (p.providerOrderId) return p;
  const { providerOrderId } = await activeGateway()!.createOrder({ paymentNo: p.paymentNo, amountPaise: p.amountPaise });
  const updated = await PaymentModel.findOneAndUpdate({ _id: p._id, providerOrderId: { $exists: false } }, { providerOrderId }, { new: true });
  return updated ?? (await PaymentModel.findById(p._id))!;
}

export async function checkout(userId: Id, input: { address: Address; expectedTotalPaise: number; idempotencyKey: string }, actor: Actor) {
  const existing = () => PaymentModel.findOne({ buyerUserId: userId, idempotencyKey: input.idempotencyKey });
  const prior = await existing();
  if (prior) return openWithGateway(prior._id);
  const gw = activeGateway();
  if (!gw) throw new AppError(503, 'PAYMENTS_OFF', 'Online payments aren’t available yet');
  const { unpaidExpiryMinutes } = await getSettings('commerce');
  let paymentId: Id;
  try {
    paymentId = await mongoose.connection.transaction(async (session) => {
      // Touch the cart first so two simultaneous checkouts conflict instead of both ordering.
      await CartModel.updateOne({ userId }, { $set: { updatedAt: new Date() } }, { session });
      const cart = await buildCart(userId, session);
      if (!cart.count) throw badRequest('Your cart is empty');
      const bad = cart.groups.flatMap((g) => g.lines).find((l) => l.problem);
      if (bad) throw conflict(`${bad.name}: ${bad.problem}`, undefined, 'CART_PROBLEM');
      if (cart.coupon?.problem) throw conflict(`Coupon ${cart.coupon.code}: ${cart.coupon.problem}`, undefined, 'COUPON_PROBLEM');
      if (cart.totalPaise !== input.expectedTotalPaise) throw conflict('Prices have changed. Please review your cart.', undefined, 'PRICE_CHANGED');
      const coupon = cart.coupon ? await CouponModel.findOne({ code: cart.coupon.code }).session(session).lean() : null;
      const orders: OrderDoc[] = [];
      for (const g of cart.groups) {
        const buckets = new Map<string, CartLine[]>();
        for (const l of g.lines) {
          const key = l.type === 'project' ? `project:${l.id}` : l.type;
          buckets.set(key, [...(buckets.get(key) ?? []), l]);
        }
        for (const lines of buckets.values()) {
          const items = [];
          for (const l of lines) {
            const reserved = l.type === 'product' ? await ListingModel.updateOne({ _id: l.listingId, 'product.availability': 'in_stock', 'product.stockQty': { $gte: l.qty } }, { $inc: { 'product.stockQty': -l.qty } }, { session }) : null;
            items.push({ listingId: l.listingId, name: l.name, type: l.type, slug: l.slug, qty: l.qty, unitPricePaise: l.unitPricePaise, gstRatePct: l.gstRatePct, discountPaise: l.discountPaise, taxablePaise: l.taxablePaise, gstPaise: l.gstPaise, totalPaise: l.totalPaise, note: l.note, stockReserved: !!reserved?.modifiedCount });
          }
          const first = lines[0]!;
          const discountPaise = lines.reduce((a, l) => a + l.discountPaise, 0);
          orders.push(await createOrder({
            buyerUserId: userId, vendorId: g.vendor.id, kind: first.type, items, plan: first.plan, advancePaise: first.plan === 'advance' ? first.dueNowPaise : 0,
            address: input.address, expiresAt: new Date(Date.now() + unpaidExpiryMinutes * 60_000), isTest: gw.testMode,
            ...(discountPaise ? { discountPaise, couponCode: coupon!.code, couponFundedBy: coupon!.fundedBy } : {}),
          }, actor, session));
        }
      }
      if (coupon) await redeemCoupon(coupon._id, userId, orders.filter((o) => o.discountPaise > 0).map((o) => o._id), cart.discountPaise, session);
      const p = await createPayment(userId, orders, input.idempotencyKey, session);
      await CartModel.updateOne({ userId }, { $set: { items: [] }, $unset: { couponCode: 1 } }, { session });
      return p._id;
    });
  } catch (e) {
    const dup = (e as { code?: number }).code === 11000 || (e as AppError).status === 400 ? await existing() : null;
    if (!dup) throw e;
    paymentId = dup._id;
  }
  return openWithGateway(paymentId);
}

/** Pay the amount currently due on an existing order (retry, or the balance). Reuses an open payment for the same amount. */
export async function payOrder(order: OrderDoc) {
  const amount = dueNow(order);
  if (amount <= 0) throw conflict('Nothing is due on this order');
  const open = await PaymentModel.findOne({ buyerUserId: order.buyerUserId, status: 'created', allocations: { $size: 1 }, 'allocations.0.orderId': order._id, amountPaise: amount, provider: activeGateway()?.name });
  const p = open ?? (await createPayment(order.buyerUserId!, [order], randomToken(18)));
  return openWithGateway(p._id);
}

/* ================================================================ Payment results */

/** Apply a *verified* gateway event. Safe to call repeatedly with the same event. */
export async function applyGatewayEvent(provider: string, ev: GatewayEvent): Promise<'applied' | 'duplicate' | 'ignored'> {
  return mongoose.connection.transaction(async (session) => {
    const p = await PaymentModel.findOne({ provider, providerOrderId: ev.providerOrderId }).session(session);
    if (!p) return 'ignored';
    if (p.eventIds.includes(ev.eventId)) return 'duplicate';
    p.eventIds.push(ev.eventId);
    if (ev.type === 'failed') {
      if (p.status === 'created') p.status = 'failed';
      await p.save({ session });
      return 'applied';
    }
    if (p.status === 'captured' || p.status === 'refunded') { await p.save({ session }); return 'duplicate'; }
    if (ev.amountPaise !== p.amountPaise || ev.currency !== 'INR') {
      logger.error({ paymentNo: p.paymentNo }, 'Gateway amount or currency does not match the payment: not applied');
      await p.save({ session });
      return 'ignored';
    }
    p.set({ status: 'captured', providerPaymentId: ev.providerPaymentId, verifiedAt: new Date() });
    await p.save({ session });
    await applyCapture(p, session);
    return 'applied';
  });
}

type PaymentDoc = InstanceType<typeof PaymentModel>;

/** Record money that has definitely been received: against orders, a wallet top-up or a subscription. */
async function applyCapture(p: PaymentDoc, session: ClientSession) {
    const isTest = p.provider === 'sandbox';
    if (p.purpose === 'topup') {
      await post({ userId: p.buyerUserId!, isTest, wallet: 'main', direction: 'credit', amountPaise: p.amountPaise, category: 'topup', key: `topup:${p.id}`, refId: p.id, description: `Top-up ${p.paymentNo}` }, session);
      return;
    }
    if (p.purpose === 'subscription') {
      await activateSubscription(p.buyerUserId!, p.planId!, 'payment', `payment:${p.id}`, p.provider === 'wallet' ? !!activeGateway()?.testMode : isTest, session);
      return;
    }
    for (const a of p.allocations) {
      const o = await OrderModel.findById(a.orderId).session(session);
      if (!o) continue;
      o.capturedPaise += a.amountPaise;
      const closed = o.status === 'cancelled' || o.status === 'refunded';
      const applied = closed ? 0 : Math.min(a.amountPaise, o.totalPaise - o.paidPaise);
      const excess = a.amountPaise - applied;
      o.paidPaise += applied;
      if (excess > 0) {
        o.refundRequestedPaise += excess;
        o.history.push(hist(o.status, SYSTEM, closed ? 'Payment arrived after the order was cancelled: refund needed' : 'Extra payment received: refund needed') as never);
      }
      if (applied > 0 && o.status === 'pending') {
        o.status = 'confirmed';
        o.confirmedAt = new Date();
        o.expiresAt = undefined;
        o.history.push(hist('confirmed', SYSTEM, `Payment ${p.paymentNo} received`) as never);
        await syncRequest(o, 'running', session);
      } else if (applied > 0) {
        o.history.push(hist(o.status, SYSTEM, `Payment ${p.paymentNo} received`) as never);
      }
      await o.save({ session });
      if (applied > 0 && o.paidPaise === o.totalPaise) await issueInvoice(o, session);
    }
}

/** Pay an open payment from the main wallet. A separate payment record is used, so a late gateway capture still gets flagged for refund. */
export async function payFromWallet(paymentId: Id) {
  const src = await PaymentModel.findById(paymentId);
  if (!src || src.purpose === 'topup') throw notFound('Payment');
  const key = `wallet:${src.id}`;
  const done = await PaymentModel.findOne({ buyerUserId: src.buyerUserId, idempotencyKey: key });
  if (done) return done;
  if (!['created', 'failed'].includes(src.status)) throw conflict('This payment is already finished');
  const isTest = !!activeGateway()?.testMode;
  if ((src.provider === 'sandbox') !== isTest) throw conflict('This payment was started in another mode');
  await ensureWallets([src.buyerUserId!], isTest);
  return mongoose.connection.transaction(async (session) => {
    for (const a of src.allocations) {
      const o = await OrderModel.findById(a.orderId).session(session);
      if (!o || dueNow(o) !== a.amountPaise) throw conflict('The amount due has changed. Open the order to pay.');
    }
    const year = istYear();
    const seq = await nextSequence(`payment:${year}`, session);
    const [p] = await PaymentModel.create([{ paymentNo: `JR-PAY-${year}-${String(seq).padStart(6, '0')}`, buyerUserId: src.buyerUserId, idempotencyKey: key, allocations: src.allocations, amountPaise: src.amountPaise, purpose: src.purpose, planId: src.planId, provider: 'wallet', status: 'captured', verifiedAt: new Date() }], { session });
    await post({ userId: src.buyerUserId!, isTest, wallet: 'main', direction: 'debit', amountPaise: src.amountPaise, category: src.purpose === 'subscription' ? 'subscription' : 'purchase', key, refId: p!.id, description: src.purpose === 'subscription' ? 'Subscription' : `Order ${src.allocations.map((a) => a.orderNo).join(', ')}`.slice(0, 200) }, session);
    await applyCapture(p!, session);
    return p!;
  });
}

/** A payment that isn't for an order: wallet top-up or subscription. */
export async function startPayment(buyerUserId: Id, input: { amountPaise: number; purpose: 'topup' | 'subscription'; planId?: Id; idempotencyKey: string }) {
  const gw = activeGateway();
  if (!gw) throw new AppError(503, 'PAYMENTS_OFF', 'Online payments aren’t available yet');
  const find = () => PaymentModel.findOne({ buyerUserId, idempotencyKey: input.idempotencyKey });
  let p = await find();
  if (!p) {
    await ensureWallets([buyerUserId], gw.testMode);
    const year = istYear();
    const seq = await nextSequence(`payment:${year}`);
    try {
      p = await PaymentModel.create({ ...input, paymentNo: `JR-PAY-${year}-${String(seq).padStart(6, '0')}`, buyerUserId, allocations: [], provider: gw.name });
    } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; p = (await find())!; }
  }
  return openWithGateway(p._id);
}

const syncRequest = async (o: OrderDoc, status: 'running' | 'completed' | 'cancelled', session: ClientSession) => {
  if (o.projectRequestId) await ProjectRequestModel.updateOne({ _id: o.projectRequestId }, { status }, { session });
};

/* ================================================================ Status changes */

async function releaseStock(o: OrderDoc, session: ClientSession) {
  for (const i of o.items) {
    if (!i.stockReserved) continue;
    await ListingModel.updateOne({ _id: i.listingId }, { $inc: { 'product.stockQty': i.qty } }, { session });
    i.stockReserved = false;
  }
}

/** Load an order inside a transaction and change it. Concurrent changes conflict and retry. */
async function change(orderId: Id, fn: (o: OrderDoc, session: ClientSession) => Promise<void>): Promise<OrderDoc> {
  return mongoose.connection.transaction(async (session) => {
    const o = await OrderModel.findById(orderId).session(session);
    if (!o) throw notFound('Order');
    await fn(o, session);
    await o.save({ session });
    return o;
  });
}

async function cancelInside(o: OrderDoc, actor: Actor, note: string, session: ClientSession) {
  const shipped = o.history.some((h) => h.status === 'shipped');
  o.status = 'cancelled';
  o.expiresAt = undefined;
  o.history.push(hist('cancelled', actor, note) as never);
  if (!shipped) await releaseStock(o, session);
  if (o.paidPaise === 0 && o.couponCode) await releaseCoupon(o._id, session);
  // How much is returned is an admin decision; the refund is only requested here.
  o.refundRequestedPaise = Math.max(0, o.capturedPaise - o.refundReservedPaise);
  await syncRequest(o, 'cancelled', session);
}

/** Buyer: unpaid orders cancel at once; paid ones become a request for the vendor or an admin to decide. */
export const buyerCancel = (orderId: Id, actor: Actor, reason: string) =>
  change(orderId, async (o, session) => {
    if (o.status === 'pending' && o.paidPaise === 0) return cancelInside(o, actor, reason, session);
    if (o.status !== 'confirmed' && o.status !== 'processing') throw conflict('This order can no longer be cancelled');
    if (o.cancellation?.status === 'open') throw conflict('You’ve already asked to cancel this order');
    o.cancellation = { status: 'open', reason, note: '', at: new Date() };
    o.history.push(hist(o.status, actor, `Asked to cancel: ${reason}`) as never);
  });

export const decideCancellation = (orderId: Id, actor: Actor, decision: 'accept' | 'decline', note = '') =>
  change(orderId, async (o, session) => {
    if (o.cancellation?.status !== 'open') throw conflict('There is no open cancellation request');
    o.cancellation = { ...o.cancellation, status: decision === 'accept' ? 'accepted' : 'declined', note };
    if (decision === 'accept') return cancelInside(o, actor, note || 'Cancellation accepted', session);
    o.history.push(hist(o.status, actor, `Cancellation declined${note ? `: ${note}` : ''}`) as never);
  });

/** Vendor or admin cancels an order they can't fulfil. */
export const sellerCancel = (orderId: Id, actor: Actor, reason: string) =>
  change(orderId, async (o, session) => {
    if (!['pending', 'confirmed', 'processing', 'shipped'].includes(o.status)) throw conflict('This order can’t be cancelled');
    if (o.cancellation?.status === 'open') o.cancellation = { ...o.cancellation, status: 'accepted', note: reason };
    await cancelInside(o, actor, reason, session);
  });

/** Allowed next steps for the seller side. Only products ship. */
export function nextSteps(o: Pick<Order, 'status' | 'kind'>): ('processing' | 'shipped' | 'completed')[] {
  if (o.status === 'confirmed') return ['processing'];
  if (o.status === 'processing') return o.kind === 'product' ? ['shipped'] : ['completed'];
  if (o.status === 'shipped') return ['completed'];
  return [];
}

export const transition = async (orderId: Id, actor: Actor, to: 'processing' | 'shipped' | 'completed', opts: { note?: string; tracking?: { carrier: string; number: string; url?: string } } = {}) => {
  const done = await change(orderId, async (o, session) => {
    if (!nextSteps(o).includes(to)) throw conflict(`An order that is ${o.status} can’t be marked ${to}`);
    if (o.cancellation?.status === 'open') throw conflict('Decide the buyer’s cancellation request first');
    if (to === 'completed' && o.paidPaise < o.totalPaise) throw conflict('The balance must be paid before this order can be completed', undefined, 'BALANCE_DUE');
    o.status = to;
    if (opts.tracking) o.tracking = { carrier: opts.tracking.carrier, number: opts.tracking.number, url: opts.tracking.url || '' };
    if (to === 'completed') { o.completedAt = new Date(); await syncRequest(o, 'completed', session); }
    o.history.push(hist(to, actor, opts.note) as never);
  });
  // The scheduled job retries this if it fails.
  if (to === 'completed') await createCommissions(orderId).catch((err) => logger.error({ err }, 'Commission calculation failed'));
  return done;
};

/** Cancel unpaid orders past their deadline and release reserved stock. */
export async function expireUnpaid(now = new Date()) {
  const rows = await OrderModel.find({ status: 'pending', paidPaise: 0, expiresAt: { $lt: now } }, { _id: 1 }).limit(200).lean();
  let n = 0;
  for (const r of rows) {
    await change(r._id, async (o, session) => {
      if (o.status !== 'pending' || o.paidPaise > 0 || !o.expiresAt || o.expiresAt >= now) return;
      await cancelInside(o, SYSTEM, 'Not paid in time', session);
      n++;
    });
  }
  return n;
}

export function scheduleOrderExpiry() {
  const tick = () => void expireUnpaid().catch((err) => logger.error({ err }, 'Order expiry failed'));
  tick();
  return setInterval(tick, 60_000).unref();
}

/* ================================================================ Refunds */

export async function refundOrder(orderId: Id, input: { amount: number; reason: string; idempotencyKey: string }, byUserId: Id, actor: Actor) {
  const gw = activeGateway();
  if (await RefundModel.exists({ idempotencyKey: input.idempotencyKey })) {
    if (!(await RefundModel.exists({ idempotencyKey: input.idempotencyKey, orderId }))) throw conflict('This refund key was used for another order');
    return;
  }
  // 1. Reserve the amount and write the refund records together, so two admins can't refund the same money.
  const refunds = await mongoose.connection.transaction(async (session) => {
    const o = await OrderModel.findOneAndUpdate(
      { _id: orderId, $expr: { $lte: [{ $add: ['$refundReservedPaise', input.amount] }, '$capturedPaise'] } },
      { $inc: { refundReservedPaise: input.amount } },
      { session, new: true },
    );
    if (!o) throw badRequest('That is more than can be refunded on this order', { amount: 'More than the refundable amount' });
    const payments = await PaymentModel.find({ 'allocations.orderId': orderId, status: 'captured' }).sort({ createdAt: 1 }).session(session);
    const prior = await RefundModel.find({ orderId, status: { $ne: 'failed' } }).session(session).lean();
    let left = input.amount;
    const rows = [];
    for (const p of payments) {
      if (p.provider !== 'wallet' && p.provider !== gw?.name) continue;
      const alloc = p.allocations.filter((a) => String(a.orderId) === String(orderId)).reduce((a, x) => a + x.amountPaise, 0);
      const used = prior.filter((r) => String(r.paymentId) === String(p._id)).reduce((a, r) => a + r.amountPaise, 0);
      const amountPaise = Math.min(left, alloc - used);
      if (amountPaise <= 0) continue;
      rows.push({ orderId, paymentId: p._id, amountPaise, reason: input.reason, idempotencyKey: input.idempotencyKey, byUserId });
      left -= amountPaise;
    }
    if (left > 0) throw conflict('Payments on this order were taken through a different gateway');
    return RefundModel.create(rows, { session, ordered: true });
  });

  const owner = (await OrderModel.findById(orderId, { buyerUserId: 1, isTest: 1 }).lean())!;
  await ensureWallets([owner.buyerUserId!], owner.isTest);

  // 2. Ask the gateway (wallet payments go back to the wallet), then record each result.
  let failed = 0;
  for (const r of refunds) {
    let providerRefundId: string | null = null;
    const p = await PaymentModel.findById(r.paymentId).lean();
    const toWallet = p!.provider === 'wallet';
    try {
      providerRefundId = toWallet ? `wallet:${r.id}` : (await gw!.refund({ providerPaymentId: p!.providerPaymentId!, amountPaise: r.amountPaise, key: String(r._id) })).providerRefundId;
    } catch (err) {
      logger.error({ err, refundId: String(r._id) }, 'Gateway refund failed');
    }
    await mongoose.connection.transaction(async (session) => {
      const o = (await OrderModel.findById(orderId).session(session))!;
      if (!providerRefundId) {
        failed++;
        await RefundModel.updateOne({ _id: r._id }, { status: 'failed' }, { session });
        o.refundReservedPaise -= r.amountPaise;
        await o.save({ session });
        return;
      }
      await RefundModel.updateOne({ _id: r._id }, { status: 'processed', providerRefundId }, { session });
      if (toWallet) await post({ userId: o.buyerUserId!, isTest: o.isTest, wallet: 'main', direction: 'credit', amountPaise: r.amountPaise, category: 'refund', key: `refund:${r.id}`, refId: r.id, description: `Refund for ${o.orderNo}` }, session);
      o.refundedPaise += r.amountPaise;
      o.refundRequestedPaise = Math.max(0, o.refundRequestedPaise - r.amountPaise);
      // Extra money received was never invoiced, so only refunds beyond it need a credit note.
      const credit = Math.max(0, o.refundedPaise - (o.capturedPaise - o.paidPaise)) - o.creditedPaise;
      if (credit > 0 && o.paidPaise === o.totalPaise) {
        await issueCreditNote(o, credit, input.idempotencyKey, session);
        o.creditedPaise += credit;
      }
      o.history.push(hist(o.status, actor, `Refunded ₹${(r.amountPaise / 100).toFixed(2)}: ${input.reason}`) as never);
      if (o.refundedPaise >= o.capturedPaise) {
        o.status = 'refunded';
        o.history.push(hist('refunded', actor) as never);
        await syncRequest(o, 'cancelled', session);
      }
      await o.save({ session });
      await reverseForRefund(o, session);
      const total = await RefundModel.aggregate<{ n: number }>([{ $match: { paymentId: r.paymentId, status: 'processed' } }, { $group: { _id: null, n: { $sum: '$amountPaise' } } }]).session(session);
      await PaymentModel.updateOne({ _id: r.paymentId, amountPaise: { $lte: total[0]?.n ?? 0 } }, { status: 'refunded' }, { session });
    });
  }
  if (failed) throw new AppError(502, 'REFUND_FAILED', 'The payment gateway didn’t accept the refund. Nothing was marked refunded for that part; try again.');
}

/** Close a refund request without paying it out (e.g. the refund policy doesn't allow it). */
export const dismissRefundRequest = (orderId: Id, actor: Actor, reason: string) =>
  change(orderId, async (o) => {
    if (!o.refundRequestedPaise) throw conflict('There is no refund request');
    o.refundRequestedPaise = 0;
    o.history.push(hist(o.status, actor, `Refund request closed: ${reason}`) as never);
  });

/* ================================================================ Views */

type LeanOrder = Order & { _id: Types.ObjectId; createdAt: Date };

function paymentStatus(o: Order) {
  if (o.refundedPaise > 0) return o.refundedPaise >= o.capturedPaise ? 'refunded' : 'partly_refunded';
  if (o.paidPaise === 0) return 'unpaid';
  return o.paidPaise >= o.totalPaise ? 'paid' : 'partly_paid';
}

export async function toRows(orders: LeanOrder[]): Promise<OrderRow[]> {
  const buyers = orders.map((o) => o.buyerUserId);
  const [users, members, vendors] = await Promise.all([
    UserModel.find({ _id: { $in: buyers } }, { name: 1 }).lean(),
    MemberModel.find({ userId: { $in: buyers } }, { userId: 1, memberId: 1 }).lean(),
    VendorModel.find({ _id: { $in: orders.map((o) => o.vendorId) } }, { businessName: 1, slug: 1 }).lean(),
  ]);
  return orders.map((o) => {
    const v = vendors.find((x) => String(x._id) === String(o.vendorId));
    return {
      id: String(o._id), orderNo: o.orderNo, kind: o.kind, title: `${o.items[0]?.name ?? ''}${o.items.length > 1 ? ` + ${o.items.length - 1} more` : ''}`, itemCount: o.items.length, status: o.status, paymentStatus: paymentStatus(o),
      totalPaise: o.totalPaise, paidPaise: o.paidPaise, refundedPaise: o.refundedPaise, createdAt: o.createdAt.toISOString(),
      buyer: { name: users.find((u) => String(u._id) === String(o.buyerUserId))?.name ?? '—', memberId: members.find((m) => String(m.userId) === String(o.buyerUserId))?.memberId },
      vendor: { id: String(o.vendorId), name: v?.businessName ?? '—', slug: v?.slug ?? '' }, isTest: o.isTest, cancellationRequested: o.cancellation?.status === 'open', trackingNumber: o.tracking?.number ?? null,
    };
  });
}

export type Viewer = { as: 'buyer' } | { as: 'vendor' | 'admin'; canManage: boolean; canRefund?: boolean };

export async function toOrderDetail(order: LeanOrder, viewer: Viewer): Promise<OrderDetail> {
  const [[row], payments, refunds, invoices, settings] = await Promise.all([
    toRows([order]),
    PaymentModel.find({ 'allocations.orderId': order._id }).sort({ createdAt: 1 }).lean(),
    RefundModel.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
    InvoiceModel.find({ orderId: order._id }).sort({ issuedAt: 1 }).lean(),
    getSettings('commerce'),
  ]);
  const due = dueNow(order);
  const actions: string[] = [];
  const openCancel = order.cancellation?.status === 'open';
  if (viewer.as === 'buyer') {
    if (due > 0 && activeGateway()) actions.push('pay');
    if (order.status === 'pending') actions.push('cancel');
    if (['confirmed', 'processing'].includes(order.status) && !openCancel) actions.push('request_cancel');
    if (settings.completionBy !== 'vendor' && nextSteps(order).includes('completed') && !openCancel && due === 0) actions.push('completed');
  } else {
    if (viewer.canManage) {
      if (openCancel) actions.push('decide_cancel');
      else for (const s of nextSteps(order)) if (s !== 'completed' || ((viewer.as === 'admin' || settings.completionBy !== 'buyer') && due === 0)) actions.push(s);
      if (['pending', 'confirmed', 'processing', 'shipped'].includes(order.status)) actions.push('cancel');
    }
    if (viewer.as === 'admin' && viewer.canRefund && order.capturedPaise - order.refundReservedPaise > 0) actions.push('refund');
    if (viewer.as === 'admin' && viewer.canRefund && order.refundRequestedPaise > 0) actions.push('dismiss_refund');
  }
  return {
    ...row!,
    items: order.items.map((i) => ({ name: i.name, type: i.type, slug: i.slug ?? null, qty: i.qty, unitPricePaise: i.unitPricePaise, gstRatePct: i.gstRatePct, taxablePaise: i.taxablePaise, gstPaise: i.gstPaise, totalPaise: i.totalPaise, note: i.note ?? '' })),
    subtotalPaise: order.subtotalPaise + order.discountPaise, discountPaise: order.discountPaise, couponCode: order.couponCode ?? null, gstPaise: order.gstPaise, advancePaise: order.advancePaise, plan: order.plan, dueNowPaise: due,
    // The vendor gets delivery contact details only once the order is paid.
    address: viewer.as === 'vendor' && !order.confirmedAt ? null : (order.address as unknown as Address),
    history: order.history.map((h) => ({ status: h.status ?? '', at: h.at!.toISOString(), by: h.by ?? '', note: h.note ?? '' })),
    tracking: order.tracking ? { carrier: order.tracking.carrier ?? '', number: order.tracking.number ?? '', url: order.tracking.url ?? '' } : null,
    cancellation: order.cancellation ? { status: order.cancellation.status ?? '', reason: order.cancellation.reason ?? '', note: order.cancellation.note ?? '', at: order.cancellation.at!.toISOString() } : null,
    payments: payments.map((p) => ({ id: String(p._id), paymentNo: p.paymentNo, status: p.status, at: p.createdAt.toISOString(), amountPaise: p.allocations.filter((a) => String(a.orderId) === String(order._id)).reduce((a, x) => a + x.amountPaise, 0) })),
    refunds: refunds.map((r) => ({ id: String(r._id), amountPaise: r.amountPaise, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() })),
    refundRequestedPaise: order.refundRequestedPaise,
    invoices: invoices.map((i) => ({ id: String(i._id), invoiceNo: i.invoiceNo, type: i.type, totalPaise: i.totalPaise, issuedAt: i.issuedAt.toISOString() })),
    projectRequestId: order.projectRequestId ? String(order.projectRequestId) : null,
    actions, expiresAt: order.expiresAt?.toISOString() ?? null,
  };
}

export const toPaymentView = (p: Payment & { _id: unknown; createdAt: Date }): PaymentView => ({
  id: String(p._id), paymentNo: p.paymentNo, provider: p.provider, purpose: p.purpose, status: p.status, amountPaise: p.amountPaise, testMode: p.provider === 'sandbox', createdAt: p.createdAt.toISOString(),
  orders: p.allocations.map((a) => ({ id: String(a.orderId), orderNo: a.orderNo ?? '', amountPaise: a.amountPaise })),
});

const ACTIVE: OrderStatus[] = ['confirmed', 'processing', 'shipped'];

/** Order counters for dashboards. Value = money received minus money refunded. */
export async function orderStats(match: Record<string, unknown>): Promise<OrderStats> {
  const since = new Date(Date.now() - 365 * 86_400_000);
  const [byStatus, months, cancellationRequests, refundRequests] = await Promise.all([
    OrderModel.aggregate<{ _id: { status: OrderStatus; project: boolean }; n: number; value: number }>([
      { $match: match },
      { $group: { _id: { status: '$status', project: { $eq: ['$kind', 'project'] } }, n: { $sum: 1 }, value: { $sum: { $subtract: ['$capturedPaise', '$refundedPaise'] } } } },
    ]),
    OrderModel.aggregate<{ _id: string; value: number }>([
      { $match: { ...match, confirmedAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$confirmedAt', timezone: 'Asia/Kolkata' } }, value: { $sum: { $subtract: ['$capturedPaise', '$refundedPaise'] } } } },
    ]),
    OrderModel.countDocuments({ ...match, 'cancellation.status': 'open' }),
    OrderModel.countDocuments({ ...match, refundRequestedPaise: { $gt: 0 } }),
  ]);
  const count = (f: (s: OrderStatus, project: boolean) => boolean) => byStatus.filter((r) => f(r._id.status, r._id.project)).reduce((a, r) => a + r.n, 0);
  const ist = new Date(Date.now() + 5.5 * 3_600_000);
  return {
    total: count(() => true), pending: count((s) => s === 'pending'), active: count((s) => ACTIVE.includes(s)), completed: count((s) => s === 'completed'), cancelled: count((s) => s === 'cancelled' || s === 'refunded'),
    valuePaise: byStatus.reduce((a, r) => a + r.value, 0), runningProjects: count((s, p) => p && ACTIVE.includes(s)), completedProjects: count((s, p) => p && s === 'completed'),
    months: Array.from({ length: 12 }, (_, i) => {
      const key = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7);
      return { month: key, valuePaise: months.find((m) => m._id === key)?.value ?? 0 };
    }),
    cancellationRequests, refundRequests,
  };
}
