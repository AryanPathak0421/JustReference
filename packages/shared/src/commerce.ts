import { z } from 'zod';
import { mobileSchema } from './auth';
import { GST_RATES } from './catalog';
import { LISTING_TYPES } from './enums';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Choose an option');
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
/** Rupees entered in forms → integer paise. Converted once, by the API. */
const rupees = (label: string, min = 0) =>
  z.coerce
    .number({ error: `Enter the ${label}` })
    .min(min, min ? `The ${label} must be at least ₹${min}` : `The ${label} can’t be negative`)
    .max(100_000_000, `The ${label} is too large`)
    .transform((r) => Math.round(r * 100));
const reason = z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300);

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand',
  'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

export const addressSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(80),
  mobile: mobileSchema,
  line1: z.string().trim().min(5, 'Enter the address').max(150),
  line2: optionalText(150),
  city: z.string().trim().min(2, 'Enter the city').max(60),
  state: z.enum(INDIAN_STATES, { error: 'Choose a state' }),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code'),
});
export type AddressInput = z.input<typeof addressSchema>;
export type Address = z.output<typeof addressSchema>;

export const PAYMENT_PLANS = ['full', 'advance'] as const;
export type PaymentPlan = (typeof PAYMENT_PLANS)[number];

export const cartItemSchema = z.object({
  listingId: objectId,
  qty: z.coerce.number().int().min(1).max(999).default(1),
  plan: z.enum(PAYMENT_PLANS).default('full'),
  note: optionalText(300),
});
export const cartUpdateSchema = z.object({
  qty: z.coerce.number().int().min(1).max(999).optional(),
  plan: z.enum(PAYMENT_PLANS).optional(),
  note: z.string().trim().max(300).optional(),
});

export const checkoutSchema = z.object({
  address: addressSchema,
  /** Total the buyer was shown; if prices changed since, checkout is refused so they can review. */
  expectedTotalPaise: z.number().int().min(0),
  idempotencyKey: z.string().min(16).max(64),
});

export const cancelSchema = z.object({ reason });
export const cancellationDecisionSchema = z.object({ decision: z.enum(['accept', 'decline']), note: optionalText(300) });
export const orderTransitionSchema = z
  .object({
    to: z.enum(['processing', 'shipped', 'completed']),
    note: optionalText(300),
    tracking: z
      .object({
        carrier: z.string().trim().min(2, 'Enter the courier').max(60),
        number: z.string().trim().min(2, 'Enter the tracking number').max(60),
        url: z.union([z.url({ protocol: /^https?$/, error: 'Enter a full link' }), z.literal('')]).optional(),
      })
      .optional(),
  })
  .refine((v) => v.to !== 'shipped' || !!v.tracking, { path: ['tracking', 'carrier'], message: 'Enter the courier and tracking number' });
export const refundSchema = z.object({ amount: rupees('refund amount', 1), reason, idempotencyKey: z.string().min(16).max(64) });
export const sandboxOutcomeSchema = z.object({ outcome: z.enum(['success', 'failure']) });

/* ---------------- Project requests & bids */
export const PROJECT_REQUEST_STATUSES = ['pending_approval', 'open', 'rejected', 'awarded', 'running', 'completed', 'cancelled'] as const;
export type ProjectRequestStatus = (typeof PROJECT_REQUEST_STATUSES)[number];

export const projectRequestSchema = z.object({
  kind: z.enum(['project', 'service']),
  categoryId: objectId,
  title: z.string().trim().min(8, 'Write a clear title (at least 8 characters)').max(120),
  description: z.string().trim().min(30, 'Describe what you need (at least 30 characters)').max(4000),
  budget: rupees('budget', 1),
  timelineDays: z.coerce.number().int().min(1, 'At least 1 day').max(1000),
  city: z.string().trim().min(2, 'Enter the city').max(60),
});
export type ProjectRequestInput = z.input<typeof projectRequestSchema>;

export const bidSchema = z
  .object({
    amount: rupees('bid amount', 1),
    advance: rupees('advance'),
    gstRatePct: z.coerce.number().refine((v) => (GST_RATES as readonly number[]).includes(v), 'Choose a GST rate'),
    estimatedDays: z.coerce.number().int().min(1, 'At least 1 day').max(1000),
    proposal: z.string().trim().min(30, 'Describe your proposal (at least 30 characters)').max(3000),
  })
  .refine((v) => v.advance <= v.amount, { path: ['advance'], message: 'Advance can’t be more than the bid' });
export type BidInput = z.input<typeof bidSchema>;
export const acceptBidSchema = z.object({ address: addressSchema, plan: z.enum(PAYMENT_PLANS) });
export const requestDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reason: optionalText(300) })
  .refine((d) => d.decision === 'approve' || (d.reason && d.reason.length >= 5), { path: ['reason'], message: 'Give a reason (at least 5 characters)' });

/* ---------------- Commerce settings (business rules are configurable, never hard-coded) */
export const COMPLETION_BY = ['vendor', 'buyer', 'either'] as const;
export const commerceSettingsSchema = z.object({
  unpaidExpiryMinutes: z.coerce.number().int().min(10, 'At least 10 minutes').max(10_080),
  completionBy: z.enum(COMPLETION_BY),
  projectRequestsNeedApproval: z.boolean(),
});
export type CommerceSettings = z.output<typeof commerceSettingsSchema>;

/* ---------------- Response types */
export interface CartLine {
  id: string; listingId: string; type: (typeof LISTING_TYPES)[number]; name: string; slug: string; image: string | null;
  qty: number; plan: PaymentPlan; note: string; unitPricePaise: number; gstRatePct: number;
  taxablePaise: number; gstPaise: number; totalPaise: number; dueNowPaise: number;
  allowFull: boolean; allowAdvance: boolean; problem: string | null; isSample: boolean;
}
export interface CartGroup { vendor: { id: string; name: string; slug: string; gstRegistered: boolean }; lines: CartLine[]; totalPaise: number }
export interface CartView {
  groups: CartGroup[]; count: number; subtotalPaise: number; gstPaise: number; totalPaise: number; dueNowPaise: number;
  canCheckout: boolean; paymentsEnabled: boolean; testMode: boolean;
}

export interface OrderRow {
  id: string; orderNo: string; kind: (typeof LISTING_TYPES)[number]; title: string; itemCount: number; status: string; paymentStatus: string;
  totalPaise: number; paidPaise: number; refundedPaise: number; createdAt: string;
  buyer: { name: string; memberId?: string }; vendor: { id: string; name: string; slug: string };
  isTest: boolean; cancellationRequested: boolean; trackingNumber: string | null;
}
export interface RefundInfo { id: string; amountPaise: number; reason: string; status: string; createdAt: string }
export interface OrderDetail extends OrderRow {
  items: {
    name: string; type: string; slug: string | null; qty: number; unitPricePaise: number; gstRatePct: number;
    taxablePaise: number; gstPaise: number; totalPaise: number; note: string;
  }[];
  subtotalPaise: number; gstPaise: number; advancePaise: number; plan: PaymentPlan; dueNowPaise: number;
  address: Address | null;
  history: { status: string; at: string; by: string; note: string }[];
  tracking: { carrier: string; number: string; url: string } | null;
  cancellation: { status: string; reason: string; note: string; at: string } | null;
  payments: { id: string; paymentNo: string; amountPaise: number; status: string; at: string }[];
  refunds: RefundInfo[];
  refundRequestedPaise: number;
  invoices: { id: string; invoiceNo: string; type: string; totalPaise: number; issuedAt: string }[];
  projectRequestId: string | null;
  /** What the current viewer may do: pay, cancel, request_cancel, decide_cancel, processing, shipped, completed, refund. */
  actions: string[];
  expiresAt: string | null;
}
export interface PaymentView {
  id: string; paymentNo: string; provider: string; status: string; amountPaise: number; testMode: boolean; createdAt: string;
  orders: { id: string; orderNo: string; amountPaise: number }[];
}
export interface InvoiceRow {
  id: string; invoiceNo: string; type: string; orderId: string; orderNo: string; seller: string; buyer: string;
  taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; issuedAt: string; isTest: boolean;
}
export interface GstSummaryRow { month: string; invoices: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }
export interface BidView {
  id: string; vendor: { id: string; name: string; slug: string; city: string }; amountPaise: number; advancePaise: number; gstRatePct: number;
  gstPaise: number; totalPaise: number; estimatedDays: number; proposal: string; status: string; createdAt: string;
}
export interface ProjectRequestView {
  id: string; kind: 'project' | 'service'; title: string; description: string; category: string; budgetPaise: number; timelineDays: number; city: string;
  status: ProjectRequestStatus; rejectionReason: string | null; createdAt: string; owner: { name: string; memberId?: string } | null;
  bidCount: number; bids: BidView[]; myBid: BidView | null; orderId: string | null;
}
export interface OrderStats {
  total: number; pending: number; active: number; completed: number; cancelled: number; valuePaise: number;
  runningProjects: number; completedProjects: number; months: { month: string; valuePaise: number }[];
  cancellationRequests: number; refundRequests: number;
}
export interface CustomerRow { userId: string; name: string; memberId?: string; orders: number; valuePaise: number; lastOrderAt: string }
