import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, FlaskConical, Loader2, ShoppingCart, Trash2, XCircle } from 'lucide-react';
import type { CartLine, CartView, PaymentPlan, PaymentView } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton } from '@/design-system';
import { SampleTag } from '@/features/catalog/components';
import { useAuth } from '@/features/auth/AuthProvider';
import { AddressFields, Totals, useAddressForm } from '@/features/commerce/components';
import { getPayment, lastAddress, newKey, placeOrder, removeCartItem, simulatePayment, updateCartItem, useCart } from '@/features/commerce/api';
import { applyCoupon, payFromWallet, removeCoupon, useWallet } from '@/features/finance/api';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';

const crumbs = (...c: { label: string; to?: string }[]) => [{ label: 'Member', to: '/member' }, ...c];
const summaryRows = (c: CartView): [string, number][] => [['Subtotal', c.subtotalPaise], ...(c.discountPaise ? [[`Coupon ${c.coupon!.code}`, -c.discountPaise] as [string, number]] : []), ['GST', c.gstPaise], ...(c.dueNowPaise !== c.totalPaise ? [['Payable later', c.totalPaise - c.dueNowPaise] as [string, number]] : [])];

function Notices({ cart }: { cart: CartView }) {
  return (
    <>
      {!cart.paymentsEnabled && <Alert tone="warn" title="Online payments aren’t switched on">You can fill your cart, but orders can’t be placed until a payment gateway is connected.</Alert>}
      {cart.testMode && <Alert tone="warn" title="Test mode">Payments are simulated. No real money is taken and nothing is delivered.</Alert>}
    </>
  );
}

/* ================================================================ Cart */
export function CartPage() {
  const { data: cart, isLoading, error, refetch } = useCart();
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={crumbs({ label: 'Purchases', to: '/member/purchases/history' }, { label: 'My cart' })} title="My cart" description="Review your items, then check out." />
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card>
        : isLoading || !cart ? <Skeleton className="h-64" />
        : cart.count === 0 ? <Card><EmptyState icon={ShoppingCart} title="Your cart is empty" description="Browse products, services and projects to get started." action={<ButtonLink to="/products">Browse products</ButtonLink>} /></Card>
        : (
          <>
            <Notices cart={cart} />
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.9fr_1fr]">
              <div className="grid gap-5">
                {cart.groups.map((g) => (
                  <Card key={g.vendor.id || 'gone'} className="p-5">
                    <CardHeader title={g.vendor.slug ? <Link to={`/vendors/${g.vendor.slug}`} className="hover:text-brand-600">{g.vendor.name}</Link> : g.vendor.name} description={g.vendor.gstRegistered ? 'GST registered' : 'Not GST registered: no GST is charged'} />
                    <ul className="divide-y divide-line-2">{g.lines.map((l) => <Line key={l.id} line={l} />)}</ul>
                  </Card>
                ))}
              </div>
              <Card className="p-5 xl:sticky xl:top-24">
                <CardHeader title="Summary" />
                <CouponBox cart={cart} />
                <Totals rows={summaryRows(cart)} total={['Pay now', cart.dueNowPaise]} />
                {cart.canCheckout && !cart.coupon?.problem
                  ? <ButtonLink to="/member/checkout" size="lg" className="mt-5 w-full">Check out</ButtonLink>
                  : <Button size="lg" className="mt-5 w-full" disabled>Check out</Button>}
                {cart.groups.some((g) => g.lines.some((l) => l.problem)) && <p className="mt-2 text-[13px] text-danger">Fix or remove the marked items to continue.</p>}
              </Card>
            </div>
          </>
        )}
    </div>
  );
}

function Line({ line: l }: { line: CartLine }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(String(l.qty));
  const [busy, setBusy] = useState(false);
  useEffect(() => setQty(String(l.qty)), [l.qty]);
  const run = async (f: () => Promise<CartView>) => {
    setBusy(true);
    try { qc.setQueryData(['cart'], await f()); } catch (e) { toast.error(errorMessage(e)); setQty(String(l.qty)); } finally { setBusy(false); }
  };
  const commit = () => {
    const n = Math.trunc(Number(qty));
    if (!(n >= 1 && n <= 999)) return setQty(String(l.qty));
    if (n !== l.qty) void run(() => updateCartItem(l.id, { qty: n }));
  };
  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-3 py-4">
      <div className="min-w-52 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          {l.slug ? <Link to={`/${l.type}s/${l.slug}`} className="font-semibold hover:text-brand-600">{l.name}</Link> : <b>{l.name}</b>}
          {l.isSample && <SampleTag />}
        </span>
        <p className="text-[13px] text-muted">{formatINR(l.unitPricePaise)}{l.gstRatePct > 0 && ` + ${l.gstRatePct}% GST`}</p>
        {l.problem && <Badge tone="red" className="mt-1">{l.problem}</Badge>}
        {l.allowAdvance && l.allowFull && (
          <Select aria-label={`Payment for ${l.name}`} className="mt-2 h-9 w-56" value={l.plan} disabled={busy} onChange={(e) => run(() => updateCartItem(l.id, { plan: e.target.value as PaymentPlan }))}>
            <option value="full">Full payment</option><option value="advance">Advance now, balance later</option>
          </Select>
        )}
        {l.plan === 'advance' && <p className="mt-1 text-[13px] text-muted">Advance now: <b className="text-ink">{formatINR(l.dueNowPaise)}</b></p>}
      </div>
      {l.type === 'product' && <Input aria-label={`Quantity of ${l.name}`} type="number" min={1} max={999} className="h-10 w-20" value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />}
      <b className="w-28 text-right">{formatINR(l.totalPaise)}</b>
      <Button variant="ghost" size="icon" aria-label={`Remove ${l.name}`} disabled={busy} onClick={() => run(() => removeCartItem(l.id))}><Trash2 className="size-4" /></Button>
    </li>
  );
}

function CouponBox({ cart }: { cart: CartView }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<CartView>) => { setBusy(true); try { qc.setQueryData(['cart'], await f()); setError(''); setCode(''); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  if (cart.coupon) return <div className="mb-4 rounded-xl bg-canvas p-3 text-[14px]"><div className="flex items-center justify-between gap-2"><b className="font-mono">{cart.coupon.code}</b><Button size="sm" variant="ghost" loading={busy} onClick={() => run(removeCoupon)}>Remove</Button></div>{cart.coupon.problem && <p className="text-[13px] text-danger">{cart.coupon.problem}</p>}</div>;
  return (
    <form className="mb-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void run(() => applyCoupon(code.trim())); }}>
      <Field label="Coupon code" error={error} className="flex-1">{({ id, invalid }) => <Input id={id} className="h-10 font-mono" aria-invalid={invalid} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />}</Field>
      <Button type="submit" variant="outline" className="h-10" loading={busy}>Apply</Button>
    </form>
  );
}

/** Pay an open payment from the main wallet. */
function WalletPay({ payment, onPaid }: { payment: PaymentView; onPaid: (p: PaymentView) => void }) {
  const { data: w } = useWallet();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!w || w.mainPaise <= 0) return null;
  if (w.mainPaise < payment.amountPaise) return <p className="mt-4 text-[13px] text-muted">Wallet balance {formatINR(w.mainPaise)}: not enough for this payment.</p>;
  if (!w.pinSet) return <p className="mt-4 text-[13px] text-muted"><Link to="/member/account" className="font-semibold text-brand-600 underline">Set a wallet password</Link> to pay from your wallet ({formatINR(w.mainPaise)}).</p>;
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { onPaid(await payFromWallet(payment.id, pin)); } catch (x) { setError(errorMessage(x)); } finally { setBusy(false); } };
  return (
    <form onSubmit={go} className="mt-6 grid gap-3 border-t border-line pt-5 text-left">
      <Field label={`Pay from wallet (balance ${formatINR(w.mainPaise)})`} error={error}>{({ id, invalid }) => <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} placeholder="Wallet password" aria-invalid={invalid} value={pin} onChange={(e) => setPin(e.target.value)} />}</Field>
      <Button type="submit" variant="outline" loading={busy} disabled={pin.length < 4}>Pay {formatINR(payment.amountPaise)} from wallet</Button>
    </form>
  );
}

/* ================================================================ Checkout */
export function CheckoutPage() {
  const { data: cart, isLoading, error, refetch } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useAddressForm();
  const last = useQuery({ queryKey: ['orders', 'last-address'], queryFn: lastAddress });
  const key = useRef(newKey()); // one key per checkout attempt, so a double click or retry can't order twice
  useEffect(() => {
    if (!last.data || form.formState.isDirty) return;
    const a = last.data.address;
    form.reset({ name: a?.name ?? user?.name ?? '', mobile: a?.mobile ?? user?.mobile ?? '', line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', state: (a?.state ?? '') as never, pincode: a?.pincode ?? '' });
  }, [last.data, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (address) => {
    try {
      const p = await placeOrder({ address, expectedTotalPaise: cart!.totalPaise, idempotencyKey: key.current });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['cart'] });
      navigate(`/member/pay/${p.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        const fields = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace(/^address\./, ''), v]));
        if (applyFieldErrors(new ApiError(e.status, e.code, e.message, fields), form.setError)) return;
      }
      toast.error(errorMessage(e));
      if (e instanceof ApiError && e.status !== 0) { key.current = newKey(); void refetch(); }
    }
  });

  const head = <PageHeader className="mb-0" breadcrumbs={crumbs({ label: 'My cart', to: '/member/cart' }, { label: 'Checkout' })} title="Checkout" />;
  if (error) return <>{head}<Card><ErrorState onRetry={() => refetch()} /></Card></>;
  if (isLoading || !cart) return <div className="grid gap-5">{head}<Skeleton className="h-80" /></div>;
  if (!cart.canCheckout && !form.formState.isSubmitting) {
    return <div className="grid gap-5">{head}<Notices cart={cart} /><Card><EmptyState icon={ShoppingCart} title="Nothing to check out" description="Your cart is empty or has items that need attention." action={<ButtonLink to="/member/cart">Back to cart</ButtonLink>} /></Card></div>;
  }
  return (
    <div className="grid grid-cols-1 gap-5">
      {head}
      <Notices cart={cart} />
      <form onSubmit={submit} noValidate className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.9fr_1fr]">
        <Card className="p-6"><CardHeader title="Delivery & billing address" description="Used for delivery and printed on your GST invoice." /><AddressFields form={form} /></Card>
        <Card className="p-5 xl:sticky xl:top-24">
          <CardHeader title="Your order" description={cart.groups.length > 1 ? `${cart.groups.length} vendors: you’ll get a separate order for each` : undefined} />
          <ul className="mb-4 grid gap-2 text-[14px]">
            {cart.groups.flatMap((g) => g.lines).map((l) => <li key={l.id} className="flex justify-between gap-3"><span className="min-w-0">{l.name}{l.qty > 1 && ` × ${l.qty}`}</span><span className="flex-none">{formatINR(l.totalPaise)}</span></li>)}
          </ul>
          <Totals rows={summaryRows(cart)} total={['Pay now', cart.dueNowPaise]} />
          <Button type="submit" size="lg" className="mt-5 w-full" loading={form.formState.isSubmitting}>Place order & pay</Button>
          <p className="mt-2 text-[12.5px] text-muted">By ordering you agree to the <Link to="/terms" className="underline">terms</Link> and <Link to="/refund-policy" className="underline">refund policy</Link>.</p>
        </Card>
      </form>
    </div>
  );
}

/* ================================================================ Payment */
export function PaymentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>();
  // The status always comes from the server, which only trusts the gateway's verified notification.
  const { data: p, isLoading, error, refetch } = useQuery({
    queryKey: ['payment', id], queryFn: () => getPayment(id),
    refetchInterval: (q) => (q.state.data && q.state.data.status === 'created' && !q.state.data.testMode ? 3000 : false),
  });
  const simulate = async (o: 'success' | 'failure') => {
    setBusy(o);
    try {
      qc.setQueryData(['payment', id], await simulatePayment(id, o));
      for (const k of ['orders', 'order', 'request', 'finance']) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) { toast.error(errorMessage(e)); void refetch(); } finally { setBusy(undefined); }
  };
  const head = <PageHeader className="mb-0" breadcrumbs={crumbs({ label: 'Purchases', to: '/member/purchases/history' }, { label: 'Payment' })} title="Payment" />;
  if (error) return <div className="grid gap-5">{head}<Card><ErrorState onRetry={() => refetch()} /></Card></div>;
  if (isLoading || !p) return <div className="grid gap-5">{head}<Skeleton className="h-64" /></div>;
  const ok = p.status === 'captured' || p.status === 'refunded';
  return (
    <div className="grid grid-cols-1 gap-5">
      {head}
      <Card className="mx-auto w-full max-w-lg p-7 text-center">
        {ok ? <CheckCircle2 className="mx-auto size-12 text-success" /> : p.status === 'failed' ? <XCircle className="mx-auto size-12 text-danger" /> : p.testMode ? <FlaskConical className="mx-auto size-12 text-warn" /> : <Loader2 className="mx-auto size-12 animate-spin text-brand-600" />}
        <h2 className="mt-4 text-xl font-bold">{ok ? 'Payment received' : p.status === 'failed' ? 'Payment failed' : p.testMode ? 'Test payment' : 'Waiting for the payment gateway'}</h2>
        <p className="mt-1 text-[28px] font-extrabold text-navy-950">{formatINR(p.amountPaise)}</p>
        <p className="text-[13px] text-muted">{p.paymentNo}</p>
        <ul className="mt-4 grid gap-1.5">
          {p.orders.map((o) => <li key={o.id}><Link to={`/member/orders/${o.id}`} className="font-mono text-[13px] font-semibold text-brand-600 hover:underline">{o.orderNo}</Link> <span className="text-[13px] text-muted">· {formatINR(o.amountPaise)}</span></li>)}
        </ul>
        {p.testMode && !ok && (
          <div className="mt-6 grid gap-2">
            <p className="mb-1 text-[13px] text-muted">This is a simulated gateway. No real money moves.</p>
            <Button loading={busy === 'success'} disabled={!!busy} onClick={() => simulate('success')}>Simulate successful payment</Button>
            {p.status === 'created' && <Button variant="outline" loading={busy === 'failure'} disabled={!!busy} onClick={() => simulate('failure')}>Simulate failure</Button>}
          </div>
        )}
        {!ok && p.purpose !== 'topup' && <WalletPay payment={p} onPaid={(n) => { for (const k of ['orders', 'order', 'request', 'finance']) qc.invalidateQueries({ queryKey: [k] }); navigate(`/member/pay/${n.id}`, { replace: true }); }} />}
        {ok && p.purpose !== 'order' && <ButtonLink to={p.purpose === 'topup' ? '/member/wallet' : '/member/epin/plans'} className="mt-6">{p.purpose === 'topup' ? 'Go to wallet' : 'View subscription'}</ButtonLink>}
        {ok && p.purpose === 'order' && <ButtonLink to={p.orders.length === 1 ? `/member/orders/${p.orders[0]!.id}` : '/member/purchases/history'} className="mt-6">View {p.orders.length === 1 ? 'order' : 'orders'}</ButtonLink>}
      </Card>
    </div>
  );
}
