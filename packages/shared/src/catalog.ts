import { z } from 'zod';
import { LISTING_TYPES } from './enums';
import { VENDOR_PERMISSION_KEYS } from './permissions';
import { emailSchema, mobileSchema, passwordSchema } from './auth';

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Choose an option');
/** Rupees entered in forms → integer paise on the wire. */
const rupees = (label: string) =>
  z.coerce.number({ error: `Enter the ${label}` }).min(0, `${label} can’t be negative`).max(100_000_000, `${label} is too large`).transform((r) => Math.round(r * 100));

/* ---------------- Categories */
export const categorySchema = z.object({
  kind: z.enum(LISTING_TYPES),
  name: z.string().trim().min(2, 'Enter a name').max(60),
  parentId: objectId.optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof categorySchema>;

export const categoryUpdateSchema = categorySchema.pick({ name: true, sortOrder: true, isActive: true });

/* ---------------- Listings */
export const PRODUCT_AVAILABILITY = ['in_stock', 'out_of_stock', 'made_to_order'] as const;
export const GST_RATES = [0, 5, 12, 18, 28] as const;

const listingBase = z.object({
  name: z.string().trim().min(3, 'Enter a name (at least 3 characters)').max(120),
  categoryId: objectId,
  subcategoryId: z.union([objectId, z.literal('')]).optional().transform((v) => v || undefined),
  summary: z.string().trim().min(10, 'Write a one-line summary (at least 10 characters)').max(200),
  description: z.string().trim().max(5000).optional().default(''),
  city: z.string().trim().min(2, 'Enter the city').max(60),
  priceNote: optionalText(30),
  gstRatePct: z.coerce.number().refine((v) => (GST_RATES as readonly number[]).includes(v), 'Choose a GST rate'),
  attributes: z.array(z.object({ name: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(120) })).max(20).default([]),
});

export const productListingSchema = listingBase.extend({
  type: z.literal('product'),
  price: rupees('price'),
  product: z.object({
    sku: optionalText(40),
    availability: z.enum(PRODUCT_AVAILABILITY),
    stockQty: z.coerce.number().int().min(0).max(1_000_000).optional(),
    unit: optionalText(20),
  }),
});

export const serviceListingSchema = listingBase.extend({
  type: z.literal('service'),
  price: rupees('price'),
  service: z.object({
    deliveryDays: z.coerce.number().int().min(1, 'At least 1 day').max(365),
    remote: z.boolean(),
  }),
});

/** Projects: cost, duration, advance/balance/full payment, special instructions, terms (brief §7). */
export const projectListingSchema = listingBase.extend({
  type: z.literal('project'),
  price: rupees('project cost'),
  project: z.object({
    durationDays: z.coerce.number().int().min(1, 'At least 1 day').max(3650),
    advance: rupees('advance payment'),
    allowFullPayment: z.boolean(),
    specialInstructions: optionalText(2000),
    terms: optionalText(5000),
  }),
}).refine((d) => d.project.advance <= d.price, { path: ['project', 'advance'], message: 'Advance can’t be more than the project cost' });

export const listingSchema = z.discriminatedUnion('type', [productListingSchema, serviceListingSchema, projectListingSchema]);
export type ListingInput = z.input<typeof listingSchema>;
export type ListingParsed = z.output<typeof listingSchema>;

export const listingDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reason: optionalText(300) })
  .refine((d) => d.decision === 'approve' || (d.reason && d.reason.length >= 5), { path: ['reason'], message: 'Tell the vendor what to fix (at least 5 characters)' });

/* ---------------- Vendors */
export const BUSINESS_TYPES = ['proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other'] as const;
export const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;
export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const url = z.union([z.url('Enter a full URL starting with https://'), z.literal('')]).optional();
const upper = (re: RegExp, msg: string) => z.string().trim().toUpperCase().regex(re, msg);

export const vendorProfileSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name').max(120),
  businessType: z.enum(BUSINESS_TYPES),
  category: z.string().trim().min(2, 'What does your business do? e.g. “Solar installation”').max(60),
  description: z.string().trim().max(1500).optional().default(''),
  officeAddress: z.string().trim().min(10, 'Enter the full business address').max(300),
  residenceAddress: optionalText(300),
  city: z.string().trim().min(2, 'Enter the city').max(60),
  state: z.string().trim().min(2, 'Enter the state').max(60),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code'),
  /** Full PAN is write-only: the API stores it encrypted and only returns the masked form. */
  pan: z.union([upper(PAN_REGEX, 'Enter a valid PAN, e.g. ABCDE1234F'), z.literal('')]).optional(),
  gstin: z.union([upper(GSTIN_REGEX, 'Enter a valid 15-character GSTIN'), z.literal('')]).optional(),
  website: url,
  social: z.object({ facebook: url, instagram: url, linkedin: url, youtube: url, twitter: url }).partial().optional(),
});
export type VendorProfileInput = z.input<typeof vendorProfileSchema>;

export const bankAccountSchema = z
  .object({
    holderName: z.string().trim().min(2, 'Enter the account holder name').max(80),
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Enter a 9–18 digit account number'),
    confirmAccountNumber: z.string().trim(),
    ifsc: upper(IFSC_REGEX, 'Enter a valid IFSC, e.g. HDFC0001234'),
    bankName: z.string().trim().min(2, 'Enter the bank name').max(80),
    branchAddress: z.string().trim().min(5, 'Enter the branch address').max(300),
  })
  .refine((d) => d.accountNumber === d.confirmAccountNumber, { path: ['confirmAccountNumber'], message: 'Account numbers do not match' });
export type BankAccountInput = z.input<typeof bankAccountSchema>;

export const DOCUMENT_TYPES = ['pan_card', 'aadhaar', 'gst_certificate', 'address_proof', 'business_registration', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  pan_card: 'PAN card',
  aadhaar: 'Aadhaar (masked copy)',
  gst_certificate: 'GST certificate',
  address_proof: 'Business address proof',
  business_registration: 'Business registration',
  other: 'Other document',
};
/** Documents a vendor must upload before submitting for approval. */
export const REQUIRED_VENDOR_DOCUMENTS: DocumentType[] = ['pan_card', 'address_proof'];
/** Documents members can upload for KYC (needed before payouts in Phase 5). */
export const MEMBER_DOCUMENT_TYPES: DocumentType[] = ['aadhaar', 'pan_card', 'address_proof', 'other'];

export const VENDOR_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'suspended'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const vendorDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reason: optionalText(300) })
  .refine((d) => d.decision === 'approve' || (d.reason && d.reason.length >= 5), { path: ['reason'], message: 'Tell the vendor what to fix (at least 5 characters)' });

export const vendorStatusSchema = z
  .object({ status: z.enum(['approved', 'suspended']), reason: optionalText(300) })
  .refine((d) => d.status === 'approved' || (d.reason && d.reason.length >= 5), { path: ['reason'], message: 'Give a reason (at least 5 characters)' });

/** Admin "Create vendor": account + business shell; the vendor completes KYC themselves. */
export const vendorCreateSchema = z.object({
  name: z.string().trim().min(2, 'Enter the owner’s full name').max(80),
  email: emailSchema,
  mobile: mobileSchema,
  password: passwordSchema,
  businessName: z.string().trim().min(2, 'Enter the business name').max(120),
});

export const vendorRoleSchema = z.object({
  name: z.string().trim().min(2, 'Enter a role name').max(60),
  description: optionalText(200),
  permissions: z.array(z.enum(VENDOR_PERMISSION_KEYS as [string, ...string[]])).min(1, 'Choose at least one right'),
});

export const vendorRolesAssignSchema = z.object({ roleIds: z.array(objectId) });
