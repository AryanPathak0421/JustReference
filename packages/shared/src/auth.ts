import { z } from 'zod';

/** Indian mobile number: 10 digits starting 6–9, optional +91 / 0 prefix is stripped by `normalizeMobile`. */
export const MOBILE_REGEX = /^[6-9]\d{9}$/;

export function normalizeMobile(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
}

export const mobileSchema = z
  .string()
  .trim()
  .transform(normalizeMobile)
  .refine((v) => MOBILE_REGEX.test(v), 'Enter a valid 10-digit Indian mobile number');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

/** Referral codes are uppercase alphanumerics; the exact format is configured server-side. */
export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{4,16}$/, 'Referral ID looks invalid');

/** Login accepts either an email address or a mobile number in one field. */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Enter your email or mobile number')
    .refine(
      (v) => v.includes('@') ? z.email().safeParse(v).success : MOBILE_REGEX.test(normalizeMobile(v)),
      'Enter a valid email or 10-digit mobile number',
    ),
  password: z.string().min(1, 'Enter your password'),
  remember: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    accountType: z.enum(['member', 'vendor']),
    name: z.string().trim().min(2, 'Enter your full name').max(80, 'Name is too long'),
    email: emailSchema,
    mobile: mobileSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    referralCode: z.union([referralCodeSchema, z.literal('')]).optional(),
    businessName: z.string().trim().max(120).optional(),
    acceptTerms: z.literal(true, { error: 'You must accept the terms to continue' }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((d) => d.accountType !== 'vendor' || (d.businessName && d.businessName.length >= 2), {
    path: ['businessName'],
    message: 'Enter your business name',
  });
export type RegisterInput = z.input<typeof registerSchema>;

export const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const forgotPasswordSchema = z.object({
  identifier: loginSchema.shape.identifier,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const verifyRegistrationSchema = z.object({
  userId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid registration'),
  code: otpSchema.shape.code,
});

export const resendOtpSchema = z.object({ userId: verifyRegistrationSchema.shape.userId });

export const resetPasswordWithCodeSchema = z
  .object({
    identifier: loginSchema.shape.identifier,
    code: otpSchema.shape.code,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
export type ResetPasswordWithCodeInput = z.infer<typeof resetPasswordWithCodeSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
