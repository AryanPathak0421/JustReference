import type { Request } from 'express';
import { listingSchema, type ListingParsed } from '@jr/shared';
import { ListingModel, type ListingDoc } from '../models/catalog';
import type { VendorDoc } from '../models/vendor';
import { AppError, badRequest, notFound } from '../core/errors';
import { parse } from '../core/http';
import { DOCUMENT_MAX_BYTES, processImage, requireFile, sniff } from '../middleware/upload';
import { assertCategories, listingFields, loadRefs, toManaged } from './catalog';
import { newKey, storage } from './storage';
import { uniqueSlug } from './slug';
import { audit } from './audit';

export const MAX_IMAGES = 8;
export const MAX_PROJECT_DOCS = 5;

/** Validate a listing body; returns the parsed input or throws field errors. */
export async function parseListing(body: unknown, fixedType?: string): Promise<ListingParsed> {
  const input = parse(listingSchema, body);
  if (fixedType && input.type !== fixedType) throw badRequest('A listing’s type can’t be changed', { type: 'A listing’s type can’t be changed' });
  const fields = await assertCategories(input.type, input.categoryId, input.subcategoryId);
  if (Object.keys(fields).length) throw badRequest('Check the category', fields);
  return input;
}

export async function createListing(req: Request, vendor: VendorDoc, input: ListingParsed, status: 'draft' | 'published') {
  const now = new Date();
  const listing = await ListingModel.create({
    type: input.type,
    vendorId: vendor._id,
    slug: await uniqueSlug(ListingModel as never, input.name, { type: input.type }),
    ...expand(listingFields(input)),
    status,
    vendorActive: vendor.status === 'approved',
    publishedAt: status === 'published' ? now : undefined,
    reviewedBy: status === 'published' ? req.auth!.user.id : undefined,
  });
  await audit(req, {
    action: 'listing.create', entity: 'listing', entityId: listing.id,
    summary: `Created ${input.type} “${listing.name}” for ${vendor.businessName}${status === 'published' ? ' (published)' : ' (draft)'}`,
  });
  return listing;
}

/** Turn `{ 'project.x': v }` dotted keys into nested objects for `create`. */
function expand(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!k.includes('.')) { out[k] = v; continue; }
    const [a, b] = k.split('.') as [string, string];
    out[a] = { ...((out[a] as object) ?? {}), [b]: v };
  }
  return out;
}

/**
 * Apply an edit. A vendor editing a live listing sends it back for review unless they may autopublish;
 * an admin's edit keeps the current status.
 */
export async function updateListing(req: Request, listing: ListingDoc, input: ListingParsed, opts: { byVendor: boolean; autopublish: boolean }) {
  const fields = listingFields(input);
  listing.set(fields);
  if (listing.isModified('name')) {
    listing.slug = await uniqueSlug(ListingModel as never, input.name, { type: listing.type }, listing._id);
  }
  let note = '';
  if (opts.byVendor && !opts.autopublish && (listing.status === 'published' || listing.status === 'rejected')) {
    const wasLive = listing.status === 'published';
    listing.status = 'pending_approval';
    listing.submittedAt = new Date();
    listing.rejectionReason = undefined;
    note = wasLive ? ' (sent for re-approval)' : ' (resubmitted)';
  }
  await listing.save();
  await audit(req, { action: 'listing.update', entity: 'listing', entityId: listing.id, summary: `Edited ${listing.type} “${listing.name}”${note}` });
}

/** Vendor submits a draft/rejected listing. Approved vendors with autopublish go live directly. */
export async function submitListing(req: Request, listing: ListingDoc, vendor: VendorDoc, autopublish: boolean) {
  if (vendor.status !== 'approved') {
    throw new AppError(403, 'VENDOR_NOT_APPROVED', 'Your business profile must be approved before you can publish listings');
  }
  if (!['draft', 'rejected', 'archived'].includes(listing.status)) throw badRequest('This listing is already submitted or published');
  if (!listing.images.length) throw badRequest('Add at least one photo before submitting', { images: 'Add at least one photo' });
  const now = new Date();
  listing.submittedAt = now;
  listing.rejectionReason = undefined;
  if (autopublish) {
    listing.status = 'published';
    listing.publishedAt = now;
  } else {
    listing.status = 'pending_approval';
  }
  await listing.save();
  await audit(req, {
    action: autopublish ? 'listing.publish' : 'listing.submit', entity: 'listing', entityId: listing.id,
    summary: autopublish ? `Published ${listing.type} “${listing.name}” (auto-publish right)` : `Submitted ${listing.type} “${listing.name}” for approval`,
  });
}

export async function addImage(req: Request, listing: ListingDoc) {
  const file = requireFile(req.file);
  if (listing.images.length >= MAX_IMAGES) throw badRequest(`A listing can have up to ${MAX_IMAGES} photos`);
  const kind = sniff(file.buffer);
  if (!kind || kind === 'pdf') throw badRequest('Upload a JPG, PNG or WebP image', { file: 'Upload a JPG, PNG or WebP image' });
  const data = await processImage(file.buffer);
  const key = newKey('webp');
  await storage.put(key, data, 'public');
  listing.images.push({ key });
  await listing.save();
}

export async function removeImage(listing: ListingDoc, imageId: string) {
  const img = listing.images.find((i) => String(i._id) === imageId);
  if (!img) throw notFound('Photo');
  listing.images.pull({ _id: img._id });
  await listing.save();
  await storage.remove(img.key, 'public');
}

export async function makeCover(listing: ListingDoc, imageId: string) {
  const idx = listing.images.findIndex((i) => String(i._id) === imageId);
  if (idx < 0) throw notFound('Photo');
  const [img] = listing.images.splice(idx, 1);
  listing.images.unshift(img!);
  await listing.save();
}

/** Project documents (brochures, specs) are downloadable by buyers; PDFs are stored as-is, images re-encoded. */
export async function addProjectDocument(req: Request, listing: ListingDoc) {
  if (listing.type !== 'project') throw badRequest('Documents can only be attached to projects');
  const file = requireFile(req.file);
  const docs = listing.project?.documents ?? [];
  if (docs.length >= MAX_PROJECT_DOCS) throw badRequest(`A project can have up to ${MAX_PROJECT_DOCS} documents`);
  if (file.size > DOCUMENT_MAX_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'That file is too large');
  const kind = sniff(file.buffer);
  if (!kind) throw badRequest('Upload a PDF, JPG or PNG file', { file: 'Upload a PDF, JPG or PNG file' });
  const data = kind === 'pdf' ? file.buffer : await processImage(file.buffer, 2400);
  const key = newKey(kind === 'pdf' ? 'pdf' : 'webp');
  await storage.put(key, data, 'public');
  const name = (typeof req.body?.name === 'string' && req.body.name.trim().slice(0, 80)) || file.originalname.slice(0, 80) || 'Document';
  listing.set('project.documents', [...docs, { key, name }]);
  await listing.save();
}

export async function removeProjectDocument(listing: ListingDoc, docId: string) {
  const docs = listing.project?.documents ?? [];
  const doc = docs.find((d) => String(d._id) === docId);
  if (!doc) throw notFound('Document');
  listing.set('project.documents', docs.filter((d) => String(d._id) !== docId));
  await listing.save();
  await storage.remove(doc.key, 'public');
}

/** Permanently delete a listing and its files (only drafts/rejected/archived — never live ones). */
export async function deleteListing(req: Request, listing: ListingDoc) {
  if (listing.status === 'published' || listing.status === 'pending_approval') {
    throw badRequest('Archive the listing first. Live or in-review listings can’t be deleted.');
  }
  const keys = [...listing.images.map((i) => i.key), ...(listing.project?.documents ?? []).map((d) => d.key)];
  await listing.deleteOne();
  await Promise.all(keys.map((k) => storage.remove(k, 'public')));
  await audit(req, { action: 'listing.delete', entity: 'listing', entityId: listing.id, summary: `Deleted ${listing.type} “${listing.name}”` });
}

export async function managedView(listing: ListingDoc) {
  const lean = listing.toObject() as never;
  return toManaged(lean, await loadRefs([lean]));
}
