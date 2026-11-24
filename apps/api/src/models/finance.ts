import { Schema, model, type InferSchemaType } from 'mongoose';
import { LEDGER_CATEGORIES, LISTING_TYPES, PLAN_KINDS, WALLET_TYPES, WITHDRAWAL_STATES } from '@jr/shared';

const oid = Schema.Types.ObjectId;
const user = { type: oid, ref: 'User', required: true } as const;
const money = { type: Number, required: true } as const;

/** Sandbox money lives in separate wallets (`isTest`), so it can never be spent or withdrawn as real money. */
const walletSchema = new Schema(
  { userId: user, type: { type: String, enum: WALLET_TYPES, required: true }, isTest: { type: Boolean, required: true }, balancePaise: { type: Number, default: 0 } },
  { timestamps: true },
);
walletSchema.index({ userId: 1, type: 1, isTest: 1 }, { unique: true });
export const WalletModel = model('Wallet', walletSchema);

/** Append-only. Balances change only together with one of these, in the same transaction. */
const ledgerSchema = new Schema(
  {
    txnId: { type: String, required: true }, key: { type: String, required: true }, userId: user, wallet: { type: String, enum: WALLET_TYPES, required: true }, isTest: { type: Boolean, required: true },
    direction: { type: String, enum: ['credit', 'debit'], required: true }, amountPaise: { ...money, min: 1 }, balanceAfterPaise: money, category: { type: String, enum: LEDGER_CATEGORIES, required: true },
    refId: String, description: { type: String, required: true, maxlength: 200 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ledgerSchema.index({ txnId: 1 }, { unique: true });
ledgerSchema.index({ key: 1 }, { unique: true });
ledgerSchema.index({ userId: 1, isTest: 1, createdAt: -1 });
ledgerSchema.index({ isTest: 1, createdAt: -1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace'] as const) {
  ledgerSchema.pre(op as 'updateOne', function () { throw new Error('Ledger entries are immutable'); });
}
ledgerSchema.pre('save', function () { if (!this.isNew) throw new Error('Ledger entries are immutable'); });
export type Ledger = InferSchemaType<typeof ledgerSchema>;
export const LedgerModel = model('LedgerEntry', ledgerSchema);

const withdrawalSchema = new Schema(
  {
    requestNo: { type: String, required: true }, userId: user, key: { type: String, required: true }, amountPaise: money, feePaise: money, netPaise: money, isTest: { type: Boolean, required: true },
    bank: { _id: false, holderName: String, accountLast4: String, ifsc: String, bankName: String }, status: { type: String, enum: WITHDRAWAL_STATES, default: 'requested' },
    utr: String, reason: String, paidAt: Date, processedBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
withdrawalSchema.index({ requestNo: 1 }, { unique: true });
withdrawalSchema.index({ key: 1 }, { unique: true });
withdrawalSchema.index({ utr: 1 }, { unique: true, partialFilterExpression: { utr: { $type: 'string' } } });
withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({ userId: 1, createdAt: -1 });
export type Withdrawal = InferSchemaType<typeof withdrawalSchema>;
export const WithdrawalModel = model('Withdrawal', withdrawalSchema);

const level = { _id: false, kind: { type: String, enum: ['percent', 'flat'], required: true }, value: { type: Number, required: true } };
const ruleSchema = new Schema(
  {
    name: { type: String, required: true }, listingTypes: [{ type: String, enum: LISTING_TYPES }], basis: { type: String, enum: ['before_gst', 'with_gst'], required: true }, levels: [level],
    maxPayoutPaise: { type: Number, default: null }, effectiveFrom: { type: String, default: null }, effectiveTo: { type: String, default: null }, active: { type: Boolean, default: false }, version: { type: Number, default: 1 },
  },
  { timestamps: true },
);
export type CommissionRule = InferSchemaType<typeof ruleSchema>;
export const CommissionRuleModel = model('CommissionRule', ruleSchema);

const commissionSchema = new Schema(
  {
    orderId: { type: oid, ref: 'Order', required: true }, orderNo: String, earnerUserId: user, fromUserId: user, level: { type: Number, required: true }, ruleId: { type: oid, required: true }, ruleVersion: Number, ruleName: String,
    grossPaise: money, tdsPaise: { type: Number, default: 0 }, netPaise: { type: Number, default: 0 }, reversedPaise: { type: Number, default: 0 }, paidGrossPaise: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'paid', 'reversed'], default: 'pending' }, availableAt: { type: Date, required: true }, paidAt: Date, isTest: { type: Boolean, required: true },
  },
  { timestamps: true },
);
commissionSchema.index({ orderId: 1, earnerUserId: 1, level: 1, ruleId: 1 }, { unique: true });
commissionSchema.index({ earnerUserId: 1, status: 1, createdAt: -1 });
commissionSchema.index({ status: 1, availableAt: 1 });
export type Commission = InferSchemaType<typeof commissionSchema>;
export const CommissionModel = model('Commission', commissionSchema);

const tdsSchema = new Schema(
  { userId: user, financialYear: { type: String, required: true }, source: { type: String, required: true }, refId: String, grossPaise: money, ratePct: money, tdsPaise: money, panMasked: String, isTest: { type: Boolean, required: true } },
  { timestamps: true },
);
tdsSchema.index({ userId: 1, financialYear: 1 });
tdsSchema.index({ createdAt: -1 });
export const TdsModel = model('TdsRecord', tdsSchema);

const settlementSchema = new Schema(
  { orderId: { type: oid, ref: 'Order', required: true }, orderNo: String, vendorId: { type: oid, ref: 'Vendor', required: true }, userId: user, grossPaise: money, feePct: money, feePaise: money, netPaise: money, reversedPaise: { type: Number, default: 0 }, baseRefundedPaise: { type: Number, default: 0 }, isTest: { type: Boolean, required: true } },
  { timestamps: true },
);
settlementSchema.index({ orderId: 1 }, { unique: true });
settlementSchema.index({ userId: 1, createdAt: -1 });
export const SettlementModel = model('Settlement', settlementSchema);

const couponModelSchema = new Schema(
  {
    code: { type: String, required: true }, name: { type: String, required: true }, kind: { type: String, enum: ['percent', 'flat'], required: true }, value: money, minOrderPaise: money, maxDiscountPaise: { type: Number, default: null },
    listingTypes: [String], fundedBy: { type: String, enum: ['platform', 'vendor'], required: true }, validFrom: { type: Date, required: true }, validTo: { type: Date, required: true },
    totalLimit: { type: Number, default: null }, perUserLimit: money, usedCount: { type: Number, default: 0 }, audience: { type: String, enum: ['everyone', 'assigned'], required: true }, assignedUserIds: [{ type: oid, ref: 'User' }], active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
couponModelSchema.index({ code: 1 }, { unique: true });
couponModelSchema.index({ assignedUserIds: 1 });
export type Coupon = InferSchemaType<typeof couponModelSchema>;
export const CouponModel = model('Coupon', couponModelSchema);

const redemptionSchema = new Schema({ couponId: { type: oid, ref: 'Coupon', required: true }, userId: user, orderIds: [{ type: oid, ref: 'Order' }], discountPaise: money }, { timestamps: true });
redemptionSchema.index({ couponId: 1, userId: 1 });
redemptionSchema.index({ orderIds: 1 });
export const RedemptionModel = model('CouponRedemption', redemptionSchema);

const rewardModelSchema = new Schema(
  { userId: user, kind: { type: String, enum: ['cash', 'other'], required: true }, title: { type: String, required: true }, reason: { type: String, required: true }, amountPaise: { type: Number, default: 0 }, tdsPaise: { type: Number, default: 0 }, key: { type: String, required: true }, byUserId: user, isTest: { type: Boolean, required: true } },
  { timestamps: true },
);
rewardModelSchema.index({ key: 1 }, { unique: true });
rewardModelSchema.index({ userId: 1, createdAt: -1 });
export const RewardModel = model('Reward', rewardModelSchema);

const planModelSchema = new Schema(
  { name: { type: String, required: true }, kind: { type: String, enum: PLAN_KINDS, required: true }, durationDays: { type: Number, default: null }, pricePaise: money, benefits: [String], active: { type: Boolean, default: false } },
  { timestamps: true },
);
export type Plan = InferSchemaType<typeof planModelSchema>;
export const PlanModel = model('SubscriptionPlan', planModelSchema);

const subscriptionSchema = new Schema(
  { userId: user, planId: { type: oid, ref: 'SubscriptionPlan', required: true }, planName: String, startAt: { type: Date, required: true }, endAt: { type: Date, default: null }, via: { type: String, enum: ['payment', 'epin'], required: true }, ref: { type: String, required: true }, isTest: { type: Boolean, required: true } },
  { timestamps: true },
);
subscriptionSchema.index({ userId: 1, endAt: -1 });
subscriptionSchema.index({ ref: 1 }, { unique: true });
export const SubscriptionModel = model('Subscription', subscriptionSchema);

/** The code is kept as a keyed hash (for lookup) and encrypted (so its owner can read it). */
const epinSchema = new Schema(
  {
    codeHash: { type: String, required: true }, codeEncrypted: { type: String, required: true, select: false }, suffix: { type: String, required: true }, planId: { type: oid, ref: 'SubscriptionPlan', required: true }, batchKey: { type: String, required: true }, seq: { type: Number, required: true },
    status: { type: String, enum: ['fresh', 'issued', 'used', 'blocked'], required: true }, issuedToUserId: { type: oid, ref: 'User', default: null }, usedByUserId: { type: oid, ref: 'User', default: null }, usedAt: Date, expiresAt: Date, isTest: { type: Boolean, required: true },
  },
  { timestamps: true },
);
epinSchema.index({ codeHash: 1 }, { unique: true });
epinSchema.index({ batchKey: 1, seq: 1 }, { unique: true });
epinSchema.index({ status: 1, createdAt: -1 });
epinSchema.index({ issuedToUserId: 1 });
export const EpinModel = model('Epin', epinSchema);
