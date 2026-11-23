import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CheckCircle2, Circle, Eye, FileText, Landmark, Send, Trash2, Upload } from 'lucide-react';
import {
  bankAccountSchema, BUSINESS_TYPES, DOCUMENT_LABELS, DOCUMENT_TYPES, REQUIRED_VENDOR_DOCUMENTS, vendorProfileSchema,
  type BankAccountInput, type DocumentType, type VendorProfileInput, type VendorSelf,
} from '@jr/shared';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from '@/design-system';
import {
  deleteDocument, getMyVendor, myDocumentBlob, openBlob, saveMyBank, saveMyProfile, submitForApproval, uploadDocument, uploadLogo,
} from '@/features/vendor/api';
import { VendorLogo } from '@/features/catalog/components';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

const KEY = ['vendor', 'me'];
const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: 'Sole proprietorship', partnership: 'Partnership', llp: 'LLP', private_limited: 'Private limited company', public_limited: 'Public limited company', other: 'Other',
};

export function BusinessProfilePage() {
  const { data: v, isLoading, error, refetch } = useQuery({ queryKey: KEY, queryFn: getMyVendor });
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Vendor', to: '/vendor' }, { label: 'Business profile' }]}
        title="Business profile & verification"
        description="Complete your details and KYC so buyers can trust your business. Your listings go live after approval."
        actions={v && <StatusBadge status={v.status === 'pending' ? 'pending_approval' : v.status === 'approved' ? 'approved' : v.status} />}
      />
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading || !v ? <Skeleton className="h-96" /> : <Profile v={v} />}
    </div>
  );
}

function StatusBanner({ v }: { v: VendorSelf }) {
  if (v.status === 'approved') return <Alert tone="success" title="Your business is verified">Your approved listings are visible to buyers. Changing your business name, PAN or GSTIN will send your profile for re-verification.</Alert>;
  if (v.status === 'pending') return <Alert tone="info" title="Waiting for review">Our team is checking your details and documents. This usually takes 1–2 working days. You can keep preparing listings meanwhile.</Alert>;
  if (v.status === 'rejected') return <Alert tone="danger" title="Changes needed">{v.statusReason ?? 'Please update your details and submit again.'}</Alert>;
  if (v.status === 'suspended') return <Alert tone="danger" title="Account suspended">{v.statusReason ?? 'Your listings are hidden. Contact support for help.'}</Alert>;
  return <Alert tone="warn" title="Finish setting up your business">Complete the three steps below, then submit for approval. You can create draft listings now.</Alert>;
}

function Profile({ v }: { v: VendorSelf }) {
  const qc = useQueryClient();
  const set = (next: VendorSelf) => qc.setQueryData(KEY, next);
  const c = v.checklist;
  const steps = [
    { done: c.profile, label: 'Business details & PAN', href: '#details' },
    { done: c.bank, label: 'Bank account for payouts', href: '#bank' },
    { done: c.documents.length === 0, label: 'KYC documents', href: '#documents' },
  ];
  const ready = steps.every((s) => s.done);
  const canSubmit = v.status === 'draft' || v.status === 'rejected';

  return (
    <>
      <StatusBanner v={v} />
      {canSubmit && (
        <Card className="p-5">
          <CardHeader title="Get verified" description="Complete each step, then submit for approval." />
          <ol className="grid gap-2 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.label}>
                <a href={s.href} className={cn('flex items-center gap-2.5 rounded-xl border p-3 text-[14px] transition hover:bg-canvas', s.done ? 'border-[#bfe8d7] bg-success-50/60' : 'border-line')}>
                  {s.done ? <CheckCircle2 className="size-5 flex-none text-success" /> : <Circle className="size-5 flex-none text-subtle" />}
                  <span><span className="text-[12px] text-muted">Step {i + 1}</span><br /><b className="font-semibold">{s.label}</b></span>
                </a>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              disabled={!ready}
              leftIcon={<Send className="size-4" />}
              onClick={async () => {
                try { set(await submitForApproval()); toast.success('Submitted for approval'); } catch (e) { toast.error(errorMessage(e)); }
              }}
            >
              Submit for approval
            </Button>
            {!ready && <span className="text-[13px] text-muted">Complete all steps to submit.</span>}
          </div>
        </Card>
      )}
      <DetailsForm v={v} onSaved={set} />
      <BankForm v={v} onSaved={set} />
      <Documents v={v} onChange={set} />
    </>
  );
}

function DetailsForm({ v, onSaved }: { v: VendorSelf; onSaved: (v: VendorSelf) => void }) {
  const defaults: VendorProfileInput = {
    businessName: v.businessName, businessType: v.businessType as VendorProfileInput['businessType'], category: v.category, description: v.description,
    officeAddress: v.officeAddress, residenceAddress: v.residenceAddress ?? '', city: v.city, state: v.state, pincode: v.pincode, pan: '', gstin: v.gstin ?? '', website: v.website ?? '',
    social: { facebook: '', instagram: '', linkedin: '', youtube: '', twitter: '', ...v.social },
  };
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<VendorProfileInput>({ resolver: zodResolver(vendorProfileSchema), defaultValues: defaults });
  useEffect(() => reset(defaults), [v.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const logoRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  const onSubmit = async (input: VendorProfileInput) => {
    if (!v.panMasked && !input.pan) return setError('pan', { message: 'Enter your PAN' });
    try {
      const next = await saveMyProfile(input);
      onSaved(next);
      reset({ ...input, pan: '' });
      toast.success(next.status === 'pending' && v.status === 'approved' ? 'Saved: your profile was sent for re-verification' : 'Business details saved');
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };

  return (
    <Card id="details" className="scroll-mt-24 p-6">
      <CardHeader title="Business details" description="Shown on your public vendor profile (except PAN, addresses marked private, and bank details)." />
      <div className="mb-5 flex items-center gap-4">
        <VendorLogo vendor={{ name: v.businessName, logoUrl: v.logoUrl }} size={64} />
        <div>
          <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setLogoBusy(true);
            try { onSaved(await uploadLogo(f)); toast.success('Logo updated'); } catch (err) { toast.error(errorMessage(err)); } finally { setLogoBusy(false); }
          }} />
          <Button variant="outline" size="sm" loading={logoBusy} leftIcon={<Upload className="size-4" />} onClick={() => logoRef.current?.click()}>{v.logoUrl ? 'Change logo' : 'Upload logo'}</Button>
          <p className="mt-1 text-[12px] text-muted">Square JPG, PNG or WebP, up to 5 MB.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" error={errors.businessName?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('businessName')} />}</Field>
        <Field label="Business type" error={errors.businessType?.message} required>
          {({ id }) => <Select id={id} {...register('businessType')}>{BUSINESS_TYPES.map((t) => <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t]}</option>)}</Select>}
        </Field>
        <Field label="What does your business do?" error={errors.category?.message} required hint="e.g. Solar installation, Interior design" className="sm:col-span-2">{({ id, invalid, describedBy }) => <Input id={id} aria-invalid={invalid} aria-describedby={describedBy} {...register('category')} />}</Field>
        <Field label="About your business" error={errors.description?.message} className="sm:col-span-2">{({ id }) => <Textarea id={id} maxLength={1500} {...register('description')} />}</Field>
        <Field label="Office / business address" error={errors.officeAddress?.message} required className="sm:col-span-2">{({ id, invalid }) => <Textarea id={id} className="min-h-18" aria-invalid={invalid} {...register('officeAddress')} />}</Field>
        <Field label="City" error={errors.city?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('city')} />}</Field>
        <Field label="State" error={errors.state?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('state')} />}</Field>
        <Field label="PIN code" error={errors.pincode?.message} required>{({ id, invalid }) => <Input id={id} inputMode="numeric" maxLength={6} aria-invalid={invalid} {...register('pincode')} />}</Field>
        <Field label="Residence address (private)" error={errors.residenceAddress?.message} hint="Never shown publicly">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} {...register('residenceAddress')} />}</Field>
        <Field label="PAN" error={errors.pan?.message} required={!v.panMasked} hint={v.panMasked ? `On file: ${v.panMasked}. Enter a new PAN only to change it.` : 'Stored encrypted. Only the last characters are ever shown.'}>
          {({ id, invalid, describedBy }) => <Input id={id} className="uppercase" maxLength={10} autoComplete="off" placeholder={v.panMasked ?? 'ABCDE1234F'} aria-invalid={invalid} aria-describedby={describedBy} {...register('pan')} />}
        </Field>
        <Field label="GSTIN" error={errors.gstin?.message} hint="Optional if you’re not GST-registered">{({ id, invalid, describedBy }) => <Input id={id} className="uppercase" maxLength={15} aria-invalid={invalid} aria-describedby={describedBy} {...register('gstin')} />}</Field>
        <Field label="Website" error={errors.website?.message} className="sm:col-span-2">{({ id, invalid }) => <Input id={id} type="url" placeholder="https://" aria-invalid={invalid} {...register('website')} />}</Field>
        {(['facebook', 'instagram', 'linkedin', 'youtube'] as const).map((k) => (
          <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)} error={errors.social?.[k]?.message}>{({ id, invalid }) => <Input id={id} type="url" placeholder="https://" aria-invalid={invalid} {...register(`social.${k}`)} />}</Field>
        ))}
        <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save business details</Button></div>
      </form>
    </Card>
  );
}

function BankForm({ v, onSaved }: { v: VendorSelf; onSaved: (v: VendorSelf) => void }) {
  const [editing, setEditing] = useState(!v.bank);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<BankAccountInput>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: { holderName: v.bank?.holderName ?? '', accountNumber: '', confirmAccountNumber: '', ifsc: v.bank?.ifsc ?? '', bankName: v.bank?.bankName ?? '', branchAddress: v.bank?.branchAddress ?? '' },
  });
  const onSubmit = async (input: BankAccountInput) => {
    try {
      onSaved(await saveMyBank(input));
      reset({ ...input, accountNumber: '', confirmAccountNumber: '' });
      setEditing(false);
      toast.success('Bank account saved');
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };
  return (
    <Card id="bank" className="scroll-mt-24 p-6">
      <CardHeader title="Bank account" description="Where your earnings and payouts are sent. Encrypted; only the last 4 digits are ever shown." />
      {!editing && v.bank ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-4">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><Landmark className="size-5" /></span>
          <div className="flex-1 text-[14px]">
            <b>{v.bank.bankName} ••••{v.bank.accountLast4}</b>
            <p className="text-muted">{v.bank.holderName} · IFSC {v.bank.ifsc}</p>
            <p className="text-[13px] text-muted">{v.bank.branchAddress}</p>
          </div>
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
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={isSubmitting}>Save bank account</Button>
            {v.bank && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </form>
      )}
    </Card>
  );
}

function Documents({ v, onChange }: { v: VendorSelf; onChange: (v: VendorSelf) => void }) {
  const [type, setType] = useState<DocumentType>(v.checklist.documents[0] ?? 'pan_card');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const missing = new Set(v.checklist.documents);

  return (
    <Card id="documents" className="scroll-mt-24 p-6">
      <CardHeader title="KYC documents" description="PDF, JPG or PNG up to 8 MB. Stored privately: only you and our verification team can see them." />
      <div className="mb-4 flex flex-wrap gap-2">
        {REQUIRED_VENDOR_DOCUMENTS.map((t) => (
          <Badge key={t} tone={missing.has(t) ? 'amber' : 'green'}>{missing.has(t) ? <Circle className="size-3" /> : <CheckCircle2 className="size-3" />}{DOCUMENT_LABELS[t]} (required)</Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Document type">{({ id }) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value as DocumentType)} className="w-60">
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOCUMENT_LABELS[t]}</option>)}
          </Select>
        )}</Field>
        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 8 * 1024 * 1024) return void toast.error('That file is larger than 8 MB');
          setBusy(true);
          try { onChange(await uploadDocument(type, f)); toast.success(`${DOCUMENT_LABELS[type]} uploaded`); }
          catch (err) { toast.error(err instanceof ApiError && err.fields?.file ? err.fields.file : errorMessage(err)); }
          finally { setBusy(false); }
        }} />
        <Button loading={busy} leftIcon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Upload file</Button>
      </div>
      {v.documents.length > 0 && (
        <ul className="mt-5 divide-y divide-line-2 rounded-xl border border-line">
          {v.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText className="size-5 text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{DOCUMENT_LABELS[d.type]}</p>
                <p className="truncate text-[12.5px] text-muted">{d.name} · {(d.size / 1024).toFixed(0)} KB · {new Date(d.uploadedAt).toLocaleDateString('en-IN')}</p>
              </div>
              <StatusBadge status={d.status} />
              <Button variant="ghost" size="sm" leftIcon={<Eye className="size-3.5" />} onClick={() => openBlob(() => myDocumentBlob(d.id), d.name).catch((e) => toast.error(errorMessage(e)))}>View</Button>
              {!(d.status === 'approved' && v.status === 'approved') && (
                <ConfirmDialog
                  title="Remove this document?" description={`${DOCUMENT_LABELS[d.type]} (${d.name}) will be deleted.`} confirmLabel="Remove" tone="danger"
                  onConfirm={async () => { try { onChange(await deleteDocument(d.id)); } catch (e) { toast.error(errorMessage(e)); } }}
                  trigger={(open) => <Button variant="ghost" size="sm" aria-label={`Remove ${d.name}`} onClick={open}><Trash2 className="size-3.5" /></Button>}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
