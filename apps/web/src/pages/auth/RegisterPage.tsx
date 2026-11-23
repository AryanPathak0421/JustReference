import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AtSign, Building2, Gift, Phone, Store, User } from 'lucide-react';
import { registerSchema, type RegisterInput } from '@jr/shared';
import { Alert, Button, Checkbox, Field, Input, PasswordInput } from '@/design-system';
import { register as registerAccount } from '@/features/auth/api';
import { applyFieldErrors, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const level = Math.min(4, Math.max(pw ? 1 : 0, score - 1));
  return { level, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][level] };
}

function StrengthMeter({ password }: { password: string }) {
  const { level, label } = passwordStrength(password);
  const color = ['bg-line', 'bg-danger', 'bg-warn', 'bg-brand-500', 'bg-success'][level];
  if (!password) return null;
  return (
    <div className="flex items-center gap-2.5" aria-live="polite">
      <div className="flex flex-1 gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full', i <= level ? color : 'bg-line-2')} />)}</div>
      <span className="text-[12px] font-semibold text-muted">{label}</span>
    </div>
  );
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string>();

  const { register, handleSubmit, control, setValue, setError, formState: { errors, isSubmitting } } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      accountType: params.get('type') === 'vendor' ? 'vendor' : 'member',
      name: '', email: '', mobile: '', password: '', confirmPassword: '',
      referralCode: (params.get('ref') ?? '').toUpperCase(),
      businessName: '',
    },
  });
  const accountType = useWatch({ control, name: 'accountType' });
  const password = useWatch({ control, name: 'password' }) ?? '';

  const onSubmit = async (values: RegisterInput) => {
    setFormError(undefined);
    try {
      const r = await registerAccount(values);
      navigate('/verify', { state: { userId: r.userId, otp: r.otp } });
    } catch (e) {
      if (!applyFieldErrors(e, setError)) setFormError(errorMessage(e));
    }
  };

  return (
    <>
      <h1 className="text-[28px] font-extrabold tracking-tight text-navy-950">Create your account</h1>
      <p className="mt-1.5 text-[15px] text-muted">Free to join. Takes less than a minute.</p>
      {formError && <Alert tone="danger" className="mt-5">{formError}</Alert>}

      <div role="radiogroup" aria-label="Account type" className="mt-7 grid grid-cols-2 gap-2.5">
        {([['member', User, 'Member', 'Buy, refer & earn'], ['vendor', Store, 'Vendor', 'Sell & get hired']] as const).map(([value, Icon, title, sub]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={accountType === value}
            onClick={() => setValue('accountType', value, { shouldValidate: false })}
            className={cn('flex items-center gap-3 rounded-xl border p-3.5 text-left transition', accountType === value ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-50' : 'border-line hover:border-[#cfd6e4]')}
          >
            <Icon className={cn('size-5', accountType === value ? 'text-brand-600' : 'text-subtle')} />
            <span><b className="block text-[14px]">{title}</b><span className="text-[12.5px] text-muted">{sub}</span></span>
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 grid gap-4">
        {accountType === 'vendor' && (
          <Field label="Business name" error={errors.businessName?.message} required>
            {({ id, describedBy, invalid }) => <Input id={id} leftIcon={<Building2 />} autoComplete="organization" placeholder="Your registered business name" aria-describedby={describedBy} aria-invalid={invalid} {...register('businessName')} />}
          </Field>
        )}
        <Field label="Full name" error={errors.name?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} leftIcon={<User />} autoComplete="name" placeholder="As on your PAN card" aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" error={errors.email?.message} required>
            {({ id, describedBy, invalid }) => <Input id={id} leftIcon={<AtSign />} type="email" autoComplete="email" placeholder="you@example.com" aria-describedby={describedBy} aria-invalid={invalid} {...register('email')} />}
          </Field>
          <Field label="Mobile number" error={errors.mobile?.message} required hint="We’ll send a WhatsApp/SMS code">
            {({ id, describedBy, invalid }) => <Input id={id} leftIcon={<Phone />} type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" aria-describedby={describedBy} aria-invalid={invalid} {...register('mobile')} />}
          </Field>
        </div>
        <Field label="Password" error={errors.password?.message} required hint="At least 8 characters with a letter and a number">
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" placeholder="Create a password" aria-describedby={describedBy} aria-invalid={invalid} {...register('password')} />}
        </Field>
        <StrengthMeter password={password} />
        <Field label="Confirm password" error={errors.confirmPassword?.message} required>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" placeholder="Repeat your password" aria-describedby={describedBy} aria-invalid={invalid} {...register('confirmPassword')} />}
        </Field>
        <Field label="Referral ID" error={errors.referralCode?.message} hint={params.get('ref') ? 'Applied from your invite link' : 'Optional. Enter the ID of the member who invited you'}>
          {({ id, describedBy, invalid }) => <Input id={id} leftIcon={<Gift />} placeholder="e.g. JR7K2Q" className="uppercase placeholder:normal-case" aria-describedby={describedBy} aria-invalid={invalid} {...register('referralCode')} />}
        </Field>
        <div>
          <Checkbox
            label={<>I agree to the <Link to="/terms" target="_blank" className="font-semibold text-brand-600 hover:underline">Terms &amp; Conditions</Link>, <Link to="/privacy" target="_blank" className="font-semibold text-brand-600 hover:underline">Privacy Policy</Link> and <Link to="/refund-policy" target="_blank" className="font-semibold text-brand-600 hover:underline">Refund Policy</Link>.</>}
            aria-invalid={!!errors.acceptTerms}
            {...register('acceptTerms')}
          />
          {errors.acceptTerms && <p role="alert" className="mt-1.5 ml-6.5 text-[12.5px] font-medium text-danger">{errors.acceptTerms.message}</p>}
        </div>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">Continue</Button>
      </form>

      <p className="mt-6 text-center text-[14px] text-muted">
        Already have an account? <Link to="/login" className="font-semibold text-brand-600 hover:underline">Log in</Link>
      </p>
    </>
  );
}
