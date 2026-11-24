import { useState, type ReactNode } from 'react';
import { useNavigate, useLocation, Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Info, ShoppingCart } from 'lucide-react';
import { addressSchema, INDIAN_STATES, type AddressInput, type ListingDetail, type PaymentPlan } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '@/design-system';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage } from '@/lib/api';
import { addToCart } from './api';

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const TestBadge = () => <Badge tone="amber">Test payment</Badge>;

/* ---------------------------------------------------------------- Address */
export const EMPTY_ADDRESS = { name: '', mobile: '', line1: '', line2: '', city: '', state: '' as never, pincode: '' };
export const useAddressForm = () => useForm<AddressInput>({ resolver: zodResolver(addressSchema, undefined, { raw: true }), defaultValues: EMPTY_ADDRESS });

export function AddressFields({ form }: { form: UseFormReturn<AddressInput> }) {
  const { register, formState: { errors: e } } = form;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" error={e.name?.message} required>{({ id, invalid }) => <Input id={id} autoComplete="name" aria-invalid={invalid} {...register('name')} />}</Field>
      <Field label="Mobile number" error={e.mobile?.message} required>{({ id, invalid }) => <Input id={id} type="tel" inputMode="numeric" autoComplete="tel-national" aria-invalid={invalid} {...register('mobile')} />}</Field>
      <Field label="Address" error={e.line1?.message} required className="sm:col-span-2">{({ id, invalid }) => <Input id={id} autoComplete="address-line1" aria-invalid={invalid} {...register('line1')} />}</Field>
      <Field label="Area or landmark" error={e.line2?.message} className="sm:col-span-2">{({ id }) => <Input id={id} autoComplete="address-line2" {...register('line2')} />}</Field>
      <Field label="City" error={e.city?.message} required>{({ id, invalid }) => <Input id={id} autoComplete="address-level2" aria-invalid={invalid} {...register('city')} />}</Field>
      <Field label="State" error={e.state?.message} required>
        {({ id, invalid }) => <Select id={id} aria-invalid={invalid} {...register('state')}><option value="">Choose…</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</Select>}
      </Field>
      <Field label="PIN code" error={e.pincode?.message} required>{({ id, invalid }) => <Input id={id} inputMode="numeric" autoComplete="postal-code" aria-invalid={invalid} {...register('pincode')} />}</Field>
    </div>
  );
}

/* ---------------------------------------------------------------- Reason dialog */
/** Asks for a short reason, then runs an action. Stays open with a message if the action fails. */
export function ReasonDialog({ trigger, title, description, label, tone = 'primary', optional, onSubmit }: {
  trigger: (open: () => void) => ReactNode; title: string; description?: ReactNode; label: string; tone?: 'primary' | 'danger'; optional?: boolean; onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!optional && reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
    setBusy(true);
    try { await onSubmit(reason.trim()); setOpen(false); setReason(''); setError(''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      {trigger(() => setOpen(true))}
      <Modal open={open} onOpenChange={(o) => !busy && setOpen(o)} title={title} description={description}
        footer={<><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Back</Button><Button variant={tone} loading={busy} onClick={go}>{label}</Button></>}>
        <Field label={optional ? 'Note (optional)' : 'Reason'} error={error} required={!optional}>
          {({ id, invalid }) => <Textarea id={id} maxLength={300} aria-invalid={invalid} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- Buy box on listing pages */
export function BuyBox({ listing: l }: { listing: ListingDetail }) {
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const allowAdvance = !!l.project && l.project.advancePaise > 0 && l.project.advancePaise < l.pricePaise;
  const allowFull = !l.project || !allowAdvance || l.project.allowFullPayment;
  const [qty, setQty] = useState(1);
  const [plan, setPlan] = useState<PaymentPlan>(allowFull ? 'full' : 'advance');
  const [busy, setBusy] = useState(false);
  const soldOut = l.product?.availability === 'out_of_stock' || l.product?.stockQty === 0;
  const noPrice = l.pricePaise < 100;

  const add = async () => {
    if (!user) return navigate(`/login?next=${encodeURIComponent(pathname)}`);
    setBusy(true);
    try {
      qc.setQueryData(['cart'], await addToCart({ listingId: l.id, qty, plan }));
      toast.success('Added to your cart', { action: { label: 'View cart', onClick: () => navigate('/member/cart') } });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  if (status === 'authenticated' && user && !user.roles.includes('member')) {
    return <p className="mt-5 flex items-start gap-1.5 rounded-xl bg-canvas p-3 text-[13px] text-muted"><Info className="mt-0.5 size-4 flex-none" />Sign in with a member account to buy.</p>;
  }
  return (
    <div className="mt-5 grid gap-3">
      {l.type === 'product' && !soldOut && (
        <Field label="Quantity">{({ id }) => <Input id={id} type="number" min={1} max={Math.min(999, l.product?.stockQty ?? 999)} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(999, Math.trunc(Number(e.target.value)) || 1)))} className="w-28" />}</Field>
      )}
      {l.type === 'project' && allowAdvance && allowFull && (
        <Field label="Payment">{({ id }) => (
          <Select id={id} value={plan} onChange={(e) => setPlan(e.target.value as PaymentPlan)}>
            <option value="full">Full payment</option><option value="advance">Advance now ({formatINR(l.project!.advancePaise)} + GST), balance later</option>
          </Select>
        )}</Field>
      )}
      <Button size="lg" className="w-full" loading={busy} disabled={soldOut || noPrice} onClick={add} leftIcon={<ShoppingCart className="size-4" />}>
        {soldOut ? 'Out of stock' : noPrice ? 'Contact vendor for price' : l.type === 'product' ? 'Add to cart' : l.type === 'service' ? 'Book this service' : 'Order this project'}
      </Button>
      {l.type === 'project' && <p className="text-[12.5px] text-muted">Need something custom? <Link to="/member/projects/new" className="font-semibold text-brand-600 hover:underline">Post a project</Link> and get bids.</p>}
    </div>
  );
}

export function Totals({ rows, total }: { rows: [string, number][]; total: [string, number] }) {
  return (
    <dl className="grid gap-2 text-[14px]">
      {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="font-medium">{formatINR(v)}</dd></div>)}
      <div className="flex justify-between gap-4 border-t border-line pt-2 text-[16px] font-bold"><dt>{total[0]}</dt><dd>{formatINR(total[1])}</dd></div>
    </dl>
  );
}
