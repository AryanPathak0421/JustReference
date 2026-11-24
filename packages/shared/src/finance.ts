import { z } from 'zod';
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
const blankToNull = <T extends z.ZodType>(s: T) => z.union([z.literal('').transform(() => null), z.null(), s]).optional().transform((v) => v ?? null);
const pct = z.coerce.number().min(0, 'Can’t be negative').max(100, 'At most 100%');
const paise = z.number().int().min(0).max(10_000_000_000);
const days = z.coerce.number().int().min(0).max(365);
const isoDate = z.iso.date();
const key = z.string().min(16).max(64);
const pin = z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit wallet password');

export const WALLET_TYPES = ['main', 'earnings'] as const;
export type WalletType = (typeof WALLET_TYPES)[number];
export const LEDGER_CATEGORIES = [
  'topup', 'transfer_in', 'transfer_out', 'purchase', 'refund', 'commission', 'commission_reversal', 'reward', 'sale', 'sale_reversal', 'withdrawal', 'withdrawal_return', 'move', 'epin', 'subscription',
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

/* ---------------- Settings. Everything that moves money is off until a Super Admin sets it. */
export const walletSettingsSchema = z.object({
  topUpEnabled: z.boolean(),
  topUpMinPaise: paise,
  topUpMaxPaise: paise,
  transferEnabled: z.boolean(),
  transferMaxPaise: paise,
  withdrawEnabled: z.boolean(),
  withdrawMinPaise: paise,
  withdrawFeePaise: paise,
  withdrawRequiresKyc: z.boolean(),
  memberEpinEnabled: z.boolean(),
}).refine((v) => v.topUpMaxPaise >= v.topUpMinPaise, { path: ['topUpMaxPaise'], message: 'Must be at least the minimum' })
  .refine((v) => !v.withdrawEnabled || v.withdrawMinPaise > v.withdrawFeePaise, { path: ['withdrawMinPaise'], message: 'Must be more than the fee' });
export type WalletSettings = z.output<typeof walletSettingsSchema>;

export const earningsSettingsSchema = z.object({
  /** null = not decided: vendors are not settled. */
  platformFeePct: pct.nullable(),
  settlementHoldDays: days,
  commissionHoldDays: days,
  tdsEnabled: z.boolean(),
  tdsRatePct: pct,
  tdsNoPanRatePct: pct,
  tdsThresholdPaise: paise,
  tdsOnRewards: z.boolean(),
});
export type EarningsSettings = z.output<typeof earningsSettingsSchema>;

/* ---------------- Wallet */
export const topUpSchema = z.object({ amount: rupees('amount', 1), idempotencyKey: key });
export const transferSchema = z.object({ memberId: z.string().trim().toUpperCase().min(3, 'Enter the member ID').max(20), amount: rupees('amount', 1), note: optionalText(100), pin, idempotencyKey: key });
export const moveSchema = z.object({ amount: rupees('amount', 1), pin, idempotencyKey: key });
export const withdrawSchema = z.object({ amount: rupees('amount', 1), pin, idempotencyKey: key });
export const pinSchema = z.object({ pin });
export const WITHDRAWAL_STATES = ['requested', 'approved', 'paid', 'rejected'] as const;
export const withdrawalDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']), reason: optionalText(300) })
  .refine((d) => d.decision === 'approve' || (d.reason && d.reason.length >= 5), { path: ['reason'], message: 'Give a reason (at least 5 characters)' });
export const withdrawalPaidSchema = z.object({ utr: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,30}$/, 'Enter the bank reference (UTR): 8–30 letters and digits') });

/* ---------------- Commission rules */
export const commissionRuleSchema = z.object({
  name: z.string().trim().min(3, 'Enter a name').max(80),
  listingTypes: z.array(z.enum(LISTING_TYPES)).min(1, 'Choose at least one'),
  /** Amount that percentages apply to. */
  basis: z.enum(['before_gst', 'with_gst']),
  levels: z.array(z.object({ kind: z.enum(['percent', 'flat']), value: z.coerce.number({ error: 'Enter a value' }).positive('Must be more than 0').max(1_000_000) })).min(1, 'Add at least one level').max(15),
  maxPayout: blankToNull(rupees('maximum', 1)),
  effectiveFrom: blankToNull(isoDate),
  effectiveTo: blankToNull(isoDate),
})
  .refine((r) => r.levels.filter((l) => l.kind === 'percent').reduce((a, l) => a + l.value, 0) <= 100, { path: ['levels'], message: 'Percentages can’t add up to more than 100%' })
  .refine((r) => !r.effectiveFrom || !r.effectiveTo || r.effectiveFrom <= r.effectiveTo, { path: ['effectiveTo'], message: 'Must be after the start date' });
export type CommissionRuleInput = z.input<typeof commissionRuleSchema>;
export const activeSchema = z.object({ active: z.boolean() });
export const idsSchema = z.object({ ids: z.array(objectId).min(1).max(100) });

/* ---------------- Coupons & rewards */
export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, 'Use 4–20 letters and digits'),
  name: z.string().trim().min(3, 'Enter a name').max(80),
  kind: z.enum(['percent', 'flat']),
  value: z.coerce.number({ error: 'Enter the value' }).positive('Must be more than 0').max(1_000_000),
  minOrder: rupees('minimum order'),
  maxDiscount: blankToNull(rupees('maximum discount', 1)),
  listingTypes: z.array(z.enum(LISTING_TYPES)).min(1, 'Choose at least one'),
  fundedBy: z.enum(['platform', 'vendor']),
  validFrom: isoDate,
  validTo: isoDate,
  totalLimit: blankToNull(z.coerce.number().int().min(1)),
  perUserLimit: z.coerce.number().int().min(1).max(1000),
  audience: z.enum(['everyone', 'assigned']),
})
  .refine((c) => c.kind !== 'percent' || c.value <= 100, { path: ['value'], message: 'At most 100%' })
  .refine((c) => c.validFrom <= c.validTo, { path: ['validTo'], message: 'Must be after the start date' });
export type CouponInput = z.input<typeof couponSchema>;
export const couponAssignSchema = z.object({ memberIds: z.array(z.string().trim().toUpperCase().min(3).max(20)).min(1, 'Enter at least one member ID').max(200) });
export const applyCouponSchema = z.object({ code: z.string().trim().toUpperCase().min(1, 'Enter a code').max(20) });

export const rewardSchema = z.object({
  memberId: z.string().trim().toUpperCase().min(3, 'Enter the member ID').max(20),
  kind: z.enum(['cash', 'other']),
  title: z.string().trim().min(3, 'Enter a title').max(100),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(300),
  amount: rupees('amount').optional(),
  idempotencyKey: key,
}).refine((r) => r.kind !== 'cash' || (r.amount ?? 0) >= 100, { path: ['amount'], message: 'Enter at least ₹1' });

/* ---------------- Subscriptions & E-PINs */
export const PLAN_KINDS = ['yearly', 'time_based', 'lifetime', 'special'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const planSchema = z.object({
  name: z.string().trim().min(3, 'Enter a name').max(60),
  kind: z.enum(PLAN_KINDS),
  durationDays: blankToNull(z.coerce.number().int().min(1).max(3650)),
  price: rupees('price', 1),
  benefits: z.array(z.string().trim().min(1).max(120)).max(12),
  active: z.boolean(),
}).refine((p) => p.kind === 'lifetime' || p.kind === 'yearly' || !!p.durationDays, { path: ['durationDays'], message: 'Enter the number of days' });
export type PlanInput = z.input<typeof planSchema>;
export const epinGenerateSchema = z.object({ planId: objectId, count: z.coerce.number().int().min(1).max(100), memberId: optionalText(20), expiresOn: blankToNull(isoDate), idempotencyKey: key });
export const epinIssueSchema = z.object({ memberId: z.string().trim().toUpperCase().min(3, 'Enter the member ID').max(20) });
export const epinBuySchema = z.object({ planId: objectId, pin, idempotencyKey: key });
export const epinRedeemSchema = z.object({ code: z.string().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().length(16, 'Enter the 16-character E-PIN')) });
export const subscribeSchema = z.object({ planId: objectId, idempotencyKey: key });

/* ---------------- Response types */
export interface WalletView {
  mainPaise: number; earningsPaise: number; testMode: boolean; pinSet: boolean; pendingWithdrawalPaise: number;
  settings: Pick<WalletSettings, 'topUpEnabled' | 'topUpMinPaise' | 'topUpMaxPaise' | 'transferEnabled' | 'transferMaxPaise' | 'withdrawEnabled' | 'withdrawMinPaise' | 'withdrawFeePaise' | 'withdrawRequiresKyc' | 'memberEpinEnabled'> & { canPay: boolean };
  bank: { holderName: string; accountLast4: string; ifsc: string; bankName: string } | null; kycDone: boolean;
}
export interface LedgerRow { id: string; txnId: string; wallet: WalletType; direction: 'credit' | 'debit'; amountPaise: number; balanceAfterPaise: number; category: LedgerCategory; description: string; createdAt: string; user?: { name: string; memberId?: string } }
export interface LedgerReport { data: LedgerRow[]; meta: { page: number; pageSize: number; total: number }; creditPaise: number; debitPaise: number }
export interface WithdrawalRow { id: string; requestNo: string; amountPaise: number; feePaise: number; netPaise: number; status: string; bank: { holderName: string; accountLast4: string; ifsc: string; bankName: string }; utr: string | null; reason: string | null; createdAt: string; paidAt: string | null; isTest: boolean; user?: { id: string; name: string; memberId?: string } }
export interface CommissionRow { id: string; orderNo: string; level: number; grossPaise: number; tdsPaise: number; netPaise: number; reversedPaise: number; status: string; availableAt: string; createdAt: string; from: { name: string; memberId?: string }; earner?: { name: string; memberId?: string }; ruleName: string; isTest: boolean }
export interface CommissionRuleRow { id: string; name: string; listingTypes: string[]; basis: string; levels: { kind: 'percent' | 'flat'; value: number }[]; maxPayoutPaise: number | null; effectiveFrom: string | null; effectiveTo: string | null; active: boolean; version: number }
export interface CouponRow { id: string; code: string; name: string; kind: 'percent' | 'flat'; value: number; minOrderPaise: number; maxDiscountPaise: number | null; listingTypes: string[]; fundedBy: string; validFrom: string; validTo: string; totalLimit: number | null; perUserLimit: number; usedCount: number; audience: string; assignedCount: number; active: boolean; expired: boolean }
export interface MyCoupon { id: string; code: string; name: string; offer: string; minOrderPaise: number; validTo: string; status: 'unused' | 'used' | 'expired'; discountPaise?: number; usedAt?: string }
export interface RewardRow { id: string; kind: string; title: string; reason: string; amountPaise: number; tdsPaise: number; createdAt: string; user?: { name: string; memberId?: string } }
export interface PlanRow { id: string; name: string; kind: PlanKind; durationDays: number | null; pricePaise: number; benefits: string[]; active: boolean }
export interface SubscriptionView { id: string; plan: string; startAt: string; endAt: string | null; status: 'active' | 'upcoming' | 'expired'; via: string }
export interface EpinRow { id: string; suffix: string; plan: string; status: string; issuedTo: { name: string; memberId?: string } | null; usedBy: { name: string; memberId?: string } | null; createdAt: string; usedAt: string | null; expiresAt: string | null }
export interface TdsRow { id: string; financialYear: string; source: string; grossPaise: number; ratePct: number; tdsPaise: number; panMasked: string | null; createdAt: string; user?: { name: string; memberId?: string } }
export interface SettlementRow { id: string; orderNo: string; grossPaise: number; feePaise: number; netPaise: number; reversedPaise: number; createdAt: string; vendor?: string; isTest: boolean }
export interface EarningsSummary { paidPaise: number; pendingPaise: number; directPaise: number; indirectPaise: number; reversedPaise: number; rewardsPaise: number; tdsPaise: number; months: { month: string; valuePaise: number }[] }
export interface BusinessSummary { own: { orders: number; valuePaise: number }; direct: { orders: number; valuePaise: number }; indirect: { orders: number; valuePaise: number } }
export interface BusinessRow { name: string; memberId: string; level: number; orders: number; valuePaise: number }
export interface ReconciliationView { ranAt: string | null; wallets: number; mismatches: { user: string; wallet: string; balancePaise: number; ledgerPaise: number }[] }
export interface MoneySummary { mainPaise: number; earningsPaise: number; withdrawalsPending: number; withdrawalsPendingPaise: number; withdrawnPaise: number; commissionsPendingPaise: number; commissionsPaidPaise: number; activeRules: number }
