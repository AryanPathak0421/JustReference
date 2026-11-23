import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AtSign } from 'lucide-react';
import { loginSchema, type LoginInput, type RegisterResponse } from '@jr/shared';
import { Alert, Button, Checkbox, Field, Input, PasswordInput } from '@/design-system';
import { login } from '@/features/auth/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { homePath, safeNext } from '@/features/auth/guards';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '', remember: true },
  });

  const onSubmit = async (values: LoginInput) => {
    setFormError(undefined);
    try {
      const r = await login(values);
      signIn(r);
      navigate(safeNext(params.get('next'), r.user) ?? homePath(r.user), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERIFICATION_REQUIRED') {
        const d = e.details as { userId: string; otp: RegisterResponse['otp'] };
        navigate('/verify', { state: { userId: d.userId, otp: d.otp, notice: 'Verify your mobile number to finish creating your account.' } });
        return;
      }
      if (!applyFieldErrors(e, setError)) setFormError(errorMessage(e));
    }
  };

  return (
    <>
      <h1 className="text-[28px] font-extrabold tracking-tight text-navy-950">Welcome back</h1>
      <p className="mt-1.5 text-[15px] text-muted">Log in with your email address or mobile number.</p>

      {params.get('reset') === '1' && <Alert tone="success" className="mt-6">Your password has been reset. Log in with your new password.</Alert>}
      {formError && <Alert tone="danger" className="mt-6">{formError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-7 grid gap-4.5">
        <Field label="Email or mobile number" error={errors.identifier?.message} required>
          {({ id, describedBy, invalid }) => (
            <Input id={id} leftIcon={<AtSign />} autoComplete="username" inputMode="email" placeholder="you@example.com or 98765 43210" aria-describedby={describedBy} aria-invalid={invalid} {...register('identifier')} />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message} required labelAside={<Link to="/forgot-password" className="text-[13px] font-semibold text-brand-600 hover:underline">Forgot password?</Link>}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput id={id} autoComplete="current-password" placeholder="Your password" aria-describedby={describedBy} aria-invalid={invalid} {...register('password')} />
          )}
        </Field>
        <Checkbox label="Keep me signed in on this device" {...register('remember')} />
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1 w-full">Log in</Button>
      </form>

      <p className="mt-6 text-center text-[14px] text-muted">
        New to JustReference? <Link to="/register" className="font-semibold text-brand-600 hover:underline">Create a free account</Link>
      </p>
    </>
  );
}
