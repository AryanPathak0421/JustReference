import type { Request } from 'express';
import type { ClientSession } from 'mongoose';
import { AuditLogModel } from '../models/security';
import { logger } from '../config/logger';

export interface AuditEntry {
  action: string;
  summary: string;
  entity?: string;
  entityId?: string;
  /** Must never contain secrets — keep it to ids, statuses and field names. */
  meta?: Record<string, unknown>;
  actorId?: string | null;
}

/**
 * Append an audit record. Inside a transaction pass the session so the audit row commits
 * (or rolls back) with the change it describes.
 */
export async function audit(req: Request | null, entry: AuditEntry, session?: ClientSession) {
  const doc = {
    actorId: entry.actorId !== undefined ? entry.actorId : (req?.auth?.user.id ?? null),
    action: entry.action,
    summary: entry.summary,
    entity: entry.entity,
    entityId: entry.entityId,
    meta: entry.meta,
    ip: req?.ip,
    userAgent: req?.get('user-agent')?.slice(0, 300),
  };
  try {
    await AuditLogModel.create([doc], { session });
  } catch (err) {
    if (session) throw err;
    // Outside a transaction, never fail the user's request because the audit write failed — but shout.
    logger.error({ err, action: entry.action }, 'Audit write failed');
  }
}
