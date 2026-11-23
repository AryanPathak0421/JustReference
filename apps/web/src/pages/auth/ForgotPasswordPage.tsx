import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, AtSign, KeyRound } from 'lucide-react';
import { forgotPasswordSchema, resetPasswordWithCodeSchema, type ForgotPasswordInput, type ResetPasswordWithCodeInput } from '@jr/shared';
import { Alert, Button, Field, Input, PasswordInput } from '@/design-system';
import { requestPasswordReset, resetPassword } from '@/features/auth/api';
import { DevOutboxHint } from '@/features/auth/DevOutboxHint';
import { applyFieldErrors, errorMessage } from '@/lib/api';

export function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState<string>();

  return (
    <>
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" />Back to log in</Link>
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600"><KeyRound className="size-6" /></span>
      <h1 className="mt-4 text-[28px] font-extrabold tracking-tight text-navy-950">Reset your password</h1>
      {identifier ? <ResetStep identifier={identifier} onRestart={() => setIdentifier(undefined)} /> : <RequestStep onSent={setIdentifier} />}
    </>
  );
}

function RequestStep({ onSent }: { onSent: (identifier: string) => void }) {
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { identifier: '' },
  });
  const onSubmit = async (values: ForgotPasswordInput) => {
    setFormError(undefined);
    try {
      await requestPasswordReset(values);
      onSent(values.identifier);
    } catch (e) {
      if (!applyFieldErrors(e, setError)) setFormError(errorMessage(e));
    }
  };
  return (
    <>
      <p className="mt-1.5 text-[15px] text-muted">Enter the email or mobile number on your account and we’ll send you a 6-digit reset code.</p>
      {formError && <Alert tone="danger" className="mt-5">{formError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 grid gap-4.5">
        <Field label="Email or mobile number" error={errors.identifier?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} leftIcon={<AtSign />} autoComplete="username" placeholder="you@example.com or 98765 43210" aria-describedby={describedBy} aria-invalid={invalid} {...register('identifier')} />}
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">Send reset code</Button>
      </form>
    </>
  );
}

function ResetStep({ identifier, onRestart }: { identifier: string; onRestart: () => void }) {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ResetPasswordWithCodeInput>({
    resolver: zodResolver(resetPasswordWithCodeSchema),
    defaultValues: { identifier, code: '', password: '', confirmPassword: '' },
  });
  const onSubmit = async (values: ResetPasswordWithCodeInput) => {
    setFormError(undefined);
    try {
      await resetPassword(values);
      navigate('/login?reset=1', { replace: true });
    } catch (e) {
      if (!applyFieldErrors(e, setError)) setFormError(errorMessage(e));
    }
  };
  return (
    <>
      {/* Deliberately generic so this form can't be used to discover which accounts exist. */}
      <p className="mt-1.5 text-[15px] text-muted">
        If an account matches <b className="text-ink">{identifier}</b>, we’ve sent a reset code. Enter it below with your new password.
      </p>
      {formError && <Alert tone="danger" className="mt-5">{formError}</Alert>}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 grid gap-4">
        <Field label="Reset code" error={errors.code?.message} required>
          {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" className="tracking-[0.3em]" aria-describedby={describedBy} aria-invalid={invalid} {...register('code')} />}
        </Field>
        <Field label="New password" error={errors.password?.message} hint="At least 8 characters with a letter and a number" required>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...register('password')} />}
        </Field>
        <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} {...register('confirmPassword')} />}
        </Field>
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">Reset password</Button>
      </form>
      <p className="mt-5 text-center text-[14px] text-muted">
        Didn’t get a code? <button type="button" onClick={onRestart} className="font-semibold text-brand-600 hover:underline">Try again</button>
      </p>
      <DevOutboxHint />
    </>
  );
}
