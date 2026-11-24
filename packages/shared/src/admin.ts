import { z } from 'zod';
import { MOBILE_REGEX, normalizeMobile, passwordSchema, referralCodeSchema } from './auth';
import { PERMISSION_KEYS } from './permissions';

const name = z.string().trim().min(2, 'Enter a full name').max(80, 'Name is too long');
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));
const mobile = z
  .string()
  .trim()
  .transform(normalizeMobile)
  .refine((v) => MOBILE_REGEX.test(v), 'Enter a valid 10-digit Indian mobile number');
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

/* ---------------- Administrators (Super Admin) */
export const adminCreateSchema = z.object({
  name,
  email,
  mobile,
  /** Temporary password; the admin must change it at first login. */
  password: passwordSchema,
  roleIds: z.array(objectId).min(1, 'Choose at least one role'),
});
export type AdminCreateInput = z.input<typeof adminCreateSchema>;

export const adminUpdateSchema = z.object({
  name,
  email,
  mobile,
  roleIds: z.array(objectId).min(1, 'Choose at least one role'),
});
export type AdminUpdateInput = z.input<typeof adminUpdateSchema>;

export const temporaryPasswordSchema = z.object({ password: passwordSchema });

/* ---------------- Roles */
export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Enter a role name').max(60),
  description: optionalText(200),
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).min(1, 'Choose at least one permission'),
});
export type RoleInput = z.input<typeof roleSchema>;

/* ---------------- Members (Admin) */
export const memberCreateSchema = z.object({
  name,
  email,
  mobile,
  password: passwordSchema,
  referralCode: z.union([referralCodeSchema, z.literal('')]).optional(),
});
export type MemberCreateInput = z.input<typeof memberCreateSchema>;

export const addressesSchema = z.object({
  residence: optionalText(300),
  office: optionalText(300),
  billing: optionalText(300),
});

export const memberUpdateSchema = z.object({
  name,
  email,
  mobile,
  dob: z.union([z.iso.date('Enter a valid date'), z.literal('')]).optional(),
  addresses: addressesSchema.optional(),
});
export type MemberUpdateInput = z.input<typeof memberUpdateSchema>;

export const MEMBER_STATUS_ACTIONS = ['active', 'blocked', 'blacklisted'] as const;
export const statusChangeSchema = z
  .object({
    status: z.enum(MEMBER_STATUS_ACTIONS),
    reason: optionalText(300),
  })
  .refine((d) => d.status === 'active' || (d.reason && d.reason.length >= 3), {
    path: ['reason'],
    message: 'Give a reason (it is recorded in the audit log)',
  });
export type StatusChangeInput = z.input<typeof statusChangeSchema>;

export const SECURITY_CODE_TYPES = ['transaction_pin'] as const;
export type SecurityCodeType = (typeof SECURITY_CODE_TYPES)[number];

/* ---------------- Settings */
const url = z.union([z.url('Enter a full URL starting with https://'), z.literal('')]).optional();

export const generalSettingsSchema = z.object({
  siteName: z.string().trim().min(2).max(60),
  supportEmail: z.union([email, z.literal('')]).optional(),
  supportPhone: optionalText(20),
  address: optionalText(300),
  social: z.object({ facebook: url, instagram: url, linkedin: url, youtube: url, twitter: url }).partial().optional(),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

export const authSettingsSchema = z.object({
  otpChannel: z.enum(['whatsapp', 'sms']),
  otpTtlMinutes: z.coerce.number().int().min(2).max(15),
  memberIdPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, 'Use 2–4 letters'),
});
export type AuthSettings = z.infer<typeof authSettingsSchema>;

export const maintenanceSettingsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300).optional(),
});
export type MaintenanceSettings = z.infer<typeof maintenanceSettingsSchema>;

export const SETTINGS_GROUPS = ['general', 'auth', 'maintenance', 'engagement', 'commerce', 'wallet', 'earnings'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/* ---------------- Self-service */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ['newPassword'], message: 'Choose a password you haven’t used just now' });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const setPinSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your account password'),
    pin: z.string().regex(/^\d{4,6}$/, 'Use 4 to 6 digits'),
    confirmPin: z.string(),
  })
  .refine((d) => d.pin === d.confirmPin, { path: ['confirmPin'], message: 'PINs do not match' })
  .refine((d) => !/^(\d)\1+$/.test(d.pin) && !'0123456789'.includes(d.pin) && !'9876543210'.includes(d.pin), {
    path: ['pin'],
    message: 'Avoid repeated or sequential digits',
  });
export type SetPinInput = z.input<typeof setPinSchema>;
