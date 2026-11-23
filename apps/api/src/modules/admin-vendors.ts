import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  LISTING_TYPES, temporaryPasswordSchema, VENDOR_PERMISSIONS, VENDOR_STATUSES, vendorCreateSchema, vendorDecisionSchema, vendorProfileSchema,
  vendorRoleSchema, vendorRolesAssignSchema, vendorStatusSchema, type ListingType, type RoleRow, type VendorDetail, type VendorRow,
} from '@jr/shared';
import { requirePermission } from '../middleware/auth';
import { VendorModel, DocumentModel } from '../models/vendor';
import { ListingModel } from '../models/catalog';
import { RoleModel } from '../models/security';
import { UserModel } from '../models/user';
import { AppError, badRequest, conflict, notFound } from '../core/errors';
import { assertObjectId, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { encryptField, hashSecret } from '../core/crypto';
import { createMemberRecord, resolvePermissions } from '../services/identity';
import { createVendorShell, maskPan, syncVendorListings, toVendorSelf } from '../services/vendors';
import { revokeUserSessions } from '../services/sessions';
import { uniqueSlug } from '../services/slug';
import { audit } from '../services/audit';
import { sendPrivate } from './vendor';

const router = Router();
// Authentication and the admin-role check are applied once by the parent /admin router (app.ts).

/* ---------------------------------------------------------------- Vendor roles ("vendor rights") */

router.get('/vendor-permissions', requirePermission('vendors.view'), (_req, res) => void res.json({ data: VENDOR_PERMISSIONS }));

router.get('/vendor-roles', requirePermission('vendors.view'), async (_req, res) => {
  const [roles, counts] = await Promise.all([
    RoleModel.find({ scope: 'vendor' }).sort({ isSystem: -1, name: 1 }).lean(),
    UserModel.aggregate<{ _id: unknown; n: number }>([{ $match: { roles: 'vendor' } }, { $unwind: '$roleIds' }, { $group: { _id: '$roleIds', n: { $sum: 1 } } }]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  const data: RoleRow[] = roles.map((r) => ({
    id: String(r._id), key: r.key, name: r.name, description: r.description ?? undefined, permissions: r.permissions,
    isSystem: r.isSystem, assignedCount: byId.get(String(r._id)) ?? 0, updatedAt: r.updatedAt.toISOString(),
  }));
  res.json({ data });
});

router.post('/vendor-roles', requirePermission('vendors.manage'), async (req, res) => {
  const input = parse(vendorRoleSchema, req.body);
  if (await RoleModel.exists({ name: input.name })) throw conflict('A role with this name already exists', { name: 'A role with this name already exists' });
  const key = `vendor_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)}_${Date.now().toString(36)}`;
  const role = await RoleModel.create({ ...input, key, scope: 'vendor', isSystem: false });
  await audit(req, { action: 'vendor_role.create', entity: 'role', entityId: role.id, summary: `Created vendor role “${role.name}”`, meta: { permissions: role.permissions } });
  res.status(201).json({ id: role.id });
});

router.patch('/vendor-roles/:id', requirePermission('vendors.manage'), async (req, res) => {
  const role = await RoleModel.findOne({ _id: assertObjectId(req.params.id, 'Role'), scope: 'vendor' });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw new AppError(400, 'SYSTEM_ROLE', 'System roles can’t be edited. Create a custom role instead.');
  role.set(parse(vendorRoleSchema, req.body));
  await role.save();
  await audit(req, { action: 'vendor_role.update', entity: 'role', entityId: role.id, summary: `Updated vendor role “${role.name}”`, meta: { permissions: role.permissions } });
  res.json({ id: role.id });
});

router.delete('/vendor-roles/:id', requirePermission('vendors.manage'), async (req, res) => {
  const role = await RoleModel.findOne({ _id: assertObjectId(req.params.id, 'Role'), scope: 'vendor' });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw new AppError(400, 'SYSTEM_ROLE', 'System roles can’t be deleted');
  const inUse = await UserModel.countDocuments({ roleIds: role._id });
  if (inUse) throw conflict(`This role is assigned to ${inUse} vendor(s). Remove it from them first.`, undefined, 'ROLE_IN_USE');
  await role.deleteOne();
  await audit(req, { action: 'vendor_role.delete', entity: 'role', entityId: role.id, summary: `Deleted vendor role “${role.name}”` });
  res.status(204).end();
});

/* ---------------------------------------------------------------- Vendors */

const listQuery = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'submitted']).default('newest'),
});
const SORTS = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { businessName: 1 }, submitted: { submittedAt: 1 } } as const;

router.get('/vendors', requirePermission('vendors.view'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const owners = await UserModel.find({ roles: 'vendor', $or: [{ name: rx }, { email: rx }, { mobile: rx }] }, { _id: 1 }).limit(500).lean();
    filter.$or = [{ businessName: rx }, { city: rx }, { category: rx }, { gstin: q.q.toUpperCase() }, { userId: { $in: owners.map((o) => o._id) } }];
  }
  const [vendors, total] = await Promise.all([
    VendorModel.find(filter).sort(SORTS[q.sort]).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    VendorModel.countDocuments(filter),
  ]);
  const [owners, counts] = await Promise.all([
    UserModel.find({ _id: { $in: vendors.map((v) => v.userId) } }, { name: 1, email: 1, mobile: 1 }).lean(),
    ListingModel.aggregate<{ _id: unknown; n: number }>([{ $match: { vendorId: { $in: vendors.map((v) => v._id) } } }, { $group: { _id: '$vendorId', n: { $sum: 1 } } }]),
  ]);
  const ownerBy = new Map(owners.map((o) => [String(o._id), o]));
  const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
  const data: VendorRow[] = vendors.map((v) => {
    const o = ownerBy.get(String(v.userId));
    return {
      id: String(v._id), userId: String(v.userId), businessName: v.businessName, ownerName: o?.name ?? '—', email: o?.email ?? '', mobile: o?.mobile ?? '',
      city: v.city || undefined, category: v.category || undefined, status: v.status, listingCount: countBy.get(String(v._id)) ?? 0,
      submittedAt: v.submittedAt?.toISOString() ?? null, createdAt: v.createdAt.toISOString(), isSample: !!v.isSample,
    };
  });
  res.json(paged(data, q.page, q.pageSize, total));
});

/** Admin "Create vendor": account with a temporary password + empty business profile + member record. */
router.post('/vendors', requirePermission('vendors.manage'), async (req, res) => {
  const input = parse(vendorCreateSchema, req.body);
  const clash = await UserModel.find({ $or: [{ email: input.email }, { mobile: input.mobile }] }, { email: 1, mobile: 1 }).lean();
  const fields: Record<string, string> = {};
  for (const u of clash) {
    if (u.email === input.email) fields.email = 'This email is already registered';
    if (u.mobile === input.mobile) fields.mobile = 'This mobile number is already registered';
  }
  if (Object.keys(fields).length) throw conflict('Email or mobile already registered', fields);
  const passwordHash = await hashSecret(input.password);
  const vendorId = await mongoose.connection.transaction(async (session) => {
    const [user] = await UserModel.create(
      [{ name: input.name, email: input.email, mobile: input.mobile, passwordHash, roles: ['vendor'], status: 'active', mustChangePassword: true, createdBy: req.auth!.user.id }],
      { session },
    );
    const vendor = await createVendorShell(user!._id, input.businessName, session);
    await createMemberRecord(user!._id, { joinedVia: 'admin' }, session);
    await audit(req, { action: 'vendor.create', entity: 'vendor', entityId: vendor.id, summary: `Created vendor ${vendor.businessName} (owner ${user!.name})` }, session);
    return vendor.id as string;
  });
  res.status(201).json({ id: vendorId });
});

async function loadVendor(req: Request) {
  const v = await VendorModel.findById(assertObjectId(req.params.id, 'Vendor'));
  if (!v) throw notFound('Vendor');
  return v;
}

router.get('/vendors/:id', requirePermission('vendors.view'), async (req, res) => {
  const v = await loadVendor(req);
  const user = await UserModel.findById(v.userId).lean();
  if (!user) throw notFound('Vendor account');
  const [self, roles, counts] = await Promise.all([
    toVendorSelf(v.toObject(), (await resolvePermissions(user)).filter((p) => p.startsWith('vendor.'))),
    RoleModel.find({ _id: { $in: user.roleIds ?? [] }, scope: 'vendor' }, { name: 1 }).lean(),
    ListingModel.aggregate<{ _id: ListingType; n: number }>([{ $match: { vendorId: v._id } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
  ]);
  const detail: VendorDetail = {
    ...self,
    userId: String(user._id), ownerName: user.name, email: user.email, mobile: user.mobile, accountStatus: user.status,
    roles: roles.map((r) => ({ id: String(r._id), name: r.name })),
    listingCounts: Object.fromEntries(LISTING_TYPES.map((t) => [t, counts.find((c) => c._id === t)?.n ?? 0])) as Record<ListingType, number>,
    createdAt: v.createdAt.toISOString(),
    isSample: !!v.isSample,
  };
  res.json(detail);
});

router.put('/vendors/:id/profile', requirePermission('vendors.manage'), async (req, res) => {
  const v = await loadVendor(req);
  const input = parse(vendorProfileSchema, req.body);
  const { pan, social, ...rest } = input;
  v.set({ ...rest, social: social ?? {}, website: input.website || undefined, gstin: input.gstin || undefined });
  if (pan) { v.panEncrypted = encryptField(pan); v.panMasked = maskPan(pan); }
  if (v.isModified('businessName')) v.slug = await uniqueSlug(VendorModel as never, input.businessName, {}, v._id);
  await v.save();
  await audit(req, { action: 'vendor.profile_update', entity: 'vendor', entityId: v.id, summary: `Edited business profile of ${v.businessName} (by admin)` });
  res.json({ id: v.id });
});

router.post('/vendors/:id/decision', requirePermission('vendors.approve'), async (req, res) => {
  const v = await loadVendor(req);
  const { decision, reason } = parse(vendorDecisionSchema, req.body);
  if (v.status !== 'pending') throw badRequest('This vendor isn’t waiting for review');
  await mongoose.connection.transaction(async (session) => {
    if (decision === 'approve') {
      v.status = 'approved';
      v.approvedAt = new Date();
      v.approvedBy = req.auth!.user.id as never;
      v.statusReason = undefined;
      await DocumentModel.updateMany({ vendorId: v._id, status: 'pending' }, { status: 'approved', reviewedBy: req.auth!.user.id }, { session });
    } else {
      v.status = 'rejected';
      v.statusReason = reason;
    }
    await v.save({ session });
    await syncVendorListings(v._id, decision === 'approve', session);
    await audit(req, {
      action: decision === 'approve' ? 'vendor.approve' : 'vendor.reject', entity: 'vendor', entityId: v.id,
      summary: decision === 'approve' ? `Approved vendor ${v.businessName}` : `Rejected vendor ${v.businessName}: ${reason}`,
    }, session);
  });
  res.json({ id: v.id, status: v.status });
});

router.post('/vendors/:id/status', requirePermission('vendors.manage'), async (req, res) => {
  const v = await loadVendor(req);
  const { status, reason } = parse(vendorStatusSchema, req.body);
  if (status === 'approved' && v.status !== 'suspended') throw badRequest('Only suspended vendors can be reinstated');
  if (status === 'suspended' && v.status === 'suspended') throw badRequest('This vendor is already suspended');
  await mongoose.connection.transaction(async (session) => {
    v.status = status;
    v.statusReason = status === 'suspended' ? reason : undefined;
    await v.save({ session });
    await syncVendorListings(v._id, status === 'approved', session);
    await audit(req, {
      action: status === 'suspended' ? 'vendor.suspend' : 'vendor.reinstate', entity: 'vendor', entityId: v.id,
      summary: status === 'suspended' ? `Suspended vendor ${v.businessName}: ${reason} (listings hidden)` : `Reinstated vendor ${v.businessName}`,
    }, session);
  });
  res.json({ id: v.id, status: v.status });
});

router.put('/vendors/:id/roles', requirePermission('vendors.manage'), async (req, res) => {
  const v = await loadVendor(req);
  const { roleIds } = parse(vendorRolesAssignSchema, req.body);
  const roles = await RoleModel.find({ _id: { $in: roleIds }, scope: 'vendor' }, { name: 1 }).lean();
  if (roles.length !== new Set(roleIds).size) throw badRequest('Choose vendor roles from the list', { roleIds: 'Choose vendor roles from the list' });
  const user = await UserModel.findById(v.userId);
  if (!user) throw notFound('Vendor account');
  const adminRoleIds = (await RoleModel.find({ _id: { $in: user.roleIds }, scope: { $ne: 'vendor' } }, { _id: 1 }).lean()).map((r) => r._id);
  user.roleIds = [...adminRoleIds, ...roles.map((r) => r._id)] as never;
  await user.save();
  await audit(req, { action: 'vendor.roles', entity: 'vendor', entityId: v.id, summary: `Set vendor roles for ${v.businessName}: ${roles.map((r) => r.name).join(', ') || 'none'}` });
  res.json({ id: v.id });
});

router.post('/vendors/:id/reset-password', requirePermission('vendors.manage'), async (req, res) => {
  const v = await loadVendor(req);
  const { password } = parse(temporaryPasswordSchema, req.body);
  const user = await UserModel.findById(v.userId);
  if (!user) throw notFound('Vendor account');
  user.set({ passwordHash: await hashSecret(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: undefined, passwordChangedAt: new Date() });
  await user.save();
  const revoked = await revokeUserSessions(user.id, 'password_reset_by_admin');
  await audit(req, { action: 'vendor.reset_password', entity: 'vendor', entityId: v.id, summary: `Set a temporary password for ${v.businessName}; signed out ${revoked} session(s)` });
  res.json({ id: v.id });
});

router.get('/vendors/:id/documents/:docId/file', requirePermission('vendors.view'), async (req, res) => {
  const v = await loadVendor(req);
  const doc = await DocumentModel.findOne({ _id: assertObjectId(req.params.docId, 'Document'), vendorId: v._id });
  if (!doc) throw notFound('Document');
  await audit(req, { action: 'vendor.document_view', entity: 'vendor', entityId: v.id, summary: `Viewed ${doc.type.replace(/_/g, ' ')} of ${v.businessName}` });
  await sendPrivate(res, doc.storageKey, doc.mime, doc.originalName);
});

export default router;
