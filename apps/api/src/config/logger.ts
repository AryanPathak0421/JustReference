import pino from 'pino';
import { env, isDev } from './env';

/**
 * Structured logger. Secrets and personal data are redacted at the logger level, so a careless
 * `logger.info({ body })` can't leak passwords, OTPs, tokens or bank/ID numbers.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.confirmPassword',
  '*.passwordHash',
  '*.code',
  '*.otp',
  '*.pin',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.pan',
  '*.aadhaar',
  '*.accountNumber',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } } } : {}),
});
