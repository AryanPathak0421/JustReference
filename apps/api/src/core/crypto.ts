import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { env } from '../config/env';

/* ---------- Passwords & PINs (argon2id, OWASP-recommended parameters) */
// `Algorithm` is an ambient const enum; 2 === Algorithm.Argon2id.
const ARGON = { algorithm: 2 as Algorithm, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashSecret = (plain: string) => hash(plain, ARGON);
export async function verifySecret(hashed: string, plain: string) {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Pre-computed hash used to keep login timing equal whether or not the account exists. */
let dummyHash: Promise<string> | undefined;
export const dummyVerify = async (plain: string) => {
  dummyHash ??= hashSecret('not-a-real-password-0');
  await verifySecret(await dummyHash, plain);
  return false;
};

/* ---------- Tokens */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmac = (s: string) => createHmac('sha256', env.JWT_ACCESS_SECRET).update(s).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join('');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid misreading
export const randomCode = (n: number) => Array.from({ length: n }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join('');

/* ---------- Field-level encryption for PAN / Aadhaar / bank numbers (used from Phase 3) */
const key = () => Buffer.from(env.FIELD_ENCRYPTION_KEY, 'base64');

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decryptField(stored: string): string {
  const [v, iv, tag, data] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export const maskMobile = (m: string) => (m.length >= 5 ? `+91 ••••• ${m.slice(-5)}` : '•••');
export function maskEmail(e: string) {
  const [u, d] = e.split('@');
  return u && d ? `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}` : '•••';
}
