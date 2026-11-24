import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Search, X } from 'lucide-react';
import type { LedgerReport, LedgerRow } from '@jr/shared';
import { LEDGER_CATEGORIES } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, ServerTable, type Column } from '@/design-system';
import { fmtDateTime } from '@/features/commerce/components';
import { ApiError, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';
import { exportTransactions, type ListQ, type Paged } from './api';

const PAGE_SIZE = 20;
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const newKey = () => crypto.randomUUID();
export const who = (p?: { name: string; memberId?: string }) => <><b className="block font-semibold text-ink">{p?.name ?? '—'}</b><span className="font-mono text-[12px] text-muted">{p?.memberId}</span></>;

/** One idempotency key per attempt: kept after a lost connection (so retrying is safe), renewed after a definite answer. */
export function useAttemptKey() {
  const ref = useRef(newKey());
  return { get: () => ref.current, done: () => { ref.current = newKey(); }, failed: (e: unknown) => { if (e instanceof ApiError && e.status !== 0 && e.status < 500) ref.current = newKey(); } };
}

export function TestMoneyNote({ on }: { on?: boolean }) {
  return on ? <Alert tone="warn" title="Test mode">Balances and payments here are test money. They can’t be used or paid out as real money.</Alert> : null;
}

interface Filter { key: string; label: string; options: { value: string; label: string }[] }
/** Server-paginated report with search, filters and dates kept in the URL. */
export function ReportPage<T, R extends Paged<T> = Paged<T>>({ panelKey, title, description, parent, queryKey, load, columns, rowKey, fixed, filters, search, dates = true, actions, top, emptyTitle, bare }: {
  panelKey: PanelKey; title: string; description?: ReactNode; parent?: { label: string; to: string }; queryKey: string; load: (q: ListQ) => Promise<R>; columns: Column<T>[]; rowKey: (r: T) => string;
  fixed?: ListQ; filters?: Filter[]; search?: string; dates?: boolean; actions?: (q: ListQ) => ReactNode; top?: (data: R | undefined) => ReactNode; emptyTitle?: string; bare?: boolean;
}) {
  const panel = PANELS[panelKey];
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    if (!keepPage) n.delete('page');
    setParams(n);
  };
  const page = Number(params.get('page') ?? 1);
  const query: ListQ = { page, pageSize: PAGE_SIZE };
  if (search) query.q = params.get('q') || undefined;
  if (dates) { query.from = params.get('from') || undefined; query.to = params.get('to') || undefined; }
  for (const f of filters ?? []) query[f.key] = params.get(f.key) || undefined;
  Object.assign(query, fixed);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['finance', queryKey, panelKey, query], queryFn: () => load(query), placeholderData: keepPreviousData });
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => setQ(params.get('q') ?? ''), [params]);
  const submit = (e: FormEvent) => { e.preventDefault(); set({ q: q.trim() || undefined }); };
  const body = (
    <>
      {top?.(data)}
      {(search || dates || filters?.length) && (
        <Card className="p-4">
          <form onSubmit={submit} role="search" className="flex flex-wrap items-end gap-3">
            {search && <div className="min-w-56 flex-1"><Input leftIcon={<Search />} className="h-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder={search} aria-label={search} /></div>}
            {filters?.map((f) => <label key={f.key} className="grid gap-1 text-[12.5px] font-semibold text-muted">{f.label}<Select className="h-10 w-40" value={params.get(f.key) ?? ''} onChange={(e) => set({ [f.key]: e.target.value || undefined })}><option value="">All</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></label>)}
            {dates && (['from', 'to'] as const).map((k) => <label key={k} className="grid gap-1 text-[12.5px] font-semibold text-muted">{k === 'from' ? 'From' : 'To'}<Input type="date" className="h-10 w-40" value={params.get(k) ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} /></label>)}
            {search && <Button type="submit" className="h-10">Search</Button>}
            {[...params.keys()].some((k) => k !== 'page') && <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={() => setParams(new URLSearchParams())}>Clear</Button>}
          </form>
        </Card>
      )}
      <Card className="p-4">
        <ServerTable rows={data?.data} columns={columns} rowKey={rowKey} loading={isLoading} error={error} onRetry={() => refetch()} total={data?.meta.total ?? 0} page={page} pageSize={PAGE_SIZE} onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined }, true)} emptyTitle={emptyTitle ?? 'Nothing here yet'} />
      </Card>
    </>
  );
  if (bare) return <div className="grid grid-cols-1 gap-5">{body}</div>;
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, ...(parent ? [parent] : []), { label: title }]} title={title} description={description} actions={actions?.(query)} />
      {body}
    </div>
  );
}

const ledgerColumns = (admin: boolean): Column<LedgerRow>[] => [
  { key: 'id', header: 'Transaction', cell: (r) => <><span className="block font-mono text-[12.5px] whitespace-nowrap text-ink">{r.txnId}</span><span className="text-[12px] whitespace-nowrap text-muted">{fmtDateTime(r.createdAt)}</span></> },
  ...(admin ? [{ key: 'u', header: 'Member', cell: (r: LedgerRow) => who(r.user) }] : []),
  { key: 'd', header: 'Description', cell: (r) => <span className="block min-w-44">{r.description}</span> },
  { key: 'c', header: 'Category', cell: (r) => <Badge>{label(r.category)}</Badge> },
  { key: 'w', header: 'Wallet', cell: (r) => label(r.wallet) },
  { key: 'a', header: 'Amount', align: 'right', cell: (r) => <b className={r.direction === 'credit' ? 'whitespace-nowrap text-success' : 'whitespace-nowrap text-ink'}>{r.direction === 'credit' ? '+' : '−'}{formatINR(r.amountPaise)}</b> },
  { key: 'b', header: 'Balance', align: 'right', cell: (r) => <span className="whitespace-nowrap">{formatINR(r.balanceAfterPaise)}</span> },
];
export function LedgerPage({ panelKey, title, description, load, admin, fixed, parent }: { panelKey: PanelKey; title: string; description?: string; load: (q: ListQ) => Promise<LedgerReport>; admin?: boolean; fixed?: ListQ; parent?: { label: string; to: string } }) {
  return (
    <ReportPage<LedgerRow, LedgerReport> panelKey={panelKey} title={title} description={description} parent={parent} queryKey={`ledger-${title}`} load={load} columns={ledgerColumns(!!admin)} rowKey={(r) => r.id} fixed={fixed} search={admin ? 'Transaction, description or member' : 'Transaction ID or description'}
      filters={[{ key: 'wallet', label: 'Wallet', options: [{ value: 'main', label: 'Main' }, { value: 'earnings', label: 'Earnings' }] }, ...(fixed?.direction ? [] : [{ key: 'direction', label: 'Type', options: [{ value: 'credit', label: 'Credit' }, { value: 'debit', label: 'Debit' }] }]), { key: 'category', label: 'Category', options: LEDGER_CATEGORIES.map((c) => ({ value: c, label: label(c) })) }]}
      actions={(q) => <Button variant="outline" size="sm" leftIcon={<Download className="size-4" />} onClick={() => exportTransactions(!!admin, q).catch((e) => toast.error(errorMessage(e)))}>Export CSV</Button>}
      top={(d) => <Stats items={[['Credit', d?.creditPaise], ['Debit', d?.debitPaise], ['Net', d ? d.creditPaise - d.debitPaise : undefined]]} />} emptyTitle="No transactions" />
  );
}
export function Stats({ items }: { items: [string, number | undefined][] }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{items.map(([k, v]) => <Card key={k} className="p-4"><div className="text-[12.5px] text-muted">{k}</div><div className="mt-0.5 text-xl font-extrabold text-navy-950">{v === undefined ? '–' : formatINR(v)}</div></Card>)}</div>;
}

/** Amount + wallet password, with server errors under the right field. */
export function MoneyForm({ button, extra, onSubmit, valid = true, hidePin, pinSet, panelBase }: { button: string; extra?: ReactNode; onSubmit: (v: { amount: number; pin: string; idempotencyKey: string }) => Promise<unknown>; valid?: boolean; hidePin?: boolean; pinSet?: boolean; panelBase: string }) {
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const key = useAttemptKey();
  if (!hidePin && pinSet === false) return <Alert tone="warn" title="Set a wallet password first">You need it to move money. <Link to={`${panelBase}/account`} className="font-semibold underline">Set it in Account & security</Link></Alert>;
  const go = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    const v: Record<string, string> = {};
    if (!(n >= 1) || !Number.isFinite(n)) v.amount = 'Enter an amount of at least ₹1';
    if (!hidePin && !/^\d{4,6}$/.test(pin)) v.pin = 'Enter your 4 to 6 digit wallet password';
    setErr(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try { await onSubmit({ amount: n, pin, idempotencyKey: key.get() }); key.done(); setAmount(''); setPin(''); setErr({}); } catch (x) {
      key.failed(x);
      setErr(x instanceof ApiError && x.fields ? x.fields : { _: errorMessage(x) });
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go} noValidate className="grid max-w-md gap-4">
      {extra}
      <Field label="Amount (₹)" error={err.amount} required>{({ id, invalid }) => <Input id={id} type="number" min={1} step="0.01" aria-invalid={invalid} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
      {!hidePin && <Field label="Wallet password" error={err.pin} required>{({ id, invalid }) => <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} aria-invalid={invalid} value={pin} onChange={(e) => setPin(e.target.value)} />}</Field>}
      {Object.entries(err).filter(([k]) => k !== 'amount' && k !== 'pin').map(([k, m]) => <p key={k} role="alert" className="text-[13px] text-danger">{m}</p>)}
      <div><Button type="submit" loading={busy} disabled={!valid}>{button}</Button></div>
    </form>
  );
}
