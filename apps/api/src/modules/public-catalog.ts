import { Router } from 'express';
import { z } from 'zod';
import { LISTING_TYPES, type PublicVendorProfile, type VendorCard } from '@jr/shared';
import { CategoryModel, ListingModel } from '../models/catalog';
import { VendorModel } from '../models/vendor';
import { notFound } from '../core/errors';
import { escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { loadRefs, toDetail, toSummary, vendorCard, VISIBLE } from '../services/catalog';
import { KEY_PATTERN, storage } from '../services/storage';

/** Public catalog: only published listings of approved vendors are ever returned. */
const router = Router();

const SORTS = {
  relevance: { featured: -1, publishedAt: -1 },
  newest: { publishedAt: -1 },
  price_asc: { pricePaise: 1 },
  price_desc: { pricePaise: -1 },
} as const;

const searchQuery = paginationSchema.extend({
  type: z.enum(LISTING_TYPES),
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  subcategory: z.string().trim().max(80).optional(),
  city: z.string().trim().max(60).optional(),
  min: z.coerce.number().min(0).optional(),
  max: z.coerce.number().min(0).optional(),
  vendor: z.string().trim().max(80).optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc']).default('relevance'),
});

router.get('/listings', async (req, res) => {
  const q = parse(searchQuery, req.query);
  const filter: Record<string, unknown> = { type: q.type, ...VISIBLE };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: rx }, { summary: rx }];
  }
  if (q.category) {
    const cat = await CategoryModel.findOne({ kind: q.type, slug: q.category, parentId: null, isActive: true }, { _id: 1 }).lean();
    if (!cat) return void res.json(paged([], q.page, q.pageSize, 0));
    filter.categoryId = cat._id;
    if (q.subcategory) {
      const sub = await CategoryModel.findOne({ kind: q.type, slug: q.subcategory, parentId: cat._id }, { _id: 1 }).lean();
      if (!sub) return void res.json(paged([], q.page, q.pageSize, 0));
      filter.subcategoryId = sub._id;
    }
  }
  if (q.city) filter.city = new RegExp(`^${escapeRegex(q.city)}$`, 'i');
  if (q.min != null || q.max != null) {
    filter.pricePaise = { ...(q.min != null ? { $gte: Math.round(q.min * 100) } : {}), ...(q.max != null ? { $lte: Math.round(q.max * 100) } : {}) };
  }
  if (q.vendor) {
    const v = await VendorModel.findOne({ slug: q.vendor, status: 'approved' }, { _id: 1 }).lean();
    if (!v) return void res.json(paged([], q.page, q.pageSize, 0));
    filter.vendorId = v._id;
  }
  const [rows, total] = await Promise.all([
    ListingModel.find(filter).sort(SORTS[q.sort]).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    ListingModel.countDocuments(filter),
  ]);
  const refs = await loadRefs(rows as never);
  res.set('Cache-Control', 'public, max-age=30');
  res.json(paged(rows.map((r) => toSummary(r as never, refs)), q.page, q.pageSize, total));
});

/** Cities and price range available for a listing type (filters UI). Categories come from /categories. */
router.get('/listings/facets', async (req, res) => {
  const type = parse(z.enum(LISTING_TYPES), req.query.type);
  const [cities, range] = await Promise.all([
    ListingModel.distinct('city', { type, ...VISIBLE }),
    ListingModel.aggregate<{ min: number; max: number }>([{ $match: { type, ...VISIBLE } }, { $group: { _id: null, min: { $min: '$pricePaise' }, max: { $max: '$pricePaise' } } }]),
  ]);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ cities: (cities as string[]).sort(), priceRange: range[0] ? { min: range[0].min, max: range[0].max } : null });
});

router.get('/listings/:type/:slug', async (req, res) => {
  const type = parse(z.enum(LISTING_TYPES), req.params.type);
  const l = await ListingModel.findOne({ type, slug: String(req.params.slug), ...VISIBLE }).lean();
  if (!l) throw notFound('Listing');
  const refs = await loadRefs([l as never]);
  const [more] = await Promise.all([
    ListingModel.find({ ...VISIBLE, type, vendorId: l.vendorId, _id: { $ne: l._id } }).sort({ publishedAt: -1 }).limit(3).lean(),
  ]);
  const moreRefs = await loadRefs(more as never);
  res.json({ listing: toDetail(l as never, refs), moreFromVendor: more.map((m) => toSummary(m as never, moreRefs)) });
});

/** Project documents (brochures/specs) — public, but only for visible listings, and always as a download. */
router.get('/listings/:type/:slug/documents/:docId', async (req, res) => {
  const l = await ListingModel.findOne({ type: 'project', slug: String(req.params.slug), ...VISIBLE }, { project: 1 }).lean();
  const doc = l?.project?.documents?.find((d) => String(d._id) === req.params.docId);
  if (!doc) throw notFound('Document');
  const data = await storage.get(doc.key, 'public');
  if (!data) throw notFound('Document');
  const isPdf = doc.key.endsWith('.pdf');
  res.set({
    'Content-Type': isPdf ? 'application/pdf' : 'image/webp',
    'Content-Disposition': `attachment; filename="${(doc.name ?? 'document').replace(/[^\w.\- ]/g, '_')}.${isPdf ? 'pdf' : 'webp'}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  });
  res.send(data);
});

/** Homepage: featured listings (or the newest, if none are featured yet) and recently approved vendors. */
router.get('/featured', async (_req, res) => {
  let rows = await ListingModel.find({ ...VISIBLE, featured: true, type: { $in: ['project', 'service'] } }).sort({ publishedAt: -1 }).limit(3).lean();
  if (rows.length < 3) {
    const extra = await ListingModel.find({ ...VISIBLE, type: { $in: ['project', 'service'] }, _id: { $nin: rows.map((r) => r._id) } }).sort({ publishedAt: -1 }).limit(3 - rows.length).lean();
    rows = [...rows, ...extra];
  }
  const refs = await loadRefs(rows as never);
  const vendors = await VendorModel.find({ status: 'approved' }).sort({ approvedAt: -1 }).limit(4).lean();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ listings: rows.map((r) => toSummary(r as never, refs)), vendors: vendors.map((v) => vendorCard(v as never)) });
});

/* ---------------------------------------------------------------- Vendors & directory */

const vendorQuery = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  city: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  letter: z.string().regex(/^[A-Z#]$/).optional(),
  sort: z.enum(['name', 'newest']).default('name'),
});

router.get('/vendors', async (req, res) => {
  const q = parse(vendorQuery, req.query);
  const filter: Record<string, unknown> = { status: 'approved' };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ businessName: rx }, { category: rx }, { description: rx }];
  }
  if (q.city) filter.city = new RegExp(`^${escapeRegex(q.city)}$`, 'i');
  if (q.category) filter.category = new RegExp(`^${escapeRegex(q.category)}$`, 'i');
  if (q.letter) filter.businessName = q.letter === '#' ? /^[^A-Za-z]/ : new RegExp(`^${q.letter}`, 'i');
  const [vendors, total] = await Promise.all([
    VendorModel.find(filter).sort(q.sort === 'name' ? { businessName: 1 } : { approvedAt: -1 }).collation({ locale: 'en' }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    VendorModel.countDocuments(filter),
  ]);
  const counts = await ListingModel.aggregate<{ _id: unknown; n: number }>([
    { $match: { ...VISIBLE, vendorId: { $in: vendors.map((v) => v._id) } } },
    { $group: { _id: '$vendorId', n: { $sum: 1 } } },
  ]);
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
  const data: (VendorCard & { officeAddress: string; website?: string })[] = vendors.map((v) => ({
    ...vendorCard(v as never),
    listingCount: countBy.get(String(v._id)) ?? 0,
    officeAddress: v.officeAddress ?? '',
    website: v.website ?? undefined,
  }));
  res.set('Cache-Control', 'public, max-age=30');
  res.json(paged(data, q.page, q.pageSize, total));
});

router.get('/vendors/facets', async (_req, res) => {
  const [cities, categories] = await Promise.all([
    VendorModel.distinct('city', { status: 'approved' }),
    VendorModel.distinct('category', { status: 'approved' }),
  ]);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ cities: (cities as string[]).filter(Boolean).sort(), categories: (categories as string[]).filter(Boolean).sort() });
});

router.get('/vendors/:slug', async (req, res) => {
  const v = await VendorModel.findOne({ slug: String(req.params.slug), status: 'approved' }).lean();
  if (!v) throw notFound('Vendor');
  const counts = await ListingModel.aggregate<{ _id: string; n: number }>([{ $match: { ...VISIBLE, vendorId: v._id } }, { $group: { _id: '$type', n: { $sum: 1 } } }]);
  const listingCounts = Object.fromEntries(LISTING_TYPES.map((t) => [t, counts.find((c) => c._id === t)?.n ?? 0])) as PublicVendorProfile['listingCounts'];
  const profile: PublicVendorProfile = {
    ...vendorCard(v as never),
    listingCount: Object.values(listingCounts).reduce((a, b) => a + b, 0),
    listingCounts,
    description: v.description ?? '',
    businessType: v.businessType ?? 'other',
    officeAddress: v.officeAddress ?? '',
    state: v.state ?? '',
    website: v.website ?? undefined,
    social: { ...(v.social ?? {}) } as PublicVendorProfile['social'],
    gstRegistered: !!v.gstin,
    memberSince: (v.approvedAt ?? v.createdAt).toISOString(),
  };
  res.json(profile);
});

/* ---------------------------------------------------------------- Media (public files only) */

export const mediaRouter = Router();
mediaRouter.get('/:y/:m/:file', async (req, res) => {
  const key = `${req.params.y}/${req.params.m}/${req.params.file}`;
  if (!KEY_PATTERN.test(key) || !key.endsWith('.webp')) throw notFound('File');
  const data = await storage.get(key, 'public');
  if (!data) throw notFound('File');
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(data);
});

export default router;
