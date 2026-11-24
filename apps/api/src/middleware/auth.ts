import type { RequestHandler } from 'express';
import type { Role } from '@jr/shared';
import { UserModel } from '../models/user';
import { SessionModel } from '../models/security';
import { forbidden, unauthorized } from '../core/errors';
import { verifyAccessToken } from '../services/sessions';
import { resolvePermissions } from '../services/identity';

export interface AuthContext {
  user: { id: string; name: string; email: string; roles: Role[]; mustChangePassword: boolean };
  sessionId: string;
  permissions: Set<string>;
  /** When the person last entered their password in this session. */
  passwordAt: Date;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Paths a user who must change their password may still call. */
const PASSWORD_CHANGE_ALLOWED = ['/api/v1/auth/', '/api/v1/me'];

/**
 * Requires a valid access token. The user and session are re-checked on every request, so blocking a
 * user or revoking a session takes effect immediately rather than when the token expires.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let claims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Your session has expired', 'TOKEN_EXPIRED');
  }

  const [user, sessionOk] = await Promise.all([
    UserModel.findById(claims.sub, { name: 1, email: 1, roles: 1, roleIds: 1, status: 1, mustChangePassword: 1 }).lean(),
    SessionModel.findOne({ _id: claims.sid, userId: claims.sub, revokedAt: null, expiresAt: { $gt: new Date() } }, { reauthAt: 1, createdAt: 1 }).lean(),
  ]);
  if (!user || !sessionOk) throw unauthorized('Your session has ended. Please log in again.', 'SESSION_EXPIRED');
  if (user.status !== 'active') throw unauthorized('This account is not active. Contact support for help.', 'ACCOUNT_DISABLED');

  req.auth = {
    user: { id: String(user._id), name: user.name, email: user.email, roles: user.roles as Role[], mustChangePassword: !!user.mustChangePassword },
    sessionId: claims.sid,
    permissions: new Set(await resolvePermissions(user)),
    passwordAt: sessionOk.reauthAt ?? sessionOk.createdAt,
  };

  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.some((p) => req.originalUrl.startsWith(p))) {
    throw forbidden('Please set a new password before continuing', 'PASSWORD_CHANGE_REQUIRED');
  }
  next();
};

/** Requires every listed permission. */
export const requirePermission = (...perms: string[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  const missing = perms.filter((p) => !req.auth!.permissions.has(p));
  if (missing.length) throw forbidden('You don’t have permission to do this', 'FORBIDDEN', { missing });
  next();
};

const RECENT_MS = 15 * 60_000;
/** For actions that move money: the password must have been entered in this session within 15 minutes. */
export const requireRecentAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  if (Date.now() - req.auth.passwordAt.getTime() > RECENT_MS) throw forbidden('Confirm your password to continue', 'REAUTH_REQUIRED');
  next();
};

/** Requires at least one of the listed base roles. */
export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.auth) throw unauthorized();
  if (!roles.some((r) => req.auth!.user.roles.includes(r))) throw forbidden();
  next();
};
