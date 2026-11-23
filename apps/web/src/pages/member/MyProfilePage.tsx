import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Camera, Eye, FileText, Info, Landmark, Trash2, Upload } from 'lucide-react';
import {
  bankAccountSchema, DOCUMENT_LABELS, MEMBER_DOCUMENT_TYPES, memberProfileSchema,
  type BankAccountInput, type DocumentType, type MemberProfile, type MemberProfileInput,
} from '@jr/shared';
import { Alert, Avatar, Button, Card, CardHeader, Checkbox, ConfirmDialog, ErrorState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from '@/design-system';
import { deleteMyDocument, getMyProfile, myDocumentBlob, saveMyBank, saveMyProfile, uploadAvatar, uploadMyDocument } from '@/features/members/api';
import { CompletionMeter } from '@/features/members/components';
import { openBlob } from '@/features/vendor/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

const KEY = ['me', 'profile'];

export function MyProfilePage({ panelKey = 'member' }: { panelKey?: PanelKey }) {
  const panel = PANELS[panelKey];
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: KEY, queryFn: getMyProfile });
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Profile' }]} title="My profile"
        description="Your details, bank account for payouts and KYC documents. Sensitive numbers are stored encrypted." />
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading || !p ? <Skeleton className="h-96" /> : <Profile p={p} />}
    </div>
  );
}

function Profile({ p }: { p: MemberProfile }) {
  const qc = useQueryClient();
  const { setUser, user } = useAuth();
  const set = (next: MemberProfile) => {
    qc.setQueryData(KEY, next);
    qc.invalidateQueries({ queryKey: ['me', 'referral-summary'] });
    if (user && next.name !== user.name) setUser({ ...user, name: next.name });
  };
  const avatarRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Card className="flex flex-wrap items-center gap-5 p-5">
        <div className="relative">
          {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="size-20 rounded-full border border-line object-cover" /> : <Avatar name={p.name} size={80} />}
          <button type="button" aria-label="Change profile photo" onClick={() => avatarRef.current?.click()} disabled={busy}
            className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full border-2 border-white bg-navy-900 text-white hover:bg-navy-700"><Camera className="size-4" /></button>
          <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            setBusy(true);
            try { set(await uploadAvatar(f)); toast.success('Photo updated'); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
          }} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold tracking-tight">{p.name}</h2>
          <p className="text-[13.5px] text-muted">Member ID <b className="font-mono text-ink">{p.memberId}</b> · Referral ID <b className="font-mono text-ink">{p.referralCode}</b></p>
          <p className="text-[13px] text-muted">{p.sponsor ? <>Referred by {p.sponsor.name} ({p.sponsor.memberId})</> : 'Joined directly'} · member since {new Date(p.joinedAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
        </div>
        {p.completion.percent === 100 && <div className="w-full sm:w-72"><CompletionMeter completion={p.completion} compact /></div>}
      </Card>
      {p.completion.percent < 100 && (
        <Card className="p-5"><CardHeader title="Complete your profile" description="A complete profile is needed before you can receive payouts." /><CompletionMeter completion={p.completion} /></Card>
      )}
      <PersonalForm p={p} onSaved={set} />
      <BankCard p={p} onSaved={set} />
      <DocumentsCard p={p} onChange={set} />
    </>
  );
}

function PersonalForm({ p, onSaved }: { p: MemberProfile; onSaved: (p: MemberProfile) => void }) {
  const defaults: MemberProfileInput = {
    name: p.name, dob: p.dob ?? '', addresses: { residence: p.addresses.residence ?? '', office: p.addresses.office ?? '', billing: p.addresses.billing ?? '' },
    pan: '', gstin: p.gstin ?? '', aadhaarLast4: p.aadhaarLast4 ?? '', website: p.website ?? '',
    social: { facebook: '', twitter: '', instagram: '', linkedin: '', ...p.social },
  };
  const { register, handleSubmit, reset, setValue, getValues, setError, formState: { errors, isSubmitting, isDirty } } = useForm<MemberProfileInput>({ resolver: zodResolver(memberProfileSchema), defaultValues: defaults });
  useEffect(() => reset(defaults), [p.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sameBilling, setSameBilling] = useState(false);

  const onSubmit = async (v: MemberProfileInput) => {
    try { const next = await saveMyProfile(v); onSaved(next); reset({ ...v, pan: '' }); toast.success('Profile saved'); }
    catch (e) { if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e)); }
  };

  return (
    <Card className="p-6">
      <CardHeader title="Personal details" />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.name?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('name')} />}</Field>
        <Field label="Date of birth" error={errors.dob?.message} hint="We’ll send you birthday wishes">{({ id, invalid, describedBy }) => <Input id={id} type="date" max={new Date().toISOString().slice(0, 10)} aria-invalid={invalid} aria-describedby={describedBy} {...register('dob')} />}</Field>
        <div className="grid gap-1.5 sm:col-span-2 sm:grid-cols-2 sm:gap-4">
          <div><p className="text-[13.5px] font-semibold text-ink-2">Email</p><p className="mt-1.5 flex h-11 items-center rounded-[10px] bg-canvas px-3.5 text-[14.5px] text-muted">{p.email}</p></div>
          <div><p className="text-[13.5px] font-semibold text-ink-2">Mobile</p><p className="mt-1.5 flex h-11 items-center gap-2 rounded-[10px] bg-canvas px-3.5 text-[14.5px] text-muted">{p.mobile}{p.mobileVerified && <StatusBadge status="approved" />}</p></div>
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted sm:col-span-2"><Info className="size-3.5" />To change your email or mobile number, contact support so we can verify the new one.</p>
        </div>
        <Field label="Residence address" error={errors.addresses?.residence?.message} className="sm:col-span-2">{({ id }) => <Textarea id={id} className="min-h-18" {...register('addresses.residence', { onChange: (e) => sameBilling && setValue('addresses.billing', e.target.value, { shouldDirty: true }) })} />}</Field>
        <Field label="Office address" error={errors.addresses?.office?.message}>{({ id }) => <Textarea id={id} className="min-h-18" {...register('addresses.office')} />}</Field>
        <div className="grid gap-1.5">
          <Field label="Billing address" error={errors.addresses?.billing?.message}>{({ id }) => <Textarea id={id} className="min-h-18" disabled={sameBilling} {...register('addresses.billing')} />}</Field>
          <Checkbox label="Same as residence address" checked={sameBilling} onChange={(e) => { setSameBilling(e.target.checked); if (e.target.checked) setValue('addresses.billing', getValues('addresses.residence') ?? '', { shouldDirty: true }); }} />
        </div>
        <Field label="PAN" error={errors.pan?.message} hint={p.panMasked ? `On file: ${p.panMasked}. Enter a new PAN only to change it.` : 'Stored encrypted. Needed for TDS on earnings.'}>
          {({ id, invalid, describedBy }) => <Input id={id} className="uppercase" maxLength={10} autoComplete="off" placeholder={p.panMasked ?? 'ABCDE1234F'} aria-invalid={invalid} aria-describedby={describedBy} {...register('pan')} />}
        </Field>
        <Field label="GSTIN" error={errors.gstin?.message} hint="Only if you’re GST-registered">{({ id, invalid, describedBy }) => <Input id={id} className="uppercase" maxLength={15} aria-invalid={invalid} aria-describedby={describedBy} {...register('gstin')} />}</Field>
        <Field label="Aadhaar: last 4 digits" error={errors.aadhaarLast4?.message} hint="For safety we never store your full Aadhaar number">{({ id, invalid, describedBy }) => <Input id={id} inputMode="numeric" maxLength={4} autoComplete="off" aria-invalid={invalid} aria-describedby={describedBy} {...register('aadhaarLast4')} />}</Field>
        <Field label="Website" error={errors.website?.message}>{({ id, invalid }) => <Input id={id} type="url" placeholder="https://" aria-invalid={invalid} {...register('website')} />}</Field>
        {(['facebook', 'twitter', 'instagram', 'linkedin'] as const).map((k) => (
          <Field key={k} label={k === 'twitter' ? 'X (Twitter)' : k[0]!.toUpperCase() + k.slice(1)} error={errors.social?.[k]?.message}>{({ id, invalid }) => <Input id={id} type="url" placeholder="https://" aria-invalid={invalid} {...register(`social.${k}`)} />}</Field>
        ))}
        <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save details</Button></div>
      </form>
    </Card>
  );
}

function BankCard({ p, onSaved }: { p: MemberProfile; onSaved: (p: MemberProfile) => void }) {
  const [editing, setEditing] = useState(!p.bank);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<BankAccountInput>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: { holderName: p.bank?.holderName ?? p.name, accountNumber: '', confirmAccountNumber: '', ifsc: p.bank?.ifsc ?? '', bankName: p.bank?.bankName ?? '', branchAddress: p.bank?.branchAddress ?? '' },
  });
  const onSubmit = async (v: BankAccountInput) => {
    try { onSaved(await saveMyBank(v)); reset({ ...v, accountNumber: '', confirmAccountNumber: '' }); setEditing(false); toast.success('Bank account saved'); }
    catch (e) { if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e)); }
  };
  return (
    <Card className="p-6">
      <CardHeader title="Bank account" description="Where your earnings and withdrawals are paid. Encrypted; only the last 4 digits are shown." />
      {!editing && p.bank ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-4">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><Landmark className="size-5" /></span>
          <div className="flex-1 text-[14px]"><b>{p.bank.bankName} ••••{p.bank.accountLast4}</b><p className="text-muted">{p.bank.holderName} · IFSC {p.bank.ifsc}</p><p className="text-[13px] text-muted">{p.bank.branchAddress}</p></div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Change account</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Account holder name" error={errors.holderName?.message} required className="sm:col-span-2">{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('holderName')} />}</Field>
          <Field label="Account number" error={errors.accountNumber?.message} required>{({ id, invalid }) => <Input id={id} inputMode="numeric" autoComplete="off" aria-invalid={invalid} {...register('accountNumber')} />}</Field>
          <Field label="Confirm account number" error={errors.confirmAccountNumber?.message} required>{({ id, invalid }) => <Input id={id} inputMode="numeric" autoComplete="off" onPaste={(e) => e.preventDefault()} aria-invalid={invalid} {...register('confirmAccountNumber')} />}</Field>
          <Field label="IFSC" error={errors.ifsc?.message} required>{({ id, invalid }) => <Input id={id} className="uppercase" maxLength={11} aria-invalid={invalid} {...register('ifsc')} />}</Field>
          <Field label="Bank name" error={errors.bankName?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('bankName')} />}</Field>
          <Field label="Branch address" error={errors.branchAddress?.message} required className="sm:col-span-2">{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('branchAddress')} />}</Field>
          <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={isSubmitting}>Save bank account</Button>{p.bank && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}</div>
        </form>
      )}
    </Card>
  );
}

function DocumentsCard({ p, onChange }: { p: MemberProfile; onChange: (p: MemberProfile) => void }) {
  const [type, setType] = useState<DocumentType>('aadhaar');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Card className="p-6">
      <CardHeader title="KYC documents" description="PDF, JPG or PNG up to 8 MB. Stored privately: only you and our verification team can open them." />
      <Alert tone="info" className="mb-4">For Aadhaar, upload a <b>masked Aadhaar</b> (only the last 4 digits visible). You can download one from the UIDAI website.</Alert>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Document type">{({ id }) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value as DocumentType)} className="w-60">
            {MEMBER_DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>)}
          </Select>
        )}</Field>
        <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          if (f.size > 8 * 1024 * 1024) return void toast.error('That file is larger than 8 MB');
          setBusy(true);
          try { onChange(await uploadMyDocument(type, f)); toast.success(`${DOCUMENT_LABELS[type]} uploaded`); }
          catch (err) { toast.error(err instanceof ApiError && err.fields?.file ? err.fields.file : errorMessage(err)); }
          finally { setBusy(false); }
        }} />
        <Button loading={busy} leftIcon={<Upload className="size-4" />} onClick={() => ref.current?.click()}>Upload file</Button>
      </div>
      {p.documents.length > 0 && (
        <ul className="mt-5 divide-y divide-line-2 rounded-xl border border-line">
          {p.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText className="size-5 text-brand-600" />
              <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">{DOCUMENT_LABELS[d.type]}</p><p className="truncate text-[12.5px] text-muted">{d.name} · {(d.size / 1024).toFixed(0)} KB</p></div>
              <StatusBadge status={d.status} />
              <Button variant="ghost" size="sm" leftIcon={<Eye className="size-3.5" />} onClick={() => openBlob(() => myDocumentBlob(d.id), d.name).catch((e) => toast.error(errorMessage(e)))}>View</Button>
              {d.status !== 'approved' && (
                <ConfirmDialog title="Remove this document?" description={`${DOCUMENT_LABELS[d.type]} (${d.name}) will be deleted.`} confirmLabel="Remove" tone="danger"
                  onConfirm={async () => { try { onChange(await deleteMyDocument(d.id)); } catch (e) { toast.error(errorMessage(e)); } }}
                  trigger={(open) => <Button variant="ghost" size="sm" aria-label={`Remove ${d.name}`} onClick={open}><Trash2 className="size-3.5" /></Button>} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
