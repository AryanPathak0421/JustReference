import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { randomBytes } from 'node:crypto';

// Environment must be set before any app module (config/env) is imported.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = inject('mongoUri');
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.PAYMENT_DRIVER = 'sandbox';
process.env.LOG_LEVEL ??= 'silent'; // run with LOG_LEVEL=error to see unexpected server errors
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'jr-uploads-'));

const mongoose = (await import('mongoose')).default;
const { connectDb, disconnectDb } = await import('../src/config/db');
const { ensureSystemData } = await import('../src/seed/system');
const { clearSettingsCache } = await import('../src/services/settings');

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI!);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  clearSettingsCache();
  await ensureSystemData();
});

afterAll(async () => {
  await disconnectDb();
});
