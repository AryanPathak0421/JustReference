import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, MessageCircle, Smartphone } from 'lucide-react';
import type { RegisterResponse } from '@jr/shared';
import { Alert, Button } from '@/design-system';
import { resendRegistrationCode, verifyRegistration } from '@/features/auth/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { homePath } from '@/features/auth/guards';
import { DevOutboxHint } from '@/features/auth/DevOutboxHint';
import { ApiError, errorMessage } from '@/lib/api';

interface VerifyState {
  userId: string;
  otp: RegisterResponse['otp'] | null;
  notice?: string;
}

function useCountdown(initial: number) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export function VerifyPage() {
  const state = useLocation().state as VerifyState | null;
  if (!state?.userId) return <Navigate to="/register" replace />;
  return <VerifyForm {...state} />;
}

function VerifyForm({ userId, otp: initialOtp, notice }: VerifyState) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [otp, setOtp] = useState(initialOtp);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useCountdown(initialOtp?.resendInSec ?? 30);
  const inputRef = useRef<HTMLInputElement>(null);
  const ChannelIcon = otp?.channel === 'sms' ? Smartphone : MessageCircle;
  const channelName = otp?.channel === 'sms' ? 'SMS' : 'WhatsApp';

  useEffect(() => inputRef.current?.focus(), []);

  const verify = async () => {
    if (code.length !== 6) return setError('Enter the 6-digit code');
    setBusy(true);
    try {
      const r = await verifyRegistration(userId, code);
      signIn(r);
      toast.success('Welcome to JustReference!', { description: r.user.memberId ? `Your member ID is ${r.user.memberId}.` : undefined });
      navigate(homePath(r.user), { replace: true });
    } catch (e) {
      setError(e instanceof ApiError && e.fields?.code ? e.fields.code : errorMessage(e));
      if (e instanceof ApiError && e.status === 404) navigate('/register', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const r = await resendRegistrationCode(userId);
      setOtp(r.otp);
      setResendIn(r.otp.resendInSec);
      setCode('');
      toast.success('A new code is on its way');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OTP_COOLDOWN') setResendIn(Number(e.details?.retryAfterSec ?? 30));
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <Link to="/register" className="mb-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink"><ArrowLeft className="size-4" />Back</Link>
      <span className="grid size-12 place-items-center rounded-2xl bg-success-50 text-success"><ChannelIcon className="size-6" /></span>
      <h1 className="mt-4 text-[28px] font-extrabold tracking-tight text-navy-950">Verify your mobile</h1>
      {notice && <Alert tone="info" className="mt-4">{notice}</Alert>}
      <p className="mt-2 text-[15px] text-muted">
        Enter the 6-digit code we sent by {channelName}{otp ? <> to <b className="text-ink">{otp.target}</b></> : null}.
        {otp && otp.expiresInSec > 0 && <> It expires in {Math.round(otp.expiresInSec / 60)} minutes.</>}
      </p>

      <form className="mt-6" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
        <label htmlFor="otp" className="sr-only">6-digit code</label>
        <input
          id="otp"
          ref={inputRef}
          value={code}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(undefined); }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="••••••"
          aria-invalid={!!error}
          aria-describedby={error ? 'otp-error' : undefined}
          className="h-16 w-full rounded-xl border border-line text-center font-mono text-[28px] font-bold tracking-[0.55em] indent-[0.55em] outline-none placeholder:text-line focus:border-brand-500 focus:ring-4 focus:ring-brand-50 aria-[invalid=true]:border-danger"
        />
        {error && <p id="otp-error" role="alert" className="mt-2 text-[12.5px] font-medium text-danger">{error}</p>}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>Verify &amp; continue</Button>
      </form>
      <p className="mt-5 text-center text-[14px] text-muted">
        Didn’t get it?{' '}
        {resendIn > 0
          ? <span className="font-semibold text-subtle">Resend in 0:{String(resendIn).padStart(2, '0')}</span>
          : <button type="button" onClick={resend} className="font-semibold text-brand-600 hover:underline">Resend code</button>}
      </p>
      <DevOutboxHint />
    </>
  );
}
