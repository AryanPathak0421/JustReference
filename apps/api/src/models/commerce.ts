import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { BID_STATUSES, LISTING_TYPES, ORDER_STATUSES, PAYMENT_PLANS, PAYMENT_STATUSES, PROJECT_REQUEST_STATUSES } from '@jr/shared';

const oid = Schema.Types.ObjectId;

const cartSchema = new Schema(
  {
    userId: { type: oid, ref: 'User', required: true },
    couponCode: String,
    items: [{ listingId: { type: oid, ref: 'Listing', required: true }, qty: { type: Number, required: true }, plan: { type: String, enum: PAYMENT_PLANS, default: 'full' }, note: String }],
  },
  { timestamps: true },
);
cartSchema.index({ userId: 1 }, { unique: true });
export const CartModel = model('Cart', cartSchema);

const addressShape = { _id: false, name: String, mobile: String, line1: String, line2: String, city: String, state: String, pincode: String };

/** One order per vendor and type (each project is its own order). Items and prices are snapshots. All money is integer paise. */
const orderSchema = new Schema(
  {
    orderNo: { type: String, required: true },
    buyerUserId: { type: oid, ref: 'User', required: true },
    vendorId: { type: oid, ref: 'Vendor', required: true },
    kind: { type: String, enum: LISTING_TYPES, required: true },
    items: [{
      _id: false, listingId: { type: oid, ref: 'Listing' }, name: { type: String, required: true }, type: { type: String, required: true }, slug: String,
      qty: { type: Number, required: true }, unitPricePaise: { type: Number, required: true }, gstRatePct: { type: Number, required: true },
      discountPaise: { type: Number, default: 0 }, taxablePaise: { type: Number, required: true }, gstPaise: { type: Number, required: true }, totalPaise: { type: Number, required: true }, note: String, stockReserved: { type: Boolean, default: false },
    }],
    /** Taxable value, after any coupon discount. */
    subtotalPaise: { type: Number, required: true },
    discountPaise: { type: Number, default: 0 },
    couponCode: String,
    couponFundedBy: { type: String, enum: ['platform', 'vendor'] },
    commissionsDone: { type: Boolean, default: false },
    settled: { type: Boolean, default: false },
    gstPaise: { type: Number, required: true },
    totalPaise: { type: Number, required: true, min: 1 },
    plan: { type: String, enum: PAYMENT_PLANS, default: 'full' },
    advancePaise: { type: Number, default: 0 },
    /** Money applied to this order's price. */
    paidPaise: { type: Number, default: 0 },
    /** All money received for this order, including late or duplicate payments that must be refunded. */
    capturedPaise: { type: Number, default: 0 },
    refundReservedPaise: { type: Number, default: 0 },
    refundedPaise: { type: Number, default: 0 },
    /** Waiting for an admin to decide. Refund amounts are never decided automatically. */
    refundRequestedPaise: { type: Number, default: 0 },
    creditedPaise: { type: Number, default: 0 },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending' },
    confirmedAt: Date,
    completedAt: Date,
    expiresAt: Date,
    address: { type: addressShape, required: true },
    history: [{ _id: false, status: String, at: Date, byUserId: { type: oid, ref: 'User' }, by: String, note: String }],
    tracking: { type: { _id: false, carrier: String, number: String, url: String }, default: undefined },
    cancellation: { type: { _id: false, status: String, reason: String, note: String, at: Date }, default: undefined },
    projectRequestId: { type: oid, ref: 'ProjectRequest', default: null },
    isTest: { type: Boolean, default: false },
  },
  { timestamps: true },
);
orderSchema.index({ orderNo: 1 }, { unique: true });
orderSchema.index({ buyerUserId: 1, createdAt: -1 });
orderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ status: 1, expiresAt: 1 });
orderSchema.index({ status: 1, commissionsDone: 1 });
orderSchema.index({ status: 1, settled: 1, completedAt: 1 });
export type Order = InferSchemaType<typeof orderSchema>;
export type OrderDoc = HydratedDocument<Order>;
export const OrderModel = model('Order', orderSchema);

const paymentSchema = new Schema(
  {
    paymentNo: { type: String, required: true },
    buyerUserId: { type: oid, ref: 'User', required: true },
    idempotencyKey: { type: String, required: true },
    allocations: [{ _id: false, orderId: { type: oid, ref: 'Order', required: true }, orderNo: String, amountPaise: { type: Number, required: true } }],
    amountPaise: { type: Number, required: true, min: 1 },
    purpose: { type: String, enum: ['order', 'topup', 'subscription'], default: 'order' },
    planId: { type: oid, ref: 'SubscriptionPlan' },
    provider: { type: String, required: true },
    providerOrderId: String,
    providerPaymentId: String,
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created' },
    /** Gateway event IDs already processed (replay protection). */
    eventIds: { type: [String], default: [] },
    verifiedAt: Date,
  },
  { timestamps: true },
);
paymentSchema.index({ paymentNo: 1 }, { unique: true });
paymentSchema.index({ buyerUserId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $type: 'string' } } });
paymentSchema.index({ 'allocations.orderId': 1 });
export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema);

const refundModelSchema = new Schema(
  {
    orderId: { type: oid, ref: 'Order', required: true },
    paymentId: { type: oid, ref: 'Payment', required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true },
    status: { type: String, enum: ['processing', 'processed', 'failed'], default: 'processing' },
    providerRefundId: String,
    idempotencyKey: { type: String, required: true },
    byUserId: { type: oid, ref: 'User', required: true },
  },
  { timestamps: true },
);
refundModelSchema.index({ idempotencyKey: 1, paymentId: 1 }, { unique: true });
refundModelSchema.index({ orderId: 1 });
export const RefundModel = model('Refund', refundModelSchema);

const partySchema = { _id: false, name: String, address: String, state: String, gstin: String };
const invoiceSchema = new Schema(
  {
    invoiceNo: { type: String, required: true },
    type: { type: String, enum: ['invoice', 'credit_note'], required: true },
    orderId: { type: oid, ref: 'Order', required: true },
    orderNo: { type: String, required: true },
    refundKey: String,
    vendorId: { type: oid, ref: 'Vendor', required: true },
    buyerUserId: { type: oid, ref: 'User', required: true },
    seller: { type: partySchema, required: true },
    buyer: { type: partySchema, required: true },
    interState: { type: Boolean, required: true },
    lines: [{ _id: false, name: String, qty: Number, gstRatePct: Number, taxablePaise: Number, cgstPaise: Number, sgstPaise: Number, igstPaise: Number, totalPaise: Number }],
    taxablePaise: { type: Number, required: true },
    cgstPaise: { type: Number, required: true },
    sgstPaise: { type: Number, required: true },
    igstPaise: { type: Number, required: true },
    totalPaise: { type: Number, required: true },
    originalInvoiceNo: String,
    isTest: { type: Boolean, default: false },
    issuedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
invoiceSchema.index({ invoiceNo: 1 }, { unique: true });
invoiceSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { type: 'invoice' } });
invoiceSchema.index({ vendorId: 1, issuedAt: -1 });
invoiceSchema.index({ buyerUserId: 1, issuedAt: -1 });
invoiceSchema.index({ issuedAt: -1 });
export type Invoice = InferSchemaType<typeof invoiceSchema>;
export const InvoiceModel = model('Invoice', invoiceSchema);

const projectRequestSchema = new Schema(
  {
    ownerUserId: { type: oid, ref: 'User', required: true },
    kind: { type: String, enum: ['project', 'service'], required: true },
    categoryId: { type: oid, ref: 'Category', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    budgetPaise: { type: Number, required: true },
    timelineDays: { type: Number, required: true },
    city: { type: String, required: true },
    status: { type: String, enum: PROJECT_REQUEST_STATUSES, required: true },
    rejectionReason: String,
    awardedBidId: { type: oid, ref: 'Bid', default: null },
    orderId: { type: oid, ref: 'Order', default: null },
  },
  { timestamps: true },
);
projectRequestSchema.index({ ownerUserId: 1, status: 1 });
projectRequestSchema.index({ status: 1, createdAt: -1 });
export type ProjectRequest = InferSchemaType<typeof projectRequestSchema>;
export const ProjectRequestModel = model('ProjectRequest', projectRequestSchema);

const bidModelSchema = new Schema(
  {
    requestId: { type: oid, ref: 'ProjectRequest', required: true },
    vendorId: { type: oid, ref: 'Vendor', required: true },
    amountPaise: { type: Number, required: true },
    advancePaise: { type: Number, required: true },
    gstRatePct: { type: Number, required: true },
    estimatedDays: { type: Number, required: true },
    proposal: { type: String, required: true },
    status: { type: String, enum: BID_STATUSES, default: 'submitted' },
  },
  { timestamps: true },
);
bidModelSchema.index({ requestId: 1, vendorId: 1 }, { unique: true });
bidModelSchema.index({ vendorId: 1, createdAt: -1 });
export type Bid = InferSchemaType<typeof bidModelSchema>;
export const BidModel = model('Bid', bidModelSchema);
