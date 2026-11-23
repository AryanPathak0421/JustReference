import { Schema, model } from 'mongoose';
import { INVITE_CHANNELS } from '@jr/shared';

/** "Create new referral": an invitation a member sends to someone they know. */
const invitationSchema = new Schema(
  {
    sponsorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 80 },
    channel: { type: String, enum: INVITE_CHANNELS, required: true },
    mobile: String,
    email: String,
    status: { type: String, enum: ['sent', 'joined'], default: 'sent' },
    joinedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    joinedAt: Date,
  },
  { timestamps: true },
);
invitationSchema.index({ sponsorUserId: 1, createdAt: -1 });
invitationSchema.index({ mobile: 1, status: 1 });
invitationSchema.index({ email: 1, status: 1 });
export const InvitationModel = model('Invitation', invitationSchema);

/** Lock/marker so scheduled jobs run once per period even with several API instances. */
const jobRunSchema = new Schema(
  {
    key: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    result: Schema.Types.Mixed,
  },
  { versionKey: false },
);
jobRunSchema.index({ key: 1 }, { unique: true });
jobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });
export const JobRunModel = model('JobRun', jobRunSchema);
