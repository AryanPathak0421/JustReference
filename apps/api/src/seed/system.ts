import { FULL_ADMIN_ROLE_KEY, PERMISSION_KEYS, STANDARD_VENDOR_ROLE_KEY } from '@jr/shared';
import { RoleModel } from '../models/security';

/**
 * Idempotent system data, run on every API start:
 * - "Full admin" always grants exactly the current admin permission catalog;
 * - "Standard vendor" (given to every approved vendor) can manage their own listings, with admin approval.
 */
export async function ensureSystemData() {
  await RoleModel.findOneAndUpdate(
    { key: FULL_ADMIN_ROLE_KEY },
    {
      $set: { permissions: PERMISSION_KEYS, isSystem: true, scope: 'admin' },
      $setOnInsert: { name: 'Full admin', description: 'Every admin permission. Cannot manage administrators or roles.' },
    },
    { upsert: true },
  );
  await RoleModel.findOneAndUpdate(
    { key: STANDARD_VENDOR_ROLE_KEY },
    {
      $set: { permissions: ['vendor.listings.manage'], isSystem: true, scope: 'vendor' },
      $setOnInsert: { name: 'Standard vendor', description: 'Manage own listings. New and edited listings need admin approval.' },
    },
    { upsert: true },
  );
}
