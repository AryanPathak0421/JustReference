import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { FolderSearch, Plus } from 'lucide-react';
import { bidSchema, GST_RATES, PROJECT_REQUEST_STATUSES, projectRequestSchema, type BidInput, type BidView, type PaymentPlan, type ProjectRequestInput, type ProjectRequestView } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Button, ButtonLink, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Select, ServerTable, Skeleton, StatusBadge, Textarea, type Column } from '@/design-system';
import { fmtDate } from '@/features/dashboard/widgets';
import { useCategories } from '@/features/catalog/api';
import { AddressFields, ReasonDialog, useAddressForm } from '@/features/commerce/components';
import { acceptBid, cancelRequest, closeRequest, createRequest, decideRequest, getRequest, lastAddress, listRequests, rejectBid, saveBid, withdrawBid } from '@/features/commerce/api';
import { ApiError, applyFieldErrors, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

const listPath = (k: PanelKey) => (k === 'member' ? '/member/projects/requests' : `${PANELS[k].base}/bids`);
const PAGE_SIZE = 20;

/* ================================================================ List (member, vendor, admin) */
export function RequestsPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Number(params.get('page') ?? 1);
  const mine = params.get('mine') === 'yes' ? 'yes' : undefined;
  const status = params.get('status') || undefined;
  const set = (patch: Record<string, string | undefined>) => { const n = new URLSearchParams(params); if (!('page' in patch)) n.delete('page'); for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k)); setParams(n); };
  const query = { page, pageSize: PAGE_SIZE, ...(panelKey === 'vendor' ? { mine } : { status }) };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['request', 'list', panelKey, query], queryFn: () => listRequests(panelKey, query), placeholderData: keepPreviousData });
  const title = panelKey === 'member' ? 'My project requests' : panelKey === 'vendor' ? 'Bids' : 'Bids monitor';
  const columns: Column<ProjectRequestView>[] = [
    { key: 't', header: 'Request', cell: (r) => <><Link to={`${listPath(panelKey)}/${r.id}`} onClick={(e) => e.stopPropagation()} className="block min-w-40 font-semibold text-ink hover:text-brand-600">{r.title}</Link><span className="text-[12.5px] text-muted">{r.category} · {r.city}</span></> },
    ...(panelKey === 'admin' ? [{ key: 'o', header: 'Posted by', cell: (r: ProjectRequestView) => <>{r.owner?.name}<br /><span className="font-mono text-[12px] text-muted">{r.owner?.memberId}</span></> }] : []),
    { key: 'b', header: 'Budget', align: 'right', cell: (r) => formatINR(r.budgetPaise) }, { key: 'd', header: 'Timeline', cell: (r) => `${r.timelineDays} days` }, { key: 'n', header: 'Bids', align: 'right', cell: (r) => r.bidCount },
    ...(panelKey === 'vendor' ? [{ key: 'm', header: 'My bid', cell: (r: ProjectRequestView) => (r.myBid ? <>{formatINR(r.myBid.amountPaise)} <StatusBadge status={r.myBid.status} /></> : '—') }] : []),
    { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'c', header: 'Posted', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span> },
  ];
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: title }]} title={title}
        description={panelKey === 'member' ? 'Post what you need, compare bids and choose a vendor.' : panelKey === 'vendor' ? 'Find work posted by members and send your offer. Other vendors can’t see your bid.' : 'Review new requests and follow every bid.'}
        actions={panelKey === 'member' && <ButtonLink to="/member/projects/new" size="sm" leftIcon={<Plus className="size-4" />}>Post a project</ButtonLink>} />
      {panelKey === 'vendor'
        ? <div><Segmented label="Show" value={mine ?? 'no'} onChange={(v) => set({ mine: v === 'yes' ? 'yes' : undefined })} options={[{ value: 'no', label: 'Open requests' }, { value: 'yes', label: 'My bids' }]} /></div>
        : <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">Status<Select className="h-10 w-48" value={status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><option value="">All</option>{PROJECT_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></label>}
      {error instanceof ApiError && error.code === 'VENDOR_NOT_APPROVED' ? <Alert tone="warn">{error.message} <Link to="/vendor/profile" className="font-semibold underline">Business profile</Link></Alert> : (
        <Card className="p-4"><ServerTable rows={data?.data} columns={columns} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => refetch()} total={data?.meta.total ?? 0} page={page} pageSize={PAGE_SIZE} onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined })} onRowClick={(r) => navigate(`${listPath(panelKey)}/${r.id}`)} emptyTitle={panelKey === 'member' ? 'No project requests yet' : 'Nothing here right now'} /></Card>
      )}
    </div>
  );
}

/* ================================================================ New request (member) */
export function NewRequestPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, watch, setValue, setError, formState: { errors: e, isSubmitting } } = useForm<ProjectRequestInput>({
    resolver: zodResolver(projectRequestSchema, undefined, { raw: true }) as never, defaultValues: { kind: 'project', categoryId: '', title: '', description: '', budget: '' as never, timelineDays: '' as never, city: '' },
  });
  const kind = watch('kind');
  const cats = useCategories(kind);
  const submit = handleSubmit(async (v) => {
    try {
      const r = await createRequest(v);
      qc.invalidateQueries({ queryKey: ['request'] });
      toast.success(r.status === 'open' ? 'Your request is live' : 'Sent for approval');
      navigate(`/member/projects/requests/${r.id}`);
    } catch (err) { if (!applyFieldErrors(err, setError)) toast.error(errorMessage(err)); }
  });
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: 'Member', to: '/member' }, { label: 'My project requests', to: '/member/projects/requests' }, { label: 'Post a project' }]} title="Post a project" description="Verified vendors send you bids. You choose, and pay only after accepting one." />
      <Card className="max-w-3xl p-6">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="What do you need?">{({ id }) => <Select id={id} {...register('kind', { onChange: () => setValue('categoryId', '') })}><option value="project">A project</option><option value="service">A service</option></Select>}</Field>
          <Field label="Category" error={e.categoryId?.message} required>{({ id, invalid }) => <Select id={id} aria-invalid={invalid} {...register('categoryId')}><option value="">Choose…</option>{cats.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Title" error={e.title?.message} required className="sm:col-span-2">{({ id, invalid }) => <Input id={id} maxLength={120} aria-invalid={invalid} {...register('title')} />}</Field>
          <Field label="Details" error={e.description?.message} required hint="Scope, materials, deadlines. Don’t include phone numbers or addresses." className="sm:col-span-2">{({ id, invalid, describedBy }) => <Textarea id={id} className="min-h-36" maxLength={4000} aria-invalid={invalid} aria-describedby={describedBy} {...register('description')} />}</Field>
          <Field label="Budget (₹)" error={e.budget?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={1} aria-invalid={invalid} {...register('budget')} />}</Field>
          <Field label="Timeline (days)" error={e.timelineDays?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={1} aria-invalid={invalid} {...register('timelineDays')} />}</Field>
          <Field label="City" error={e.city?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('city')} />}</Field>
          <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting}>Post request</Button></div>
        </form>
      </Card>
    </div>
  );
}

/* ================================================================ Detail */
export function RequestDetailPage({ panelKey }: { panelKey: PanelKey }) {
  const { id = '' } = useParams();
  const panel = PANELS[panelKey];
  const qc = useQueryClient();
  const key = ['request', panelKey, id];
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => getRequest(panelKey, id) });
  const [accepting, setAccepting] = useState<BidView>();
  const apply = (d: ProjectRequestView) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ['request', 'list'] }); };
  const run = async (f: () => Promise<ProjectRequestView>, msg: string) => { try { apply(await f()); toast.success(msg); } catch (e) { toast.error(errorMessage(e)); void refetch(); } };
  const crumbs = [{ label: panel.label, to: panel.base }, { label: panelKey === 'member' ? 'My project requests' : 'Bids', to: listPath(panelKey) }, { label: r?.title ?? 'Request' }];
  if (error) return <><PageHeader breadcrumbs={crumbs} title="Project request" /><Card>{error instanceof ApiError && error.status === 404 ? <EmptyState icon={FolderSearch} title="This request isn’t available" description="It may have been closed." action={<ButtonLink to={listPath(panelKey)}>Back</ButtonLink>} /> : <ErrorState onRetry={() => refetch()} />}</Card></>;
  if (isLoading || !r) return <div className="grid gap-5"><Skeleton className="h-16" /><Skeleton className="h-72" /></div>;
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={crumbs} title={r.title} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} />{r.category} · {r.city} · posted {fmtDate(r.createdAt)}</span>}
        actions={
          <>
            {panelKey === 'member' && r.orderId && <ButtonLink size="sm" to={`/member/orders/${r.orderId}`}>{r.status === 'awarded' ? 'Pay & start' : 'View order'}</ButtonLink>}
            {panelKey === 'member' && ['pending_approval', 'open'].includes(r.status) && <ConfirmDialog title="Withdraw this request?" description="Vendors can no longer bid on it." confirmLabel="Withdraw" tone="danger" onConfirm={() => run(() => cancelRequest(r.id), 'Request withdrawn')} trigger={(o) => <Button size="sm" variant="outline" onClick={o}>Withdraw</Button>} />}
            {panelKey === 'admin' && r.status === 'pending_approval' && <><Button size="sm" onClick={() => run(() => decideRequest(r.id, 'approve'), 'Request approved')}>Approve</Button><ReasonDialog title="Reject this request?" label="Reject" tone="danger" onSubmit={(x) => decideRequest(r.id, 'reject', x).then(apply)} trigger={(o) => <Button size="sm" variant="outline" onClick={o}>Reject</Button>} /></>}
            {panelKey === 'admin' && r.status === 'open' && <ReasonDialog title="Close this request?" description="All open bids are rejected." label="Close" tone="danger" onSubmit={(x) => closeRequest(r.id, x).then(apply)} trigger={(o) => <Button size="sm" variant="outline" onClick={o}>Close request</Button>} />}
          </>
        } />
      {r.status === 'pending_approval' && panelKey === 'member' && <Alert tone="info">Our team reviews new requests before vendors can see them.</Alert>}
      {r.rejectionReason && panelKey !== 'vendor' && <Alert tone="danger" title={r.status === 'rejected' ? 'Not approved' : 'Closed'}>{r.rejectionReason}</Alert>}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-6"><CardHeader title="What’s needed" /><p className="text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{r.description}</p></Card>
        <Card className="p-5"><dl className="grid gap-3 text-[14px]">{[['Budget', formatINR(r.budgetPaise)], ['Timeline', `${r.timelineDays} days`], ['Type', r.kind === 'project' ? 'Project' : 'Service'], ['Bids', String(r.bidCount)], ...(panelKey === 'admin' && r.owner ? [['Posted by', `${r.owner.name} ${r.owner.memberId ?? ''}`]] : [])].map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl></Card>
      </div>
      {panelKey === 'vendor' ? <BidForm request={r} onSaved={apply} /> : (
        <Card className="p-5">
          <CardHeader title={`Bids (${r.bids.length})`} description="Lowest first" />
          {r.bids.length === 0 ? <EmptyState title="No bids yet" description={r.status === 'open' ? 'Vendors can see this request now.' : undefined} /> : (
            <ul className="grid gap-3">
              {r.bids.map((b) => (
                <li key={b.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><Link to={`/vendors/${b.vendor.slug}`} className="font-bold hover:text-brand-600">{b.vendor.name}</Link> <StatusBadge status={b.status} /><p className="text-[13px] text-muted">{b.vendor.city} · about {b.estimatedDays} days · {fmtDate(b.createdAt)}</p></div>
                    <div className="text-right"><b className="text-[18px]">{formatINR(b.totalPaise)}</b><p className="text-[12.5px] text-muted">{formatINR(b.amountPaise)}{b.gstPaise > 0 && ` + ${formatINR(b.gstPaise)} GST`}{b.advancePaise > 0 && ` · advance ${formatINR(b.advancePaise)}`}</p></div>
                  </div>
                  <p className="mt-3 text-[14px] whitespace-pre-line text-ink-2">{b.proposal}</p>
                  {panelKey === 'member' && r.status === 'open' && b.status === 'submitted' && <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => setAccepting(b)}>Accept</Button><ConfirmDialog title={`Reject ${b.vendor.name}’s bid?`} description="They can’t bid on this request again." confirmLabel="Reject" tone="danger" onConfirm={() => run(() => rejectBid(r.id, b.id), 'Bid rejected')} trigger={(o) => <Button size="sm" variant="outline" onClick={o}>Reject</Button>} /></div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {accepting && <AcceptDialog requestId={r.id} bid={accepting} onClose={() => setAccepting(undefined)} />}
    </div>
  );
}

function AcceptDialog({ requestId, bid, onClose }: { requestId: string; bid: BidView; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useAddressForm();
  const last = useQuery({ queryKey: ['orders', 'last-address'], queryFn: lastAddress });
  const hasAdvance = bid.advancePaise > 0 && bid.advancePaise < bid.amountPaise;
  const [plan, setPlan] = useState<PaymentPlan>(hasAdvance ? 'advance' : 'full');
  useEffect(() => { const a = last.data?.address; if (a && !form.formState.isDirty) form.reset({ ...a, line2: a.line2 ?? '' }); }, [last.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = form.handleSubmit(async (address) => {
    try {
      const { orderId } = await acceptBid(requestId, bid.id, { address, plan });
      for (const k of ['request', 'orders']) qc.invalidateQueries({ queryKey: [k] });
      toast.success('Bid accepted');
      navigate(`/member/orders/${orderId}`);
    } catch (e) { toast.error(errorMessage(e)); }
  });
  return (
    <Modal open onOpenChange={(o) => !o && !form.formState.isSubmitting && onClose()} title={`Accept ${bid.vendor.name}’s bid`} description={`${formatINR(bid.totalPaise)} in total. Other bids are rejected and an order is created for you to pay.`} className="max-h-[90dvh] max-w-2xl overflow-y-auto"
      footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button loading={form.formState.isSubmitting} onClick={submit}>Accept & create order</Button></>}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        {hasAdvance && <Field label="Payment">{({ id }) => <Select id={id} value={plan} onChange={(e) => setPlan(e.target.value as PaymentPlan)}><option value="advance">Advance now ({formatINR(bid.advancePaise)}{bid.gstPaise > 0 && ' + GST'}), balance later</option><option value="full">Full payment</option></Select>}</Field>}
        <AddressFields form={form} />
      </form>
    </Modal>
  );
}

function BidForm({ request: r, onSaved }: { request: ProjectRequestView; onSaved: (r: ProjectRequestView) => void }) {
  const b = r.myBid;
  const editable = r.status === 'open' && (!b || ['submitted', 'withdrawn'].includes(b.status));
  const { register, handleSubmit, setError, formState: { errors: e, isSubmitting } } = useForm<BidInput>({
    resolver: zodResolver(bidSchema, undefined, { raw: true }) as never,
    defaultValues: b ? { amount: b.amountPaise / 100, advance: b.advancePaise / 100, gstRatePct: b.gstRatePct || 18, estimatedDays: b.estimatedDays, proposal: b.proposal } : { amount: '' as never, advance: 0, gstRatePct: 18, estimatedDays: '' as never, proposal: '' },
  });
  const submit = handleSubmit(async (v) => { try { onSaved(await saveBid(r.id, v)); toast.success('Bid saved'); } catch (err) { if (!applyFieldErrors(err, setError)) toast.error(errorMessage(err)); } });
  return (
    <Card className="max-w-3xl p-6">
      <CardHeader title={b ? 'Your bid' : 'Submit a bid'} description="GST is added only if your business has a GSTIN on file." actions={b && <StatusBadge status={b.status} />} />
      {!editable && <Alert tone="info" className="mb-4">{b?.status === 'accepted' ? 'Your bid was accepted. The order appears under Orders once the buyer pays.' : 'This request is closed for bids.'}</Alert>}
      <form onSubmit={submit} noValidate>
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <Field label="Bid amount (₹, before GST)" error={e.amount?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={1} step="0.01" aria-invalid={invalid} {...register('amount')} />}</Field>
          <Field label="Advance you need (₹)" error={e.advance?.message}>{({ id, invalid }) => <Input id={id} type="number" min={0} step="0.01" aria-invalid={invalid} {...register('advance')} />}</Field>
          <Field label="GST rate" error={e.gstRatePct?.message}>{({ id }) => <Select id={id} {...register('gstRatePct')}>{GST_RATES.map((x) => <option key={x} value={x}>{x}%</option>)}</Select>}</Field>
          <Field label="Days needed" error={e.estimatedDays?.message} required>{({ id, invalid }) => <Input id={id} type="number" min={1} aria-invalid={invalid} {...register('estimatedDays')} />}</Field>
          <Field label="Proposal" error={e.proposal?.message} required className="sm:col-span-2">{({ id, invalid }) => <Textarea id={id} className="min-h-32" maxLength={3000} aria-invalid={invalid} {...register('proposal')} />}</Field>
        </fieldset>
        {editable && <div className="mt-5 flex gap-2"><Button type="submit" loading={isSubmitting}>{b?.status === 'submitted' ? 'Update bid' : 'Submit bid'}</Button>{b?.status === 'submitted' && <ConfirmDialog title="Withdraw your bid?" description="You can bid again while the request is open." confirmLabel="Withdraw" tone="danger" onConfirm={async () => { try { onSaved(await withdrawBid(r.id)); toast.success('Bid withdrawn'); } catch (x) { toast.error(errorMessage(x)); } }} trigger={(o) => <Button variant="outline" onClick={o}>Withdraw</Button>} />}</div>}
      </form>
    </Card>
  );
}
