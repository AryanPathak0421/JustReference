import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { changePasswordSchema, setPinSchema, type ChangePasswordInput, type SetPinInput } from '@jr/shared';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, Field, Input, PageHeader, PasswordInput, Skeleton } from '@/design-system';
import { changePassword, getSecurity, listSessions, revokeOtherSessions, revokeSession, setTransactionPin } from '@/features/admin/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { applyFieldErrors, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

function deviceName(ua: string) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Android|iPhone|Mobile/.test(ua) };
}
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function PasswordCard() {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const onSubmit = async (v: ChangePasswordInput) => {
    try {
      const r = await changePassword(v);
      setUser(r.user);
      reset();
      qc.invalidateQueries({ queryKey: ['me', 'sessions'] });
      toast.success('Password changed', { description: r.signedOutOtherSessions ? `Signed out ${r.signedOutOtherSessions} other device(s).` : undefined });
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };
  return (
    <Card className="p-6">
      <CardHeader title="Password" description="Changing your password signs you out on your other devices." />
      {user?.mustChangePassword && (
        <Alert tone="warn" title="Set your own password to continue" className="mb-5">
          You signed in with a temporary password. Choose a new one before using the rest of the app.
        </Alert>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid max-w-md gap-4">
        <Field label={user?.mustChangePassword ? 'Temporary password' : 'Current password'} error={errors.currentPassword?.message} required>
          {({ id, invalid }) => <PasswordInput id={id} autoComplete="current-password" aria-invalid={invalid} {...register('currentPassword')} />}
        </Field>
        <Field label="New password" error={errors.newPassword?.message} hint="At least 8 characters with a letter and a number" required>
          {({ id, invalid, describedBy }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} aria-describedby={describedBy} {...register('newPassword')} />}
        </Field>
        <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
          {({ id, invalid }) => <PasswordInput id={id} autoComplete="new-password" aria-invalid={invalid} {...register('confirmPassword')} />}
        </Field>
        <div><Button type="submit" loading={isSubmitting}>Change password</Button></div>
      </form>
    </Card>
  );
}

function PinCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['me', 'security'], queryFn: getSecurity });
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<SetPinInput>({
    resolver: zodResolver(setPinSchema),
    defaultValues: { currentPassword: '', pin: '', confirmPin: '' },
  });
  const onSubmit = async (v: SetPinInput) => {
    try {
      await setTransactionPin(v);
      reset();
      qc.invalidateQueries({ queryKey: ['me', 'security'] });
      toast.success('Transaction PIN saved');
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };
  const isSet = data?.transactionPin.isSet;
  return (
    <Card className="p-6">
      <CardHeader
        title="Transaction PIN"
        description="A 4–6 digit PIN you’ll enter to confirm wallet transfers and withdrawals."
        actions={isLoading ? <Skeleton className="h-6 w-20" /> : <Badge tone={isSet ? 'green' : 'amber'}>{isSet ? 'Set' : 'Not set'}</Badge>}
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid max-w-md gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isSet ? 'New PIN' : 'PIN'} error={errors.pin?.message} required>
            {({ id, invalid }) => <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} aria-invalid={invalid} {...register('pin')} />}
          </Field>
          <Field label="Confirm PIN" error={errors.confirmPin?.message} required>
            {({ id, invalid }) => <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} aria-invalid={invalid} {...register('confirmPin')} />}
          </Field>
        </div>
        <Field label="Account password" error={errors.currentPassword?.message} hint="To confirm it’s you" required>
          {({ id, invalid, describedBy }) => <PasswordInput id={id} autoComplete="current-password" aria-invalid={invalid} aria-describedby={describedBy} {...register('currentPassword')} />}
        </Field>
        <div><Button type="submit" loading={isSubmitting} leftIcon={<KeyRound className="size-4" />}>{isSet ? 'Change PIN' : 'Set PIN'}</Button></div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['me', 'sessions'], queryFn: listSessions });
  const refresh = () => qc.invalidateQueries({ queryKey: ['me', 'sessions'] });
  const revoke = useMutation({ mutationFn: revokeSession, onSuccess: () => { toast.success('Device signed out'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const others = (data?.data.length ?? 0) - 1;

  return (
    <Card className="p-6">
      <CardHeader
        title="Signed-in devices"
        description="Sign out any device you don’t recognise."
        actions={others > 0 && (
          <ConfirmDialog
            title="Sign out all other devices?"
            description={`This ends ${others} other session${others === 1 ? '' : 's'}. You’ll stay signed in here.`}
            confirmLabel="Sign out others"
            tone="danger"
            onConfirm={async () => { const r = await revokeOtherSessions(); toast.success(`Signed out ${r.revoked} device(s)`); refresh(); }}
            trigger={(open) => <Button variant="outline" size="sm" leftIcon={<LogOut className="size-4" />} onClick={open}>Sign out others</Button>}
          />
        )}
      />
      {error ? <ErrorState onRetry={() => refetch()} /> : (
        <ul className="divide-y divide-line-2">
          {isLoading ? Array.from({ length: 2 }, (_, i) => <li key={i} className="py-3"><Skeleton className="h-10 w-full" /></li>) : data?.data.map((s) => {
            const d = deviceName(s.userAgent);
            const Icon = d.mobile ? Smartphone : Monitor;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="grid size-10 place-items-center rounded-xl bg-canvas text-ink-2"><Icon className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14px] font-semibold">{d.label}{s.current && <Badge tone="green">This device</Badge>}</p>
                  <p className="text-[12.5px] text-muted">Signed in {when(s.createdAt)} · last active {when(s.lastUsedAt)}{s.ip ? ` · ${s.ip}` : ''}</p>
                </div>
                {!s.current && <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function AccountSettingsPage({ panelKey }: { panelKey: PanelKey }) {
  const { user } = useAuth();
  const panel = PANELS[panelKey];
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Account & security' }]}
        title="Account & security"
        description={user ? `${user.name} · ${user.email} · ${user.mobile}` : undefined}
        actions={<Badge tone="navy"><ShieldCheck className="size-3.5" />{user?.memberId ?? panel.label}</Badge>}
      />
      <PasswordCard />
      {!user?.mustChangePassword && (
        <>
          {user?.roles.includes('member') && <PinCard />}
          <SessionsCard />
        </>
      )}
    </div>
  );
}
