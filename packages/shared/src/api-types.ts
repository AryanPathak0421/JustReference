/** Response shapes shared by the API and the web client. */
import type { Role, UserStatus } from './enums';

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  mobile: string;
  roles: Role[];
  /** Effective permission keys; super admins also get the SUPER_ADMIN_ABILITIES. */
  permissions: string[];
  status: UserStatus;
  mustChangePassword: boolean;
  memberId?: string;
  referralCode?: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface RegisterResponse {
  userId: string;
  otp: { channel: 'whatsapp' | 'sms' | 'email'; target: string; expiresInSec: number; resendInSec: number };
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  mobile: string;
  status: UserStatus;
  memberId?: string;
  referralCode?: string;
  sponsor?: { memberId?: string; name: string } | null;
  createdAt: string;
  lastLoginAt?: string | null;
  mobileVerified: boolean;
  hasTransactionPin: boolean;
}

export interface MemberDetail extends MemberRow {
  dob?: string | null;
  addresses?: { residence?: string; office?: string; billing?: string };
  directReferrals: number;
  activeSessions: number;
  statusReason?: string | null;
  roles: Role[];
}

export interface AdminRow {
  id: string;
  name: string;
  email: string;
  mobile: string;
  status: UserStatus;
  roles: { id: string; name: string }[];
  lastLoginAt?: string | null;
  createdAt: string;
  mustChangePassword: boolean;
}

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  assignedCount: number;
  updatedAt: string;
}

/* ---------------- Catalog (Phase 2) */
import type { ListingStatus, ListingType } from './enums';
import type { DocumentType, VendorStatus } from './catalog';

export interface CategoryNode {
  id: string;
  kind: ListingType;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  /** Published listings in this category (and its subcategories, for top-level nodes). */
  listingCount: number;
  children: CategoryNode[];
}

export interface MediaRef {
  id: string;
  key: string;
  url: string;
}

export interface VendorCard {
  id: string;
  name: string;
  slug: string;
  category: string;
  city: string;
  verified: boolean;
  logoUrl?: string | null;
  listingCount?: number;
  isSample?: boolean;
}

export interface ListingSummary {
  id: string;
  type: ListingType;
  name: string;
  slug: string;
  summary: string;
  category: { id: string; name: string; slug: string };
  subcategory?: { id: string; name: string; slug: string } | null;
  pricePaise: number;
  priceNote?: string;
  city: string;
  image?: string | null;
  vendor: VendorCard;
  featured: boolean;
  isSample: boolean;
  createdAt: string;
  product?: { availability: string; unit?: string };
  service?: { deliveryDays: number; remote: boolean };
  project?: { durationDays: number; advancePaise: number; balancePaise: number; allowFullPayment: boolean };
}

export interface ListingDetail extends ListingSummary {
  description: string;
  images: MediaRef[];
  gstRatePct: number;
  attributes: { name: string; value: string }[];
  product?: ListingSummary['product'] & { sku?: string; stockQty?: number };
  project?: ListingSummary['project'] & { specialInstructions?: string; terms?: string; documents: { id: string; name: string }[] };
}

/** Listing as seen by its vendor or an admin, including moderation fields. */
export interface ManagedListing extends ListingDetail {
  status: ListingStatus;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  publishedAt?: string | null;
  updatedAt: string;
}

export interface VendorDocumentInfo {
  id: string;
  type: DocumentType;
  name: string;
  size: number;
  mime: string;
  status: 'pending' | 'approved' | 'rejected';
  uploadedAt: string;
}

export interface VendorSelf {
  id: string;
  status: VendorStatus;
  statusReason?: string | null;
  businessName: string;
  slug: string;
  businessType: string;
  category: string;
  description: string;
  officeAddress: string;
  residenceAddress?: string;
  city: string;
  state: string;
  pincode: string;
  panMasked?: string | null;
  gstin?: string | null;
  website?: string;
  social: Partial<Record<'facebook' | 'instagram' | 'linkedin' | 'youtube' | 'twitter', string>>;
  logoUrl?: string | null;
  bank?: { holderName: string; accountLast4: string; ifsc: string; bankName: string; branchAddress: string } | null;
  documents: VendorDocumentInfo[];
  /** What's still missing before the vendor can submit for approval. */
  checklist: { profile: boolean; bank: boolean; documents: DocumentType[] };
  permissions: string[];
  submittedAt?: string | null;
  approvedAt?: string | null;
}

export interface VendorRow {
  id: string;
  userId: string;
  businessName: string;
  ownerName: string;
  email: string;
  mobile: string;
  city?: string;
  category?: string;
  status: VendorStatus;
  listingCount: number;
  submittedAt?: string | null;
  createdAt: string;
  isSample: boolean;
}

export interface VendorDetail extends VendorSelf {
  userId: string;
  ownerName: string;
  email: string;
  mobile: string;
  accountStatus: string;
  roles: { id: string; name: string }[];
  listingCounts: Record<ListingType, number>;
  createdAt: string;
  isSample: boolean;
}

export interface PublicVendorProfile extends VendorCard {
  description: string;
  businessType: string;
  officeAddress: string;
  state: string;
  website?: string;
  social: VendorSelf['social'];
  gstRegistered: boolean;
  memberSince: string;
  listingCounts: Record<ListingType, number>;
}

/* ---------------- Members & referrals (Phase 3) */
export interface ProfileCompletion {
  percent: number;
  items: { key: string; label: string; done: boolean }[];
}

export interface MemberProfile {
  userId: string;
  name: string;
  email: string;
  mobile: string;
  mobileVerified: boolean;
  memberId: string;
  referralCode: string;
  sponsor: { name: string; memberId: string } | null;
  joinedAt: string;
  dob: string | null;
  addresses: { residence?: string; office?: string; billing?: string };
  panMasked: string | null;
  gstin: string | null;
  aadhaarLast4: string | null;
  website?: string;
  social: Partial<Record<'facebook' | 'twitter' | 'instagram' | 'linkedin', string>>;
  avatarUrl: string | null;
  bank: { holderName: string; accountLast4: string; ifsc: string; bankName: string; branchAddress: string } | null;
  documents: VendorDocumentInfo[];
  completion: ProfileCompletion;
}

export interface BirthdayItem {
  userId: string;
  name: string;
  memberId: string;
  level: number;
  /** YYYY-MM-DD of the upcoming birthday (this year or next). */
  date: string;
  daysAway: number;
}

export interface ReferralSummary {
  memberId: string;
  referralCode: string;
  direct: number;
  indirect: number;
  total: number;
  joinedThisMonth: number;
  byLevel: { level: number; count: number }[];
  invitations: { sent: number; joined: number };
  birthdays: BirthdayItem[];
}

export interface ReferralRow {
  userId: string;
  name: string;
  memberId: string;
  /** 1 = direct referral, 2 = their referral, … */
  level: number;
  sponsor: { name: string; memberId: string } | null;
  status: string;
  joinedAt: string;
  directCount: number;
  /** Masked contact — only for your own direct referrals. */
  mobileMasked?: string;
}

export interface ReferralNode {
  userId: string;
  name: string;
  memberId: string;
  level: number;
  status: string;
  joinedAt: string;
  directCount: number;
  downlineCount: number;
}

export interface ReferralTree {
  node: ReferralNode;
  /** Path from the viewer (or admin-selected root) down to this node, for breadcrumbs. */
  path: { userId: string; name: string; memberId: string }[];
  children: ReferralNode[];
  childrenTotal: number;
}

export interface InvitationRow {
  id: string;
  name: string;
  channel: 'whatsapp' | 'sms' | 'email';
  contactMasked: string;
  status: 'sent' | 'joined';
  joined?: { name: string; memberId: string } | null;
  createdAt: string;
}

export interface MemberBankRow {
  userId: string;
  name: string;
  memberId?: string;
  holderName: string;
  bankName: string;
  accountLast4: string;
  ifsc: string;
  branchAddress: string;
  updatedAt: string;
}

export interface AuditRow {
  id: string;
  actor: { id: string; name: string } | null;
  action: string;
  entity?: string;
  entityId?: string;
  summary: string;
  ip?: string;
  createdAt: string;
}
