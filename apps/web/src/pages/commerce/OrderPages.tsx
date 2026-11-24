import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CreditCard, Download, PackageX, Search, Truck, X } from 'lucide-react';
import { ORDER_STATUSES, type CustomerRow, type GstSummaryRow, type InvoiceRow, type OrderDetail, type OrderRow, type PaymentView } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import {
  Alert, Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, ServerTable, Skeleton, StatusBadge, Textarea, type Column,
} from '@/design-system';
import { fmtDate, MiniStats } from '@/features/dashboard/widgets';
import { fmtDateTime, ReasonDialog, TestBadge, Totals } from '@/features/commerce/components';
import {
  cancelOrder, completeOrder, decideCancellation, dismissRefund, getOrder, gstSummary, invoiceBlob, listCustomers, listInvoices, listOrders, listPayments, newKey, orderStats, payOrder, refundOrder, setOrderStatus,
} from '@/features/commerce/api';
import { ReviewBox } from '@/features/comms/reviews';
import { ApiError, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

const PAGE_SIZE = 20;
/** URL-backed list state, so filters survive reloads and the back button. */
function useUrlState() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete('page');
    setParams(next);
  };
  return { params, get: (k: string) => params.get(k) || undefined, set, page: Number(params.get('page') ?? 1), clear: () => setParams(new URLSearchParams()) };
}
function SearchForm({ u, placeholder, children }: { u: ReturnType<typeof useUrlState>; placeholder: string; children?: React.ReactNode }) {
  const [q, setQ] = useState(u.get('q') ?? '');
  useEffect(() => setQ(u.params.get('q') ?? ''), [u.params]);
  const submit = (e: FormEvent) => { e.preventDefault(); u.set({ q: q.trim() || undefined }); };
  return (
    <Card className="p-4">
      <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1"><Input leftIcon={<Search />} className="h-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>
        {children}
        <Button type="submit" className="h-10">Search</Button>
        {[...u.params.keys()].some((k) => k !== 'page') && <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={u.clear}>Clear</Button>}
      </form>
    </Card>
  );
}

/* ================================================================ Lists */
export interface OrdersPreset { title: string; description: string; kind?: string; status?: string; group?: string }

export function OrdersPage({ panelKey, preset }: { panelKey: PanelKey; preset: OrdersPreset }) {
  const panel = PANELS[panelKey];
  const u = useUrlState();
  const navigate = useNavigate();
  const query = {
    kind: preset.kind ?? u.get('kind'), status: preset.status ?? u.get('status'), group: preset.group, attention: u.get('attention'), q: u.get('q'), from: u.get('from'), to: u.get('to'), page: u.page, pageSize: PAGE_SIZE,
  };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['orders', panelKey, query], queryFn: () => listOrders(panelKey, query), placeholderData: keepPreviousData });
  const columns: Column<OrderRow>[] = [
    { key: 'no', header: 'Order', cell: (r) => <><Link to={`${panel.base}/orders/${r.id}`} onClick={(e) => e.stopPropagation()} className="block font-mono text-[12.5px] font-semibold whitespace-nowrap text-brand-600 hover:underline">{r.orderNo}</Link><span className="text-[12px] whitespace-nowrap text-muted">{fmtDate(r.createdAt)}</span></> },
    { key: 'item', header: 'Item', cell: (r) => <span className="line-clamp-2 min-w-40">{r.title}</span> },
    ...(panelKey !== 'member' ? [{ key: 'buyer', header: 'Buyer', cell: (r: OrderRow) => <><b className="block font-semibold text-ink">{r.buyer.name}</b><span className="font-mono text-[12px] text-muted">{r.buyer.memberId}</span></> }] : []),
    ...(panelKey !== 'vendor' ? [{ key: 'vendor', header: 'Vendor', cell: (r: OrderRow) => r.vendor.name }] : []),
    { key: 'total', header: 'Total', align: 'right', cell: (r) => <b className="text-ink">{formatINR(r.totalPaise)}</b> },
    { key: 'pay', header: 'Payment', cell: (r) => <StatusBadge status={r.paymentStatus} /> },
    { key: 'status', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.cancellationRequested && <Badge tone="amber">Cancellation asked</Badge>}{r.isTest && <TestBadge />}</span> },
    ...(preset.status === 'shipped' ? [{ key: 'trk', header: 'Tracking', cell: (r: OrderRow) => <span className="font-mono text-[12.5px]">{r.trackingNumber ?? '—'}</span> }] : []),
  ];
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: preset.title }]} title={preset.title} description={preset.description} />
      <SearchForm u={u} placeholder="Order number, item or tracking number">
        {!preset.status && !preset.group && (
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Status
            <Select className="h-10 w-40" value={query.status ?? ''} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">All</option><option value="active">In progress</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}</Select>
          </label>
        )}
        {panelKey !== 'member' && (
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Needs attention
            <Select className="h-10 w-44" value={query.attention ?? ''} onChange={(e) => u.set({ attention: e.target.value || undefined })}><option value="">Any</option><option value="cancellation">Cancellation asked</option><option value="refund">Refund to decide</option></Select>
          </label>
        )}
        <label className="grid gap-1 text-[12.5px] font-semibold text-muted">From<Input type="date" className="h-10 w-40" value={query.from ?? ''} onChange={(e) => u.set({ from: e.target.value || undefined })} /></label>
        <label className="grid gap-1 text-[12.5px] font-semibold text-muted">To<Input type="date" className="h-10 w-40" value={query.to ?? ''} onChange={(e) => u.set({ to: e.target.value || undefined })} /></label>
      </SearchForm>
      <Card className="p-4">
        <ServerTable rows={data?.data} columns={columns} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => refetch()} total={data?.meta.total ?? 0} page={u.page} pageSize={PAGE_SIZE}
          onPageChange={(p) => u.set({ page: p > 1 ? String(p) : undefined }, true)} onRowClick={(r) => navigate(`${panel.base}/orders/${r.id}`)} emptyTitle="No orders here" emptyDescription={panelKey === 'member' ? 'Orders you place will appear here.' : 'Orders will appear here once they’re placed and paid.'} />
      </Card>
    </div>
  );
}

export function OrderSummaryPage() {
  const { data: s, isLoading, error, refetch } = useQuery({ queryKey: ['orders', 'vendor', 'stats'], queryFn: () => orderStats('vendor') });
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: 'Vendor', to: '/vendor' }, { label: 'Orders', to: '/vendor/orders/all' }, { label: 'Order summary' }]} title="Order summary" description="Paid orders for your listings." />
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : (
        <>
          <MiniStats loading={isLoading} items={[
            { label: 'Total orders', value: String(s?.total ?? ''), to: '/vendor/orders/all' }, { label: 'In progress', value: String(s?.active ?? ''), to: '/vendor/orders/all?status=active' }, { label: 'Completed', value: String(s?.completed ?? ''), to: '/vendor/orders/all?status=completed' },
            { label: 'Cancelled / refunded', value: String(s?.cancelled ?? '') }, { label: 'Cancellations to decide', value: String(s?.cancellationRequests ?? ''), to: '/vendor/orders/all?attention=cancellation' }, { label: 'Received, less refunds', value: s ? formatINR(s.valuePaise) : '' },
          ]} />
          <Card className="p-5"><CardHeader title="By month" description="Money received for orders confirmed that month, less refunds" />
            <DataTable rows={[...(s?.months ?? [])].reverse()} loading={isLoading} rowKey={(r) => r.month} pageSize={12} exportName="order-summary" columns={[{ key: 'm', header: 'Month', cell: (r) => r.month, value: (r) => r.month }, { key: 'v', header: 'Value', align: 'right', cell: (r) => formatINR(r.valuePaise), value: (r) => r.valuePaise / 100 }]} />
          </Card>
        </>
      )}
    </div>
  );
}

/* ================================================================ Detail */
export function OrderDetailPage({ panelKey }: { panelKey: PanelKey }) {
  const { id = '' } = useParams();
  const panel = PANELS[panelKey];
  const key = ['order', panelKey, id];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: o, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => getOrder(panelKey, id) });
  const listTo = panelKey === 'member' ? '/member/purchases/history' : panelKey === 'vendor' ? '/vendor/orders/all' : `${panel.base}/orders`;
  const crumbs = [{ label: panel.label, to: panel.base }, { label: 'Orders', to: listTo }, { label: o?.orderNo ?? 'Order' }];
  const apply = (d: OrderDetail) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['request'] }); };
  const run = async (f: () => Promise<OrderDetail>, msg: string) => {
    try { apply(await f()); toast.success(msg); } catch (e) { toast.error(errorMessage(e)); void refetch(); }
  };
  if (error instanceof ApiError && error.status === 404) return <><PageHeader breadcrumbs={crumbs} title="Order not found" /><Card><EmptyState icon={PackageX} title="This order isn’t available" description="The link may be wrong, or the order isn’t yours." action={<ButtonLink to={listTo}>All orders</ButtonLink>} /></Card></>;
  if (error) return <><PageHeader breadcrumbs={crumbs} title="Order" /><Card><ErrorState onRetry={() => refetch()} /></Card></>;
  if (isLoading || !o) return <div className="grid gap-5"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  const can = (a: string) => o.actions.includes(a);
  const refundable = o.payments.filter((p) => p.status === 'captured' || p.status === 'refunded').reduce((a, p) => a + p.amountPaise, 0) - o.refunds.filter((r) => r.status !== 'failed').reduce((a, r) => a + r.amountPaise, 0);

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={crumbs} title={<span className="font-mono text-[22px]">{o.orderNo}</span>}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} />{o.isTest && <TestBadge />}placed {fmtDateTime(o.createdAt)}</span>}
        actions={
          <>
            {can('pay') && <Button size="sm" leftIcon={<CreditCard className="size-4" />} onClick={async () => { try { navigate(`/member/pay/${(await payOrder(o.id)).id}`); } catch (e) { toast.error(errorMessage(e)); } }}>Pay {formatINR(o.dueNowPaise)}</Button>}
            {can('processing') && <Button size="sm" onClick={() => run(() => setOrderStatus(panelKey, o.id, { to: 'processing' }), 'Order marked as processing')}>Start processing</Button>}
            {can('shipped') && <ShipDialog onShip={(tracking) => setOrderStatus(panelKey, o.id, { to: 'shipped', tracking }).then(apply)} />}
            {can('completed') && (
              <ConfirmDialog title={panelKey === 'member' ? 'Confirm you received everything?' : 'Mark as completed?'} description="Completed orders can’t be moved back." confirmLabel={panelKey === 'member' ? 'Yes, received' : 'Mark completed'}
                onConfirm={() => run(() => (panelKey === 'member' ? completeOrder(o.id) : setOrderStatus(panelKey, o.id, { to: 'completed' })), 'Order completed')} trigger={(open) => <Button size="sm" leftIcon={<CheckCircle2 className="size-4" />} onClick={open}>{panelKey === 'member' ? 'Confirm received' : 'Mark completed'}</Button>} />
            )}
            {can('refund') && <RefundDialog order={o} refundable={refundable} onDone={apply} />}
            {(can('cancel') || can('request_cancel')) && (
              <ReasonDialog title={can('request_cancel') ? 'Ask to cancel this order?' : 'Cancel this order?'} tone="danger" label={can('request_cancel') ? 'Send request' : 'Cancel order'}
                description={can('request_cancel') ? 'The vendor or our team will decide. Any refund follows the refund policy.' : o.paidPaise > 0 ? 'The payment is not returned automatically: an admin decides the refund.' : undefined}
                onSubmit={(r) => cancelOrder(panelKey, o.id, r).then(apply)} trigger={(open) => <Button size="sm" variant="outline" onClick={open}>{can('request_cancel') ? 'Ask to cancel' : 'Cancel order'}</Button>} />
            )}
          </>
        } />

      {o.status === 'pending' && o.expiresAt && <Alert tone="warn">Waiting for payment. Unpaid orders are cancelled at {fmtDateTime(o.expiresAt)}.</Alert>}
      {o.cancellation?.status === 'open' && (
        <Alert tone="warn" title="Cancellation requested">
          <p>{o.cancellation.reason}</p>
          {can('decide_cancel') && (
            <div className="mt-3 flex flex-wrap gap-2">
              <ReasonDialog optional title="Accept the cancellation?" description="The order is cancelled and an admin decides the refund." label="Accept" tone="danger" onSubmit={(n) => decideCancellation(panelKey, o.id, 'accept', n).then(apply)} trigger={(open) => <Button size="sm" onClick={open}>Accept</Button>} />
              <ReasonDialog optional title="Decline the cancellation?" label="Decline" onSubmit={(n) => decideCancellation(panelKey, o.id, 'decline', n).then(apply)} trigger={(open) => <Button size="sm" variant="outline" onClick={open}>Decline</Button>} />
            </div>
          )}
        </Alert>
      )}
      {o.cancellation?.status === 'declined' && <Alert tone="info" title="Cancellation declined">{o.cancellation.note || 'The order continues.'}</Alert>}
      {o.refundRequestedPaise > 0 && (
        <Alert tone="warn" title={`Refund to decide: up to ${formatINR(o.refundRequestedPaise)}`}>
          {can('dismiss_refund') ? <ReasonDialog title="Close without refunding?" label="Close request" tone="danger" onSubmit={(r) => dismissRefund(o.id, r).then(apply)} trigger={(open) => <Button size="sm" variant="outline" className="mt-2" onClick={open}>Close without refund</Button>} /> : 'Our team is reviewing it against the refund policy.'}
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.8fr_1fr]">
        <div className="grid min-w-0 gap-5">
          <Card className="p-5">
            <CardHeader title="Items" description={panelKey === 'vendor' ? undefined : <>Sold by <Link to={`/vendors/${o.vendor.slug}`} className="font-semibold text-brand-600 hover:underline">{o.vendor.name}</Link></>} />
            <ul className="divide-y divide-line-2">
              {o.items.map((i, n) => (
                <li key={n} className="flex flex-wrap justify-between gap-3 py-3 text-[14px]">
                  <div className="min-w-0"><b className="font-semibold">{i.name}</b><p className="text-[13px] text-muted">{i.qty} × {formatINR(i.unitPricePaise)}{i.gstRatePct > 0 && ` + ${i.gstRatePct}% GST (${formatINR(i.gstPaise)})`}</p>{i.note && <p className="text-[13px] text-ink-2">{i.note}</p>}</div>
                  <b>{formatINR(i.totalPaise)}</b>
                </li>
              ))}
            </ul>
            <div className="mt-4 sm:ml-auto sm:max-w-xs">
              <Totals rows={[['Subtotal', o.subtotalPaise], ...(o.discountPaise ? [[`Coupon ${o.couponCode ?? ''}`, -o.discountPaise] as [string, number]] : []), ['GST', o.gstPaise], ...(o.plan === 'advance' ? [['Advance', o.advancePaise] as [string, number]] : []), ['Paid', o.paidPaise], ...(o.refundedPaise ? [['Refunded', o.refundedPaise] as [string, number]] : [])]} total={['Total', o.totalPaise]} />
              {o.dueNowPaise > 0 && <p className="mt-2 text-right text-[13px] font-semibold text-warn">{formatINR(o.dueNowPaise)} due</p>}
            </div>
            {o.projectRequestId && panelKey === 'member' && <Link to={`/member/projects/requests/${o.projectRequestId}`} className="mt-3 inline-block text-[13px] font-semibold text-brand-600 hover:underline">View the project request</Link>}
          </Card>
          <Card className="p-5">
            <CardHeader title="Order history" />
            <ol className="grid gap-3">
              {o.history.map((h, n) => <li key={n} className="flex gap-3 text-[14px]"><span className="mt-1.5 size-2 flex-none rounded-full bg-brand-600" /><div><b className="capitalize">{h.status}</b>{h.note && <span> · {h.note}</span>}<p className="text-[12.5px] text-muted">{h.by} · {fmtDateTime(h.at)}</p></div></li>)}
            </ol>
          </Card>
        </div>
        <div className="grid min-w-0 gap-5">
          {o.tracking && <Card className="p-5"><CardHeader title="Tracking" /><p className="flex items-center gap-2 text-[14px]"><Truck className="size-4 text-subtle" />{o.tracking.carrier} · <b className="font-mono">{o.tracking.number}</b></p>{o.tracking.url && <a href={o.tracking.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[13px] font-semibold text-brand-600 hover:underline">Track shipment</a>}</Card>}
          {panelKey !== 'member' && <Card className="p-5"><CardHeader title="Buyer" /><p className="font-semibold">{o.buyer.name}</p><p className="font-mono text-[13px] text-muted">{o.buyer.memberId}</p></Card>}
          {o.address && <Card className="p-5"><CardHeader title="Address" /><address className="text-[14px] leading-relaxed not-italic">{o.address.name}<br />{o.address.line1}{o.address.line2 && <>, {o.address.line2}</>}<br />{o.address.city}, {o.address.state} {o.address.pincode}<br />{o.address.mobile}</address></Card>}
          {panelKey === 'member' && o.status === 'completed' && <ReviewBox orderId={o.id} />}
          <Card className="p-5">
            <CardHeader title="Invoices" />
            {o.invoices.length === 0 ? <p className="text-[14px] text-muted">Issued once the order is fully paid.</p> : <ul className="grid gap-2">{o.invoices.map((i) => <li key={i.id} className="flex items-center justify-between gap-3 text-[14px]"><span><b className="font-mono text-[13px]">{i.invoiceNo}</b><br /><span className="text-[12.5px] text-muted">{i.type === 'credit_note' ? 'Credit note' : 'Invoice'} · {formatINR(i.totalPaise)}</span></span><PdfButton panelKey={panelKey} id={i.id} /></li>)}</ul>}
          </Card>
          <Card className="p-5">
            <CardHeader title="Payments & refunds" />
            <ul className="grid gap-2 text-[14px]">
              {o.payments.map((p) => <li key={p.id} className="flex justify-between gap-3"><span><span className="font-mono text-[12.5px]">{p.paymentNo}</span><br /><span className="text-[12.5px] text-muted">{fmtDateTime(p.at)}</span></span><span className="text-right">{formatINR(p.amountPaise)}<br /><StatusBadge status={p.status} /></span></li>)}
              {o.refunds.map((r) => <li key={r.id} className="flex justify-between gap-3 border-t border-line-2 pt-2"><span>Refund<br /><span className="text-[12.5px] text-muted">{r.reason}</span></span><span className="text-right">−{formatINR(r.amountPaise)}<br /><StatusBadge status={r.status} /></span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PdfButton({ panelKey, id }: { panelKey: PanelKey; id: string }) {
  const [busy, setBusy] = useState(false);
  return <Button variant="outline" size="sm" loading={busy} leftIcon={<Download className="size-3.5" />} onClick={async (e) => { e.stopPropagation(); setBusy(true); try { await invoiceBlob(panelKey, id); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); } }}>PDF</Button>;
}

function ShipDialog({ onShip }: { onShip: (t: { carrier: string; number: string; url?: string }) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ carrier: '', number: '', url: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await onShip(v); setOpen(false); toast.success('Marked as shipped'); } catch (e) { setError(e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Button size="sm" leftIcon={<Truck className="size-4" />} onClick={() => setOpen(true)}>Mark shipped</Button>
      <Modal open={open} onOpenChange={(x) => !busy && setOpen(x)} title="Shipping details" description="The buyer sees these on their order." footer={<><Button variant="outline" onClick={() => setOpen(false)}>Back</Button><Button loading={busy} onClick={go}>Mark shipped</Button></>}>
        <div className="grid gap-4">
          <Field label="Courier" required>{({ id }) => <Input id={id} value={v.carrier} onChange={(e) => setV({ ...v, carrier: e.target.value })} />}</Field>
          <Field label="Tracking number" required>{({ id }) => <Input id={id} value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} />}</Field>
          <Field label="Tracking link">{({ id }) => <Input id={id} type="url" placeholder="https://" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />}</Field>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

function RefundDialog({ order, refundable, onDone }: { order: OrderDetail; refundable: number; onDone: (d: OrderDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  const go = async () => {
    const n = Number(amount);
    if (!(n >= 1) || Math.round(n * 100) > refundable) return setError(`Enter an amount from ₹1 to ${formatINR(refundable)}`);
    if (reason.trim().length < 5) return setError('Give a reason (at least 5 characters)');
    setBusy(true);
    try {
      onDone(await refundOrder(order.id, { amount: n, reason: reason.trim(), idempotencyKey: key.current }));
      toast.success('Refund issued');
      setOpen(false); setAmount(''); setReason(''); setError('');
      key.current = newKey();
    } catch (e) {
      setError(errorMessage(e));
      // A lost connection keeps the key, so retrying can't refund twice. A definite refusal starts a new attempt.
      if (e instanceof ApiError && e.status !== 0 && (e.status < 500 || e.code === 'REFUND_FAILED')) key.current = newKey();
    } finally { setBusy(false); }
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Refund</Button>
      <Modal open={open} onOpenChange={(x) => !busy && setOpen(x)} title="Issue a refund" description={`Up to ${formatINR(refundable)} can be refunded${order.isTest ? ' (test payment: no real money moves)' : ' to the original payment method. This can’t be undone'}.`}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Back</Button><Button variant="danger" loading={busy} onClick={go}>Refund{Number(amount) > 0 ? ` ₹${amount}` : ''}</Button></>}>
        <div className="grid gap-4">
          <Field label="Amount (₹)" required>{({ id }) => <Input id={id} type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Reason" required>{({ id }) => <Textarea id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

/* ================================================================ Invoices, GST, billing, customers */
export function InvoicesPage({ panelKey, title }: { panelKey: PanelKey; title: string }) {
  const panel = PANELS[panelKey];
  const u = useUrlState();
  const query = { q: u.get('q'), from: u.get('from'), to: u.get('to'), page: u.page, pageSize: PAGE_SIZE };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['invoices', panelKey, query], queryFn: () => listInvoices(panelKey, query), placeholderData: keepPreviousData });
  const columns: Column<InvoiceRow>[] = [
    { key: 'no', header: 'Invoice', cell: (r) => <><b className="block font-mono text-[12.5px] whitespace-nowrap text-ink">{r.invoiceNo}</b><span className="text-[12px] whitespace-nowrap text-muted">{fmtDate(r.issuedAt)}</span></> },
    { key: 'type', header: 'Type', cell: (r) => <span className="flex flex-wrap gap-1">{r.type === 'credit_note' ? <Badge tone="violet">Credit note</Badge> : <Badge tone="blue">Invoice</Badge>}{r.isTest && <TestBadge />}</span> },
    { key: 'order', header: 'Order', cell: (r) => <Link to={`${panel.base}/orders/${r.orderId}`} className="font-mono text-[12.5px] whitespace-nowrap text-brand-600 hover:underline">{r.orderNo}</Link> },
    ...(panelKey !== 'vendor' ? [{ key: 's', header: 'Seller', cell: (r: InvoiceRow) => r.seller }] : []),
    ...(panelKey !== 'member' ? [{ key: 'b', header: 'Buyer', cell: (r: InvoiceRow) => r.buyer }] : []),
    { key: 'tax', header: 'GST', align: 'right', cell: (r) => formatINR(r.cgstPaise + r.sgstPaise + r.igstPaise) },
    { key: 'total', header: 'Total', align: 'right', cell: (r) => <b className="text-ink">{r.type === 'credit_note' && '−'}{formatINR(r.totalPaise)}</b> },
    { key: 'pdf', header: '', cell: (r) => <PdfButton panelKey={panelKey} id={r.id} /> },
  ];
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: title }]} title={title} description="Invoices are issued when an order is fully paid; refunds create credit notes." />
      <SearchForm u={u} placeholder="Invoice or order number, or name">
        <label className="grid gap-1 text-[12.5px] font-semibold text-muted">From<Input type="date" className="h-10 w-40" value={query.from ?? ''} onChange={(e) => u.set({ from: e.target.value || undefined })} /></label>
        <label className="grid gap-1 text-[12.5px] font-semibold text-muted">To<Input type="date" className="h-10 w-40" value={query.to ?? ''} onChange={(e) => u.set({ to: e.target.value || undefined })} /></label>
      </SearchForm>
      <Card className="p-4"><ServerTable rows={data?.data} columns={columns} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => refetch()} total={data?.meta.total ?? 0} page={u.page} pageSize={PAGE_SIZE} onPageChange={(p) => u.set({ page: p > 1 ? String(p) : undefined }, true)} emptyTitle="No invoices yet" /></Card>
      {panelKey === 'vendor' && <GstTable panelKey="vendor" />}
    </div>
  );
}

function GstTable({ panelKey }: { panelKey: 'member' | 'vendor' }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['invoices', panelKey, 'gst'], queryFn: () => gstSummary(panelKey) });
  const money = (k: keyof GstSummaryRow, header: string): Column<GstSummaryRow> => ({ key: k, header, align: 'right', cell: (r) => formatINR(Number(r[k])), value: (r) => Number(r[k]) / 100 });
  if (error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  return (
    <Card className="p-5">
      <CardHeader title="GST by month" description={panelKey === 'vendor' ? 'Credit notes are subtracted. Test orders are left out.' : 'Credit notes are subtracted.'} />
      <DataTable rows={data?.data ?? []} loading={isLoading} rowKey={(r) => r.month} exportName="gst-summary" emptyTitle="No GST records yet" columns={[{ key: 'month', header: 'Month', cell: (r) => r.month, value: (r) => r.month }, { key: 'n', header: 'Documents', align: 'right', cell: (r) => r.invoices, value: (r) => r.invoices }, money('taxablePaise', 'Taxable'), money('cgstPaise', 'CGST'), money('sgstPaise', 'SGST'), money('igstPaise', 'IGST'), money('totalPaise', 'Total')]} />
    </Card>
  );
}
export const GstPage = () => <div className="grid grid-cols-1 gap-5"><PageHeader className="mb-0" breadcrumbs={[{ label: 'Member', to: '/member' }, { label: 'Invoices', to: '/member/invoices/purchases' }, { label: 'GST details' }]} title="GST details" description="GST on your purchases, month by month." /><GstTable panelKey="member" /></div>;

export function BillingPage() {
  const u = useUrlState();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['orders', 'payments', u.page], queryFn: () => listPayments(u.page), placeholderData: keepPreviousData });
  const columns: Column<PaymentView>[] = [
    { key: 'no', header: 'Payment', cell: (r) => <Link to={`/member/pay/${r.id}`} className="font-mono text-[12.5px] font-semibold whitespace-nowrap text-brand-600 hover:underline">{r.paymentNo}</Link> },
    { key: 'orders', header: 'Orders', cell: (r) => r.orders.map((o) => <Link key={o.id} to={`/member/orders/${o.id}`} className="block font-mono text-[12.5px] whitespace-nowrap hover:text-brand-600">{o.orderNo}</Link>) },
    { key: 'amt', header: 'Amount', align: 'right', cell: (r) => <b className="text-ink">{formatINR(r.amountPaise)}</b> },
    { key: 'st', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.testMode && <TestBadge />}</span> },
    { key: 'd', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
  ];
  return <div className="grid grid-cols-1 gap-5"><PageHeader className="mb-0" breadcrumbs={[{ label: 'Member', to: '/member' }, { label: 'Billing history' }]} title="Billing history" description="Every payment you’ve made or started." /><Card className="p-4"><ServerTable rows={data?.data} columns={columns} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => refetch()} total={data?.meta.total ?? 0} page={u.page} pageSize={20} onPageChange={(p) => u.set({ page: p > 1 ? String(p) : undefined }, true)} emptyTitle="No payments yet" /></Card></div>;
}

export function CustomersPage() {
  const u = useUrlState();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['orders', 'customers', u.page], queryFn: () => listCustomers(u.page), placeholderData: keepPreviousData });
  const columns: Column<CustomerRow>[] = [
    { key: 'n', header: 'Customer', cell: (r) => <><b className="block font-semibold text-ink">{r.name}</b><span className="font-mono text-[12px] text-muted">{r.memberId}</span></> },
    { key: 'o', header: 'Orders', align: 'right', cell: (r) => r.orders }, { key: 'v', header: 'Value', align: 'right', cell: (r) => formatINR(r.valuePaise) }, { key: 'l', header: 'Last order', cell: (r) => fmtDate(r.lastOrderAt) },
  ];
  return <div className="grid grid-cols-1 gap-5"><PageHeader className="mb-0" breadcrumbs={[{ label: 'Vendor', to: '/vendor' }, { label: 'Customers' }]} title="Customers" description="Members who have paid for your listings." /><Card className="p-4"><ServerTable rows={data?.data} columns={columns} rowKey={(r) => r.userId} loading={isLoading} error={error} onRetry={() => refetch()} total={data?.meta.total ?? 0} page={u.page} pageSize={20} onPageChange={(p) => u.set({ page: p > 1 ? String(p) : undefined }, true)} emptyTitle="No customers yet" /></Card></div>;
}

/** Member menu entries for selling: waiting on a business decision, so say so instead of showing a form. */
export const MemberSellingPage = () => (
  <><PageHeader breadcrumbs={[{ label: 'Member', to: '/member' }, { label: 'Selling' }]} title="Selling as a member" />
    <Card><EmptyState title="Selling needs a vendor account" description="Only verified vendors can list and sell today. Whether members may sell without becoming vendors is still to be decided." action={<ButtonLink to="/register?type=vendor">Become a vendor</ButtonLink>} /></Card></>
);
