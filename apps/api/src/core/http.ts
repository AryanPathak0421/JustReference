import { isValidObjectId } from 'mongoose';
import { z, type ZodType } from 'zod';
import { notFound } from './errors';

/** Parse untrusted input with a Zod schema; ZodErrors become 400 responses in the error handler. */
export const parse = <S extends ZodType>(schema: S, data: unknown): z.output<S> => schema.parse(data);

export function assertObjectId(id: unknown, what = 'Record'): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id) || !isValidObjectId(id)) throw notFound(what);
  return id;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Inclusive date range filter on a Date field, interpreting dates in IST (the business timezone). */
export function dateRangeFilter(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const range: Record<string, Date> = {};
  if (from) range.$gte = new Date(`${from}T00:00:00+05:30`);
  if (to) range.$lte = new Date(`${to}T23:59:59.999+05:30`);
  return range;
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function paged<T>(data: T[], page: number, pageSize: number, total: number) {
  return { data, meta: { page, pageSize, total } };
}

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
