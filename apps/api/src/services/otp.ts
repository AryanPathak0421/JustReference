import type { Types } from 'mongoose';
import { OtpModel } from '../models/security';
import { AppError } from '../core/errors';
import { hmac, randomDigits, safeEqual } from '../core/crypto';
import { messaging, type Channel } from './messaging';
import { getSettings } from './settings';

export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 30;
export const OTP_MAX_SENDS_PER_HOUR = 5;

type Purpose = 'register' | 'reset';

const codeHash = (purpose: Purpose, target: string, code: string) => hmac(`otp:${purpose}:${target}:${code}`);

const TEMPLATES: Record<Purpose, (code: string, mins: number, site: string) => string> = {
  register: (c, m, s) => `${c} is your ${s} verification code. It expires in ${m} minutes. Never share it with anyone.`,
  reset: (c, m, s) => `${c} is your ${s} password reset code. It expires in ${m} minutes. If you didn't ask for this, ignore this message.`,
};

/**
 * Create (or replace) an OTP for a target and send it. Enforces a resend cooldown and an hourly cap.
 * Returns timing info for the client; never returns the code.
 */
export async function issueOtp(opts: { target: string; purpose: Purpose; channel: Channel; userId?: Types.ObjectId | string }) {
  const { target, purpose, channel } = opts;
  const now = new Date();
  const existing = await OtpModel.findOne({ target, purpose });

  let sendCount = 1;
  let windowStartedAt = now;
  if (existing) {
    const sinceLast = (now.getTime() - existing.lastSentAt.getTime()) / 1000;
    if (sinceLast < OTP_RESEND_COOLDOWN_SEC) {
      const wait = Math.ceil(OTP_RESEND_COOLDOWN_SEC - sinceLast);
      throw new AppError(429, 'OTP_COOLDOWN', `Please wait ${wait} seconds before requesting another code`, undefined, { retryAfterSec: wait });
    }
    const inWindow = now.getTime() - existing.windowStartedAt.getTime() < 3600_000;
    if (inWindow && existing.sendCount >= OTP_MAX_SENDS_PER_HOUR) {
      throw new AppError(429, 'OTP_LIMIT', 'Too many codes requested. Please try again in an hour.');
    }
    sendCount = inWindow ? existing.sendCount + 1 : 1;
    windowStartedAt = inWindow ? existing.windowStartedAt : now;
  }

  const { otpTtlMinutes } = await getSettings('auth');
  const { siteName } = await getSettings('general');
  const code = randomDigits(OTP_LENGTH);
  await OtpModel.findOneAndUpdate(
    { target, purpose },
    {
      userId: opts.userId,
      codeHash: codeHash(purpose, target, code),
      attempts: 0,
      expiresAt: new Date(now.getTime() + otpTtlMinutes * 60_000),
      lastSentAt: now,
      sendCount,
      windowStartedAt,
    },
    { upsert: true },
  );
  await messaging.send({ channel, to: target, subject: `${siteName} code`, text: TEMPLATES[purpose](code, otpTtlMinutes, siteName) });
  return { expiresInSec: otpTtlMinutes * 60, resendInSec: OTP_RESEND_COOLDOWN_SEC };
}

/** Check a code. Consumes it on success; counts failed attempts and burns it after the limit. */
export async function verifyOtp(opts: { target: string; purpose: Purpose; code: string }): Promise<void> {
  const { target, purpose, code } = opts;
  const invalid = new AppError(400, 'OTP_INVALID', 'That code is incorrect or has expired', { code: 'That code is incorrect or has expired' });
  const doc = await OtpModel.findOne({ target, purpose });
  if (!doc || doc.expiresAt < new Date()) throw invalid;
  if (doc.attempts >= OTP_MAX_ATTEMPTS) {
    throw new AppError(429, 'OTP_LOCKED', 'Too many incorrect attempts. Request a new code.', { code: 'Too many incorrect attempts. Request a new code.' });
  }
  if (!/^\d{6}$/.test(code) || !safeEqual(doc.codeHash, codeHash(purpose, target, code))) {
    await OtpModel.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
    throw invalid;
  }
  // Single use: expire immediately but keep the row for resend throttling.
  await OtpModel.updateOne({ _id: doc._id }, { codeHash: 'used', expiresAt: new Date(0) });
}
