import { Router } from 'express';
import { setPinSchema, type SessionInfo } from '@jr/shared';
import { authenticate } from '../middleware/auth';
import { SecurityCodeModel, SessionModel } from '../models/security';
import { UserModel } from '../models/user';
import { AppError, notFound } from '../core/errors';
import { assertObjectId, parse } from '../core/http';
import { hashSecret, verifySecret } from '../core/crypto';
import { revokeSession, revokeUserSessions } from '../services/sessions';
import { audit } from '../services/audit';
import memberSelfRouter from './member-self';

const router = Router();
router.use(authenticate);

router.get('/sessions', async (req, res) => {
  const sessions = await SessionModel.find({ userId: req.auth!.user.id, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .lean();
  const data: SessionInfo[] = sessions.map((s) => ({
    id: String(s._id),
    userAgent: s.userAgent ?? 'Unknown device',
    ip: s.ip ?? '',
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: (s.lastUsedAt ?? s.createdAt).toISOString(),
    current: String(s._id) === req.auth!.sessionId,
  }));
  res.json({ data });
});

router.delete('/sessions/:id', async (req, res) => {
  const id = assertObjectId(req.params.id, 'Session');
  const s = await SessionModel.findOne({ _id: id, userId: req.auth!.user.id, revokedAt: null });
  if (!s) throw notFound('Session');
  await revokeSession(id, 'signed_out_by_user');
  await audit(req, { action: 'auth.session_revoke', entity: 'session', entityId: id, summary: 'Signed out a device' });
  res.status(204).end();
});

router.post('/sessions/revoke-others', async (req, res) => {
  const count = await revokeUserSessions(req.auth!.user.id, 'signed_out_everywhere', req.auth!.sessionId);
  await audit(req, { action: 'auth.session_revoke_all', entity: 'user', entityId: req.auth!.user.id, summary: `Signed out ${count} other device(s)` });
  res.json({ revoked: count });
});

router.get('/security', async (req, res) => {
  const pin = await SecurityCodeModel.findOne({ userId: req.auth!.user.id, type: 'transaction_pin' }, { updatedAt: 1 }).lean();
  res.json({ transactionPin: { isSet: !!pin, updatedAt: pin?.updatedAt ?? null } });
});

router.put('/transaction-pin', async (req, res) => {
  const input = parse(setPinSchema, req.body);
  const user = await UserModel.findById(req.auth!.user.id).select('+passwordHash');
  if (!user || !(await verifySecret(user.passwordHash, input.currentPassword))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'Your account password is incorrect', { currentPassword: 'Your account password is incorrect' });
  }
  await SecurityCodeModel.findOneAndUpdate(
    { userId: user._id, type: 'transaction_pin' },
    { hash: await hashSecret(input.pin), failedAttempts: 0, lockedUntil: null },
    { upsert: true },
  );
  await audit(req, { action: 'security.pin_set', entity: 'user', entityId: user.id, summary: 'Set a new transaction PIN' });
  res.json({ transactionPin: { isSet: true, updatedAt: new Date() } });
});

// Phase 3: profile, bank, KYC documents, referrals and invitations.
router.use(memberSelfRouter);

export default router;
