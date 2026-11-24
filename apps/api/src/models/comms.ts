import { Schema, model, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_EVENTS, ROLES, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '@jr/shared';

const oid = Schema.Types.ObjectId;

const notificationSchema = new Schema(
  { userId: { type: oid, ref: 'User', required: true }, event: { type: String, enum: NOTIFICATION_EVENTS, required: true }, title: { type: String, required: true }, body: { type: String, default: '' }, link: String, readAt: { type: Date, default: null }, key: { type: String, required: true } },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, key: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
export const NotificationModel = model('Notification', notificationSchema);

/** Uploaded files for messages and tickets. Private: served only to the uploader, the recipient or staff. */
const attachmentSchema = new Schema({ ownerUserId: { type: oid, ref: 'User', required: true }, key: { type: String, required: true }, name: { type: String, required: true }, mime: { type: String, required: true }, size: { type: Number, required: true } }, { timestamps: true });
attachmentSchema.index({ ownerUserId: 1, createdAt: -1 });
export const AttachmentModel = model('Attachment', attachmentSchema);

/** `toUserId: null` = the JustReference team (any administrator with messages.manage). */
const messageSchema = new Schema(
  {
    fromUserId: { type: oid, ref: 'User', required: true }, toUserId: { type: oid, ref: 'User', default: null }, fromStaff: { type: Boolean, default: false }, subject: { type: String, required: true }, body: { type: String, required: true },
    attachments: [{ type: oid, ref: 'Attachment' }], replyTo: { type: oid, ref: 'Message', default: null }, draft: { type: Boolean, default: false }, toText: String, readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
messageSchema.index({ toUserId: 1, draft: 1, createdAt: -1 });
messageSchema.index({ fromUserId: 1, draft: 1, createdAt: -1 });
messageSchema.index({ attachments: 1 });
export type Message = InferSchemaType<typeof messageSchema>;
export const MessageModel = model('Message', messageSchema);

const ticketSchema = new Schema(
  {
    ticketNo: { type: String, required: true }, userId: { type: oid, ref: 'User', default: null }, guest: { type: { _id: false, name: String, email: String }, default: undefined }, subject: { type: String, required: true },
    category: { type: String, enum: TICKET_CATEGORIES, required: true }, priority: { type: String, enum: TICKET_PRIORITIES, default: 'normal' }, status: { type: String, enum: TICKET_STATUSES, default: 'open' },
    messages: [{ userId: { type: oid, ref: 'User', default: null }, from: String, staff: Boolean, body: String, attachments: [{ type: oid, ref: 'Attachment' }], at: Date }],
  },
  { timestamps: true },
);
ticketSchema.index({ ticketNo: 1 }, { unique: true });
ticketSchema.index({ userId: 1, updatedAt: -1 });
ticketSchema.index({ status: 1, updatedAt: -1 });
ticketSchema.index({ 'messages.attachments': 1 });
export type Ticket = InferSchemaType<typeof ticketSchema>;
export const TicketModel = model('Ticket', ticketSchema);

const feedbackSchema = new Schema(
  { orderId: { type: oid, ref: 'Order', required: true }, orderNo: String, buyerUserId: { type: oid, ref: 'User', required: true }, vendorId: { type: oid, ref: 'Vendor', required: true }, rating: { type: Number, required: true, min: 1, max: 5 }, comment: { type: String, default: '' }, status: { type: String, enum: ['pending', 'published', 'hidden'], default: 'pending' } },
  { timestamps: true },
);
feedbackSchema.index({ orderId: 1 }, { unique: true });
feedbackSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
feedbackSchema.index({ status: 1, createdAt: -1 });
export const FeedbackModel = model('Feedback', feedbackSchema);

const cmsSchema = new Schema({ key: { type: String, required: true }, title: { type: String, required: true }, body: { type: String, default: '' }, published: { type: Boolean, default: false } }, { timestamps: true });
cmsSchema.index({ key: 1 }, { unique: true });
export const CmsPageModel = model('CmsPage', cmsSchema);

const postSchema = new Schema({ slug: { type: String, required: true }, title: { type: String, required: true }, excerpt: { type: String, required: true }, body: { type: String, required: true }, published: { type: Boolean, default: false }, publishedAt: Date }, { timestamps: true });
postSchema.index({ slug: 1 }, { unique: true });
postSchema.index({ published: 1, publishedAt: -1 });
export const PostModel = model('BlogPost', postSchema);

export const TestimonialModel = model('Testimonial', new Schema({ name: { type: String, required: true }, role: { type: String, required: true }, quote: { type: String, required: true }, active: { type: Boolean, default: false } }, { timestamps: true }));

const announcementSchema = new Schema({ title: { type: String, required: true }, body: { type: String, required: true }, audience: [{ type: String, enum: ROLES }], pinned: { type: Boolean, default: false }, active: { type: Boolean, default: true } }, { timestamps: true });
announcementSchema.index({ active: 1, audience: 1, pinned: -1, createdAt: -1 });
export const AnnouncementModel = model('Announcement', announcementSchema);

const adSchema = new Schema({ title: { type: String, required: true }, text: String, link: String, placement: { type: String, enum: ['member', 'home'], required: true }, validFrom: { type: String, required: true }, validTo: { type: String, required: true }, active: { type: Boolean, default: true } }, { timestamps: true });
adSchema.index({ placement: 1, active: 1, validTo: 1 });
export const AdModel = model('Advertisement', adSchema);
