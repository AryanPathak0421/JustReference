import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import { fromMulterError } from '../middleware/upload';

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new AppError(400, 'BAD_REQUEST', message, fields);
export const unauthorized = (message = 'Please log in to continue', code = 'UNAUTHORIZED') => new AppError(401, code, message);
export const forbidden = (message = 'You don’t have permission to do this', code = 'FORBIDDEN', details?: Record<string, unknown>) =>
  new AppError(403, code, message, undefined, details);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, fields?: Record<string, string>, code = 'CONFLICT') => new AppError(409, code, message, fields);

export function zodFields(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

export const notFoundHandler: RequestHandler = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const upload = fromMulterError(err);
  if (upload) err = upload;
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields', fields: zodFields(err) } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields, details: err.details } });
    return;
  }
  // Duplicate key from a unique index.
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'value';
    res.status(409).json({ error: { code: 'CONFLICT', message: `This ${field} is already in use`, fields: { [field]: `This ${field} is already in use` } } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' } });
};
