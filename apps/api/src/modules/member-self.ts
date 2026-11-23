import { Router, type Request } from 'express';
import { z } from 'zod';
import { bankAccountSchema, DAILY_INVITE_LIMIT, invitationSchema, MEMBER_DOCUMENT_TYPES, memberProfileSchema, type InvitationRow } from '@jr/shared';
import { UserModel } from '../models/user';
import { MemberModel, ProfileModel, toDobMD } from '../models/member';
import { BankAccountModel, DocumentModel } from '../models/vendor';
import { InvitationModel } from '../models/referral';
import { AppError, badRequest, conflict, notFound } from '../core/errors';
import { assertObjectId, paginationSchema, parse } from '../core/http';
import { encryptField, maskEmail, maskMobile } from '../core/crypto';
import { DOCUMENT_MAX_BYTES, IMAGE_MAX_BYTES, processImage, requireFile, singleFile, sniff } from '../middleware/upload';
import { newKey, storage } from '../services/storage';
import { loadMemberProfile } from '../services/profiles';
import { referralList, referralSummary, referralTree } from '../services/referrals';
import { maskPan } from '../services/vendors';
import { messaging } from '../services/messaging';
import { getSettings } from '../services/settings';
import { audit } from '../services/audit';
import { env } from '../config/env';
import { sendPrivate } from './vendor';

/**
 * Member self-service: profile, bank, KYC documents, referrals and invitations.
 * Mounted inside the authenticated /me router. Works for anyone with a member record (members and vendors).
 */
const router = Router();

async function requireMember(req: Request) {
  const m = await MemberModel.findOne({ userId: req.auth!.user.id }).lean();
  if (!m) throw notFound('Member profile');
  return m;
}

/* ---------------------------------------------------------------- Profile */
router.get('/profile', async (req, res) => {
  res.json(await loadMemberProfile(req.auth!.user.id));
});

router.put('/profile', async (req, res) => {
  await requireMember(req);
  const input = parse(memberProfileSchema, req.body);
  const dob = input.dob ? new Date(`${input.dob}T00:00:00Z`) : null;
  const update: Record<string, unknown> = {
    dob, dobMD: toDobMD(dob), addresses: input.addresses,
    gstin: input.gstin || null, aadhaarLast4: input.aadhaarLast4 || null, website: input.website || null, social: input.social ?? {},
  };
  if (input.pan) { update.panEncrypted = encryptField(input.pan); update.panMasked = maskPan(input.pan); }
  await Promise.all([
    ProfileModel.findOneAndUpdate({ userId: req.auth!.user.id }, update, { upsert: true }),
    UserModel.updateOne({ _id: req.auth!.user.id }, { name: input.name }),
  ]);
  await audit(req, { action: 'profile.update', entity: 'user', entityId: req.auth!.user.id, summary: `Updated own profile${input.pan ? ' (PAN changed)' : ''}` });
  res.json(await loadMemberProfile(req.auth!.user.id));
});

router.put('/bank', async (req, res) => {
  await requireMember(req);
  const input = parse(bankAccountSchema, req.body);
  await BankAccountModel.findOneAndUpdate(
    { userId: req.auth!.user.id },
    { holderName: input.holderName, accountNumberEncrypted: encryptField(input.accountNumber), accountLast4: input.accountNumber.slice(-4), ifsc: input.ifsc, bankName: input.bankName, branchAddress: input.branchAddress, verifiedAt: null },
    { upsert: true },
  );
  await audit(req, { action: 'profile.bank_update', entity: 'user', entityId: req.auth!.user.id, summary: `Saved bank account ending ${input.accountNumber.slice(-4)}` });
  res.json(await loadMemberProfile(req.auth!.user.id));
});

router.post('/avatar', singleFile('file', IMAGE_MAX_BYTES), async (req, res) => {
  await requireMember(req);
  const file = requireFile(req.file);
  const kind = sniff(file.buffer);
  if (!kind || kind === 'pdf') throw badRequest('Upload a JPG, PNG or WebP image', { file: 'Upload a JPG, PNG or WebP image' });
  const key = newKey('webp');
  await storage.put(key, await processImage(file.buffer, 400), 'public');
  const old = await ProfileModel.findOneAndUpdate({ userId: req.auth!.user.id }, { avatarKey: key }, { upsert: true }).lean();
  if (old?.avatarKey) await storage.remove(old.avatarKey, 'public');
  res.json(await loadMemberProfile(req.auth!.user.id));
});

router.post('/documents', singleFile('file', DOCUMENT_MAX_BYTES), async (req, res) => {
  await requireMember(req);
  const type = parse(z.enum(MEMBER_DOCUMENT_TYPES as [string, ...string[]], { error: 'Choose the document type' }), req.body?.type);
  const file = requireFile(req.file);
  const kind = sniff(file.buffer);
  if (!kind) throw badRequest('Upload a PDF, JPG or PNG file', { file: 'Upload a PDF, JPG or PNG file' });
  if (await DocumentModel.countDocuments({ userId: req.auth!.user.id, vendorId: null }) >= 10) throw badRequest('You can upload up to 10 documents. Remove old ones first.');
  const data = kind === 'pdf' ? file.buffer : await processImage(file.buffer, 2400);
  const ext = kind === 'pdf' ? 'pdf' : 'webp';
  const key = newKey(ext);
  await storage.put(key, data, 'private');
  await DocumentModel.create({
    userId: req.auth!.user.id, vendorId: null, type, storageKey: key,
    originalName: file.originalname.slice(0, 200) || `document.${ext}`, mime: ext === 'pdf' ? 'application/pdf' : 'image/webp', size: data.length,
  });
  await audit(req, { action: 'profile.document_upload', entity: 'user', entityId: req.auth!.user.id, summary: `Uploaded ${type.replace(/_/g, ' ')}` });
  res.status(201).json(await loadMemberProfile(req.auth!.user.id));
});

router.get('/documents/:id/file', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: assertObjectId(req.params.id, 'Document'), userId: req.auth!.user.id, vendorId: null });
  if (!doc) throw notFound('Document');
  await sendPrivate(res, doc.storageKey, doc.mime, doc.originalName);
});

router.delete('/documents/:id', async (req, res) => {
  const doc = await DocumentModel.findOne({ _id: assertObjectId(req.params.id, 'Document'), userId: req.auth!.user.id, vendorId: null });
  if (!doc) throw notFound('Document');
  if (doc.status === 'approved') throw badRequest('Verified documents can’t be removed. Contact support to replace one.');
  await doc.deleteOne();
  await storage.remove(doc.storageKey, 'private');
  res.json(await loadMemberProfile(req.auth!.user.id));
});

/* ---------------------------------------------------------------- Referrals */
router.get('/referrals/summary', async (req, res) => {
  res.json(await referralSummary(req.auth!.user.id));
});

const listQuery = paginationSchema.extend({
  scope: z.enum(['all', 'direct', 'indirect']).default('all'),
  q: z.string().trim().max(80).optional(),
  level: z.coerce.number().int().min(1).max(100).optional(),
});

router.get('/referrals', async (req, res) => {
  const q = parse(listQuery, req.query);
  res.json(await referralList(req.auth!.user.id, { ...q, showDirectContact: true }));
});

const treeQuery = z.object({ node: z.string().regex(/^[a-f0-9]{24}$/).optional(), page: z.coerce.number().int().min(1).default(1) });
router.get('/referrals/tree', async (req, res) => {
  const q = parse(treeQuery, req.query);
  res.json(await referralTree(req.auth!.user.id, q.node, q.page));
});

/* ---------------------------------------------------------------- Invitations ("Create new referral") */
router.get('/invitations', async (req, res) => {
  const { page, pageSize } = parse(paginationSchema, req.query);
  const filter = { sponsorUserId: req.auth!.user.id };
  const [rows, total] = await Promise.all([
    InvitationModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    InvitationModel.countDocuments(filter),
  ]);
  const joinedIds = rows.map((r) => r.joinedUserId).filter(Boolean);
  const [users, members] = await Promise.all([
    UserModel.find({ _id: { $in: joinedIds } }, { name: 1 }).lean(),
    MemberModel.find({ userId: { $in: joinedIds } }, { userId: 1, memberId: 1 }).lean(),
  ]);
  const un = new Map(users.map((u) => [String(u._id), u.name]));
  const mm = new Map(members.map((m) => [String(m.userId), m.memberId]));
  const data: InvitationRow[] = rows.map((r) => ({
    id: String(r._id),
    name: r.name,
    channel: r.channel,
    contactMasked: r.channel === 'email' ? maskEmail(r.email ?? '') : maskMobile(r.mobile ?? ''),
    status: r.status,
    joined: r.joinedUserId ? { name: un.get(String(r.joinedUserId)) ?? r.name, memberId: mm.get(String(r.joinedUserId)) ?? '' } : null,
    createdAt: r.createdAt.toISOString(),
  }));
  res.json({ data, meta: { page, pageSize, total } });
});

router.post('/invitations', async (req, res) => {
  const me = await requireMember(req);
  const input = parse(invitationSchema, req.body);
  const contact = input.channel === 'email' ? { email: input.email } : { mobile: input.mobile };
  const since = new Date(Date.now() - 86_400_000);
  if (await InvitationModel.countDocuments({ sponsorUserId: me.userId, createdAt: { $gte: since } }) >= DAILY_INVITE_LIMIT) {
    throw new AppError(429, 'INVITE_LIMIT', `You can send up to ${DAILY_INVITE_LIMIT} invitations a day. Please try again tomorrow.`);
  }
  if (await UserModel.exists(contact)) {
    const field = input.channel === 'email' ? 'email' : 'mobile';
    throw conflict('This person already has an account', { [field]: 'This person already has a JustReference account' }, 'ALREADY_MEMBER');
  }
  if (await InvitationModel.exists({ sponsorUserId: me.userId, status: 'sent', ...contact, createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } })) {
    throw conflict('You invited this person in the last 7 days', undefined, 'ALREADY_INVITED');
  }
  const { siteName } = await getSettings('general');
  const link = `${env.PUBLIC_WEB_URL}/register?ref=${me.referralCode}`;
  const text = `Hi ${input.name.split(' ')[0]}, ${req.auth!.user.name} has invited you to join ${siteName}.${input.note ? ` "${input.note}"` : ''} Sign up here: ${link}`;
  await messaging.send({ channel: input.channel, to: (input.channel === 'email' ? input.email : input.mobile)!, subject: `${req.auth!.user.name} invited you to ${siteName}`, text });
  const inv = await InvitationModel.create({ sponsorUserId: me.userId, name: input.name, channel: input.channel, ...contact });
  await audit(req, { action: 'referral.invite', entity: 'invitation', entityId: inv.id, summary: `Invited ${input.name} by ${input.channel}` });
  res.status(201).json({ id: inv.id });
});

export default router;
