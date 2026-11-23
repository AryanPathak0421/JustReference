import { z } from 'zod';

/**
 * Environment configuration, validated at startup. The process refuses to start with a bad config
 * rather than running half-configured.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    /** Public address of the web app, used in links sent by SMS/WhatsApp/email (e.g. referral invitations). */
    PUBLIC_WEB_URL: z.url().default('http://localhost:5173'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
    ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    MESSAGING_DRIVER: z.enum(['console']).default('console'),
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    /** Local storage root (relative to the API's working directory). Public and private files live in separate folders. */
    UPLOAD_DIR: z.string().default('./uploads'),
    /** Optional: folder with the built web app (apps/web/dist) to serve from the same origin as the API. */
    WEB_DIST_DIR: z.string().optional(),
    RATE_LIMIT_DISABLED: z.stringbool().default(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    SEED_SUPERADMIN_NAME: z.string().default('Super Admin'),
    SEED_SUPERADMIN_EMAIL: z.string().optional(),
    SEED_SUPERADMIN_MOBILE: z.string().optional(),
    SEED_SUPERADMIN_PASSWORD: z.string().optional(),
    /** seed:demo only: login password for the root SAMPLE member (aarav.sharma@example.test). */
    SEED_DEMO_MEMBER_PASSWORD: z.string().optional(),
    /** seed:demo only: login for the demo Admin (admin@example.test, full admin rights). */
    SEED_DEMO_ADMIN_PASSWORD: z.string().optional(),
    /** seed:demo only: login for the first SAMPLE vendor (sungrid-energy@example.test). */
    SEED_DEMO_VENDOR_PASSWORD: z.string().optional(),
  })
  .refine((e) => e.NODE_ENV !== 'production' || !e.RATE_LIMIT_DISABLED, {
    path: ['RATE_LIMIT_DISABLED'],
    message: 'Rate limiting cannot be disabled in production',
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee apps/api/.env.example`);
  }
  return parsed.data;
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
