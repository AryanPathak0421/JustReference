import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@jr/shared';
import { env, isProd } from '../config/env';
import { SessionModel } from '../models/security';
import { randomToken, safeEqual, sha256 } from '../core/crypto';
import { unauthorized } from '../core/errors';

export const REFRESH_COOKIE = 'jr_rt';
export const CSRF_COOKIE = 'jr_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const REFRESH_PATH = '/api/v1/auth';
const NON_PERSISTENT_DAYS = 1;

export interface AccessClaims {
  sub: string;
  sid: string;
  roles: Role[];
}

export function signAccessToken(userId: string, sessionId: string, roles: Role[]) {
  return jwt.sign({ sid: sessionId, roles }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
    algorithm: 'HS256',
    issuer: 'justreference',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const p = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'justreference' }) as jwt.JwtPayload;
  return { sub: String(p.sub), sid: String(p.sid), roles: (p.roles ?? []) as Role[] };
}

const baseCookie = (): CookieOptions => ({ secure: isProd, sameSite: 'strict' });

function setAuthCookies(res: Response, sessionId: string, secret: string, persistent: boolean, expiresAt: Date) {
  const maxAge = persistent ? expiresAt.getTime() - Date.now() : undefined;
  res.cookie(REFRESH_COOKIE, `${sessionId}.${secret}`, { ...baseCookie(), httpOnly: true, path: REFRESH_PATH, maxAge });
  // Double-submit CSRF token: readable by our JS, must be echoed in a header on cookie-authenticated calls.
  res.cookie(CSRF_COOKIE, randomToken(18), { ...baseCookie(), httpOnly: false, path: '/', maxAge });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), httpOnly: true, path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE, { ...baseCookie(), path: '/' });
}

export async function createSession(req: Request, res: Response, user: { id: string; roles: Role[] }, persistent: boolean) {
  const secret = randomToken(32);
  const days = persistent ? env.REFRESH_TOKEN_TTL_DAYS : NON_PERSISTENT_DAYS;
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const session = await SessionModel.create({
    userId: user.id,
    tokenHash: sha256(secret),
    userAgent: req.get('user-agent')?.slice(0, 300),
    ip: req.ip,
    expiresAt,
    persistent,
  });
  setAuthCookies(res, session.id, secret, persistent, expiresAt);
  return { sessionId: session.id as string, accessToken: signAccessToken(user.id, session.id, user.roles) };
}

/**
 * Exchange a refresh cookie for a new one (rotation). Presenting an old, already-rotated token means
 * it was copied, so the whole session is revoked.
 */
export async function rotateSession(req: Request, res: Response) {
  const raw: string | undefined = req.cookies?.[REFRESH_COOKIE];
  const [sid, secret] = raw?.split('.') ?? [];
  if (!sid || !secret || !/^[a-f0-9]{24}$/.test(sid)) throw unauthorized('Your session has ended. Please log in again.', 'SESSION_EXPIRED');

  const session = await SessionModel.findById(sid);
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    clearAuthCookies(res);
    throw unauthorized('Your session has ended. Please log in again.', 'SESSION_EXPIRED');
  }
  if (!safeEqual(session.tokenHash, sha256(secret))) {
    session.revokedAt = new Date();
    session.revokedReason = 'refresh_token_reuse';
    await session.save();
    clearAuthCookies(res);
    throw unauthorized('Your session was signed out for security. Please log in again.', 'SESSION_REVOKED');
  }

  const next = randomToken(32);
  session.tokenHash = sha256(next);
  session.lastUsedAt = new Date();
  if (session.persistent) session.expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await session.save();
  setAuthCookies(res, session.id, next, session.persistent, session.expiresAt);
  return session;
}

export async function revokeSession(sessionId: string, reason: string) {
  await SessionModel.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date(), revokedReason: reason });
}

export async function revokeUserSessions(userId: string, reason: string, exceptSessionId?: string) {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const r = await SessionModel.updateMany(filter, { revokedAt: new Date(), revokedReason: reason });
  return r.modifiedCount;
}

export function readRefreshSessionId(req: Request): string | undefined {
  const sid = (req.cookies?.[REFRESH_COOKIE] as string | undefined)?.split('.')[0];
  return sid && /^[a-f0-9]{24}$/.test(sid) ? sid : undefined;
}
