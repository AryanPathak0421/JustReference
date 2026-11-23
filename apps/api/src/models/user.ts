import { Schema, model, type InferSchemaType, type HydratedDocument, Types } from 'mongoose';
import { ROLES, USER_STATUSES } from '@jr/shared';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    /** Base roles decide which panels a user can open. */
    roles: { type: [String], enum: ROLES, default: ['member'] },
    /** Permission-granting role documents (admins). */
    roleIds: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    status: { type: String, enum: USER_STATUSES, default: 'pending', index: true },
    statusReason: { type: String, maxlength: 300 },
    emailVerifiedAt: Date,
    mobileVerifiedAt: Date,
    lastLoginAt: Date,
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: Date,
    passwordChangedAt: Date,
    mustChangePassword: { type: Boolean, default: false },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    /** Referral ID typed at sign-up; applied (and cleared) when the mobile number is verified. */
    pendingReferralCode: { type: String, maxlength: 16 },
    /** Business name typed at vendor sign-up; becomes the vendor profile when the mobile is verified. */
    pendingBusinessName: { type: String, maxlength: 120 },
    /** Marks rows created by `seed:demo` so they're never mistaken for real customers. */
    isSample: { type: Boolean, default: false },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ mobile: 1 }, { unique: true });
userSchema.index({ roles: 1, createdAt: -1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
