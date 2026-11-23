import { Router, type Request } from 'express';
import mongoose, { type Types } from 'mongoose';
import { z } from 'zod';
import {
  memberCreateSchema, memberUpdateSchema, SECURITY_CODE_TYPES, statusChangeSchema, USER_STATUSES,
  type MemberDetail, type MemberRow,
} from '@jr/shared';
import { authenticate, requirePermission, requireRole } from '../middleware/auth';
import { UserModel } from '../models/user';
import { MemberModel, ProfileModel, toDobMD } from '../models/member';
import { SecurityCodeModel, SessionModel } from '../models/security';
import { conflict, notFound } from '../core/errors';
import { assertObjectId, csvCell, dateRangeFilter, dateRangeSchema, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { hashSecret } from '../core/crypto';
import { createMemberRecord } from '../services/identity';
import { revokeUserSessions } from '../services/sessions';
import { audit } from '../services/audit';

/** Member management for admins (brief §5). Only touches accounts with the `member` role. */
const router = Router();
router.use(authenticate, requireRole('admin', 'super_admin'));

const listQuery = paginationSchema.merge(dateRangeSchema).extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(USER_STATUSES).optional(),
  /** "restricted" = blocked or blacklisted */
  group: z.enum(['restricted']).optional(),
  hasPin: z.enum(['yes', 'no']).optional(),
  sort: z.enum(['newest', 'oldest', 'name']).default('newest'),
});
type ListQuery = z.infer<typeof listQuery>;

async function buildFilter(q: ListQuery) {
  const filter: Record<string, unknown> = { roles: 'member' };
  if (q.status) filter.status = q.status;
  if (q.group === 'restricted') filter.status = { $in: ['blocked', 'blacklisted'] };
  const created = dateRangeFilter(q.from, q.to);
  if (created) filter.createdAt = created;

  const and: Record<string, unknown>[] = [];
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const idMatches = await MemberModel.find({ $or: [{ memberId: q.q.toUpperCase() }, { referralCode: q.q.toUpperCase() }] }, { userId: 1 }).lean();
    and.push({ $or: [{ name: rx }, { email: rx }, { mobile: rx }, { _id: { $in: idMatches.map((m) => m.userId) } }] });
  }
  if (q.hasPin) {
    const withPin = await SecurityCodeModel.distinct('userId', { type: 'transaction_pin' });
    and.push({ _id: q.hasPin === 'yes' ? { $in: withPin } : { $nin: withPin } });
  }
  if (and.length) filter.$and = and;
  return filter;
}

const SORTS = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { name: 1 } } as const;

/** Join users with their member records, sponsors and PIN status in a few batched queries. */
async function toRows(users: { _id: Types.ObjectId; name: string; email: string; mobile: string; status: string; createdAt: Date; lastLoginAt?: Date | null; mobileVerifiedAt?: Date | null }[]): Promise<MemberRow[]> {
  const ids = users.map((u) => u._id);
  const [members, pins] = await Promise.all([
    MemberModel.find({ userId: { $in: ids } }).lean(),
    SecurityCodeModel.distinct('userId', { userId: { $in: ids }, type: 'transaction_pin' }),
  ]);
  const sponsorIds = members.map((m) => m.sponsorUserId).filter(Boolean) as Types.ObjectId[];
  const [sponsorUsers, sponsorMembers] = await Promise.all([
    UserModel.find({ _id: { $in: sponsorIds } }, { name: 1 }).lean(),
    MemberModel.find({ userId: { $in: sponsorIds } }, { userId: 1, memberId: 1 }).lean(),
  ]);
  const memberBy = new Map(members.map((m) => [String(m.userId), m]));
  const sponsorName = new Map(sponsorUsers.map((u) => [String(u._id), u.name]));
  const sponsorMid = new Map(sponsorMembers.map((m) => [String(m.userId), m.memberId]));
  const pinSet = new Set(pins.map(String));

  return users.map((u) => {
    const m = memberBy.get(String(u._id));
    const sid = m?.sponsorUserId ? String(m.sponsorUserId) : undefined;
    return {
      id: String(u._id),
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      status: u.status as MemberRow['status'],
      memberId: m?.memberId,
      referralCode: m?.referralCode,
      sponsor: sid ? { memberId: sponsorMid.get(sid), name: sponsorName.get(sid) ?? 'Unknown' } : null,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      mobileVerified: !!u.mobileVerifiedAt,
      hasTransactionPin: pinSet.has(String(u._id)),
    };
  });
}

router.get('/', requirePermission('members.view'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const filter = await buildFilter(q);
  const [users, total] = await Promise.all([
    UserModel.find(filter).sort(SORTS[q.sort]).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    UserModel.countDocuments(filter),
  ]);
  res.json(paged(await toRows(users), q.page, q.pageSize, total));
});

const EXPORT_LIMIT = 10_000;
router.get('/export.csv', requirePermission('members.view'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const users = await UserModel.find(await buildFilter(q)).sort(SORTS[q.sort]).limit(EXPORT_LIMIT).lean();
  const rows = await toRows(users);
  const header = ['Member ID', 'Name', 'Email', 'Mobile', 'Status', 'Referral ID', 'Sponsor', 'Mobile verified', 'Transaction PIN', 'Joined', 'Last login'];
  const lines = rows.map((r) => [
    r.memberId, r.name, r.email, r.mobile, r.status, r.referralCode, r.sponsor ? `${r.sponsor.name} (${r.sponsor.memberId ?? ''})` : '',
    r.mobileVerified ? 'Yes' : 'No', r.hasTransactionPin ? 'Set' : 'Not set', r.createdAt, r.lastLoginAt ?? '',
  ].map(csvCell).join(','));
  await audit(req, { action: 'member.export', entity: 'member', summary: `Exported ${rows.length} member record(s) to CSV`, meta: { filters: { ...q, page: undefined, pageSize: undefined } } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n'));
});

/** New registration by an admin. The member must change the temporary password at first login. */
router.post('/', requirePermission('members.create'), async (req, res) => {
  const input = parse(memberCreateSchema, req.body);
  const clashes = await UserModel.find({ $or: [{ email: input.email }, { mobile: input.mobile }] }, { email: 1, mobile: 1 }).lean();
  const fields: Record<string, string> = {};
  for (const u of clashes) {
    if (u.email === input.email) fields.email = 'This email is already registered';
    if (u.mobile === input.mobile) fields.mobile = 'This mobile number is already registered';
  }
  if (Object.keys(fields).length) throw conflict('Email or mobile already registered', fields);

  const passwordHash = await hashSecret(input.password);
  const id = await mongoose.connection.transaction(async (session) => {
    const [user] = await UserModel.create(
      [{ name: input.name, email: input.email, mobile: input.mobile, passwordHash, roles: ['member'], status: 'active', mustChangePassword: true, createdBy: req.auth!.user.id }],
      { session },
    );
    const { member } = await createMemberRecord(user!._id, { referralCode: input.referralCode || undefined, joinedVia: 'admin' }, session);
    await audit(req, { action: 'member.create', entity: 'user', entityId: user!.id, summary: `Registered member ${user!.name} (${member.memberId})` }, session);
    return user!.id as string;
  });
  res.status(201).json({ id });
});

async function loadMember(req: Request) {
  const user = await UserModel.findOne({ _id: assertObjectId(req.params.id, 'Member'), roles: 'member' });
  if (!user) throw notFound('Member');
  return user;
}

router.get('/:id', requirePermission('members.view'), async (req, res) => {
  const user = await loadMember(req);
  const [[row], profile, directReferrals, activeSessions] = await Promise.all([
    toRows([user.toObject()]),
    ProfileModel.findOne({ userId: user._id }).lean(),
    MemberModel.countDocuments({ sponsorUserId: user._id }),
    SessionModel.countDocuments({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);
  const detail: MemberDetail = {
    ...row!,
    dob: profile?.dob ? profile.dob.toISOString().slice(0, 10) : null,
    addresses: { residence: profile?.addresses?.residence ?? '', office: profile?.addresses?.office ?? '', billing: profile?.addresses?.billing ?? '' },
    directReferrals,
    activeSessions,
    statusReason: user.statusReason ?? null,
    roles: user.roles as MemberDetail['roles'],
  };
  res.json(detail);
});

router.patch('/:id', requirePermission('members.edit'), async (req, res) => {
  const user = await loadMember(req);
  const input = parse(memberUpdateSchema, req.body);
  const clash = await UserModel.find({ _id: { $ne: user._id }, $or: [{ email: input.email }, { mobile: input.mobile }] }, { email: 1, mobile: 1 }).lean();
  const fields: Record<string, string> = {};
  for (const u of clash) {
    if (u.email === input.email) fields.email = 'This email is used by another account';
    if (u.mobile === input.mobile) fields.mobile = 'This mobile number is used by another account';
  }
  if (Object.keys(fields).length) throw conflict('Email or mobile already in use', fields);

  const changed = (['name', 'email', 'mobile'] as const).filter((k) => user[k] !== input[k]);
  if (input.mobile !== user.mobile) user.mobileVerifiedAt = undefined; // new number must be re-verified
  user.set({ name: input.name, email: input.email, mobile: input.mobile });
  await user.save();
  const dob = input.dob ? new Date(`${input.dob}T00:00:00Z`) : null;
  await ProfileModel.findOneAndUpdate(
    { userId: user._id },
    { dob, dobMD: toDobMD(dob), addresses: input.addresses ?? {} },
    { upsert: true },
  );
  await audit(req, { action: 'member.update', entity: 'user', entityId: user.id, summary: `Edited profile of ${user.name}`, meta: { fields: [...changed, 'profile'] } });
  res.json({ id: user.id });
});

router.post('/:id/status', requirePermission('members.status'), async (req, res) => {
  const user = await loadMember(req);
  const { status, reason } = parse(statusChangeSchema, req.body);
  const previous = user.status;
  user.status = status;
  user.statusReason = status === 'active' ? undefined : reason;
  await user.save();
  const revoked = status === 'active' ? 0 : await revokeUserSessions(user.id, `member_${status}`);
  const verb = { active: 'Allowed', blocked: 'Blocked', blacklisted: 'Blacklisted' }[status];
  await audit(req, {
    action: `member.${status === 'active' ? 'allow' : status === 'blocked' ? 'block' : 'blacklist'}`,
    entity: 'user', entityId: user.id,
    summary: `${verb} ${user.name}${reason ? `: ${reason}` : ''}${revoked ? ` (signed out ${revoked} session(s))` : ''}`,
    meta: { from: previous, to: status },
  });
  res.json({ id: user.id, status });
});

router.post('/:id/security-codes/:type/reset', requirePermission('members.security'), async (req, res) => {
  const user = await loadMember(req);
  const type = parse(z.enum(SECURITY_CODE_TYPES), req.params.type);
  const r = await SecurityCodeModel.deleteOne({ userId: user._id, type });
  await audit(req, { action: 'member.security_code_reset', entity: 'user', entityId: user.id, summary: `Reset ${type.replace('_', ' ')} for ${user.name}`, meta: { type, existed: r.deletedCount > 0 } });
  res.json({ id: user.id, reset: r.deletedCount > 0 });
});

router.post('/:id/sessions/revoke', requirePermission('members.status'), async (req, res) => {
  const user = await loadMember(req);
  const revoked = await revokeUserSessions(user.id, 'revoked_by_admin');
  await audit(req, { action: 'member.sessions_revoke', entity: 'user', entityId: user.id, summary: `Signed ${user.name} out of ${revoked} session(s)` });
  res.json({ revoked });
});

export default router;
