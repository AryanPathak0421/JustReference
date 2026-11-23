import type { ClientSession, Types } from 'mongoose';
import { REQUIRED_VENDOR_DOCUMENTS, STANDARD_VENDOR_ROLE_KEY, type DocumentType, type VendorSelf } from '@jr/shared';
import { VendorModel, BankAccountModel, DocumentModel, type Vendor } from '../models/vendor';
import { RoleModel } from '../models/security';
import { UserModel } from '../models/user';
import { ListingModel } from '../models/catalog';
import { publicUrl } from './storage';
import { uniqueSlug } from './slug';

/**
 * Create the empty business profile for a new vendor account (inside the caller's transaction) and give
 * the user the "Standard vendor" rights, so they can prepare draft listings while KYC is reviewed.
 * Submitting listings still requires the vendor to be approved.
 */
export async function createVendorShell(userId: Types.ObjectId | string, businessName: string, session?: ClientSession, extra: Partial<Vendor> = {}) {
  const slug = await uniqueSlug(VendorModel as never, businessName);
  const [vendor] = await VendorModel.create([{ userId, businessName, slug, status: 'draft', ...extra }], { session });
  const standard = await RoleModel.findOne({ key: STANDARD_VENDOR_ROLE_KEY }, { _id: 1 }).session(session ?? null).lean();
  if (standard) await UserModel.updateOne({ _id: userId }, { $addToSet: { roleIds: standard._id } }, { session });
  return vendor!;
}

/** Fields that must be filled before a vendor can submit for approval. */
function profileComplete(v: Vendor) {
  return !!(v.businessName && v.category && v.officeAddress && v.city && v.state && v.pincode && v.panMasked);
}

export async function onboardingChecklist(v: Vendor & { _id: unknown; userId: unknown }) {
  const [bank, docs] = await Promise.all([
    BankAccountModel.exists({ userId: v.userId }),
    DocumentModel.distinct('type', { vendorId: v._id, status: { $ne: 'rejected' } }),
  ]);
  const missingDocs = REQUIRED_VENDOR_DOCUMENTS.filter((t) => !docs.includes(t));
  return { profile: profileComplete(v), bank: !!bank, documents: missingDocs as DocumentType[] };
}

export async function toVendorSelf(v: Vendor & { _id: unknown; userId: unknown; createdAt?: Date }, permissions: string[]): Promise<VendorSelf> {
  const [bank, docs, checklist] = await Promise.all([
    BankAccountModel.findOne({ userId: v.userId }).lean(),
    DocumentModel.find({ vendorId: v._id }).sort({ createdAt: -1 }).lean(),
    onboardingChecklist(v),
  ]);
  return {
    id: String(v._id),
    status: v.status,
    statusReason: v.statusReason ?? null,
    businessName: v.businessName,
    slug: v.slug,
    businessType: v.businessType ?? 'proprietorship',
    category: v.category ?? '',
    description: v.description ?? '',
    officeAddress: v.officeAddress ?? '',
    residenceAddress: v.residenceAddress ?? '',
    city: v.city ?? '',
    state: v.state ?? '',
    pincode: v.pincode ?? '',
    panMasked: v.panMasked ?? null,
    gstin: v.gstin ?? null,
    website: v.website ?? '',
    social: { ...(v.social ?? {}) } as VendorSelf['social'],
    logoUrl: publicUrl(v.logoKey),
    bank: bank ? { holderName: bank.holderName, accountLast4: bank.accountLast4, ifsc: bank.ifsc, bankName: bank.bankName, branchAddress: bank.branchAddress } : null,
    documents: docs.map((d) => ({ id: String(d._id), type: d.type as DocumentType, name: d.originalName, size: d.size, mime: d.mime, status: d.status, uploadedAt: d.createdAt.toISOString() })),
    checklist,
    permissions,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    approvedAt: v.approvedAt?.toISOString() ?? null,
  };
}

/** Keep the denormalised `vendorActive` flag on listings in sync with the vendor's status. */
export async function syncVendorListings(vendorId: Types.ObjectId | string, active: boolean, session?: ClientSession) {
  await ListingModel.updateMany({ vendorId }, { vendorActive: active }, { session });
}

/** Show only the first two and last two characters of a PAN, e.g. AB••••••4F. */
export const maskPan = (pan: string) => `${pan.slice(0, 2)}••••••${pan.slice(8)}`;
