import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, HelpCircle } from 'lucide-react';
import type { CommissionRow, CouponRow, EpinRow, RewardRow, TdsRow, WithdrawalRow } from '@jr/shared';
import { LISTING_TYPES } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, type Column } from '@/design-system';
import { useAuth } from '@/features/auth/AuthProvider';
import { fmtDate } from '@/features/dashboard/widgets';
import { fmtDateTime, ReasonDialog, TestBadge } from '@/features/commerce/components';
import {
  allBalances, allCommissions, allPlans, allRewards, allTds, allTransactions, allWithdrawals, assignCoupon, blockEpin, couponActive, createCoupon, decideWithdrawal, generateEpins, issueEpin, listCoupons, listEpins, markPaid, moneySummary, payCommissions, payReward,
} from '@/features/finance/api';
import { label, LedgerPage, newKey, ReportPage, Stats, useAttemptKey, who } from '@/features/finance/components';
import { RevealAccountButton } from '@/pages/admin/MemberExtrasPages';
import { ApiError, errorMessage } from '@/lib/api';
import type { PanelKey } from '@/panels/navigation';

function useRefresh() { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ['finance'] }); }
const firstError = (e: unknown) => (e instanceof ApiError && e.fields ? Object.values(e.fields)[0]! : errorMessage(e));

function Summary() {
  const { data: s } = useQuery({ queryKey: ['finance', 'summary'], queryFn: moneySummary });
  return <Stats items={[['All main balances', s?.mainPaise], ['All earnings balances', s?.earningsPaise], ['Withdrawals waiting', s?.withdrawalsPendingPaise], ['Paid out', s?.withdrawnPaise]]} />;
}
export const AllTransactionsPage = ({ panelKey }: { panelKey: PanelKey }) => <LedgerPage panelKey={panelKey} title="Transactions" description="Every wallet movement on the platform." load={allTransactions} admin />;
type Bal = { id: string; name: string; memberId?: string; mainPaise: number; earningsPaise: number };
export const BalancesPage = ({ panelKey, title }: { panelKey: PanelKey; title: string }) => <ReportPage<Bal> panelKey={panelKey} title={title} queryKey="balances" load={allBalances} rowKey={(r) => r.id} search="Name or member ID" dates={false} top={() => <Summary />} columns={[{ key: 'n', header: 'Account', cell: (r) => who(r) }, { key: 'm', header: 'Main', align: 'right', cell: (r) => formatINR(r.mainPaise) }, { key: 'e', header: 'Earnings', align: 'right', cell: (r) => <span className={r.earningsPaise < 0 ? 'text-danger' : ''}>{formatINR(r.earningsPaise)}</span> }, { key: 't', header: 'Total', align: 'right', cell: (r) => <b>{formatINR(r.mainPaise + r.earningsPaise)}</b> }]} />;

/* ---------------------------------------------------------------- Withdrawals */
export function WithdrawalsAdminPage({ panelKey, title, status }: { panelKey: PanelKey; title: string; status?: string }) {
  const { can } = useAuth();
  const refresh = useRefresh();
  const run = async (f: () => Promise<unknown>, msg: string) => { try { await f(); toast.success(msg); } catch (e) { toast.error(errorMessage(e)); } finally { refresh(); } };
  const cols: Column<WithdrawalRow>[] = [
    { key: 'n', header: 'Request', cell: (r) => <><span className="block font-mono text-[12.5px] text-ink">{r.requestNo}</span><span className="text-[12px] whitespace-nowrap text-muted">{fmtDateTime(r.createdAt)}</span></> }, { key: 'u', header: 'Account', cell: (r) => who(r.user) },
    { key: 'b', header: 'Pay to', cell: (r) => <span className="block min-w-40 text-[13px]">{r.bank.holderName}<br />{r.bank.bankName} ••••{r.bank.accountLast4} · {r.bank.ifsc}{can('members.bank') && r.user && r.status === 'approved' && <span className="mt-1 block"><RevealAccountButton userId={r.user.id} last4={r.bank.accountLast4} /></span>}</span> },
    { key: 'a', header: 'Requested', align: 'right', cell: (r) => formatINR(r.amountPaise) }, { key: 'p', header: 'To transfer', align: 'right', cell: (r) => <b>{formatINR(r.netPaise)}</b> }, { key: 's', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.isTest && <TestBadge />}</span> }, { key: 'x', header: 'Reference', cell: (r) => r.utr ?? r.reason ?? '—' },
    ...(can('wallet.payout') ? [{ key: 'act', header: '', cell: (r: WithdrawalRow) => (
      <span className="flex gap-1.5">
        {r.status === 'requested' && <ConfirmDialog title={`Approve ${formatINR(r.netPaise)}?`} description="Approve, transfer the money from your bank, then record the UTR here." confirmLabel="Approve" onConfirm={() => run(() => decideWithdrawal(r.id, 'approve'), 'Approved')} trigger={(o) => <Button size="sm" onClick={o}>Approve</Button>} />}
        {r.status === 'approved' && <PaidDialog row={r} onDone={refresh} />}
        {['requested', 'approved'].includes(r.status) && <ReasonDialog title="Reject and return the money?" description={r.status === 'approved' ? 'Only if the bank transfer has not been made.' : undefined} label="Reject" tone="danger" onSubmit={(x) => decideWithdrawal(r.id, 'reject', x).then(refresh)} trigger={(o) => <Button size="sm" variant="outline" onClick={o}>Reject</Button>} />}
      </span>
    ) }] : []),
  ];
  return <ReportPage<WithdrawalRow> panelKey={panelKey} title={title} queryKey="withdrawals" load={allWithdrawals} columns={cols} rowKey={(r) => r.id} search="Request, UTR or member" fixed={status ? { status } : undefined} filters={status ? [] : [{ key: 'status', label: 'Status', options: ['requested', 'approved', 'paid', 'rejected'].map((v) => ({ value: v, label: label(v) })) }]} top={() => <Summary />} emptyTitle="No withdrawals" />;
}
function PaidDialog({ row, onDone }: { row: WithdrawalRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await markPaid(row.id, utr); setOpen(false); toast.success('Marked as paid'); onDone(); } catch (e) { setError(firstError(e)); } finally { setBusy(false); } };
  return <><Button size="sm" onClick={() => setOpen(true)}>Mark paid</Button><Modal open={open} onOpenChange={setOpen} title={`Paid ${formatINR(row.netPaise)} to ${row.bank.holderName}?`} description="Record the bank reference after making the transfer. This can’t be undone." footer={<Button loading={busy} onClick={go}>Mark paid</Button>}><Field label="UTR / bank reference" error={error} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} value={utr} onChange={(e) => setUtr(e.target.value)} />}</Field></Modal></>;
}

/* ---------------------------------------------------------------- Commissions */
export function CommissionsAdminPage({ panelKey, mode }: { panelKey: PanelKey; mode: 'pay' | 'all' }) {
  const { can } = useAuth();
  const refresh = useRefresh();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pay = async () => {
    try {
      const r = await payCommissions([...sel]);
      setSel(new Set());
      if (r.paid) toast.success(`Paid ${r.paid} commission${r.paid === 1 ? '' : 's'}`);
      if (r.failed.length) toast.error(`${r.failed.length} skipped: ${r.failed[0]!.message}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { refresh(); }
  };
  const cols: Column<CommissionRow>[] = [
    ...(mode === 'pay' && can('commissions.pay') ? [{ key: 'sel', header: '', cell: (r: CommissionRow) => <input type="checkbox" className="size-4" aria-label={`Select ${r.orderNo} level ${r.level}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /> }] : []),
    { key: 'e', header: 'Earner', cell: (r) => who(r.earner) }, { key: 'o', header: 'Sale', cell: (r) => <><span className="block font-mono text-[12.5px] whitespace-nowrap">{r.orderNo}</span><span className="text-[12px] text-muted">by {r.from.name}</span></> }, { key: 'l', header: 'Level', cell: (r) => r.level }, { key: 'ru', header: 'Rule', cell: (r) => r.ruleName },
    { key: 'g', header: 'Gross', align: 'right', cell: (r) => formatINR(r.grossPaise) }, { key: 'rv', header: 'Reversed', align: 'right', cell: (r) => formatINR(r.reversedPaise) }, { key: 't', header: 'TDS', align: 'right', cell: (r) => formatINR(r.tdsPaise) }, { key: 'n', header: 'Net paid', align: 'right', cell: (r) => <b>{formatINR(r.netPaise)}</b> }, { key: 's', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.isTest && <TestBadge />}</span> }, { key: 'a', header: 'Payable from', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.availableAt)}</span> },
  ];
  return <ReportPage<CommissionRow> key={mode} panelKey={panelKey} title={mode === 'pay' ? 'Pay commissions' : 'Referral income'} description={mode === 'pay' ? 'Commissions past the waiting period. TDS is taken according to the money rules.' : 'All commissions earned from referrals.'} queryKey="commissions" load={allCommissions} columns={cols} rowKey={(r) => r.id} search="Order or member" fixed={mode === 'pay' ? { status: 'ready' } : undefined} filters={mode === 'pay' ? [] : [{ key: 'status', label: 'Status', options: ['pending', 'paid', 'reversed'].map((v) => ({ value: v, label: label(v) })) }, { key: 'scope', label: 'Network', options: [{ value: 'direct', label: 'Direct' }, { value: 'indirect', label: 'Indirect' }] }]}
    actions={() => mode === 'pay' && can('commissions.pay') && <ConfirmDialog title={`Pay ${sel.size} commission${sel.size === 1 ? '' : 's'}?`} description="The net amount is credited to each earner’s earnings wallet." confirmLabel="Pay" onConfirm={pay} trigger={(o) => <Button size="sm" disabled={!sel.size} onClick={o}>Pay selected ({sel.size})</Button>} />} emptyTitle={mode === 'pay' ? 'Nothing ready to pay' : 'No commissions yet'} />;
}
export const InvestmentIncomePage = () => <><PageHeader breadcrumbs={[{ label: 'Admin', to: '/admin' }, { label: 'Investment income' }]} title="Investment income" /><Card><EmptyState icon={HelpCircle} title="Waiting for a decision" description="The brief lists “Investment income” without saying what it is. Offering returns on money can need SEBI or RBI approval, so nothing is built until the business defines it and takes legal advice." /></Card></>;

/* ---------------------------------------------------------------- TDS & rewards */
const TDS: Column<TdsRow>[] = [{ key: 'u', header: 'Member', cell: (r) => who(r.user) }, { key: 'd', header: 'Date', cell: (r) => fmtDate(r.createdAt) }, { key: 'f', header: 'FY', cell: (r) => r.financialYear }, { key: 's', header: 'Source', cell: (r) => label(r.source) }, { key: 'p', header: 'PAN', cell: (r) => r.panMasked ?? 'Not given' }, { key: 'g', header: 'Gross', align: 'right', cell: (r) => formatINR(r.grossPaise) }, { key: 'r', header: 'Rate', align: 'right', cell: (r) => `${r.ratePct}%` }, { key: 't', header: 'TDS', align: 'right', cell: (r) => <b>{formatINR(r.tdsPaise)}</b> }];
export const TdsAdminPage = ({ panelKey }: { panelKey: PanelKey }) => <ReportPage<TdsRow> panelKey={panelKey} title="TDS list" description="One line per payout, including those with no TDS." queryKey="tds" load={allTds} columns={TDS} rowKey={(r) => r.id} search="Name or member ID" />;

export function RewardsAdminPage({ panelKey, pay }: { panelKey: PanelKey; pay?: boolean }) {
  const refresh = useRefresh();
  const blank = { memberId: '', kind: 'cash', title: '', reason: '', amount: '' };
  const [v, setV] = useState(blank);
  const [err, setErr] = useState<Record<string, string>>({});
  const key = useAttemptKey();
  const go = async () => { try { await payReward({ ...v, amount: v.kind === 'cash' ? v.amount : undefined, idempotencyKey: key.get() }); key.done(); setV(blank); setErr({}); toast.success('Reward recorded'); refresh(); } catch (e) { key.failed(e); setErr(e instanceof ApiError && e.fields ? e.fields : {}); toast.error(errorMessage(e)); } };
  const cols: Column<RewardRow>[] = [{ key: 'u', header: 'Member', cell: (r) => who(r.user) }, { key: 't', header: 'Reward', cell: (r) => <><b className="block font-semibold text-ink">{r.title}</b><span className="text-[12.5px] text-muted">{r.reason}</span></> }, { key: 'k', header: 'Kind', cell: (r) => label(r.kind) }, { key: 'a', header: 'Amount', align: 'right', cell: (r) => (r.amountPaise ? formatINR(r.amountPaise) : '—') }, { key: 'x', header: 'TDS', align: 'right', cell: (r) => formatINR(r.tdsPaise) }, { key: 'd', header: 'Date', cell: (r) => fmtDate(r.createdAt) }];
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <ReportPage<RewardRow> panelKey={panelKey} title={pay ? 'Pay rewards' : 'Rewards list'} queryKey="rewards" load={allRewards} columns={cols} rowKey={(r) => r.id} search={pay ? undefined : 'Name or member ID'} dates={false} emptyTitle="No rewards yet"
      top={() => pay && (
        <Card className="p-6"><CardHeader title="New reward" description="Cash is credited to the member’s earnings wallet." />
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Member ID" error={err.memberId} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} value={v.memberId} onChange={set('memberId')} />}</Field>
            <Field label="Kind">{({ id }) => <Select id={id} value={v.kind} onChange={set('kind')}><option value="cash">Cash</option><option value="other">Other (gift, trophy…)</option></Select>}</Field>
            <Field label="Title" error={err.title} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} value={v.title} onChange={set('title')} />}</Field>
            {v.kind === 'cash' && <Field label="Amount (₹)" error={err.amount} required>{({ id, invalid }) => <Input id={id} type="number" min={1} step="0.01" aria-invalid={invalid} value={v.amount} onChange={set('amount')} />}</Field>}
            <Field label="Reason" error={err.reason} required className="sm:col-span-2">{({ id, invalid }) => <Textarea id={id} maxLength={300} aria-invalid={invalid} value={v.reason} onChange={set('reason')} />}</Field>
          </div>
          <div className="mt-4"><ConfirmDialog title="Give this reward?" description={v.kind === 'cash' ? `₹${v.amount || 0} to ${v.memberId || '…'}. This can’t be undone.` : `“${v.title}” to ${v.memberId || '…'}.`} confirmLabel="Give reward" onConfirm={go} trigger={(o) => <Button onClick={o}>Give reward</Button>} /></div>
        </Card>
      )} />
  );
}

/* ---------------------------------------------------------------- E-PINs */
export function EpinsAdminPage({ panelKey, mode }: { panelKey: PanelKey; mode: 'generate' | 'fresh' | 'used' | 'search' }) {
  const refresh = useRefresh();
  const title = { generate: 'Generate / issue E-PIN', fresh: 'Fresh E-PINs', used: 'Used E-PINs', search: 'Search E-PIN' }[mode];
  const run = async (f: () => Promise<unknown>, msg: string) => { try { await f(); toast.success(msg); } catch (e) { toast.error(errorMessage(e)); } finally { refresh(); } };
  const cols: Column<EpinRow>[] = [
    { key: 'c', header: 'E-PIN', cell: (r) => <span className="font-mono whitespace-nowrap">••••-{r.suffix}</span> }, { key: 'p', header: 'Plan', cell: (r) => r.plan }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'i', header: 'Issued to', cell: (r) => (r.issuedTo ? who(r.issuedTo) : '—') }, { key: 'u', header: 'Used by', cell: (r) => (r.usedBy ? who(r.usedBy) : '—') }, { key: 'd', header: 'Created', cell: (r) => fmtDate(r.createdAt) }, { key: 'e', header: 'Expires', cell: (r) => (r.expiresAt ? fmtDate(r.expiresAt) : 'Never') },
    { key: 'x', header: '', cell: (r) => <span className="flex gap-1.5">{r.status === 'fresh' && <IssueDialog row={r} onDone={refresh} />}{['fresh', 'issued'].includes(r.status) && <ConfirmDialog title="Block this E-PIN?" description="It can never be used again." confirmLabel="Block" tone="danger" onConfirm={() => run(() => blockEpin(r.id), 'Blocked')} trigger={(o) => <Button size="sm" variant="outline" onClick={o}>Block</Button>} />}</span> },
  ];
  return <ReportPage<EpinRow> key={mode} panelKey={panelKey} title={title} queryKey="epins" load={listEpins} columns={cols} rowKey={(r) => r.id} dates={false} search="Last 4 characters, name or member ID" fixed={mode === 'fresh' ? { status: 'fresh' } : mode === 'used' ? { status: 'used' } : undefined} filters={mode === 'search' || mode === 'generate' ? [{ key: 'status', label: 'Status', options: ['fresh', 'issued', 'used', 'blocked'].map((s) => ({ value: s, label: label(s) })) }] : []} top={() => mode === 'generate' && <GenerateCard onDone={refresh} />} emptyTitle="No E-PINs" />;
}
function GenerateCard({ onDone }: { onDone: () => void }) {
  const plans = useQuery({ queryKey: ['finance', 'all-plans'], queryFn: allPlans });
  const [v, setV] = useState({ planId: '', count: '1', memberId: '', expiresOn: '' });
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useAttemptKey();
  const go = async () => { setBusy(true); try { setCodes((await generateEpins({ ...v, idempotencyKey: key.get() })).codes); key.done(); setError(''); onDone(); } catch (e) { key.failed(e); setError(firstError(e)); } finally { setBusy(false); } };
  const save = () => { const u = URL.createObjectURL(new Blob([codes.join('\r\n')], { type: 'text/plain' })); Object.assign(document.createElement('a'), { href: u, download: 'epins.txt' }).click(); URL.revokeObjectURL(u); };
  return (
    <Card className="p-6"><CardHeader title="New E-PINs" description="Full codes are shown once, here. Afterwards only the last 4 characters are visible to admins." />
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <Field label="Plan" required>{({ id }) => <Select id={id} value={v.planId} onChange={(e) => setV({ ...v, planId: e.target.value })}><option value="">Choose…</option>{plans.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inactive)'}</option>)}</Select>}</Field>
        <Field label="How many?" required>{({ id }) => <Input id={id} type="number" min={1} max={100} value={v.count} onChange={(e) => setV({ ...v, count: e.target.value })} />}</Field>
        <Field label="Issue to member ID" hint="Optional">{({ id }) => <Input id={id} value={v.memberId} onChange={(e) => setV({ ...v, memberId: e.target.value })} />}</Field>
        <Field label="Expires on" hint="Optional">{({ id }) => <Input id={id} type="date" value={v.expiresOn} onChange={(e) => setV({ ...v, expiresOn: e.target.value })} />}</Field>
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <Button className="mt-4" loading={busy} disabled={!v.planId} onClick={go}>Generate</Button>
      {codes.length > 0 && <Alert tone="success" title={`${codes.length} generated: save them now`} className="mt-5"><pre className="my-2 max-h-48 overflow-auto font-mono text-[13px]">{codes.join('\n')}</pre><Button size="sm" variant="outline" leftIcon={<Download className="size-4" />} onClick={save}>Download</Button></Alert>}
    </Card>
  );
}
function IssueDialog({ row, onDone }: { row: EpinRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const go = async () => { try { await issueEpin(row.id, id); setOpen(false); toast.success('Issued'); onDone(); } catch (e) { setError(firstError(e)); } };
  return <><Button size="sm" onClick={() => setOpen(true)}>Issue</Button><Modal open={open} onOpenChange={setOpen} title="Issue E-PIN" description="The member can then see the full code in their panel." footer={<Button onClick={go}>Issue</Button>}><Field label="Member ID" error={error} required>{({ id: f }) => <Input id={f} value={id} onChange={(e) => setId(e.target.value)} />}</Field></Modal></>;
}

/* ---------------------------------------------------------------- Coupons */
export function CouponsPage({ panelKey }: { panelKey: PanelKey }) {
  const refresh = useRefresh();
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<CouponRow>();
  const toggle = async (c: CouponRow) => { try { await couponActive(c.id, !c.active); toast.success(c.active ? 'Switched off' : 'Switched on'); } catch (e) { toast.error(errorMessage(e)); } finally { refresh(); } };
  const cols: Column<CouponRow>[] = [
    { key: 'c', header: 'Code', cell: (r) => <><b className="block font-mono text-ink">{r.code}</b><span className="text-[12.5px] text-muted">{r.name}</span></> }, { key: 'o', header: 'Offer', cell: (r) => <span className="whitespace-nowrap">{r.kind === 'percent' ? `${r.value}%` : `₹${r.value}`}{r.maxDiscountPaise ? ` (max ${formatINR(r.maxDiscountPaise)})` : ''}</span> }, { key: 'm', header: 'Minimum', align: 'right', cell: (r) => formatINR(r.minOrderPaise) }, { key: 'f', header: 'Paid for by', cell: (r) => label(r.fundedBy) },
    { key: 'v', header: 'Valid', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.validFrom)} – {fmtDate(r.validTo)}</span> }, { key: 'u', header: 'Used', align: 'right', cell: (r) => `${r.usedCount}${r.totalLimit ? ` / ${r.totalLimit}` : ''}` }, { key: 'a', header: 'For', cell: (r) => (r.audience === 'everyone' ? 'Everyone' : `${r.assignedCount} member${r.assignedCount === 1 ? '' : 's'}`) }, { key: 's', header: 'Status', cell: (r) => (r.expired ? <Badge>Expired</Badge> : <Badge tone={r.active ? 'green' : 'neutral'}>{r.active ? 'On' : 'Off'}</Badge>) },
    { key: 'x', header: '', cell: (r) => <span className="flex gap-1.5">{r.audience === 'assigned' && <Button size="sm" variant="outline" onClick={() => setAssigning(r)}>Assign</Button>}<Button size="sm" variant="ghost" onClick={() => toggle(r)}>{r.active ? 'Switch off' : 'Switch on'}</Button></span> },
  ];
  return (
    <>
      <ReportPage<CouponRow> panelKey={panelKey} title="Coupons" description="Discounts are taken before GST." queryKey="all-coupons" load={listCoupons} columns={cols} rowKey={(r) => r.id} search="Code or name" dates={false} actions={() => <Button size="sm" onClick={() => setCreating(true)}>Create coupon</Button>} emptyTitle="No coupons yet" />
      {creating && <CouponDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
      {assigning && <AssignDialog coupon={assigning} onClose={() => setAssigning(undefined)} onDone={() => { setAssigning(undefined); refresh(); }} />}
    </>
  );
}
function CouponDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ code: newKey().slice(0, 8).toUpperCase(), name: '', kind: 'percent', value: '', minOrder: '0', maxDiscount: '', listingTypes: [...LISTING_TYPES] as string[], fundedBy: 'platform', validFrom: '', validTo: '', totalLimit: '', perUserLimit: '1', audience: 'everyone' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await createCoupon(v as never); toast.success('Coupon created'); onDone(); } catch (e) { setErr(e instanceof ApiError && e.fields ? e.fields : { _: errorMessage(e) }); } finally { setBusy(false); } };
  const input = (k: 'code' | 'name' | 'value' | 'minOrder' | 'maxDiscount' | 'validFrom' | 'validTo' | 'totalLimit' | 'perUserLimit', l: string, type = 'text', hint?: string) => <Field key={k} label={l} error={err[k]} hint={hint}>{({ id, invalid }) => <Input id={id} type={type} aria-invalid={invalid} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}</Field>;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Create coupon" className="max-h-[90dvh] max-w-2xl overflow-y-auto" footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button loading={busy} onClick={go}>Create</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {input('code', 'Code')}{input('name', 'Name')}
        <Field label="Type">{({ id }) => <Select id={id} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="percent">Percentage</option><option value="flat">Flat ₹</option></Select>}</Field>
        {input('value', v.kind === 'percent' ? 'Percent off' : 'Amount off (₹)', 'number')}{input('minOrder', 'Minimum order (₹)', 'number')}{input('maxDiscount', 'Maximum discount (₹)', 'number', 'Blank = no maximum')}
        {input('validFrom', 'Valid from', 'date')}{input('validTo', 'Valid to', 'date')}{input('totalLimit', 'Total uses', 'number', 'Blank = unlimited')}{input('perUserLimit', 'Uses per member', 'number')}
        <Field label="Who pays for the discount?" hint="Vendor: taken from their sale. Platform: the vendor still gets the full amount.">{({ id }) => <Select id={id} value={v.fundedBy} onChange={(e) => setV({ ...v, fundedBy: e.target.value })}><option value="platform">Platform</option><option value="vendor">Vendor</option></Select>}</Field>
        <Field label="Who can use it?">{({ id }) => <Select id={id} value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })}><option value="everyone">Everyone</option><option value="assigned">Only members I assign</option></Select>}</Field>
        <fieldset className="sm:col-span-2"><legend className="mb-2 text-[13px] font-semibold">Applies to</legend><div className="flex flex-wrap gap-5">{LISTING_TYPES.map((t) => <Checkbox key={t} label={`${label(t)}s`} checked={v.listingTypes.includes(t)} onChange={(e) => setV({ ...v, listingTypes: e.target.checked ? [...v.listingTypes, t] : v.listingTypes.filter((x) => x !== t) })} />)}</div>{err.listingTypes && <p className="text-[13px] text-danger">{err.listingTypes}</p>}</fieldset>
      </div>
      {err._ && <p role="alert" className="mt-3 text-[13px] text-danger">{err._}</p>}
    </Modal>
  );
}
function AssignDialog({ coupon, onClose, onDone }: { coupon: CouponRow; onClose: () => void; onDone: () => void }) {
  const [ids, setIds] = useState('');
  const [error, setError] = useState('');
  const go = async () => { try { await assignCoupon(coupon.id, ids.split(/[\s,]+/).filter(Boolean)); toast.success('Assigned'); onDone(); } catch (e) { setError(firstError(e)); } };
  return <Modal open onOpenChange={(o) => !o && onClose()} title={`Assign ${coupon.code}`} footer={<Button onClick={go}>Assign</Button>}><Field label="Member IDs" error={error} hint="Separate with commas or new lines">{({ id }) => <Textarea id={id} value={ids} onChange={(e) => setIds(e.target.value)} />}</Field></Modal>;
}
