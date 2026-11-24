import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  categorySchema, categoryUpdateSchema, LISTING_STATUSES, LISTING_TYPES, listingDecisionSchema, type CategoryNode, type ListingType,
} from '@jr/shared';
import { requirePermission } from '../middleware/auth';
import { IMAGE_MAX_BYTES, DOCUMENT_MAX_BYTES, singleFile } from '../middleware/upload';
import { CategoryModel, ListingModel } from '../models/catalog';
import { VendorModel } from '../models/vendor';
import { badRequest, conflict, notFound } from '../core/errors';
import { assertObjectId, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { loadRefs, toManaged, VISIBLE } from '../services/catalog';
import {
  addImage, addProjectDocument, createListing, deleteListing, makeCover, managedView, parseListing, removeImage, removeProjectDocument, updateListing,
} from '../services/listing-actions';
import { uniqueSlug } from '../services/slug';
import { notify } from '../services/notify';
import { audit } from '../services/audit';

/* ======================================================================== Categories */

/** Category tree with published-listing counts. Public read; admins with catalog.manage also see inactive ones. */
export async function categoryTree(kind: ListingType, includeInactive: boolean): Promise<CategoryNode[]> {
  const [cats, counts] = await Promise.all([
    CategoryModel.find({ kind, ...(includeInactive ? {} : { isActive: true }) }).sort({ sortOrder: 1, name: 1 }).lean(),
    ListingModel.aggregate<{ _id: { c: unknown; s: unknown }; n: number }>([
      { $match: { type: kind, ...VISIBLE } },
      { $group: { _id: { c: '$categoryId', s: '$subcategoryId' }, n: { $sum: 1 } } },
    ]),
  ]);
  const byCat = new Map<string, number>();
  const bySub = new Map<string, number>();
  for (const c of counts) {
    byCat.set(String(c._id.c), (byCat.get(String(c._id.c)) ?? 0) + c.n);
    if (c._id.s) bySub.set(String(c._id.s), (bySub.get(String(c._id.s)) ?? 0) + c.n);
  }
  const node = (c: (typeof cats)[number], count: number): CategoryNode => ({
    id: String(c._id), kind: c.kind, name: c.name, slug: c.slug, sortOrder: c.sortOrder, isActive: c.isActive, listingCount: count, children: [],
  });
  const roots = cats.filter((c) => !c.parentId).map((c) => node(c, byCat.get(String(c._id)) ?? 0));
  const rootById = new Map(roots.map((r) => [r.id, r]));
  for (const c of cats.filter((c) => c.parentId)) rootById.get(String(c.parentId))?.children.push(node(c, bySub.get(String(c._id)) ?? 0));
  return roots;
}

export const categoriesPublicRouter = Router();
categoriesPublicRouter.get('/', async (req, res) => {
  const kind = parse(z.enum(LISTING_TYPES), req.query.kind);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ data: await categoryTree(kind, false) });
});

const router = Router();
// Authentication and the admin-role check are applied once by the parent /admin router (app.ts).

router.get('/categories', requirePermission('catalog.view'), async (req, res) => {
  const kind = parse(z.enum(LISTING_TYPES), req.query.kind);
  res.json({ data: await categoryTree(kind, true) });
});

router.post('/categories', requirePermission('catalog.manage'), async (req, res) => {
  const input = parse(categorySchema, req.body);
  if (input.parentId) {
    const parent = await CategoryModel.findById(input.parentId).lean();
    if (!parent || parent.kind !== input.kind || parent.parentId) throw badRequest('Choose a top-level category of the same type', { parentId: 'Invalid parent' });
  }
  if (await CategoryModel.exists({ kind: input.kind, parentId: input.parentId ?? null, name: new RegExp(`^${escapeRegex(input.name)}$`, 'i') })) {
    throw conflict('A category with this name already exists here', { name: 'Already exists' });
  }
  const cat = await CategoryModel.create({ ...input, parentId: input.parentId ?? null, slug: await uniqueSlug(CategoryModel as never, input.name, { kind: input.kind }) });
  await audit(req, { action: 'category.create', entity: 'category', entityId: cat.id, summary: `Added ${input.parentId ? 'subcategory' : 'category'} “${cat.name}” (${cat.kind})` });
  res.status(201).json({ id: cat.id });
});

router.patch('/categories/:id', requirePermission('catalog.manage'), async (req, res) => {
  const cat = await CategoryModel.findById(assertObjectId(req.params.id, 'Category'));
  if (!cat) throw notFound('Category');
  const input = parse(categoryUpdateSchema, req.body);
  cat.set(input);
  if (cat.isModified('name')) cat.slug = await uniqueSlug(CategoryModel as never, input.name, { kind: cat.kind }, cat._id);
  await cat.save();
  await audit(req, { action: 'category.update', entity: 'category', entityId: cat.id, summary: `Updated category “${cat.name}”${input.isActive === false ? ' (hidden)' : ''}` });
  res.json({ id: cat.id });
});

router.delete('/categories/:id', requirePermission('catalog.manage'), async (req, res) => {
  const cat = await CategoryModel.findById(assertObjectId(req.params.id, 'Category'));
  if (!cat) throw notFound('Category');
  const [children, used] = await Promise.all([
    CategoryModel.countDocuments({ parentId: cat._id }),
    ListingModel.countDocuments({ $or: [{ categoryId: cat._id }, { subcategoryId: cat._id }] }),
  ]);
  if (children) throw conflict(`Remove its ${children} subcategor${children === 1 ? 'y' : 'ies'} first`, undefined, 'CATEGORY_IN_USE');
  if (used) throw conflict(`${used} listing(s) use this category. Move them or hide the category instead.`, undefined, 'CATEGORY_IN_USE');
  await cat.deleteOne();
  await audit(req, { action: 'category.delete', entity: 'category', entityId: cat.id, summary: `Removed category “${cat.name}” (${cat.kind})` });
  res.status(204).end();
});

/* ======================================================================== Listings (admin) */

const listQuery = paginationSchema.extend({
  type: z.enum(LISTING_TYPES).optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  vendorId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  q: z.string().trim().max(80).optional(),
  featured: z.enum(['yes']).optional(),
});

router.get('/listings', requirePermission('catalog.view'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = {};
  if (q.type) filter.type = q.type;
  if (q.status) filter.status = q.status;
  if (q.vendorId) filter.vendorId = q.vendorId;
  if (q.featured) filter.featured = true;
  if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
  const sort: Record<string, 1 | -1> = q.status === 'pending_approval' ? { submittedAt: 1 } : { updatedAt: -1 };
  const [rows, total] = await Promise.all([
    ListingModel.find(filter).sort(sort).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    ListingModel.countDocuments(filter),
  ]);
  const refs = await loadRefs(rows as never);
  res.json(paged(rows.map((r) => toManaged(r as never, refs)), q.page, q.pageSize, total));
});

/** Queue counts for the approvals screen and sidebar badges. */
router.get('/approvals/summary', requirePermission('catalog.view'), async (_req, res) => {
  const [listings, vendors] = await Promise.all([
    ListingModel.aggregate<{ _id: ListingType; n: number }>([{ $match: { status: 'pending_approval' } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    VendorModel.countDocuments({ status: 'pending' }),
  ]);
  const byType = Object.fromEntries(LISTING_TYPES.map((t) => [t, listings.find((l) => l._id === t)?.n ?? 0]));
  res.json({ listings: byType, vendors });
});

async function loadListing(req: Request) {
  const l = await ListingModel.findById(assertObjectId(req.params.id, 'Listing'));
  if (!l) throw notFound('Listing');
  return l;
}

router.get('/listings/:id', requirePermission('catalog.view'), async (req, res) => {
  res.json(await managedView(await loadListing(req)));
});

/** Admin creates a listing on behalf of an approved vendor; it is published straight away. */
router.post('/listings', requirePermission('catalog.manage'), async (req, res) => {
  const vendorId = parse(z.string().regex(/^[a-f0-9]{24}$/, 'Choose a vendor'), req.body?.vendorId);
  const vendor = await VendorModel.findById(vendorId);
  if (!vendor) throw badRequest('Choose a vendor', { vendorId: 'Choose a vendor' });
  const input = await parseListing(req.body);
  const listing = await createListing(req, vendor, input, vendor.status === 'approved' ? 'published' : 'draft');
  res.status(201).json(await managedView(listing));
});

router.patch('/listings/:id', requirePermission('catalog.manage'), async (req, res) => {
  const l = await loadListing(req);
  await updateListing(req, l, await parseListing(req.body, l.type), { byVendor: false, autopublish: true });
  res.json(await managedView(l));
});

router.post('/listings/:id/decision', requirePermission('catalog.approve'), async (req, res) => {
  const l = await loadListing(req);
  const { decision, reason } = parse(listingDecisionSchema, req.body);
  if (l.status !== 'pending_approval') throw badRequest('This listing isn’t waiting for approval');
  if (decision === 'approve') {
    l.status = 'published';
    l.publishedAt = l.publishedAt ?? new Date();
    l.rejectionReason = undefined;
  } else {
    l.status = 'rejected';
    l.rejectionReason = reason;
  }
  l.reviewedBy = req.auth!.user.id as never;
  await l.save();
  await audit(req, {
    action: decision === 'approve' ? 'listing.approve' : 'listing.reject', entity: 'listing', entityId: l.id,
    summary: decision === 'approve' ? `Approved ${l.type} “${l.name}”` : `Rejected ${l.type} “${l.name}”: ${reason}`,
  });
  const owner = await VendorModel.findById(l.vendorId, { userId: 1 }).lean();
  await notify(owner?.userId, { event: 'account', title: decision === 'approve' ? `“${l.name}” is live` : `“${l.name}” needs changes`, body: reason ?? '', link: `/vendor/${l.type}s/${l.id}`, key: `listing:${l.id}:${decision}:${l.submittedAt?.getTime() ?? 0}` });
  res.json(await managedView(l));
});

router.post('/listings/:id/feature', requirePermission('catalog.approve'), async (req, res) => {
  const l = await loadListing(req);
  const { featured } = parse(z.object({ featured: z.boolean() }), req.body);
  if (featured && l.status !== 'published') throw badRequest('Only published listings can be featured');
  l.featured = featured;
  await l.save();
  await audit(req, { action: featured ? 'listing.feature' : 'listing.unfeature', entity: 'listing', entityId: l.id, summary: `${featured ? 'Featured' : 'Un-featured'} ${l.type} “${l.name}”` });
  res.json(await managedView(l));
});

router.post('/listings/:id/archive', requirePermission('catalog.manage'), async (req, res) => {
  const l = await loadListing(req);
  l.status = 'archived';
  l.featured = false;
  await l.save();
  await audit(req, { action: 'listing.archive', entity: 'listing', entityId: l.id, summary: `Archived ${l.type} “${l.name}” (by admin)` });
  res.json(await managedView(l));
});

router.delete('/listings/:id', requirePermission('catalog.manage'), async (req, res) => {
  await deleteListing(req, await loadListing(req));
  res.status(204).end();
});

router.post('/listings/:id/images', requirePermission('catalog.manage'), singleFile('file', IMAGE_MAX_BYTES), async (req, res) => {
  const l = await loadListing(req);
  await addImage(req, l);
  res.status(201).json(await managedView(l));
});
router.delete('/listings/:id/images/:imageId', requirePermission('catalog.manage'), async (req, res) => {
  const l = await loadListing(req);
  await removeImage(l, String(req.params.imageId));
  res.json(await managedView(l));
});
router.post('/listings/:id/images/:imageId/cover', requirePermission('catalog.manage'), async (req, res) => {
  const l = await loadListing(req);
  await makeCover(l, String(req.params.imageId));
  res.json(await managedView(l));
});
router.post('/listings/:id/documents', requirePermission('catalog.manage'), singleFile('file', DOCUMENT_MAX_BYTES), async (req, res) => {
  const l = await loadListing(req);
  await addProjectDocument(req, l);
  res.status(201).json(await managedView(l));
});
router.delete('/listings/:id/documents/:docId', requirePermission('catalog.manage'), async (req, res) => {
  const l = await loadListing(req);
  await removeProjectDocument(l, String(req.params.docId));
  res.json(await managedView(l));
});

export default router;
