import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import {
  changePasswordSchema, forgotPasswordSchema, loginSchema, normalizeMobile, registerSchema, resendOtpSchema,
  resetPasswordWithCodeSchema, verifyRegistrationSchema, type RegisterResponse, reauthSchema,
} from '@jr/shared';
import { UserModel, type UserDoc } from '../models/user';
import { AppError, conflict, notFound, unauthorized } from '../core/errors';
import { parse } from '../core/http';
import { dummyVerify, hashSecret, maskMobile, verifySecret } from '../core/crypto';
import { authenticate } from '../middleware/auth';
import { csrfProtect, loginLimiter, otpLimiter, recoveryLimiter } from '../middleware/security';
import { issueOtp, verifyOtp } from '../services/otp';
import { getSettings } from '../services/settings';
import { SessionModel } from '../models/security';
import { notify } from '../services/notify';
import { audit } from '../services/audit';
import { createMemberRecord, findSponsor, toAuthUser } from '../services/identity';
import { createVendorShell } from '../services/vendors';
import { MemberModel } from '../models/member';
import { InvitationModel } from '../models/referral';
import { OtpModel } from '../models/security';
import { clearAuthCookies, createSession, readRefreshSessionId, revokeSession, revokeUserSessions, rotateSession, signAccessToken } from '../services/sessions';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const router = Router();

const identifierQuery = (identifier: string) =>
  identifier.includes('@') ? { email: identifier.trim().toLowerCase() } : { mobile: normalizeMobile(identifier) };

/**
 * Send a sign-up code. If one was sent moments ago (cooldown), the earlier code is still valid for the
 * same number, so report its remaining time instead of failing — the person can simply use that code.
 */
async function sendRegistrationOtp(user: { _id: mongoose.Types.ObjectId; mobile: string }, opts = { reuseDuringCooldown: true }): Promise<RegisterResponse> {
  const { otpChannel } = await getSettings('auth');
  let timing;
  try {
    timing = await issueOtp({ target: user.mobile, purpose: 'register', channel: otpChannel, userId: user._id });
  } catch (e) {
    if (!(opts.reuseDuringCooldown && e instanceof AppError && e.code === 'OTP_COOLDOWN')) throw e;
    const existing = await OtpModel.findOne({ target: user.mobile, purpose: 'register' }, { expiresAt: 1 }).lean();
    timing = {
      expiresInSec: Math.max(0, Math.floor(((existing?.expiresAt.getTime() ?? 0) - Date.now()) / 1000)),
      resendInSec: Number(e.details?.retryAfterSec ?? 30),
    };
  }
  return { userId: String(user._id), otp: { channel: otpChannel, target: maskMobile(user.mobile), ...timing } };
}

async function startSession(req: Request, res: Response, user: UserDoc, persistent: boolean) {
  const { accessToken } = await createSession(req, res, { id: user.id, roles: user.roles as never }, persistent);
  return { accessToken, user: await toAuthUser(user.toObject()) };
}

/* ---------------------------------------------------------------- Register */
router.post('/register', otpLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  await findSponsor(input.referralCode || undefined); // fail fast on a bad referral ID

  const clashes = await UserModel.find({ $or: [{ email: input.email }, { mobile: input.mobile }] }, { email: 1, mobile: 1, status: 1 }).lean();
  const fields: Record<string, string> = {};
  for (const u of clashes) {
    if (u.status === 'pending') continue; // abandoned sign-up: replaced below
    if (u.email === input.email) fields.email = 'This email is already registered. Try logging in.';
    if (u.mobile === input.mobile) fields.mobile = 'This mobile number is already registered. Try logging in.';
  }
  if (Object.keys(fields).length) throw conflict('An account already exists', fields, 'ALREADY_REGISTERED');
  const stale = clashes.filter((u) => u.status === 'pending').map((u) => u._id);
  if (stale.length) await UserModel.deleteMany({ _id: { $in: stale }, status: 'pending' });

  const user = await UserModel.create({
    name: input.name,
    email: input.email,
    mobile: input.mobile,
    passwordHash: await hashSecret(input.password),
    roles: input.accountType === 'vendor' ? ['vendor'] : ['member'],
    status: 'pending',
    pendingReferralCode: input.referralCode || undefined,
    pendingBusinessName: input.accountType === 'vendor' ? input.businessName : undefined,
  });
  res.status(201).json(await sendRegistrationOtp(user));
});

router.post('/register/resend', otpLimiter, async (req, res) => {
  const { userId } = parse(resendOtpSchema, req.body);
  const user = await UserModel.findOne({ _id: userId, status: 'pending' });
  if (!user) throw notFound('Registration');
  res.json(await sendRegistrationOtp(user, { reuseDuringCooldown: false }));
});

router.post('/register/verify', otpLimiter, async (req, res) => {
  const { userId, code } = parse(verifyRegistrationSchema, req.body);
  const user = await UserModel.findOne({ _id: userId, status: 'pending' });
  if (!user) throw notFound('Registration');
  await verifyOtp({ target: user.mobile, purpose: 'register', code });

  await mongoose.connection.transaction(async (session) => {
    const referralCode = user.pendingReferralCode ?? undefined;
    const businessName = user.pendingBusinessName ?? `${user.name}’s business`;
    user.status = 'active';
    user.mobileVerifiedAt = new Date();
    user.lastLoginAt = new Date(); // verification signs them in
    user.pendingReferralCode = undefined;
    user.pendingBusinessName = undefined;
    await user.save({ session });

    // Members and vendors both get member/referral IDs (vendors earn referral income too, Phase 3+).
    let sponsorName: string | undefined;
    try {
      const { sponsor } = await createMemberRecord(user._id, { referralCode, joinedVia: 'direct' }, session);
      if (sponsor) sponsorName = String(sponsor.memberId);
    } catch (e) {
      // Sponsor vanished between sign-up and verification: join without one rather than block the user.
      if (e instanceof AppError && e.code === 'BAD_REFERRAL') await createMemberRecord(user._id, { joinedVia: 'direct' }, session);
      else throw e;
    }
    const referred = sponsorName ? ` (referred by ${sponsorName})` : '';
    // Mark the sponsor's invitation to this person (if any) as joined.
    const sponsorUserId = (await MemberModel.findOne({ userId: user._id }, { sponsorUserId: 1 }).session(session).lean())?.sponsorUserId;
    if (sponsorUserId) {
      await InvitationModel.updateMany(
        { sponsorUserId, status: 'sent', $or: [{ mobile: user.mobile }, { email: user.email }] },
        { status: 'joined', joinedUserId: user._id, joinedAt: new Date() },
        { session },
      );
    }
    if (user.roles.includes('vendor')) {
      await createVendorShell(user._id, businessName, session);
      await audit(req, { actorId: user.id, action: 'auth.register', entity: 'user', entityId: user.id, summary: `Registered as a vendor: ${businessName}${referred}` }, session);
    } else {
      await audit(req, { actorId: user.id, action: 'auth.register', entity: 'user', entityId: user.id, summary: `Registered as a member${referred}` }, session);
    }
  });
  await notify(user._id, { event: 'registration', title: 'Welcome to JustReference', body: 'Your account is ready.', link: user.roles.includes('vendor') ? '/vendor' : '/member', key: 'welcome' });
  const sponsor = (await MemberModel.findOne({ userId: user._id }, { sponsorUserId: 1 }).lean())?.sponsorUserId;
  if (sponsor) {
    const su = await UserModel.findById(sponsor, { roles: 1 }).lean();
    await notify(sponsor, { event: 'referral', title: 'Someone joined with your referral', body: user.name, link: su?.roles.includes('vendor') ? '/vendor/referrals/all' : '/member/referrals/direct', key: `referral:${user.id}` });
  }
  // Vendor rights were added to the user inside the transaction; reload them so the response includes them.
  user.roleIds = ((await UserModel.findById(user._id, { roleIds: 1 }).lean())?.roleIds ?? []) as never;
  res.status(201).json(await startSession(req, res, user, true));
});

/* ---------------------------------------------------------------- Login */
router.post('/login', loginLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = await UserModel.findOne(identifierQuery(input.identifier)).select('+passwordHash');
  const wrong = new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email/mobile or password');

  if (!user) {
    await dummyVerify(input.password);
    throw wrong;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`);
  }
  if (!(await verifySecret(user.passwordHash, input.password))) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await UserModel.updateOne(
      { _id: user._id },
      lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } : { failedLoginCount: failed },
    );
    if (lock) await audit(req, { actorId: user.id, action: 'auth.lockout', entity: 'user', entityId: user.id, summary: `Account locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_LOGINS} failed logins` });
    throw wrong;
  }

  if (user.status === 'pending') {
    const { otp } = await sendRegistrationOtp(user);
    throw new AppError(403, 'VERIFICATION_REQUIRED', 'Verify your mobile number to finish creating your account', undefined, { userId: user.id, otp });
  }
  if (user.status === 'blocked' || user.status === 'blacklisted') {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'This account has been suspended. Contact support for help.');
  }

  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  await audit(req, { actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, summary: 'Logged in' });
  res.json(await startSession(req, res, user, input.remember ?? true));
});

/* ---------------------------------------------------------------- Session */
router.post('/refresh', csrfProtect, async (req, res) => {
  const session = await rotateSession(req, res);
  const user = await UserModel.findById(session.userId);
  if (!user || user.status !== 'active') {
    await revokeSession(session.id, 'user_inactive');
    clearAuthCookies(res);
    throw unauthorized('This account is not active', 'ACCOUNT_DISABLED');
  }
  res.json({ accessToken: signAccessToken(user.id, session.id, user.roles as never), user: await toAuthUser(user.toObject()) });
});

router.post('/logout', csrfProtect, async (req, res) => {
  const sid = readRefreshSessionId(req);
  if (sid) await revokeSession(sid, 'logout');
  clearAuthCookies(res);
  res.status(204).end();
});

router.get('/me', authenticate, async (req, res) => {
  const user = await UserModel.findById(req.auth!.user.id).lean();
  if (!user) throw unauthorized();
  res.json({ user: await toAuthUser(user) });
});

/* ---------------------------------------------------------------- Password recovery */
router.post('/forgot-password', recoveryLimiter, async (req, res) => {
  const { identifier } = parse(forgotPasswordSchema, req.body);
  const byEmail = identifier.includes('@');
  const user = await UserModel.findOne(identifierQuery(identifier), { email: 1, mobile: 1, status: 1 }).lean();
  // Same response whether or not the account exists, so this can't be used to discover accounts.
  const generic = { message: 'If an account matches, we’ve sent a reset code.', channel: byEmail ? 'email' : 'sms' };
  if (user && user.status === 'active') {
    const { otpChannel } = await getSettings('auth');
    try {
      await issueOtp({ target: byEmail ? user.email : user.mobile, purpose: 'reset', channel: byEmail ? 'email' : otpChannel, userId: user._id });
    } catch (e) {
      if (!(e instanceof AppError && (e.code === 'OTP_COOLDOWN' || e.code === 'OTP_LIMIT'))) throw e;
    }
  }
  res.json(generic);
});

router.post('/reset-password', recoveryLimiter, async (req, res) => {
  const input = parse(resetPasswordWithCodeSchema, req.body);
  const byEmail = input.identifier.includes('@');
  const user = await UserModel.findOne(identifierQuery(input.identifier));
  const target = user ? (byEmail ? user.email : user.mobile) : (byEmail ? input.identifier.toLowerCase() : normalizeMobile(input.identifier));
  await verifyOtp({ target, purpose: 'reset', code: input.code });
  if (!user || user.status !== 'active') throw new AppError(400, 'OTP_INVALID', 'That code is incorrect or has expired', { code: 'That code is incorrect or has expired' });

  user.passwordHash = await hashSecret(input.password);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  await user.save();
  const revoked = await revokeUserSessions(user.id, 'password_reset');
  await audit(req, { actorId: user.id, action: 'auth.password_reset', entity: 'user', entityId: user.id, summary: `Reset password with a code; signed out ${revoked} session(s)` });
  res.json({ message: 'Your password has been reset. You can now log in.' });
});

router.post('/change-password', authenticate, async (req, res) => {
  const input = parse(changePasswordSchema, req.body);
  const user = await UserModel.findById(req.auth!.user.id).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await verifySecret(user.passwordHash, input.currentPassword))) {
    throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is incorrect', { currentPassword: 'Your current password is incorrect' });
  }
  user.passwordHash = await hashSecret(input.newPassword);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  await user.save();
  const revoked = await revokeUserSessions(user.id, 'password_changed', req.auth!.sessionId);
  await audit(req, { action: 'auth.password_change', entity: 'user', entityId: user.id, summary: `Changed password; signed out ${revoked} other session(s)` });
  res.json({ user: await toAuthUser(user.toObject()), signedOutOtherSessions: revoked });
});

/** Re-enter the password before a money action. Wrong tries count towards the account lockout. */
router.post('/reauth', authenticate, loginLimiter, async (req, res) => {
  const { password } = parse(reauthSchema, req.body);
  const user = await UserModel.findById(req.auth!.user.id).select('+passwordHash');
  if (!user) throw unauthorized();
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many wrong tries. Try again in 15 minutes.');
  if (!(await verifySecret(user.passwordHash, password))) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await UserModel.updateOne({ _id: user._id }, lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } : { failedLoginCount: failed });
    throw new AppError(400, 'WRONG_PASSWORD', 'That password is incorrect', { password: 'That password is incorrect' });
  }
  await UserModel.updateOne({ _id: user._id }, { failedLoginCount: 0 });
  await SessionModel.updateOne({ _id: req.auth!.sessionId }, { reauthAt: new Date() });
  await audit(req, { action: 'auth.reauth', entity: 'user', entityId: user.id, summary: 'Confirmed their password' });
  res.json({ ok: true });
});

export default router;
