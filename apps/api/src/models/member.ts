import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Member record: IDs and the referral position of a user.
 * `ancestorIds` is the full upline, nearest sponsor first, so "all downline of X" is `{ ancestorIds: X }`.
 */
const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    memberId: { type: String, required: true },
    referralCode: { type: String, required: true },
    sponsorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ancestorIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    depth: { type: Number, default: 0 },
    joinedVia: { type: String, enum: ['direct', 'referral', 'admin'], default: 'direct' },
  },
  { timestamps: true },
);

memberSchema.index({ userId: 1 }, { unique: true });
memberSchema.index({ memberId: 1 }, { unique: true });
memberSchema.index({ referralCode: 1 }, { unique: true });
memberSchema.index({ sponsorUserId: 1 });
memberSchema.index({ ancestorIds: 1 });

export type Member = InferSchemaType<typeof memberSchema>;
export const MemberModel = model('Member', memberSchema);

const profileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dob: Date,
    /** "MM-DD" of the date of birth, indexed for the daily birthday job and "upcoming birthdays". */
    dobMD: { type: String, default: null },
    addresses: {
      residence: { type: String, maxlength: 300 },
      office: { type: String, maxlength: 300 },
      billing: { type: String, maxlength: 300 },
    },
    panEncrypted: { type: String, select: false },
    panMasked: String,
    gstin: String,
    /** Only the last 4 digits; the full Aadhaar number is never stored. */
    aadhaarLast4: String,
    website: String,
    social: { facebook: String, twitter: String, instagram: String, linkedin: String },
    avatarKey: String,
    /** Year the birthday greeting was last sent (prevents duplicates). */
    birthdayGreetedYear: Number,
  },
  { timestamps: true, minimize: false },
);
profileSchema.index({ userId: 1 }, { unique: true });
profileSchema.index({ dobMD: 1 });

/** "MM-DD" for a date of birth stored at UTC midnight. */
export const toDobMD = (dob?: Date | null) => (dob ? dob.toISOString().slice(5, 10) : null);

export const ProfileModel = model('Profile', profileSchema);
