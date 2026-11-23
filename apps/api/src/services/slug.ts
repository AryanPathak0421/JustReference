import type { Model } from 'mongoose';
import { randomCode } from '../core/crypto';

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';

/** A slug unique within `scope` (e.g. `{ type: 'product' }`), adding a short random suffix on collision. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function uniqueSlug(model: Model<any>, base: string, scope: Record<string, unknown> = {}, exceptId?: unknown): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? root : `${root}-${randomCode(4).toLowerCase()}`;
    const clash = await model.exists({ ...scope, slug: candidate, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
    if (!clash) return candidate;
  }
  throw new Error('Could not allocate a unique slug');
}
