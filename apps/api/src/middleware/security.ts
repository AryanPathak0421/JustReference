import type { RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError, forbidden } from '../core/errors';
import { safeEqual } from '../core/crypto';
import { CSRF_COOKIE, CSRF_HEADER, verifyAccessToken } from '../services/sessions';
import { getSettings } from '../services/settings';

/* ---------------- Rate limits (per IP). Account-level lockout is handled in the auth service. */
function limiter(windowMs: number, limit: number, message: string): RequestHandler {
  if (env.RATE_LIMIT_DISABLED) return (_req, _res, next) => next();
  const opts: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
  };
  return rateLimit(opts);
}

export const apiLimiter = limiter(60_000, 300, 'Too many requests. Please slow down.');
export const loginLimiter = limiter(15 * 60_000, 20, 'Too many login attempts from this network. Try again in 15 minutes.');
export const otpLimiter = limiter(15 * 60_000, 30, 'Too many verification attempts. Try again later.');
export const recoveryLimiter = limiter(60 * 60_000, 10, 'Too many password reset requests. Try again in an hour.');

/* ---------------- CSRF (double-submit) for endpoints authenticated by cookie */
export const csrfProtect: RequestHandler = (req, _res, next) => {
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) throw forbidden('Security check failed. Refresh the page and try again.', 'CSRF_FAILED');
  next();
};

/* ---------------- Maintenance mode: everyone except admins gets 503 (login stays open) */
const MAINTENANCE_OPEN = ['/health', '/public/', '/auth/', '/dev/', '/media/'];

export const maintenanceGate: RequestHandler = async (req, _res, next) => {
  if (MAINTENANCE_OPEN.some((p) => req.path.startsWith(p))) return next();
  const m = await getSettings('maintenance');
  if (!m.enabled) return next();
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    try {
      const { roles } = verifyAccessToken(header.slice(7));
      if (roles.includes('admin') || roles.includes('super_admin')) return next();
    } catch {
      /* fall through to 503 */
    }
  }
  throw new AppError(503, 'MAINTENANCE', m.message || 'The site is under maintenance');
};
