import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Ban, CheckCircle2, KeyRound, LogOut, ShieldOff, UserX } from 'lucide-react';
import { memberUpdateSchema, type MemberDetail, type MemberUpdateInput } from '@jr/shared';
import {
  Alert, Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton,
  StatusBadge, Textarea,
} from '@/design-system';
import { getMember, resetMemberPin, revokeMemberSessions, updateMember } from '@/features/admin/api';
import { StatusDialog, type StatusAction } from '@/features/admin/StatusDialog';
import { Can, useAuth } from '@/features/auth/AuthProvider';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';
import { MemberKycCard } from './MemberExtrasPages';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export function MemberDetailPage({ panelKey }: { panelKey: PanelKey }) {
  const { id = '' } = useParams();
  const panel = PANELS[panelKey];
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin', 'member', id], queryFn: () => getMember(id) });
  const crumbs = [{ label: panel.label, to: panel.base }, { label: 'Members', to: `${panel.base}/members${panelKey === 'admin' ? '/all' : ''}` }, { label: data?.name ?? 'Member' }];

  if (error instanceof ApiError && error.status === 404) {
    return <><PageHeader breadcrumbs={crumbs} title="Member not found" /><Card><EmptyState icon={UserX} title="This member doesn’t exist" description="They may have been removed, or the link is wrong." /></Card></>;
  }
  if (error) return <><PageHeader breadcrumbs={crumbs} title="Member" /><Card><ErrorState onRetry={() => refetch()} /></Card></>;
  if (isLoading || !data) {
    return <div className="grid gap-5"><Skeleton className="h-16 w-80" /><Skeleton className="h-40" /><Skeleton className="h-80" /></div>;
  }
  return <Detail member={data} panelKey={panelKey} crumbs={crumbs} />;
}

function Detail({ member: m, crumbs, panelKey }: { member: MemberDetail; panelKey: PanelKey; crumbs: { label: string; to?: string }[] }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [action, setAction] = useState<StatusAction | null>(null);
  const restricted = m.status === 'blocked' || m.status === 'blacklisted';
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'member', m.id] });

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={crumbs}
        title={<span className="flex items-center gap-3"><Avatar name={m.name} size={40} />{m.name}</span>}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={m.status} /><span className="font-mono">{m.memberId ?? 'Not verified'}</span>· joined {fmt(m.createdAt)}</span>}
        actions={can('members.status') && (
          <>
            {restricted
              ? <Button size="sm" leftIcon={<CheckCircle2 className="size-4" />} onClick={() => setAction('active')}>Allow</Button>
              : <Button size="sm" variant="outline" leftIcon={<ShieldOff className="size-4" />} onClick={() => setAction('blocked')}>Block</Button>}
            {m.status !== 'blacklisted' && <Button size="sm" variant="danger" leftIcon={<Ban className="size-4" />} onClick={() => setAction('blacklisted')}>Blacklist</Button>}
          </>
        )}
      />

      {restricted && m.statusReason && <Alert tone="danger" title={`This member is ${m.status}`}>Reason: {m.statusReason}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Referral ID', <span className="font-mono">{m.referralCode ?? '—'}</span>],
          ['Referred by', m.sponsor ? <>{m.sponsor.name} <span className="font-mono text-[12px] text-muted">{m.sponsor.memberId}</span></> : 'Joined directly'],
          ['Direct referrals', m.directReferrals],
          ['Last login', fmt(m.lastLoginAt)],
        ].map(([label, value]) => (
          <Card key={label as string} className="p-4">
            <div className="text-[12.5px] text-muted">{label}</div>
            <div className="mt-1 text-[15px] font-semibold text-ink">{value}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
        <ProfileForm member={m} onSaved={refresh} />
        <div className="grid content-start gap-5">
          <Card className="p-5">
            <CardHeader title="Security" />
            <ul className="grid gap-3 text-[14px]">
              <li className="flex items-center justify-between gap-3">
                <span>Mobile number</span>
                <Badge tone={m.mobileVerified ? 'green' : 'amber'}>{m.mobileVerified ? 'Verified' : 'Not verified'}</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>Transaction PIN</span>
                <span className="flex items-center gap-2">
                  <Badge tone={m.hasTransactionPin ? 'green' : 'neutral'}>{m.hasTransactionPin ? 'Set' : 'Not set'}</Badge>
                  <Can perm="members.security">
                    {m.hasTransactionPin && (
                      <ConfirmDialog
                        title="Reset transaction PIN?"
                        description={`${m.name} will need to set a new PIN before their next wallet transaction. Do this only after verifying their identity.`}
                        confirmLabel="Reset PIN"
                        tone="danger"
                        onConfirm={async () => { await resetMemberPin(m.id); toast.success('Transaction PIN reset'); refresh(); }}
                        trigger={(open) => <Button variant="ghost" size="sm" leftIcon={<KeyRound className="size-3.5" />} onClick={open}>Reset</Button>}
                      />
                    )}
                  </Can>
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>Signed-in devices</span>
                <span className="flex items-center gap-2">
                  <b>{m.activeSessions}</b>
                  <Can perm="members.status">
                    {m.activeSessions > 0 && (
                      <ConfirmDialog
                        title={`Sign ${m.name} out everywhere?`}
                        description="All their devices will be signed out. Their account stays active."
                        confirmLabel="Sign out"
                        onConfirm={async () => { const r = await revokeMemberSessions(m.id); toast.success(`Signed out ${r.revoked} device(s)`); refresh(); }}
                        trigger={(open) => <Button variant="ghost" size="sm" leftIcon={<LogOut className="size-3.5" />} onClick={open}>Sign out</Button>}
                      />
                    )}
                  </Can>
                </span>
              </li>
            </ul>
          </Card>
          <MemberKycCard memberUserId={m.id} memberId={m.memberId} panelBase={PANELS[panelKey].base} />
        </div>
      </div>

      <StatusDialog member={m} action={action} onClose={() => setAction(null)} />
    </div>
  );
}

function ProfileForm({ member: m, onSaved }: { member: MemberDetail; onSaved: () => void }) {
  const { can } = useAuth();
  const editable = can('members.edit');
  const defaults: MemberUpdateInput = {
    name: m.name, email: m.email, mobile: m.mobile, dob: m.dob ?? '',
    addresses: { residence: m.addresses?.residence ?? '', office: m.addresses?.office ?? '', billing: m.addresses?.billing ?? '' },
  };
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<MemberUpdateInput>({
    resolver: zodResolver(memberUpdateSchema),
    defaultValues: defaults,
  });
  useEffect(() => reset(defaults), [m]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (v: MemberUpdateInput) => {
    try {
      await updateMember(m.id, v);
      toast.success('Profile saved');
      onSaved();
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };

  return (
    <Card className="p-5">
      <CardHeader title="Profile" description={editable ? 'Changes are recorded in the audit log. Changing the mobile number marks it unverified.' : 'You can view but not edit member profiles.'} />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.name?.message} required className="sm:col-span-2">
            {({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('name')} />}
          </Field>
          <Field label="Email" error={errors.email?.message} required>
            {({ id, invalid }) => <Input id={id} type="email" aria-invalid={invalid} {...register('email')} />}
          </Field>
          <Field label="Mobile number" error={errors.mobile?.message} required>
            {({ id, invalid }) => <Input id={id} type="tel" inputMode="numeric" aria-invalid={invalid} {...register('mobile')} />}
          </Field>
          <Field label="Date of birth" error={errors.dob?.message}>
            {({ id, invalid }) => <Input id={id} type="date" max={new Date().toISOString().slice(0, 10)} aria-invalid={invalid} {...register('dob')} />}
          </Field>
          <div className="hidden sm:block" />
          <Field label="Residence address" error={errors.addresses?.residence?.message} className="sm:col-span-2">
            {({ id }) => <Textarea id={id} className="min-h-18" {...register('addresses.residence')} />}
          </Field>
          <Field label="Office address" error={errors.addresses?.office?.message}>
            {({ id }) => <Textarea id={id} className="min-h-18" {...register('addresses.office')} />}
          </Field>
          <Field label="Billing address" error={errors.addresses?.billing?.message}>
            {({ id }) => <Textarea id={id} className="min-h-18" {...register('addresses.billing')} />}
          </Field>
        </fieldset>
        {editable && (
          <div className="mt-5 flex gap-2">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save changes</Button>
            {isDirty && <Button variant="ghost" onClick={() => reset(defaults)}>Discard</Button>}
          </div>
        )}
      </form>
    </Card>
  );
}
