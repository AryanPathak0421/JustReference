import { z } from 'zod';
import { emailSchema, mobileSchema } from './auth';
import { GSTIN_REGEX, PAN_REGEX } from './catalog';

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const url = z.union([z.url('Enter a full URL starting with https://'), z.literal('')]).optional();
const upper = (re: RegExp, msg: string) => z.string().trim().toUpperCase().regex(re, msg);

/* ---------------- Member self-service profile (brief §9 "Profile management") */
export const memberProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(80),
  dob: z.union([z.iso.date('Enter a valid date'), z.literal('')]).optional()
    .refine((d) => !d || (new Date(d) < new Date() && new Date(d) > new Date('1900-01-01')), 'Enter a valid date of birth'),
  addresses: z.object({ residence: optionalText(300), office: optionalText(300), billing: optionalText(300) }),
  /** Write-only. Stored encrypted; responses only carry `panMasked`. */
  pan: z.union([upper(PAN_REGEX, 'Enter a valid PAN, e.g. ABCDE1234F'), z.literal('')]).optional(),
  gstin: z.union([upper(GSTIN_REGEX, 'Enter a valid 15-character GSTIN'), z.literal('')]).optional(),
  /** Only the last 4 digits of Aadhaar are ever stored (UIDAI rules discourage storing full numbers). */
  aadhaarLast4: z.union([z.string().trim().regex(/^\d{4}$/, 'Enter only the last 4 digits'), z.literal('')]).optional(),
  website: url,
  social: z.object({ facebook: url, twitter: url, instagram: url, linkedin: url }).partial().optional(),
});
export type MemberProfileInput = z.input<typeof memberProfileSchema>;

/* ---------------- Referral invitations ("Create new referral") */
export const INVITE_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export const invitationSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter their name').max(80),
    channel: z.enum(INVITE_CHANNELS),
    mobile: z.union([mobileSchema, z.literal('')]).optional(),
    email: z.union([emailSchema, z.literal('')]).optional(),
    note: optionalText(200),
  })
  .refine((d) => d.channel === 'email' || !!d.mobile, { path: ['mobile'], message: 'Enter their mobile number' })
  .refine((d) => d.channel !== 'email' || !!d.email, { path: ['email'], message: 'Enter their email address' });
export type InvitationInput = z.input<typeof invitationSchema>;

/** Daily cap on invitations per member, to prevent the feature being used for spam. */
export const DAILY_INVITE_LIMIT = 20;

/* ---------------- Engagement settings (birthday greetings & reminders) */
export const engagementSettingsSchema = z.object({
  birthdayGreetings: z.boolean(),
  birthdayReminders: z.boolean(),
  greetingChannel: z.enum(INVITE_CHANNELS),
});
export type EngagementSettings = z.infer<typeof engagementSettingsSchema>;

/* ---------------- Admin: member documents */
export const documentDecisionSchema = z.object({ status: z.enum(['approved', 'rejected']) });
