import { Schema, model, Types, type ClientSession } from 'mongoose';

/* ---------------- Settings: one document per group */
const settingSchema = new Schema(
  {
    group: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false },
);
settingSchema.index({ group: 1 }, { unique: true });
export const SettingModel = model('Setting', settingSchema);

/* ---------------- Counters for gap-free human-readable IDs */
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } }, { versionKey: false });
export const CounterModel = model('Counter', counterSchema);

export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
  return doc.seq;
}

/* ---------------- Dev outbox: where the console messaging driver "sends" OTPs and emails */
const devMessageSchema = new Schema(
  {
    channel: { type: String, required: true },
    to: { type: String, required: true },
    subject: String,
    body: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
devMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86_400 });
export const DevMessageModel = model('DevMessage', devMessageSchema);
