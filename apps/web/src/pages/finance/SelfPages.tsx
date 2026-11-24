import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Crown, TicketPercent } from 'lucide-react';
import type { BusinessRow, BusinessSummary, CommissionRow, EpinRow, MyCoupon, PlanRow, RewardRow, SettlementRow, TdsRow, WithdrawalRow } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, StatusBadge, type Column } from '@/design-system';
import { fmtDate } from '@/features/dashboard/widgets';
import { fmtDateTime, TestBadge } from '@/features/commerce/components';
import {
  buyEpin, findRecipient, getBusiness, getPlans, getTransactions, moveEarnings, myCommissions, myCoupons, myEpins, myRewards, mySettlements, mySubscriptions, myTds, myWithdrawals, redeemEpin, revealEpin, subscribe, topUp, transfer, useEarnings, useWallet, withdraw, type ListQ, type Paged,
} from '@/features/finance/api';
import { label, LedgerPage, MoneyForm, ReportPage, Stats, TestMoneyNote, useAttemptKey } from '@/features/finance/components';
import { ApiError, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

function useRefresh() { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ['finance'] }); }
const head = (k: PanelKey, title: string, description?: string, parent?: { label: string; to: string }) => <PageHeader className="mb-0" breadcrumbs={[{ label: PANELS[k].label, to: PANELS[k].base }, ...(parent ? [parent] : []), { label: title }]} title={title} description={description} />;
const off = (what: string) => <Alert tone="info" title={`${what} isn’t available yet`}>It opens once the platform switches it on.</Alert>;

/* ================================================================ Wallet */
export type WalletAction = 'overview' | 'top-up' | 'transfer' | 'withdraw' | 'password';
const WALLET_TITLE: Record<WalletAction, string> = { overview: 'Wallet', 'top-up': 'Top up', transfer: 'Transfer funds', withdraw: 'Withdraw / payout', password: 'Wallet password' };

export function WalletPage({ panelKey, action }: { panelKey: PanelKey; action: WalletAction }) {
  const { data: w, isLoading, error, refetch } = useWallet();
  const base = PANELS[panelKey].base;
  const refresh = useRefresh();
  const navigate = useNavigate();
  const s = w?.settings;
  return (
    <div className="grid grid-cols-1 gap-5">
      {head(panelKey, WALLET_TITLE[action], 'Your main balance pays for purchases. Earnings can be withdrawn to your bank.', action === 'overview' ? undefined : { label: 'Wallet', to: `${base}/wallet` })}
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading || !w || !s ? <Skeleton className="h-72" /> : (
        <>
          <TestMoneyNote on={w.testMode} />
          <Stats items={[['Main balance', w.mainPaise], ['Earnings balance', w.earningsPaise], ['Withdrawals in progress', w.pendingWithdrawalPaise]]} />
          {w.earningsPaise < 0 && <Alert tone="warn">Your earnings are below zero because of refunds on earlier sales. New earnings cover this first.</Alert>}
          {action === 'top-up' && (
            <Card className="p-6"><CardHeader title="Add money" description={s.topUpEnabled ? `Between ${formatINR(s.topUpMinPaise)} and ${formatINR(s.topUpMaxPaise)}. Topped-up money is for purchases and can’t be withdrawn.` : undefined} />
              {!s.topUpEnabled || !s.canPay ? off('Top-up') : <MoneyForm panelBase={base} hidePin button="Continue to payment" onSubmit={async (v) => { const p = await topUp(v.amount, v.idempotencyKey); navigate(`/member/pay/${p.id}`); }} />}
            </Card>
          )}
          {action === 'transfer' && (
            <>
              {panelKey === 'member' && <Card className="p-6"><CardHeader title="Send to another member" description={s.transferEnabled ? `From your main balance, up to ${formatINR(s.transferMaxPaise)} at a time.` : undefined} />{s.transferEnabled ? <TransferForm base={base} pinSet={w.pinSet} onDone={refresh} /> : off('Transfer')}</Card>}
              <Card className="p-6"><CardHeader title="Move earnings to main balance" description="Useful for purchases. This can’t be moved back." />
                <MoneyForm panelBase={base} pinSet={w.pinSet} button="Move" onSubmit={async (v) => { await moveEarnings(v); toast.success('Moved to your main balance'); refresh(); }} />
              </Card>
            </>
          )}
          {action === 'withdraw' && (
            <Card className="p-6"><CardHeader title="Withdraw to your bank" description={s.withdrawEnabled ? `Minimum ${formatINR(s.withdrawMinPaise)}${s.withdrawFeePaise ? `, fee ${formatINR(s.withdrawFeePaise)}` : ', no fee'}. From earnings only.` : undefined} />
              {!s.withdrawEnabled ? off('Withdrawal')
                : !w.bank ? <Alert tone="warn">Add your bank account first. <Link className="font-semibold underline" to={`${base}/profile`}>Open profile</Link></Alert>
                : s.withdrawRequiresKyc && !w.kycDone ? <Alert tone="warn">Your KYC must be approved first. <Link className="font-semibold underline" to={`${base}/profile`}>Check your documents</Link></Alert>
                : <MoneyForm panelBase={base} pinSet={w.pinSet} button="Request withdrawal" extra={<p className="text-[14px]">To <b>{w.bank.bankName} ••••{w.bank.accountLast4}</b> ({w.bank.holderName})</p>} onSubmit={async (v) => { await withdraw(v); toast.success('Withdrawal requested'); refresh(); }} />}
              <p className="mt-4 text-[13px]"><Link className="font-semibold text-brand-600 hover:underline" to={panelKey === 'member' ? '/member/wallet/payouts' : '/vendor/payouts'}>See your withdrawals</Link></p>
            </Card>
          )}
          {action === 'password' && <Card className="p-6"><CardHeader title="Wallet password" description="This is your 4–6 digit transaction PIN. It confirms transfers, wallet payments and withdrawals. Five wrong tries lock it for 15 minutes." /><p className="mb-4 text-[14px]">Status: <Badge tone={w.pinSet ? 'green' : 'amber'}>{w.pinSet ? 'Set' : 'Not set'}</Badge></p><ButtonLink to={`${base}/account`}>{w.pinSet ? 'Change' : 'Set'} wallet password</ButtonLink></Card>}
          {action === 'overview' && (
            <Card className="p-5"><CardHeader title="What would you like to do?" />
              <div className="flex flex-wrap gap-2">{panelKey === 'member' ? <><ButtonLink to={`${base}/wallet/top-up`}>Top up</ButtonLink><ButtonLink variant="outline" to={`${base}/wallet/transfer`}>Transfer</ButtonLink><ButtonLink variant="outline" to={`${base}/wallet/withdraw`}>Withdraw</ButtonLink><ButtonLink variant="outline" to={`${base}/wallet/transactions`}>Transactions</ButtonLink></> : <><ButtonLink to="/vendor/wallet/withdraw">Request payout</ButtonLink><ButtonLink variant="outline" to="/vendor/wallet/transactions">Transactions</ButtonLink><ButtonLink variant="outline" to="/vendor/earnings">Earnings report</ButtonLink></>}</div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function TransferForm({ base, pinSet, onDone }: { base: string; pinSet: boolean; onDone: () => void }) {
  const [id, setId] = useState('');
  const [note, setNote] = useState('');
  const [to, setTo] = useState<{ name: string; memberId: string }>();
  const [error, setError] = useState('');
  const check = async () => { try { setTo(await findRecipient(id.trim())); setError(''); } catch (e) { setTo(undefined); setError(errorMessage(e)); } };
  return (
    <div className="grid gap-4">
      <div className="flex max-w-md items-end gap-2">
        <Field label="Member ID" error={error} required className="flex-1">{({ id: f, invalid }) => <Input id={f} aria-invalid={invalid} value={id} onChange={(e) => { setId(e.target.value); setTo(undefined); }} placeholder="JR0000001" />}</Field>
        <Button variant="outline" disabled={id.trim().length < 3} onClick={check}>Check</Button>
      </div>
      {to && (
        <MoneyForm panelBase={base} pinSet={pinSet} button={`Send to ${to.name}`}
          extra={<><Alert tone="info">Sending to <b>{to.name}</b> ({to.memberId}). Transfers can’t be undone.</Alert><Field label="Note">{({ id: f }) => <Input id={f} maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />}</Field></>}
          onSubmit={async (v) => { await transfer({ ...v, memberId: to.memberId, note }); toast.success(`Sent to ${to.name}`); setTo(undefined); setId(''); setNote(''); onDone(); }} />
      )}
    </div>
  );
}

const WD: Column<WithdrawalRow>[] = [
  { key: 'n', header: 'Request', cell: (r) => <><span className="block font-mono text-[12.5px] text-ink">{r.requestNo}</span><span className="text-[12px] whitespace-nowrap text-muted">{fmtDateTime(r.createdAt)}</span></> },
  { key: 'b', header: 'Bank', cell: (r) => `${r.bank.bankName} ••••${r.bank.accountLast4}` }, { key: 'a', header: 'Amount', align: 'right', cell: (r) => formatINR(r.amountPaise) }, { key: 'f', header: 'Fee', align: 'right', cell: (r) => formatINR(r.feePaise) }, { key: 'p', header: 'You receive', align: 'right', cell: (r) => <b>{formatINR(r.netPaise)}</b> },
  { key: 's', header: 'Status', cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.isTest && <TestBadge />}</span> }, { key: 'u', header: 'Reference', cell: (r) => r.utr ?? r.reason ?? '—' },
];
export const WithdrawalsPage = ({ panelKey }: { panelKey: PanelKey }) => <ReportPage<WithdrawalRow> panelKey={panelKey} title={panelKey === 'vendor' ? 'Payout requests' : 'Payout report'} description="Your withdrawals to bank." queryKey="my-withdrawals" load={myWithdrawals} columns={WD} rowKey={(r) => r.id} search="Request number or UTR" actions={() => <ButtonLink size="sm" to={`${PANELS[panelKey].base}/wallet/withdraw`}>Request payout</ButtonLink>} />;
export const TransactionsPage = ({ panelKey, title = 'Transaction report', direction }: { panelKey: PanelKey; title?: string; direction?: 'credit' | 'debit' }) => <LedgerPage panelKey={panelKey} title={title} description="Every movement in your wallets, from the ledger." load={getTransactions} fixed={direction ? { direction } : undefined} />;

const TDS: Column<TdsRow>[] = [
  { key: 'd', header: 'Date', cell: (r) => fmtDate(r.createdAt) }, { key: 'f', header: 'Financial year', cell: (r) => `20${r.financialYear.slice(0, 2)}–${r.financialYear.slice(2)}` }, { key: 's', header: 'Source', cell: (r) => label(r.source) }, { key: 'g', header: 'Gross', align: 'right', cell: (r) => formatINR(r.grossPaise) }, { key: 'r', header: 'Rate', align: 'right', cell: (r) => `${r.ratePct}%` }, { key: 't', header: 'TDS', align: 'right', cell: (r) => <b>{formatINR(r.tdsPaise)}</b> }, { key: 'p', header: 'PAN', cell: (r) => r.panMasked ?? 'Not given' },
];
export const MyTdsPage = () => <ReportPage<TdsRow> panelKey="member" title="TDS report" description="Every payout that counts towards TDS, including those with none deducted." queryKey="my-tds" load={myTds} columns={TDS} rowKey={(r) => r.id} />;

/* ================================================================ Earnings & business */
const COMM: Column<CommissionRow>[] = [
  { key: 'o', header: 'Sale', cell: (r) => <><span className="block font-mono text-[12.5px] whitespace-nowrap">{r.orderNo}</span><span className="text-[12px] text-muted">{fmtDate(r.createdAt)}</span></> }, { key: 'f', header: 'From', cell: (r) => <>{r.from.name}<br /><span className="font-mono text-[12px] text-muted">{r.from.memberId}</span></> }, { key: 'l', header: 'Level', cell: (r) => <Badge tone={r.level === 1 ? 'blue' : 'violet'}>{r.level === 1 ? 'Direct' : `Level ${r.level}`}</Badge> },
  { key: 'g', header: 'Gross', align: 'right', cell: (r) => formatINR(r.grossPaise) }, { key: 't', header: 'TDS', align: 'right', cell: (r) => formatINR(r.tdsPaise) }, { key: 'r', header: 'Reversed', align: 'right', cell: (r) => formatINR(r.reversedPaise) }, { key: 'n', header: 'Paid', align: 'right', cell: (r) => <b>{formatINR(r.netPaise)}</b> }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];
type BizData = Paged<BusinessRow> & { summary: BusinessSummary };
const BIZ: Column<BusinessRow>[] = [{ key: 'n', header: 'Member', cell: (r) => <><b className="block font-semibold text-ink">{r.name}</b><span className="font-mono text-[12px] text-muted">{r.memberId}</span></> }, { key: 'l', header: 'Level', cell: (r) => (r.level === 1 ? 'Direct' : `Level ${r.level}`) }, { key: 'o', header: 'Completed orders', align: 'right', cell: (r) => r.orders }, { key: 'v', header: 'Business', align: 'right', cell: (r) => <b>{formatINR(r.valuePaise)}</b> }];

function EarningsStats() {
  const { data: e } = useEarnings();
  return <Stats items={[['Total earnings', e?.paidPaise], ['Waiting to be paid', e?.pendingPaise], ['Direct commissions', e?.directPaise], ['Indirect commissions', e?.indirectPaise], ['Rewards', e?.rewardsPaise], ['TDS deducted', e?.tdsPaise], ['Reversed (refunds)', e?.reversedPaise]]} />;
}
export function BusinessPage({ view }: { view: 'mine' | 'referral' | 'search' | 'total' }) {
  const t = { mine: ['My business', 'Your own completed purchases.'], referral: ['Referral business', 'Completed purchases by people in your network.'], search: ['Search business', 'Find business by member and date.'], total: ['Total business', 'Your purchases and your network’s.'] }[view] as [string, string];
  const top = (d?: BizData) => {
    const s = d?.summary;
    const network = s && s.direct.valuePaise + s.indirect.valuePaise;
    const items: [string, number | undefined][] = view === 'mine' ? [['My purchases', s?.own.valuePaise]] : [['My purchases', s?.own.valuePaise], ['Direct business', s?.direct.valuePaise], ['Indirect business', s?.indirect.valuePaise], ['Total', s && s.own.valuePaise + network!]];
    return <><Stats items={view === 'referral' ? items.slice(1, 3) : items} />{view === 'mine' && s && <Card className="p-5 text-[14px]">{s.own.orders} completed orders. <Link to="/member/purchases/history?status=completed" className="font-semibold text-brand-600 hover:underline">View them</Link></Card>}{view === 'total' && <EarningsStats />}</>;
  };
  return <ReportPage<BusinessRow, BizData> panelKey="member" title={t[0]} description={t[1]} queryKey="business" load={getBusiness} columns={BIZ} rowKey={(r) => r.memberId} search={view === 'mine' ? undefined : 'Name or member ID'} filters={view === 'mine' ? [] : [{ key: 'scope', label: 'Network', options: [{ value: 'direct', label: 'Direct' }, { value: 'indirect', label: 'Indirect' }] }]} top={top} emptyTitle="No network business in this period" />;
}
export const CommissionsPage = ({ panelKey }: { panelKey: PanelKey }) => <ReportPage<CommissionRow> panelKey={panelKey} title="Commissions" description="Earned when people in your network complete purchases." queryKey="my-commissions" load={myCommissions} columns={COMM} rowKey={(r) => r.id} search="Order number" filters={[{ key: 'scope', label: 'Network', options: [{ value: 'direct', label: 'Direct' }, { value: 'indirect', label: 'Indirect' }] }, { key: 'status', label: 'Status', options: ['pending', 'paid', 'reversed'].map((v) => ({ value: v, label: label(v) })) }]} top={() => <EarningsStats />} />;
const SET: Column<SettlementRow>[] = [{ key: 'o', header: 'Order', cell: (r) => <span className="font-mono text-[12.5px] whitespace-nowrap">{r.orderNo}</span> }, { key: 'd', header: 'Settled', cell: (r) => fmtDate(r.createdAt) }, { key: 'g', header: 'Sale', align: 'right', cell: (r) => formatINR(r.grossPaise) }, { key: 'f', header: 'Platform fee', align: 'right', cell: (r) => formatINR(r.feePaise) }, { key: 'r', header: 'Reversed', align: 'right', cell: (r) => formatINR(r.reversedPaise) }, { key: 'n', header: 'Credited', align: 'right', cell: (r) => <b>{formatINR(r.netPaise)}</b> }];
export const VendorEarningsPage = () => <ReportPage<SettlementRow> panelKey="vendor" title="Earnings report" description="Completed orders credited to your earnings after the platform fee." queryKey="settlements" load={mySettlements} columns={SET} rowKey={(r) => r.id} top={() => <EarningsStats />} emptyTitle="No settled sales yet" />;

/* ================================================================ Rewards & coupons */
const RW: Column<RewardRow>[] = [{ key: 't', header: 'Reward', cell: (r) => <><b className="block font-semibold text-ink">{r.title}</b><span className="text-[12.5px] text-muted">{r.reason}</span></> }, { key: 'a', header: 'Amount', align: 'right', cell: (r) => (r.kind === 'cash' ? formatINR(r.amountPaise) : '—') }, { key: 'x', header: 'TDS', align: 'right', cell: (r) => (r.tdsPaise ? formatINR(r.tdsPaise) : '—') }, { key: 'd', header: 'Date', cell: (r) => fmtDate(r.createdAt) }];
export const MyRewardsPage = ({ kind }: { kind: 'cash' | 'other' }) => <ReportPage<RewardRow> panelKey="member" title={kind === 'cash' ? 'Cash rewards' : 'Other rewards'} queryKey="my-rewards" load={myRewards} fixed={{ kind }} columns={RW} rowKey={(r) => r.id} dates={false} emptyTitle="No rewards yet" />;

export function MyCouponsPage({ status, title }: { status: MyCoupon['status']; title: string }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'coupons'], queryFn: myCoupons });
  const rows = data?.data.filter((c) => c.status === status) ?? [];
  return (
    <div className="grid grid-cols-1 gap-5">
      {head('member', title, status === 'unused' ? 'Enter the code in your cart to use it.' : undefined, { label: 'My coupons', to: '/member/coupons/unused' })}
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? <Skeleton className="h-40" /> : rows.length === 0 ? <Card><EmptyState icon={TicketPercent} title={`No ${status} coupons`} /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((c) => (
          <Card key={c.id} className="p-5"><p className="text-[18px] font-extrabold text-navy-950">{c.offer}</p><p className="text-[14px] text-ink-2">{c.name}</p>
            <p className="mt-2 text-[13px] text-muted">{c.minOrderPaise > 0 && `Minimum ${formatINR(c.minOrderPaise)} · `}{c.status === 'used' ? `Saved ${formatINR(c.discountPaise ?? 0)} on ${fmtDate(c.usedAt!)}` : `${c.status === 'expired' ? 'Expired' : 'Valid till'} ${fmtDate(c.validTo)}`}</p>
            <div className="mt-3 flex items-center gap-2"><code className="rounded-lg bg-canvas px-3 py-1.5 font-mono text-[14px] font-bold">{c.code}</code>{c.status === 'unused' && <Button size="sm" variant="ghost" aria-label={`Copy ${c.code}`} onClick={() => navigator.clipboard.writeText(c.code).then(() => toast.success('Copied'), () => toast.error('Copy the code manually'))}><Copy className="size-4" /></Button>}</div>
          </Card>
        ))}</div>
      )}
    </div>
  );
}

/* ================================================================ Subscriptions & E-PINs */
const period = (p: PlanRow) => (p.kind === 'lifetime' ? 'Lifetime' : p.kind === 'yearly' ? '1 year' : `${p.durationDays} days`);
export function PlansPage() {
  const plans = useQuery({ queryKey: ['finance', 'plans'], queryFn: getPlans });
  const subs = useQuery({ queryKey: ['finance', 'subscriptions'], queryFn: mySubscriptions });
  const { data: w } = useWallet();
  const navigate = useNavigate();
  const refresh = useRefresh();
  const key = useAttemptKey();
  const [busy, setBusy] = useState('');
  const buy = async (id: string) => { setBusy(id); try { navigate(`/member/pay/${(await subscribe(id, key.get())).id}`); key.done(); } catch (e) { key.failed(e); toast.error(errorMessage(e)); } finally { setBusy(''); } };
  return (
    <div className="grid grid-cols-1 gap-5">
      {head('member', 'Subscription plans')}
      <TestMoneyNote on={w?.testMode} />
      {subs.data && subs.data.data.length > 0 && <Card className="p-5"><CardHeader title="Your subscriptions" /><ul className="grid gap-2 text-[14px]">{subs.data.data.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2"><span><b>{s.plan}</b> · {fmtDate(s.startAt)} – {s.endAt ? fmtDate(s.endAt) : 'lifetime'}</span><StatusBadge status={s.status} /></li>)}</ul></Card>}
      {plans.error ? <Card><ErrorState onRetry={() => plans.refetch()} /></Card> : plans.isLoading ? <Skeleton className="h-60" /> : !plans.data?.data.length ? <Card><EmptyState icon={Crown} title="No plans on sale yet" /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{plans.data.data.map((p) => (
          <Card key={p.id} className="flex flex-col p-6"><h2 className="text-[17px] font-bold">{p.name}</h2><p className="mt-1 text-[26px] font-extrabold text-navy-950">{formatINR(p.pricePaise)} <span className="text-[14px] font-medium text-muted">/ {period(p)}</span></p>
            <ul className="mt-4 grid flex-1 content-start gap-2 text-[14px]">{p.benefits.map((b) => <li key={b} className="flex gap-2"><Check className="mt-0.5 size-4 flex-none text-success" />{b}</li>)}</ul>
            <Button className="mt-5" loading={busy === p.id} disabled={!w?.settings.canPay} onClick={() => buy(p.id)}>{w && !w.settings.canPay ? 'Payments aren’t open yet' : 'Subscribe'}</Button>
          </Card>
        ))}</div>
      )}
      <Card className="p-6"><CardHeader title="Have an E-PIN?" description="Enter it to activate a subscription. Each E-PIN works once." /><RedeemForm onDone={refresh} /></Card>
    </div>
  );
}
function RedeemForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { await redeemEpin(code); toast.success('Subscription activated'); setCode(''); setError(''); onDone(); } catch (x) { setError(x instanceof ApiError && x.fields?.code ? x.fields.code : errorMessage(x)); } finally { setBusy(false); } };
  return <form onSubmit={go} className="flex max-w-md flex-wrap items-end gap-2"><Field label="E-PIN" error={error} className="min-w-56 flex-1">{({ id, invalid }) => <Input id={id} aria-invalid={invalid} className="font-mono" placeholder="XXXX-XXXX-XXXX-XXXX" maxLength={19} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />}</Field><Button type="submit" loading={busy} disabled={code.replace(/[^A-Z0-9]/g, '').length !== 16}>Activate</Button></form>;
}
export function MyEpinsPage({ special }: { special?: boolean }) {
  const { data: w } = useWallet();
  const plans = useQuery({ queryKey: ['finance', 'plans'], queryFn: getPlans });
  const [planId, setPlanId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<EpinRow>();
  const refresh = useRefresh();
  const key = useAttemptKey();
  const buy = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); try { await buyEpin({ planId, pin, idempotencyKey: key.get() }); key.done(); setPin(''); setError(''); toast.success('E-PIN generated'); refresh(); } catch (x) { key.failed(x); setError(errorMessage(x)); } finally { setBusy(false); } };
  const cols: Column<EpinRow>[] = [{ key: 'c', header: 'E-PIN', cell: (r) => <span className="font-mono">••••-{r.suffix}</span> }, { key: 'p', header: 'Plan', cell: (r) => r.plan }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'u', header: 'Used by', cell: (r) => r.usedBy?.name ?? '—' }, { key: 'd', header: 'Created', cell: (r) => fmtDate(r.createdAt) }, { key: 'x', header: '', cell: (r) => r.status === 'issued' && <Button size="sm" variant="outline" onClick={() => setReveal(r)}>Show</Button> }];
  return (
    <div className="grid grid-cols-1 gap-5">
      {head('member', special ? 'Special subscription' : 'Generate E-PIN', special ? 'Special plans are not sold. They are activated with an E-PIN given to you.' : 'Buy an E-PIN from your main balance to activate a plan for yourself or someone else.')}
      {special ? <Card className="p-6"><CardHeader title="Activate with an E-PIN" /><RedeemForm onDone={refresh} /></Card> : !w ? <Skeleton className="h-40" /> : !w.settings.memberEpinEnabled ? off('E-PIN generation') : (
        <Card className="p-6"><form onSubmit={buy} className="grid max-w-md gap-4">
          <Field label="Plan" required>{({ id }) => <Select id={id} value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Choose…</option>{plans.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatINR(p.pricePaise)}</option>)}</Select>}</Field>
          <Field label="Wallet password" error={error} required>{({ id, invalid }) => <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} aria-invalid={invalid} value={pin} onChange={(e) => setPin(e.target.value)} />}</Field>
          <div><Button type="submit" loading={busy} disabled={!planId || pin.length < 4}>Generate E-PIN</Button></div>
        </form></Card>
      )}
      <ReportPage<EpinRow> bare panelKey="member" title="" queryKey="my-epins" load={(q: ListQ) => myEpins(q)} columns={cols} rowKey={(r) => r.id} dates={false} emptyTitle="You have no E-PINs" />
      {reveal && <RevealDialog row={reveal} onClose={() => setReveal(undefined)} />}
    </div>
  );
}
function RevealDialog({ row, onClose }: { row: EpinRow; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const go = async () => { try { setCode((await revealEpin(row.id, pin)).code); } catch (e) { setError(errorMessage(e)); } };
  return <Modal open onOpenChange={(o) => !o && onClose()} title="Show E-PIN" description="Anyone with this code can use it once. Share it only with the person it’s for." footer={!code && <Button disabled={pin.length < 4} onClick={go}>Show</Button>}>{code ? <code className="block rounded-lg bg-canvas p-4 text-center font-mono text-[17px] font-bold">{code}</code> : <Field label="Wallet password" error={error}>{({ id }) => <Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} />}</Field>}</Modal>;
}
