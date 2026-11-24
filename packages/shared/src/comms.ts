import { z } from 'zod';
import { emailSchema } from './auth';
import { ROLES, type TicketStatus } from './enums';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Choose an option');
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const attachments = z.array(objectId).max(5, 'At most 5 files').default([]);
const link = z.union([z.literal(''), z.string().trim().regex(/^(\/(?!\/)|https:\/\/)[^\s]*$/, 'Use a path like /products or an https:// link').max(300)]).optional();

/* ---------------- Notifications */
export const NOTIFICATION_EVENTS = ['registration', 'order', 'payment', 'referral', 'commission', 'wallet', 'support', 'message', 'bid', 'account'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const EXTERNAL_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type ExternalChannel = (typeof EXTERNAL_CHANNELS)[number];
const channelSet = z.object({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean() });
/** Per event: which channels carry it, besides the in-app notification that is always created. */
export const notificationSettingsSchema = z.object({
  events: z.object(Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, channelSet])) as Record<NotificationEvent, typeof channelSet>),
  /** Wrapped around every outgoing text. {title}, {body}, {name}, {site} and {link} are filled in. */
  template: z.string().trim().min(6).max(500).refine((t) => t.includes('{title}') || t.includes('{body}'), 'Include {title} or {body}'),
  emailSubject: z.string().trim().min(3).max(120),
});
export type NotificationSettings = z.output<typeof notificationSettingsSchema>;
export const testMessageSchema = z.object({ channel: z.enum(EXTERNAL_CHANNELS) });

/* ---------------- Messages */
export const messageSchema = z.object({
  /** Member ID or email of the recipient (admins only). Empty = the JustReference team. */
  to: optionalText(120),
  subject: z.string().trim().min(2, 'Enter a subject').max(120),
  body: z.string().trim().min(2, 'Write a message').max(5000),
  attachments,
  replyTo: objectId.optional(),
  draft: z.boolean().default(false),
});
export type MessageInput = z.input<typeof messageSchema>;

/* ---------------- Tickets */
export const TICKET_CATEGORIES = ['order', 'payment', 'wallet', 'account', 'vendor', 'technical', 'other'] as const;
export const TICKET_PRIORITIES = ['normal', 'high', 'urgent'] as const;
export const ticketSchema = z.object({
  subject: z.string().trim().min(5, 'Write a short subject (at least 5 characters)').max(120),
  category: z.enum(TICKET_CATEGORIES),
  body: z.string().trim().min(10, 'Describe the problem (at least 10 characters)').max(5000),
  attachments,
});
export type TicketInput = z.input<typeof ticketSchema>;
export const ticketReplySchema = z.object({ body: z.string().trim().min(2, 'Write a reply').max(5000), attachments });
export const ticketUpdateSchema = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(), priority: z.enum(TICKET_PRIORITIES).optional() });
export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80), email: emailSchema,
  subject: z.string().trim().min(5, 'Write a short subject').max(120), body: z.string().trim().min(10, 'Write your message (at least 10 characters)').max(3000),
  /** Hidden field people leave empty; bots fill it in. */
  website: z.string().max(200).optional(),
});
export type ContactInput = z.input<typeof contactSchema>;

/* ---------------- Feedback */
export const feedbackSchema = z.object({ rating: z.coerce.number().int().min(1, 'Choose 1 to 5 stars').max(5), comment: z.string().trim().max(1000).default('') });
export const feedbackDecisionSchema = z.object({ status: z.enum(['published', 'hidden']) });

/* ---------------- Content */
export const CMS_PAGES = ['about', 'how-it-works', 'referral', 'privacy', 'terms', 'refund-policy'] as const;
export type CmsPageKey = (typeof CMS_PAGES)[number];
export const cmsPageSchema = z.object({ title: z.string().trim().min(2, 'Enter a title').max(100), body: z.string().trim().max(30_000), published: z.boolean() })
  .refine((p) => !p.published || p.body.length >= 20, { path: ['body'], message: 'Write the page before publishing it' });
export const postSchema = z.object({ title: z.string().trim().min(5, 'Enter a title').max(120), excerpt: z.string().trim().min(10, 'Write a short summary').max(240), body: z.string().trim().min(20, 'Write the post').max(30_000), published: z.boolean() });
export const testimonialSchema = z.object({ name: z.string().trim().min(2).max(60), role: z.string().trim().min(2).max(80), quote: z.string().trim().min(10).max(400), active: z.boolean() });
export const announcementSchema = z.object({ title: z.string().trim().min(3, 'Enter a title').max(120), body: z.string().trim().min(3, 'Write the announcement').max(2000), audience: z.array(z.enum(ROLES)).min(1, 'Choose who sees it'), pinned: z.boolean(), active: z.boolean() });
export const adSchema = z.object({ title: z.string().trim().min(3, 'Enter a title').max(100), text: z.string().trim().max(240).default(''), link, placement: z.enum(['member', 'home']), validFrom: z.iso.date(), validTo: z.iso.date(), active: z.boolean() })
  .refine((a) => a.validFrom <= a.validTo, { path: ['validTo'], message: 'Must be after the start date' });
export const reauthSchema = z.object({ password: z.string().min(1, 'Enter your password').max(200) });

/* ---------------- Reports */
export const REPORTS = {
  credit: 'Credit report', debit: 'Debit report', wallet: 'Wallet report', earnings: 'Commission earnings', tds: 'TDS report', withdrawals: 'Withdrawal report', purchases: 'Purchase report',
  sales: 'Sales report', invoices: 'Invoice report', settlements: 'Vendor payment report', rewards: 'Rewards report', members: 'Member report',
} as const;
export type ReportKey = keyof typeof REPORTS;
export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];

/* ---------------- Response types */
export interface AttachmentInfo { id: string; name: string; mime: string; size: number }
export interface NotificationRow { id: string; event: NotificationEvent; title: string; body: string; link: string | null; read: boolean; createdAt: string }
export interface MessageRow { id: string; subject: string; body: string; from: string; to: string; fromMe: boolean; read: boolean; draft: boolean; createdAt: string; attachments: AttachmentInfo[]; replyTo: string | null; toAddress: string | null; canReply: boolean }
export interface TicketRow { id: string; ticketNo: string; subject: string; category: string; priority: string; status: TicketStatus; createdAt: string; updatedAt: string; user: { name: string; memberId?: string; guest: boolean; email?: string } }
export interface TicketDetail extends TicketRow { messages: { id: string; from: string; staff: boolean; body: string; createdAt: string; attachments: AttachmentInfo[] }[] }
export interface FeedbackRow { id: string; orderNo: string; vendor: string; buyer: string; rating: number; comment: string; status: string; createdAt: string }
export interface CmsPage { key: string; title: string; body: string; published: boolean; updatedAt: string | null }
export interface PostRow { id: string; slug: string; title: string; excerpt: string; body: string; published: boolean; publishedAt: string | null }
export interface TestimonialRow { id: string; name: string; role: string; quote: string; active: boolean }
export interface AnnouncementRow { id: string; title: string; body: string; audience: string[]; pinned: boolean; active: boolean; createdAt: string }
export interface AdRow { id: string; title: string; text: string; link: string; placement: string; validFrom: string; validTo: string; active: boolean }
export interface ReportColumn { key: string; label: string; money?: boolean; date?: boolean; number?: boolean }
export interface ReportResult { title: string; columns: ReportColumn[]; data: Record<string, string | number | null>[]; meta: { page: number; pageSize: number; total: number }; totals: Record<string, number>; limited: boolean }
export interface SearchHit { group: string; title: string; sub: string; to: string }
export interface AdminStats {
  members: number; membersThisMonth: number; vendors: number; vendorsPending: number; products: number; services: number; projects: number; listingsPending: number; referralsThisMonth: number; referredPct: number; openTickets: number; projectRequestsPending: number; feedbackPending: number;
  growth: { month: string; members: number; vendors: number }[]; recent: { id: string; name: string; role: string; memberId: string | null; sponsor: string | null; status: string; date: string }[];
  topVendors: { name: string; orders: number; valuePaise: number }[]; topCategories: { name: string; orders: number; valuePaise: number }[];
}
export interface HealthView { database: { ok: boolean; pingMs: number; name: string }; uptimeSeconds: number; memoryMb: number; node: string; jobs: { key: string; at: string | null }[]; messaging: Record<ExternalChannel, boolean>; messagingDriver: string; payments: string; storage: string; version: string }
