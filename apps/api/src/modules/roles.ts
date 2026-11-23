import { Router } from 'express';
import { PERMISSIONS, roleSchema, type RoleRow } from '@jr/shared';
import { authenticate, requireRole } from '../middleware/auth';
import { RoleModel } from '../models/security';
import { UserModel } from '../models/user';
import { AppError, conflict, notFound } from '../core/errors';
import { assertObjectId, parse } from '../core/http';
import { audit } from '../services/audit';

const router = Router();

/** Permission catalog (read-only). Any admin may read it to understand their own access. */
router.get('/permissions', authenticate, requireRole('admin', 'super_admin'), (_req, res) => {
  res.json({ data: PERMISSIONS });
});

/* Everything below is Super Admin only. */
router.use('/roles', authenticate, requireRole('super_admin'));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'role';

router.get('/roles', async (_req, res) => {
  const [roles, counts] = await Promise.all([
    RoleModel.find({ scope: 'admin' }).sort({ isSystem: -1, name: 1 }).lean(),
    UserModel.aggregate<{ _id: unknown; n: number }>([{ $unwind: '$roleIds' }, { $group: { _id: '$roleIds', n: { $sum: 1 } } }]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  const data: RoleRow[] = roles.map((r) => ({
    id: String(r._id),
    key: r.key,
    name: r.name,
    description: r.description ?? undefined,
    permissions: r.permissions,
    isSystem: r.isSystem,
    assignedCount: byId.get(String(r._id)) ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
  res.json({ data });
});

router.post('/roles', async (req, res) => {
  const input = parse(roleSchema, req.body);
  let key = slug(input.name);
  if (await RoleModel.exists({ key })) key = `${key}_${Date.now().toString(36)}`;
  if (await RoleModel.exists({ name: input.name })) throw conflict('A role with this name already exists', { name: 'A role with this name already exists' });
  const role = await RoleModel.create({ ...input, key, isSystem: false, scope: 'admin' });
  await audit(req, { action: 'role.create', entity: 'role', entityId: role.id, summary: `Created role “${role.name}” with ${role.permissions.length} permission(s)`, meta: { permissions: role.permissions } });
  res.status(201).json({ id: role.id });
});

router.patch('/roles/:id', async (req, res) => {
  const id = assertObjectId(req.params.id, 'Role');
  const input = parse(roleSchema, req.body);
  const role = await RoleModel.findOne({ _id: id, scope: 'admin' });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw new AppError(400, 'SYSTEM_ROLE', 'System roles can’t be edited. Create a custom role instead.');
  if (await RoleModel.exists({ name: input.name, _id: { $ne: id } })) throw conflict('A role with this name already exists', { name: 'A role with this name already exists' });
  const before = role.permissions;
  role.set(input);
  await role.save();
  const added = role.permissions.filter((p) => !before.includes(p));
  const removed = before.filter((p) => !role.permissions.includes(p));
  await audit(req, { action: 'role.update', entity: 'role', entityId: id, summary: `Updated role “${role.name}”`, meta: { added, removed } });
  res.json({ id });
});

router.delete('/roles/:id', async (req, res) => {
  const id = assertObjectId(req.params.id, 'Role');
  const role = await RoleModel.findOne({ _id: id, scope: 'admin' });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw new AppError(400, 'SYSTEM_ROLE', 'System roles can’t be deleted');
  const inUse = await UserModel.countDocuments({ roleIds: role._id });
  if (inUse) throw conflict(`This role is assigned to ${inUse} administrator(s). Reassign them first.`, undefined, 'ROLE_IN_USE');
  await role.deleteOne();
  await audit(req, { action: 'role.delete', entity: 'role', entityId: id, summary: `Deleted role “${role.name}”` });
  res.status(204).end();
});

export default router;
