import type { Types } from 'mongoose';
import type { ListingDetail, ListingSummary, ManagedListing, VendorCard } from '@jr/shared';
import { CategoryModel, ListingModel, type Listing } from '../models/catalog';
import { VendorModel } from '../models/vendor';
import { publicUrl } from './storage';

type LeanListing = Listing & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
type LeanVendor = { _id: Types.ObjectId; businessName: string; slug: string; category?: string | null; city?: string | null; status: string; logoKey?: string | null; isSample?: boolean | null };
type LeanCategory = { _id: Types.ObjectId; name: string; slug: string };

export function vendorCard(v: LeanVendor): VendorCard {
  return {
    id: String(v._id),
    name: v.businessName,
    slug: v.slug,
    category: v.category ?? '',
    city: v.city ?? '',
    verified: v.status === 'approved',
    logoUrl: publicUrl(v.logoKey),
    isSample: !!v.isSample,
  };
}

/** Batch-load the vendors and categories a set of listings refers to. */
export async function loadRefs(listings: LeanListing[]) {
  const vendorIds = [...new Set(listings.map((l) => String(l.vendorId)))];
  const catIds = [...new Set(listings.flatMap((l) => [l.categoryId, l.subcategoryId].filter(Boolean).map(String)))];
  const [vendors, cats] = await Promise.all([
    VendorModel.find({ _id: { $in: vendorIds } }, { businessName: 1, slug: 1, category: 1, city: 1, status: 1, logoKey: 1, isSample: 1 }).lean(),
    CategoryModel.find({ _id: { $in: catIds } }, { name: 1, slug: 1 }).lean(),
  ]);
  return {
    vendors: new Map(vendors.map((v) => [String(v._id), v as LeanVendor])),
    cats: new Map(cats.map((c) => [String(c._id), c as LeanCategory])),
  };
}

const catRef = (c?: LeanCategory) => (c ? { id: String(c._id), name: c.name, slug: c.slug } : null);

export function toSummary(l: LeanListing, refs: Awaited<ReturnType<typeof loadRefs>>): ListingSummary {
  const v = refs.vendors.get(String(l.vendorId));
  const s: ListingSummary = {
    id: String(l._id),
    type: l.type,
    name: l.name,
    slug: l.slug,
    summary: l.summary,
    category: catRef(refs.cats.get(String(l.categoryId))) ?? { id: String(l.categoryId), name: 'Uncategorised', slug: '' },
    subcategory: l.subcategoryId ? catRef(refs.cats.get(String(l.subcategoryId))) : null,
    pricePaise: l.pricePaise,
    priceNote: l.priceNote ?? undefined,
    city: l.city,
    image: publicUrl(l.images?.[0]?.key),
    vendor: v ? vendorCard(v) : { id: String(l.vendorId), name: 'Unknown vendor', slug: '', category: '', city: '', verified: false },
    featured: !!l.featured,
    isSample: !!l.isSample,
    createdAt: l.createdAt.toISOString(),
  };
  if (l.type === 'product' && l.product) s.product = { availability: l.product.availability ?? 'in_stock', unit: l.product.unit ?? undefined };
  if (l.type === 'service' && l.service) s.service = { deliveryDays: l.service.deliveryDays ?? 1, remote: !!l.service.remote };
  if (l.type === 'project' && l.project) {
    const advance = l.project.advancePaise ?? 0;
    s.project = { durationDays: l.project.durationDays ?? 1, advancePaise: advance, balancePaise: Math.max(0, l.pricePaise - advance), allowFullPayment: !!l.project.allowFullPayment };
  }
  return s;
}

export function toDetail(l: LeanListing, refs: Awaited<ReturnType<typeof loadRefs>>): ListingDetail {
  const base = toSummary(l, refs);
  return {
    ...base,
    description: l.description ?? '',
    images: (l.images ?? []).map((m) => ({ key: m.key, url: publicUrl(m.key)!, id: String((m as { _id?: unknown })._id) })),
    gstRatePct: l.gstRatePct ?? 18,
    attributes: (l.attributes ?? []).map((a) => ({ name: a.name ?? '', value: a.value ?? '' })),
    product: base.product ? { ...base.product, sku: l.product?.sku ?? undefined, stockQty: l.product?.stockQty ?? undefined } : undefined,
    project: base.project
      ? {
          ...base.project,
          specialInstructions: l.project?.specialInstructions ?? undefined,
          terms: l.project?.terms ?? undefined,
          documents: (l.project?.documents ?? []).map((d) => ({ id: String((d as { _id?: unknown })._id), name: d.name ?? 'Document' })),
        }
      : undefined,
  };
}

export function toManaged(l: LeanListing, refs: Awaited<ReturnType<typeof loadRefs>>): ManagedListing {
  return {
    ...toDetail(l, refs),
    status: l.status,
    rejectionReason: l.rejectionReason ?? null,
    submittedAt: l.submittedAt?.toISOString() ?? null,
    publishedAt: l.publishedAt?.toISOString() ?? null,
    updatedAt: l.updatedAt.toISOString(),
  };
}

/** Public visibility filter: published listings of approved vendors. */
export const VISIBLE = { status: 'published', vendorActive: true } as const;

/** Validate that category/subcategory exist, are active, match the listing type and each other. */
export async function assertCategories(type: string, categoryId: string, subcategoryId?: string) {
  const ids = [categoryId, subcategoryId].filter(Boolean);
  const cats = await CategoryModel.find({ _id: { $in: ids } }).lean();
  const cat = cats.find((c) => String(c._id) === categoryId);
  const fields: Record<string, string> = {};
  if (!cat || cat.kind !== type || cat.parentId || !cat.isActive) fields.categoryId = 'Choose a category from the list';
  if (subcategoryId) {
    const sub = cats.find((c) => String(c._id) === subcategoryId);
    if (!sub || String(sub.parentId) !== categoryId || !sub.isActive) fields.subcategoryId = 'Choose a subcategory of the selected category';
  }
  return fields;
}

/** Map a parsed listing input onto the Mongoose document shape. */
export function listingFields(input: import('@jr/shared').ListingParsed) {
  const base = {
    name: input.name,
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId ?? null,
    summary: input.summary,
    description: input.description ?? '',
    city: input.city,
    pricePaise: input.price,
    priceNote: input.priceNote,
    gstRatePct: input.gstRatePct,
    attributes: input.attributes,
  };
  if (input.type === 'product') return { ...base, product: input.product, service: undefined, project: undefined };
  if (input.type === 'service') return { ...base, service: input.service, product: undefined };
  return {
    ...base,
    product: undefined,
    service: undefined,
    'project.durationDays': input.project.durationDays,
    'project.advancePaise': input.project.advance,
    'project.allowFullPayment': input.project.allowFullPayment,
    'project.specialInstructions': input.project.specialInstructions,
    'project.terms': input.project.terms,
  };
}

export { ListingModel };
