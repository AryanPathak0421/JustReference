import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { documentDecisionSchema, type MemberBankRow } from '@jr/shared';
import { authenticate, requirePermission, requireRole } from '../middleware/auth';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { BankAccountModel, DocumentModel } from '../models/vendor';
import { notFound } from '../core/errors';
import { assertObjectId, escapeRegex, paged, paginationSchema, parse } from '../core/http';
import { decryptField } from '../core/crypto';
import { loadMemberProfile } from '../services/profiles';
import { referralList, referralSummary, referralTree } from '../services/referrals';
import { audit } from '../services/audit';
import { sendPrivate } from './vendor';

/**
 * Admin views added in Phase 3: member profiles, referral trees ("Direct referral view"),
 * bank details ("Member bank details") and member KYC documents.
 * Mounted at /admin/members ahead of the Phase 1 members router; each route authenticates itself
 * so requests for other member routes aren't authenticated twice.
 */
const router = Router();
const admin = [authenticate, requireRole('admin', 'super_admin')];

/** Resolve a member by user id or member ID (JR0000123). */
async function memberUser(idOrMemberId: string) {
  if (/^[a-f0-9]{24}$/i.test(idOrMemberId)) {
    const m = await MemberModel.findOne({ userId: idOrMemberId }).lean();
    if (m) return m;
  }
  const m = await MemberModel.findOne({ memberId: idOrMemberId.toUpperCase() }).lean();
  if (!m) throw notFound('Member');
  return m;
}

const bankQuery = paginationSchema.extend({ q: z.string().trim().max(80).optional() });

router.get('/bank-accounts', ...admin, requirePermission('members.bank'), async (req, res) => {
  const q = parse(bankQuery, req.query);
  const filter: Record<string, unknown> = {};
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const [users, members] = await Promise.all([
      UserModel.find({ $or: [{ name: rx }, { email: rx }, { mobile: rx }] }, { _id: 1 }).limit(1000).lean(),
      MemberModel.find({ memberId: q.q.toUpperCase() }, { userId: 1 }).lean(),
    ]);
    filter.$or = [{ holderName: rx }, { ifsc: q.q.toUpperCase() }, { bankName: rx }, { userId: { $in: [...users.map((u) => u._id), ...members.map((m) => m.userId)] } }];
  }
  // Members only: vendor payout accounts are managed from the vendor's admin page.
  const [result] = await BankAccountModel.aggregate<{ rows: { userId: Types.ObjectId; holderName: string; bankName: string; accountLast4: string; ifsc: string; branchAddress: string; updatedAt: Date }[]; total: { n: number }[] }>([
    { $match: filter },
    { $lookup: { from: UserModel.collection.name, localField: 'userId', foreignField: '_id', as: 'u', pipeline: [{ $project: { roles: 1 } }] } },
    { $match: { 'u.roles': 'member' } },
    { $sort: { updatedAt: -1 } },
    { $facet: { rows: [{ $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }, { $project: { u: 0, accountNumberEncrypted: 0 } }], total: [{ $count: 'n' }] } },
  ]);
  const rows = result?.rows ?? [];
  const total = result?.total[0]?.n ?? 0;
  const ids = rows.map((r) => r.userId);
  const [users, members] = await Promise.all([
    UserModel.find({ _id: { $in: ids } }, { name: 1 }).lean(),
    MemberModel.find({ userId: { $in: ids } }, { userId: 1, memberId: 1 }).lean(),
  ]);
  const un = new Map(users.map((u) => [String(u._id), u.name]));
  const mm = new Map(members.map((m) => [String(m.userId), m.memberId]));
  const data: MemberBankRow[] = rows.map((r) => ({
    userId: String(r.userId), name: un.get(String(r.userId)) ?? '—', memberId: mm.get(String(r.userId)),
    holderName: r.holderName, bankName: r.bankName, accountLast4: r.accountLast4, ifsc: r.ifsc, branchAddress: r.branchAddress, updatedAt: r.updatedAt.toISOString(),
  }));
  res.json(paged(data, q.page, q.pageSize, total));
});

router.get('/:id/profile', ...admin, requirePermission('members.view'), async (req, res) => {
  const m = await memberUser(String(req.params.id));
  const profile = await loadMemberProfile(m.userId);
  // Documents and bank details need members.bank.
  if (!req.auth!.permissions.has('members.bank')) Object.assign(profile, { documents: [], bank: profile.bank ? { ...profile.bank, accountLast4: '••••' } : null });
  res.json(profile);
});

/** Full bank account number, for paying out. Every reveal is recorded in the audit log. */
router.post('/:id/bank/reveal', ...admin, requirePermission('members.bank'), async (req, res) => {
  const m = await memberUser(String(req.params.id));
  const bank = await BankAccountModel.findOne({ userId: m.userId }).select('+accountNumberEncrypted').lean();
  if (!bank) throw notFound('Bank account');
  await audit(req, { action: 'member.bank_reveal', entity: 'user', entityId: String(m.userId), summary: `Viewed full bank account number of ${m.memberId}` });
  res.set('Cache-Control', 'no-store');
  res.json({ accountNumber: decryptField(bank.accountNumberEncrypted) });
});

router.get('/:id/documents/:docId/file', ...admin, requirePermission('members.bank'), async (req, res) => {
  const m = await memberUser(String(req.params.id));
  const doc = await DocumentModel.findOne({ _id: assertObjectId(req.params.docId, 'Document'), userId: m.userId, vendorId: null });
  if (!doc) throw notFound('Document');
  await audit(req, { action: 'member.document_view', entity: 'user', entityId: String(m.userId), summary: `Viewed ${doc.type.replace(/_/g, ' ')} of ${m.memberId}` });
  await sendPrivate(res, doc.storageKey, doc.mime, doc.originalName);
});

router.post('/:id/documents/:docId/decision', ...admin, requirePermission('members.bank'), async (req: Request, res) => {
  const m = await memberUser(String(req.params.id));
  const { status } = parse(documentDecisionSchema, req.body);
  const doc = await DocumentModel.findOneAndUpdate({ _id: assertObjectId(req.params.docId, 'Document'), userId: m.userId, vendorId: null }, { status, reviewedBy: req.auth!.user.id }, { new: true });
  if (!doc) throw notFound('Document');
  await audit(req, { action: `member.document_${status === 'approved' ? 'approve' : 'reject'}`, entity: 'user', entityId: String(m.userId), summary: `${status === 'approved' ? 'Verified' : 'Rejected'} ${doc.type.replace(/_/g, ' ')} of ${m.memberId}` });
  res.json(await loadMemberProfile(m.userId));
});

/* ---------------------------------------------------------------- Referral views ("Direct referral view") */
router.get('/:id/referrals/summary', ...admin, requirePermission('members.view'), async (req, res) => {
  const m = await memberUser(String(req.params.id));
  res.json(await referralSummary(m.userId));
});

const listQuery = paginationSchema.extend({
  scope: z.enum(['all', 'direct', 'indirect']).default('direct'),
  q: z.string().trim().max(80).optional(),
  level: z.coerce.number().int().min(1).max(100).optional(),
});
router.get('/:id/referrals', ...admin, requirePermission('members.view'), async (req, res) => {
  const m = await memberUser(String(req.params.id));
  res.json(await referralList(m.userId, { ...parse(listQuery, req.query), showDirectContact: false }));
});

const treeQuery = z.object({ node: z.string().regex(/^[a-f0-9]{24}$/).optional(), page: z.coerce.number().int().min(1).default(1) });
router.get('/:id/referrals/tree', ...admin, requirePermission('members.view'), async (req, res) => {
  const m = await memberUser(String(req.params.id));
  const q = parse(treeQuery, req.query);
  res.json(await referralTree(m.userId, q.node, q.page));
});

export default router;
