import { Router } from 'express';
import { z } from 'zod';
import { adminCreateSchema, adminUpdateSchema, temporaryPasswordSchema, type AdminRow } from '@jr/shared';
import { authenticate, requireRole } from '../middleware/auth';
import { UserModel } from '../models/user';
import { RoleModel } from '../models/security';
import { AppError, badRequest, conflict, notFound } from '../core/errors';
import { assertObjectId, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { hashSecret } from '../core/crypto';
import { revokeUserSessions } from '../services/sessions';
import { audit } from '../services/audit';

/** Administrator management — Super Admin only. */
const router = Router();
router.use(authenticate, requireRole('super_admin'));

async function assertRoles(roleIds: string[]) {
  const found = await RoleModel.countDocuments({ _id: { $in: roleIds }, scope: 'admin' });
  if (found !== new Set(roleIds).size) throw badRequest('One or more roles no longer exist', { roleIds: 'Choose roles from the list' });
}

async function assertUnique(email: string, mobile: string, exceptId?: string) {
  const clash = await UserModel.find({ $or: [{ email }, { mobile }], ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { email: 1, mobile: 1 }).lean();
  const fields: Record<string, string> = {};
  for (const u of clash) {
    if (u.email === email) fields.email = 'This email is already used by another account';
    if (u.mobile === mobile) fields.mobile = 'This mobile number is already used by another account';
  }
  if (Object.keys(fields).length) throw conflict('Email or mobile already in use', fields);
}

/** Loads a managed admin. Super admins are never editable here, including yourself. */
async function loadAdmin(id: unknown) {
  const admin = await UserModel.findOne({ _id: assertObjectId(id, 'Administrator'), roles: 'admin' });
  if (!admin) throw notFound('Administrator');
  if (admin.roles.includes('super_admin')) throw new AppError(400, 'PROTECTED_ACCOUNT', 'Super Admin accounts can’t be changed here');
  return admin;
}

const listQuery = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'blocked']).optional(),
});

router.get('/', async (req, res) => {
  const { q, status, page, pageSize } = parse(listQuery, req.query);
  // Super Admins also carry the admin role but are never managed from this list.
  const filter: Record<string, unknown> = { roles: { $all: ['admin'], $nin: ['super_admin'] } };
  if (status) filter.status = status;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { mobile: rx }];
  }
  const [rows, total] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).populate<{ roleIds: { _id: unknown; name: string }[] }>('roleIds', 'name').lean(),
    UserModel.countDocuments(filter),
  ]);
  const data: AdminRow[] = rows.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    mobile: u.mobile,
    status: u.status,
    roles: (u.roleIds ?? []).map((r) => ({ id: String(r._id), name: r.name })),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    mustChangePassword: !!u.mustChangePassword,
  }));
  res.json(paged(data, page, pageSize, total));
});

router.post('/', async (req, res) => {
  const input = parse(adminCreateSchema, req.body);
  await assertRoles(input.roleIds);
  await assertUnique(input.email, input.mobile);
  const admin = await UserModel.create({
    name: input.name,
    email: input.email,
    mobile: input.mobile,
    passwordHash: await hashSecret(input.password),
    roles: ['admin'],
    roleIds: input.roleIds,
    status: 'active',
    mustChangePassword: true,
    createdBy: req.auth!.user.id,
  });
  await audit(req, { action: 'admin.create', entity: 'user', entityId: admin.id, summary: `Created administrator ${admin.name} (${admin.email})`, meta: { roleIds: input.roleIds } });
  res.status(201).json({ id: admin.id });
});

router.patch('/:id', async (req, res) => {
  const admin = await loadAdmin(req.params.id);
  const input = parse(adminUpdateSchema, req.body);
  await assertRoles(input.roleIds);
  await assertUnique(input.email, input.mobile, admin.id);
  const changed = (['name', 'email', 'mobile'] as const).filter((k) => admin[k] !== input[k]);
  const rolesChanged = admin.roleIds.map(String).sort().join() !== [...input.roleIds].sort().join();
  admin.set({ name: input.name, email: input.email, mobile: input.mobile, roleIds: input.roleIds });
  await admin.save();
  await audit(req, {
    action: 'admin.update', entity: 'user', entityId: admin.id,
    summary: `Updated administrator ${admin.name}${changed.length || rolesChanged ? `: ${[...changed, ...(rolesChanged ? ['roles'] : [])].join(', ')}` : ''}`,
    meta: { fields: changed, rolesChanged },
  });
  res.json({ id: admin.id });
});

router.post('/:id/status', async (req, res) => {
  const admin = await loadAdmin(req.params.id);
  const { status } = parse(z.object({ status: z.enum(['active', 'blocked']) }), req.body);
  if (admin.status === status) return void res.json({ id: admin.id, status });
  admin.status = status;
  await admin.save();
  const revoked = status === 'blocked' ? await revokeUserSessions(admin.id, 'deactivated') : 0;
  await audit(req, {
    action: status === 'blocked' ? 'admin.deactivate' : 'admin.activate', entity: 'user', entityId: admin.id,
    summary: status === 'blocked' ? `Deactivated administrator ${admin.name} and signed out ${revoked} session(s)` : `Reactivated administrator ${admin.name}`,
  });
  res.json({ id: admin.id, status });
});

router.post('/:id/reset-password', async (req, res) => {
  const admin = await loadAdmin(req.params.id);
  const { password } = parse(temporaryPasswordSchema, req.body);
  admin.set({ passwordHash: await hashSecret(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: undefined, passwordChangedAt: new Date() });
  await admin.save();
  const revoked = await revokeUserSessions(admin.id, 'password_reset_by_super_admin');
  await audit(req, { action: 'admin.reset_password', entity: 'user', entityId: admin.id, summary: `Set a temporary password for ${admin.name}; signed out ${revoked} session(s)` });
  res.json({ id: admin.id });
});

export default router;
