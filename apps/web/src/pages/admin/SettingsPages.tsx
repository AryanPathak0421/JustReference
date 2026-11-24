import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Construction, Power } from 'lucide-react';
import {
  authSettingsSchema, generalSettingsSchema, type AuthSettings, type EngagementSettings, type GeneralSettings, type MaintenanceSettings,
} from '@jr/shared';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, ErrorState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea } from '@/design-system';
import { getSettings, saveAuth, saveEngagement, saveGeneral, saveMaintenance } from '@/features/admin/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { applyFieldErrors, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

/* ======================================================================= Website settings */

export function SettingsPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const [tab, setTab] = useState<'general' | 'auth' | 'engagement'>('general');
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Website settings' }]}
        title="Website settings"
        description="Site details, support contacts and sign-up rules. Every change is recorded in the audit log."
        actions={<Segmented label="Settings section" value={tab} onChange={setTab} options={[{ value: 'general', label: 'General' }, { value: 'auth', label: 'Sign-up & OTP' }, { value: 'engagement', label: 'Birthdays' }]} />}
      />
      {tab === 'general' ? <GeneralForm /> : tab === 'auth' ? <AuthForm /> : <EngagementForm />}
      <Card className="p-5">
        <CardHeader title="Other settings" />
        <p className="text-[13.5px] text-muted">Payments, messaging channels and commission rules have their own screens in the Super Admin panel.</p>
      </Card>
    </div>
  );
}

function EngagementForm() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useSettings<EngagementSettings>('engagement');
  const [v, setV] = useState<EngagementSettings>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setV(data); }, [data]);
  if (error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  if (isLoading || !v) return <Skeleton className="h-56" />;
  const editable = can('settings.edit');
  const dirty = JSON.stringify(v) !== JSON.stringify(data);
  return (
    <Card className="p-6">
      <CardHeader title="Birthday greetings & reminders" description="Runs every morning after 9:00 IST. Each member is greeted once per year." />
      <fieldset disabled={!editable} className="grid max-w-xl gap-4">
        <Checkbox label="Send members a birthday greeting" checked={v.birthdayGreetings} onChange={(e) => setV({ ...v, birthdayGreetings: e.target.checked })} />
        <Checkbox label="Remind each member’s direct sponsor about their referral’s birthday" checked={v.birthdayReminders} onChange={(e) => setV({ ...v, birthdayReminders: e.target.checked })} />
        <Field label="Send by" hint="Delivered once this channel is connected.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} value={v.greetingChannel} onChange={(e) => setV({ ...v, greetingChannel: e.target.value as EngagementSettings['greetingChannel'] })}>
              <option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option>
            </Select>
          )}
        </Field>
      </fieldset>
      {editable && (
        <Button className="mt-5" disabled={!dirty} loading={busy} onClick={async () => {
          setBusy(true);
          try { qc.setQueryData(['settings', 'engagement'], await saveEngagement(v)); toast.success('Saved'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
        }}>Save settings</Button>
      )}
    </Card>
  );
}

function useSettings<T>(group: 'general' | 'auth' | 'maintenance' | 'engagement') {
  return useQuery({ queryKey: ['settings', group], queryFn: () => getSettings<T>(group) });
}

function GeneralForm() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useSettings<GeneralSettings>('general');
  const form = useForm<GeneralSettings>({ resolver: zodResolver(generalSettingsSchema) });
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = form;
  useEffect(() => { if (data) reset({ ...data, social: { facebook: '', instagram: '', linkedin: '', youtube: '', twitter: '', ...data.social } }); }, [data, reset]);

  if (error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  if (isLoading) return <Skeleton className="h-96" />;

  const onSubmit = async (v: GeneralSettings) => {
    try {
      const saved = await saveGeneral(v);
      qc.setQueryData(['settings', 'general'], saved);
      qc.invalidateQueries({ queryKey: ['public-status'] });
      toast.success('Settings saved');
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };
  const editable = can('settings.edit');

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          {!editable && <Alert tone="info" className="sm:col-span-2">You can view these settings but not change them.</Alert>}
          <Field label="Site name" error={errors.siteName?.message} required className="sm:col-span-2">
            {({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('siteName')} />}
          </Field>
          <Field label="Support email" error={errors.supportEmail?.message}>
            {({ id, invalid }) => <Input id={id} type="email" aria-invalid={invalid} {...register('supportEmail')} />}
          </Field>
          <Field label="Support phone" error={errors.supportPhone?.message}>
            {({ id, invalid }) => <Input id={id} type="tel" aria-invalid={invalid} {...register('supportPhone')} />}
          </Field>
          <Field label="Office address" error={errors.address?.message} className="sm:col-span-2">
            {({ id }) => <Textarea id={id} className="min-h-18" {...register('address')} />}
          </Field>
          <h3 className="mt-2 text-[14px] font-bold sm:col-span-2">Social links</h3>
          {(['facebook', 'instagram', 'linkedin', 'youtube', 'twitter'] as const).map((k) => (
            <Field key={k} label={k === 'twitter' ? 'X (Twitter)' : k[0]!.toUpperCase() + k.slice(1)} error={errors.social?.[k]?.message}>
              {({ id, invalid }) => <Input id={id} type="url" placeholder="https://" aria-invalid={invalid} {...register(`social.${k}`)} />}
            </Field>
          ))}
        </fieldset>
        {editable && <div className="mt-5"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save settings</Button></div>}
      </form>
    </Card>
  );
}

function AuthForm() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useSettings<AuthSettings>('auth');
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<AuthSettings>({ resolver: zodResolver(authSettingsSchema) as never });
  useEffect(() => { if (data) reset(data); }, [data, reset]);

  if (error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  if (isLoading) return <Skeleton className="h-72" />;

  const onSubmit = async (v: AuthSettings) => {
    try {
      qc.setQueryData(['settings', 'auth'], await saveAuth(v));
      toast.success('Sign-up settings saved');
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };
  const editable = can('settings.edit');

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset disabled={!editable} className="grid max-w-xl gap-4">
          <Field label="Send verification codes by" error={errors.otpChannel?.message} hint="Delivered once this channel is connected.">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} {...register('otpChannel')}>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
              </Select>
            )}
          </Field>
          <Field label="Code expiry (minutes)" error={errors.otpTtlMinutes?.message} hint="Between 2 and 15 minutes">
            {({ id, invalid, describedBy }) => <Input id={id} type="number" min={2} max={15} aria-invalid={invalid} aria-describedby={describedBy} {...register('otpTtlMinutes')} />}
          </Field>
          <Field label="Member ID prefix" error={errors.memberIdPrefix?.message} hint="2–4 letters. Applies to new members only, e.g. JR0004812.">
            {({ id, invalid, describedBy }) => <Input id={id} maxLength={4} className="uppercase" aria-invalid={invalid} aria-describedby={describedBy} {...register('memberIdPrefix')} />}
          </Field>
        </fieldset>
        {editable && <div className="mt-5"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save settings</Button></div>}
      </form>
    </Card>
  );
}

/* ======================================================================= Maintenance */

export function MaintenancePage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useSettings<MaintenanceSettings>('maintenance');
  const [message, setMessage] = useState('');
  useEffect(() => { if (data) setMessage(data.message ?? ''); }, [data]);

  const save = async (enabled: boolean) => {
    try {
      const saved = await saveMaintenance({ enabled, message: message.trim() });
      qc.setQueryData(['settings', 'maintenance'], saved);
      qc.invalidateQueries({ queryKey: ['public-status'] });
      toast.success(enabled ? 'Maintenance mode is ON' : saved.enabled ? 'Message updated' : 'Maintenance mode is OFF');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Maintenance mode' }]}
        title="Maintenance mode"
        description="Temporarily close the site to members, vendors and visitors. Admins can still log in and work."
      />
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading || !data ? <Skeleton className="h-72" /> : (
        <Card className="max-w-2xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className={`grid size-11 place-items-center rounded-xl ${data.enabled ? 'bg-warn-50 text-warn' : 'bg-success-50 text-success'}`}><Construction className="size-5" /></span>
              <div>
                <p className="text-[15px] font-bold">The site is {data.enabled ? 'in maintenance' : 'open'}</p>
                <p className="text-[13px] text-muted">{data.enabled ? 'Visitors see the message below.' : 'Everyone can use the site normally.'}</p>
              </div>
            </div>
            <Badge tone={data.enabled ? 'amber' : 'green'}>{data.enabled ? 'ON' : 'OFF'}</Badge>
          </div>
          <Field label="Message shown to visitors" className="mt-6" hint="Keep it short. Say when you expect to be back.">
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-24" />}
          </Field>
          <div className="mt-5 flex flex-wrap gap-2">
            {data.enabled ? (
              <>
                <ConfirmDialog
                  title="Turn maintenance mode off?"
                  description="The site will reopen for everyone immediately."
                  confirmLabel="Reopen site"
                  onConfirm={() => save(false)}
                  trigger={(open) => <Button leftIcon={<Power className="size-4" />} onClick={open}>Turn off &amp; reopen</Button>}
                />
                <Button variant="outline" onClick={() => save(true)} disabled={message === (data.message ?? '')}>Update message</Button>
              </>
            ) : (
              <ConfirmDialog
                title="Turn maintenance mode on?"
                description="Members, vendors and visitors will see the maintenance message and can’t use the site until you turn it off. Admins are not affected."
                confirmLabel="Turn on"
                tone="danger"
                onConfirm={() => save(true)}
                trigger={(open) => <Button variant="danger" leftIcon={<Power className="size-4" />} onClick={open}>Turn on maintenance mode</Button>}
              />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
