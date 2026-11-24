import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { BUSINESS_TYPES, DOCUMENT_TYPES, VENDOR_STATUSES } from '@jr/shared';

/**
 * Vendor business profile. One per vendor user.
 * PAN is stored encrypted (AES-256-GCM) with a masked copy for display; it is never returned in full.
 */
const vendorSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessName: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true },
    businessType: { type: String, enum: BUSINESS_TYPES, default: 'proprietorship' },
    category: { type: String, default: '', maxlength: 60 },
    description: { type: String, default: '', maxlength: 1500 },
    officeAddress: { type: String, default: '', maxlength: 300 },
    residenceAddress: { type: String, maxlength: 300 },
    city: { type: String, default: '', maxlength: 60 },
    state: { type: String, default: '', maxlength: 60 },
    pincode: { type: String, default: '' },
    panEncrypted: { type: String, select: false },
    panMasked: String,
    gstin: String,
    website: String,
    social: { facebook: String, instagram: String, linkedin: String, youtube: String, twitter: String },
    logoKey: String,
    /** Short seller number used in invoice numbers; assigned with the first invoice. */
    sellerNo: Number,
    status: { type: String, enum: VENDOR_STATUSES, default: 'draft' },
    statusReason: { type: String, maxlength: 300 },
    submittedAt: Date,
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isSample: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false },
);
vendorSchema.index({ userId: 1 }, { unique: true });
vendorSchema.index({ slug: 1 }, { unique: true });
vendorSchema.index({ status: 1, submittedAt: 1 });
vendorSchema.index({ status: 1, city: 1, category: 1 });
vendorSchema.index({ businessName: 'text', category: 'text', description: 'text' });

export type Vendor = InferSchemaType<typeof vendorSchema>;
export type VendorDoc = HydratedDocument<Vendor>;
export const VendorModel = model('Vendor', vendorSchema);

/** Bank account for payouts. Account number encrypted; only the last 4 digits are readable. */
const bankAccountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    holderName: { type: String, required: true },
    accountNumberEncrypted: { type: String, required: true, select: false },
    accountLast4: { type: String, required: true },
    ifsc: { type: String, required: true },
    bankName: { type: String, required: true },
    branchAddress: { type: String, required: true },
    verifiedAt: Date,
  },
  { timestamps: true },
);
bankAccountSchema.index({ userId: 1 }, { unique: true });
export const BankAccountModel = model('BankAccount', bankAccountSchema);

/** KYC and other private documents. Files live in private storage and are only served to the owner and admins. */
const documentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true, maxlength: 200 },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
documentSchema.index({ userId: 1, type: 1 });
documentSchema.index({ vendorId: 1 });
export const DocumentModel = model('Document', documentSchema);
