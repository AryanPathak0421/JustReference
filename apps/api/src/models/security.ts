import { Schema, model, type InferSchemaType, Types } from 'mongoose';
import { SECURITY_CODE_TYPES } from '@jr/shared';

/* ---------------- Roles: named bundles of permissions */
const roleSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, maxlength: 200 },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
    /** admin roles grant admin permissions; vendor roles grant vendor rights. */
    scope: { type: String, enum: ['admin', 'vendor'], default: 'admin', index: true },
  },
  { timestamps: true },
);
roleSchema.index({ key: 1 }, { unique: true });
export type Role = InferSchemaType<typeof roleSchema>;
export const RoleModel = model('Role', roleSchema);

/* ---------------- Sessions: one per signed-in device; refresh token stored only as a hash */
const sessionSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String, maxlength: 300 },
    ip: String,
    lastUsedAt: { type: Date, default: Date.now },
    /** "Keep me signed in": persistent cookie vs browser-session cookie. */
    persistent: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: String,
  },
  { timestamps: true },
);
// MongoDB deletes sessions automatically once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const SessionModel = model('Session', sessionSchema);

/* ---------------- One-time passwords: hashed, short-lived, attempt-limited */
const otpSchema = new Schema(
  {
    target: { type: String, required: true },
    purpose: { type: String, enum: ['register', 'reset'], required: true },
    userId: { type: Types.ObjectId, ref: 'User' },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    lastSentAt: { type: Date, required: true },
    sendCount: { type: Number, default: 1 },
    windowStartedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
otpSchema.index({ target: 1, purpose: 1 }, { unique: true });
// Keep the row (for resend throttling) for an hour after the last send.
otpSchema.index({ lastSentAt: 1 }, { expireAfterSeconds: 3600 });
export const OtpModel = model('Otp', otpSchema);

/* ---------------- Security codes (the transaction PIN is the wallet password) */
const securityCodeSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: SECURITY_CODE_TYPES, required: true },
    hash: { type: String, required: true, select: false },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
securityCodeSchema.index({ userId: 1, type: 1 }, { unique: true });
export const SecurityCodeModel = model('SecurityCode', securityCodeSchema);

/* ---------------- Audit log: append-only record of security-relevant and admin actions */
const auditSchema = new Schema(
  {
    actorId: { type: Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    summary: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
    ip: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ createdAt: -1 });
auditSchema.index({ actorId: 1, createdAt: -1 });
auditSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
export const AuditLogModel = model('AuditLog', auditSchema);
