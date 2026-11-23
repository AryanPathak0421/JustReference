import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  bankAccountSchema, DOCUMENT_TYPES, LISTING_STATUSES, LISTING_TYPES, vendorProfileSchema, type ListingType,
} from '@jr/shared';
import { authenticate, requireRole } from '../middleware/auth';
import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES, processImage, requireFile, singleFile, sniff } from '../middleware/upload';
import { VendorModel, BankAccountModel, DocumentModel, type VendorDoc } from '../models/vendor';
import { ListingModel } from '../models/catalog';
import { AppError, badRequest, forbidden, notFound } from '../core/errors';
import { assertObjectId, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { encryptField } from '../core/crypto';
import { newKey, storage } from '../services/storage';
import { maskPan, onboardingChecklist, toVendorSelf } from '../services/vendors';
import { loadRefs, toManaged } from '../services/catalog';
import {
  addImage, addProjectDocument, createListing, deleteListing, makeCover, managedView, parseListing, removeImage,
  removeProjectDocument, submitListing, updateListing,
} from '../services/listing-actions';
import { uniqueSlug } from '../services/slug';
import { audit } from '../services/audit';

/** Vendor self-service: business profile, KYC, bank details and their own listings. */
const router = Router();
router.use(authenticate, requireRole('vendor'));

async function myVendor(req: Request): Promise<VendorDoc> {
  const v = await VendorModel.findOne({ userId: req.auth!.user.id });
  if (!v) throw notFound('Business profile');
  return v;
}

const vendorPerms = (req: Request) => [...req.auth!.permissions].filter((p) => p.startsWith('vendor.'));

/* ---------------------------------------------------------------- Profile & onboarding */

router.get('/profile', async (req, res) => {
  const v = await myVendor(req);
  res.json(await toVendorSelf(v.toObject(), vendorPerms(req)));
});

/** Changing identity fields (name, PAN, GSTIN) of an approved vendor sends the profile back for verification. */
const REVERIFY_FIELDS = ['businessName', 'panMasked', 'gstin'] as const;

router.put('/profile', async (req, res) => {
  const v = await myVendor(req);
  if (v.status === 'suspended') throw forbidden('Your account is suspended. Contact support.', 'VENDOR_SUSPENDED');
  const input = parse(vendorProfileSchema, req.body);
  const { pan, social, ...rest } = input;
  v.set({ ...rest, social: social ?? {}, website: input.website || undefined, gstin: input.gstin || undefined });
  if (pan) {
    v.panEncrypted = encryptField(pan);
    v.panMasked = maskPan(pan);
  }
  if (v.isModified('businessName')) v.slug = await uniqueSlug(VendorModel as never, input.businessName, {}, v._id);
  const reverify = v.status === 'approved' && REVERIFY_FIELDS.some((f) => v.isModified(f));
  if (reverify) {
    v.status = 'pending';
    v.submittedAt = new Date();
    v.statusReason = 'Business details changed; awaiting re-verification';
  }
  await v.save();
  if (reverify) await ListingModel.updateMany({ vendorId: v._id }, { vendorActive: false });
  await audit(req, { action: 'vendor.profile_update', entity: 'vendor', entityId: v.id, summary: `Updated business profile${reverify ? ' (identity details changed: re-verification required)' : ''}` });
  res.json(await toVendorSelf(v.toObject(), vendorPerms(req)));
});

router.put('/bank', async (req, res) => {
  const v = await myVendor(req);
  const input = parse(bankAccountSchema, req.body);
  await BankAccountModel.findOneAndUpdate(
    { userId: req.auth!.user.id },
    {
      holderName: input.holderName,
      accountNumberEncrypted: encryptField(input.accountNumber),
      accountLast4: input.accountNumber.slice(-4),
      ifsc: input.ifsc,
      bankName: input.bankName,
      branchAddress: input.branchAddress,
      verifiedAt: null,
    },
    { upsert: true },
  );
  await audit(req, { action: 'vendor.bank_update', entity: 'vendor', entityId: v.id, summary: `Saved bank account ending ${input.accountNumber.slice(-4)}` });
  res.json(await toVendorSelf(v.toObject(), vendorPerms(req)));
});

router.post('/logo', singleFile('file', IMAGE_MAX_BYTES), async (req, res) => {
  const v = await myVendor(req);
  const file = requireFile(req.file);
  const kind = sniff(file.buffer);
  if (!kind || kind === 'pdf') throw badRequest('Upload a JPG, PNG or WebP image', { file: 'Upload a JPG, PNG or WebP image' });
  const key = newKey('webp');
  await storage.put(key, await processImage(file.buffer, 512), 'public');
  const old = v.logoKey;
  v.logoKey = key;
  await v.save();
  if (old) await storage.remove(old, 'public');
  res.json(await toVendorSelf(v.toObject(), vendorPerms(req)));
});

router.post('/documents', singleFile('file', DOCUMENT_MAX_BYTES), async (req, res) => {
  const v = await myVendor(req);
  const type = parse(z.enum(DOCUMENT_TYPES, { error: 'Choose the document type' }), req.body?.type);
  const file = requireFile(req.file);
  const kind = sniff(file.buffer);
  if (!kind) throw badRequest('Upload a PDF, JPG or PNG file', { file: 'Upload a PDF, JPG or PNG file' });
  if (await DocumentModel.countDocuments({ vendorId: v._id }) >= 15) throw badRequest('You can upload up to 15 documents. Remove old ones first.');
  const data = kind === 'pdf' ? file.buffer : await processImage(file.buffer, 2400);
  const ext = kind === 'pdf' ? 'pdf' : 'webp';
  const key = newKey(ext);
  await storage.put(key, data, 'private');
  await DocumentModel.create({
    userId: req.auth!.user.id, vendorId: v._id, type, storageKey: key,
    originalName: file.originalname.slice(0, 200) || `document.${ext}`, mime: ext === 'pdf' ? 'application/pdf' : 'image/webp', size: data.length,
  });
  await audit(req, { action: 'vendor.document_upload', entity: 'vendor', entityId: v.id, summary: `Uploaded ${type.replace(/_/g, ' ')}` });
  res.status(201).json(await toVendorSelf(v.toObject(), vendorPerms(req)));
});

router.get('/documents/:id/file', async (req, res) => {
  const v = await myVendor(req);
  const doc = await DocumentModel.findOne({ _id: assertObjectId(req.params.id, 'Document'), vendorId: v._id });
  if (!doc) throw notFound('Document');
  await sendPrivate(res, doc.storageKey, doc.mime, doc.originalName);
});

router.delete('/documents/:id', async (req, res) => {
  const v = await myVendor(req);
  const doc = await DocumentModel.findOne({ _id: assertObjectId(req.params.id, 'Document'), vendorId: v._id });
  if (!doc) throw notFound('Document');
  if (doc.status === 'approved' && v.status === 'approved') throw badRequest('Approved documents can’t be removed. Upload a replacement and contact support.');
  await doc.deleteOne();
  await storage.remove(doc.storageKey, 'private');
  res.json(await toVendorSelf(v.toObject(), vendorPerms(req)));
});

router.post('/submit', async (req, res) => {
  const v = await myVendor(req);
  if (!['draft', 'rejected'].includes(v.status)) throw badRequest(v.status === 'pending' ? 'Your profile is already waiting for review' : 'Your profile has already been reviewed');
  const c = await onboardingChecklist(v.toObject());
  const missing = [!c.profile && 'business details (including PAN)', !c.bank && 'bank account', c.documents.length && `documents: ${c.documents.join(', ').replace(/_/g, ' ')}`].filter(Boolean);
  if (missing.length) throw new AppError(400, 'ONBOARDING_INCOMPLETE', `Please complete: ${missing.join('; ')}`, undefined, { checklist: c });
  v.status = 'pending';
  v.submittedAt = new Date();
  v.statusReason = undefined;
  await v.save();
  await audit(req, { action: 'vendor.submit', entity: 'vendor', entityId: v.id, summary: `Submitted ${v.businessName} for approval` });
  res.json(await toVendorSelf(v.toObject(), vendorPerms(req)));
});

/** Serve a private file with headers that stop browsers executing it. */
export async function sendPrivate(res: import('express').Response, key: string, mime: string, name: string) {
  const data = await storage.get(key, 'private');
  if (!data) throw notFound('File');
  res.set({
    'Content-Type': mime,
    'Content-Disposition': `inline; filename="${name.replace(/[^\w.\- ]/g, '_')}"`,
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(data);
}

/* ---------------------------------------------------------------- Dashboard summary */

router.get('/summary', async (req, res) => {
  const v = await myVendor(req);
  const rows = await ListingModel.aggregate<{ _id: { type: ListingType; status: string }; n: number }>([
    { $match: { vendorId: v._id } },
    { $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 } } },
  ]);
  const byType = Object.fromEntries(LISTING_TYPES.map((t) => [t, 0])) as Record<ListingType, number>;
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    byType[r._id.type] += r.n;
    byStatus[r._id.status] = (byStatus[r._id.status] ?? 0) + r.n;
  }
  res.json({ vendorStatus: v.status, byType, byStatus });
});

/* ---------------------------------------------------------------- Listings */

function canManage(req: Request) {
  if (!req.auth!.permissions.has('vendor.listings.manage')) {
    throw forbidden('Your vendor role doesn’t allow managing listings. Contact support.', 'FORBIDDEN', { missing: ['vendor.listings.manage'] });
  }
}
const autopublish = (req: Request) => req.auth!.permissions.has('vendor.listings.autopublish');

async function myListing(req: Request, v: VendorDoc) {
  const l = await ListingModel.findOne({ _id: assertObjectId(req.params.id, 'Listing'), vendorId: v._id });
  if (!l) throw notFound('Listing');
  return l;
}

const listQuery = paginationSchema.extend({
  type: z.enum(LISTING_TYPES).optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
});

router.get('/listings', async (req, res) => {
  const v = await myVendor(req);
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = { vendorId: v._id };
  if (q.type) filter.type = q.type;
  if (q.status) filter.status = q.status;
  if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
  const [rows, total] = await Promise.all([
    ListingModel.find(filter).sort({ updatedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    ListingModel.countDocuments(filter),
  ]);
  const refs = await loadRefs(rows as never);
  res.json(paged(rows.map((r) => toManaged(r as never, refs)), q.page, q.pageSize, total));
});

router.post('/listings', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  if (v.status === 'suspended') throw forbidden('Your account is suspended', 'VENDOR_SUSPENDED');
  const input = await parseListing(req.body);
  const listing = await createListing(req, v, input, 'draft');
  res.status(201).json(await managedView(listing));
});

router.get('/listings/:id', async (req, res) => {
  const v = await myVendor(req);
  res.json(await managedView(await myListing(req, v)));
});

router.patch('/listings/:id', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  if (l.status === 'archived') throw badRequest('Restore this listing before editing it');
  await updateListing(req, l, await parseListing(req.body, l.type), { byVendor: true, autopublish: autopublish(req) });
  res.json(await managedView(l));
});

router.post('/listings/:id/submit', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  await submitListing(req, l, v, autopublish(req));
  res.json(await managedView(l));
});

router.post('/listings/:id/archive', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  l.status = 'archived';
  l.featured = false;
  await l.save();
  await audit(req, { action: 'listing.archive', entity: 'listing', entityId: l.id, summary: `Archived ${l.type} “${l.name}”` });
  res.json(await managedView(l));
});

router.post('/listings/:id/restore', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  if (l.status !== 'archived') throw badRequest('Only archived listings can be restored');
  l.status = 'draft';
  await l.save();
  res.json(await managedView(l));
});

router.delete('/listings/:id', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  await deleteListing(req, await myListing(req, v));
  res.status(204).end();
});

router.post('/listings/:id/images', singleFile('file', IMAGE_MAX_BYTES), async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  await addImage(req, l);
  res.status(201).json(await managedView(l));
});

router.delete('/listings/:id/images/:imageId', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  await removeImage(l, String(req.params.imageId));
  res.json(await managedView(l));
});

router.post('/listings/:id/images/:imageId/cover', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  await makeCover(l, String(req.params.imageId));
  res.json(await managedView(l));
});

router.post('/listings/:id/documents', singleFile('file', DOCUMENT_MAX_BYTES), async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  await addProjectDocument(req, l);
  res.status(201).json(await managedView(l));
});

router.delete('/listings/:id/documents/:docId', async (req, res) => {
  canManage(req);
  const v = await myVendor(req);
  const l = await myListing(req, v);
  await removeProjectDocument(l, String(req.params.docId));
  res.json(await managedView(l));
});

export default router;
