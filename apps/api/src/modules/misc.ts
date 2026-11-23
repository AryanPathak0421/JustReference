import { Router } from 'express';
import { z } from 'zod';
import type { AuditRow } from '@jr/shared';
import { authenticate, requirePermission } from '../middleware/auth';
import { AuditLogModel } from '../models/security';
import { UserModel } from '../models/user';
import { DevMessageModel } from '../models/system';
import { dateRangeFilter, dateRangeSchema, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { getSettings } from '../services/settings';
import { isDev } from '../config/env';

/* ---------------------------------------------------------------- Audit log */
export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission('audit.view'));

const auditQuery = paginationSchema.merge(dateRangeSchema).extend({
  q: z.string().trim().max(80).optional(),
  action: z.string().trim().max(60).regex(/^[a-z_.]*$/).optional(),
});

auditRouter.get('/', async (req, res) => {
  const { q, action, from, to, page, pageSize } = parse(auditQuery, req.query);
  const filter: Record<string, unknown> = {};
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  const created = dateRangeFilter(from, to);
  if (created) filter.createdAt = created;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const actors = await UserModel.find({ $or: [{ name: rx }, { email: rx }] }, { _id: 1 }).limit(200).lean();
    filter.$or = [{ summary: rx }, { actorId: { $in: actors.map((a) => a._id) } }];
  }
  const [rows, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).populate<{ actorId: { _id: unknown; name: string } | null }>('actorId', 'name').lean(),
    AuditLogModel.countDocuments(filter),
  ]);
  const data: AuditRow[] = rows.map((r) => ({
    id: String(r._id),
    actor: r.actorId ? { id: String(r.actorId._id), name: r.actorId.name } : null,
    action: r.action,
    entity: r.entity ?? undefined,
    entityId: r.entityId ?? undefined,
    summary: r.summary,
    ip: r.ip ?? undefined,
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(paged(data, page, pageSize, total));
});

/* ---------------------------------------------------------------- Public */
export const publicRouter = Router();

publicRouter.get('/status', async (_req, res) => {
  const [general, maintenance] = await Promise.all([getSettings('general'), getSettings('maintenance')]);
  res.set('Cache-Control', 'no-store');
  res.json({
    siteName: general.siteName,
    support: { email: general.supportEmail || null, phone: general.supportPhone || null, address: general.address || null },
    social: general.social ?? {},
    maintenance: { enabled: maintenance.enabled, message: maintenance.message ?? '' },
  });
});

/* ---------------------------------------------------------------- Dev outbox (development only) */
export const devRouter = Router();

devRouter.use((_req, res, next) => {
  if (!isDev) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  next();
});

devRouter.get('/outbox', async (_req, res) => {
  const messages = await DevMessageModel.find().sort({ createdAt: -1 }).limit(50).lean();
  res.set('Cache-Control', 'no-store');
  res.json({ data: messages.map((m) => ({ id: String(m._id), channel: m.channel, to: m.to, subject: m.subject, body: m.body, createdAt: m.createdAt })) });
});

devRouter.delete('/outbox', async (_req, res) => {
  await DevMessageModel.deleteMany({});
  res.status(204).end();
});
