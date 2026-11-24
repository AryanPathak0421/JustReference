import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GitBranch, Plus, Trash2 } from 'lucide-react';
import { LISTING_TYPES, PLAN_KINDS, type CommissionRuleRow, type EarningsSettings, type PlanRow, type WalletSettings } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '@/design-system';
import { fmtDateTime } from '@/features/commerce/components';
import { allPlans, getMoneySettings, getReconciliation, listRules, ruleActive, runReconciliation, savePlan, saveEarningsSettings, saveRule, saveWalletSettings } from '@/features/finance/api';
import { label } from '@/features/finance/components';
import { ApiError, errorMessage } from '@/lib/api';

const head = (title: string, description?: string, actions?: React.ReactNode) => <PageHeader className="mb-0" breadcrumbs={[{ label: 'Super Admin', to: '/super-admin' }, { label: title }]} title={title} description={description} actions={actions} />;
const errs = (e: unknown): Record<string, string> => (e instanceof ApiError && e.fields ? e.fields : { _: errorMessage(e) });

/* ================================================================ Commission rules + money rules */
export function CommissionRulesPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['finance', 'rules'], queryFn: listRules });
  const settings = useQuery({ queryKey: ['finance', 'money-settings'], queryFn: getMoneySettings });
  const [edit, setEdit] = useState<CommissionRuleRow | 'new'>();
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] });
  const toggle = async (r: CommissionRuleRow) => { try { await ruleActive(r.id, !r.active); toast.success(r.active ? 'Rule switched off' : 'Rule is active'); } catch (e) { toast.error(errorMessage(e)); } finally { refresh(); } };
  return (
    <div className="grid grid-cols-1 gap-5">
      {head('Commission & money rules', 'Nothing here has a built-in value. Rules apply to sales completed after they’re switched on.', <Button size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setEdit('new')}>New rule</Button>)}
      <Alert tone="warn" title="Get legal and CA advice first">Multi-level payouts, wallets with transfers or cash-out, and TDS are regulated in India. Commissions here are tied to completed sales only, never to sign-ups or E-PIN sales.</Alert>
      <Card className="p-5">
        <CardHeader title="Commission rules" />
        {rules.error ? <ErrorState onRetry={() => rules.refetch()} /> : rules.isLoading ? <Skeleton className="h-32" /> : !rules.data?.data.length ? <EmptyState icon={GitBranch} title="No commission rules" description="No commissions are paid until you add and activate one." /> : (
          <ul className="grid gap-3">{rules.data.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line p-4">
              <div className="min-w-0"><p className="flex flex-wrap items-center gap-2 font-bold">{r.name}<Badge tone={r.active ? 'green' : 'neutral'}>{r.active ? 'Active' : 'Off'}</Badge><span className="text-[12px] font-normal text-muted">version {r.version}</span></p>
                <p className="mt-1 text-[14px]">{r.levels.map((l, i) => `Level ${i + 1}: ${l.kind === 'percent' ? `${l.value}%` : `₹${l.value}`}`).join(' · ')}</p>
                <p className="text-[13px] text-muted">{r.listingTypes.map((t) => `${label(t)}s`).join(', ')} · on price {r.basis === 'before_gst' ? 'before' : 'including'} GST{r.maxPayoutPaise ? ` · max ${formatINR(r.maxPayoutPaise)} per sale` : ''}{r.effectiveFrom ? ` · from ${r.effectiveFrom}` : ''}{r.effectiveTo ? ` · until ${r.effectiveTo}` : ''}</p></div>
              <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit(r)}>Edit</Button><ConfirmDialog title={r.active ? 'Switch this rule off?' : 'Activate this rule?'} description={r.active ? 'Sales completed from now on won’t earn from it.' : 'Sales completed from now on will earn commissions.'} confirmLabel={r.active ? 'Switch off' : 'Activate'} tone={r.active ? 'danger' : 'primary'} onConfirm={() => toggle(r)} trigger={(o) => <Button size="sm" onClick={o}>{r.active ? 'Switch off' : 'Activate'}</Button>} /></div>
            </li>
          ))}</ul>
        )}
      </Card>
      {settings.error ? <Card><ErrorState onRetry={() => settings.refetch()} /></Card> : !settings.data ? <Skeleton className="h-80" /> : <><EarningsForm initial={settings.data.earnings} onSaved={refresh} /><WalletForm initial={settings.data.wallet} onSaved={refresh} /></>}
      {edit && <RuleDialog rule={edit === 'new' ? null : edit} onClose={() => setEdit(undefined)} onDone={() => { setEdit(undefined); refresh(); }} />}
    </div>
  );
}

function RuleDialog({ rule, onClose, onDone }: { rule: CommissionRuleRow | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ name: rule?.name ?? '', listingTypes: rule?.listingTypes ?? ([...LISTING_TYPES] as string[]), basis: rule?.basis ?? 'before_gst', levels: rule?.levels.map((l) => ({ kind: l.kind as string, value: String(l.value) })) ?? [{ kind: 'percent', value: '' }], maxPayout: rule?.maxPayoutPaise ? String(rule.maxPayoutPaise / 100) : '', effectiveFrom: rule?.effectiveFrom ?? '', effectiveTo: rule?.effectiveTo ?? '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await saveRule(rule?.id ?? null, v as never); toast.success(rule ? 'Rule updated' : 'Rule saved. Activate it when ready.'); onDone(); } catch (e) { setErr(errs(e)); } finally { setBusy(false); } };
  const level = (i: number, patch: Partial<{ kind: string; value: string }>) => setV({ ...v, levels: v.levels.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={rule ? 'Edit rule' : 'New commission rule'} className="max-h-[90dvh] max-w-xl overflow-y-auto" footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button loading={busy} onClick={go}>Save</Button></>}>
      <div className="grid gap-4">
        <Field label="Name" error={err.name} required>{({ id }) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="flex flex-wrap gap-5">{LISTING_TYPES.map((t) => <Checkbox key={t} label={`${label(t)}s`} checked={v.listingTypes.includes(t)} onChange={(e) => setV({ ...v, listingTypes: e.target.checked ? [...v.listingTypes, t] : v.listingTypes.filter((x) => x !== t) })} />)}</div>
        {err.listingTypes && <p className="text-[13px] text-danger">{err.listingTypes}</p>}
        <Field label="Percentages apply to">{({ id }) => <Select id={id} value={v.basis} onChange={(e) => setV({ ...v, basis: e.target.value })}><option value="before_gst">Price before GST</option><option value="with_gst">Price including GST</option></Select>}</Field>
        <div className="grid gap-2"><p className="text-[13px] font-semibold">Levels (1 = direct referrer)</p>
          {v.levels.map((l, i) => <div key={i} className="flex items-center gap-2"><span className="w-16 text-[13px] text-muted">Level {i + 1}</span><Select aria-label={`Level ${i + 1} type`} className="h-10 w-32" value={l.kind} onChange={(e) => level(i, { kind: e.target.value })}><option value="percent">Percent</option><option value="flat">Flat ₹</option></Select><Input aria-label={`Level ${i + 1} value`} type="number" min={0} step="0.01" className="h-10" value={l.value} onChange={(e) => level(i, { value: e.target.value })} /><Button variant="ghost" size="icon" aria-label={`Remove level ${i + 1}`} disabled={v.levels.length === 1} onClick={() => setV({ ...v, levels: v.levels.filter((_, n) => n !== i) })}><Trash2 className="size-4" /></Button></div>)}
          {Object.entries(err).filter(([k]) => k.startsWith('levels')).map(([k, m]) => <p key={k} className="text-[13px] text-danger">{m}</p>)}
          <div><Button size="sm" variant="outline" disabled={v.levels.length >= 15} onClick={() => setV({ ...v, levels: [...v.levels, { kind: 'percent', value: '' }] })}>Add level</Button></div>
        </div>
        <Field label="Most paid out per sale (₹)" hint="Blank = up to the sale amount" error={err.maxPayout}>{({ id }) => <Input id={id} type="number" value={v.maxPayout} onChange={(e) => setV({ ...v, maxPayout: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="From">{({ id }) => <Input id={id} type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} />}</Field><Field label="Until" error={err.effectiveTo}>{({ id }) => <Input id={id} type="date" value={v.effectiveTo} onChange={(e) => setV({ ...v, effectiveTo: e.target.value })} />}</Field></div>
        {err._ && <p role="alert" className="text-[13px] text-danger">{err._}</p>}
      </div>
    </Modal>
  );
}

function Num({ label: l, value, onChange, hint, error, step }: { label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string; step?: string }) {
  return <Field label={l} hint={hint} error={error}>{({ id, describedBy }) => <Input id={id} type="number" min={0} step={step ?? '0.01'} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value)} />}</Field>;
}
function EarningsForm({ initial, onSaved }: { initial: EarningsSettings; onSaved: () => void }) {
  const toForm = (s: EarningsSettings) => ({ ...s, platformFeePct: s.platformFeePct == null ? '' : String(s.platformFeePct), settlementHoldDays: String(s.settlementHoldDays), commissionHoldDays: String(s.commissionHoldDays), tdsRatePct: String(s.tdsRatePct), tdsNoPanRatePct: String(s.tdsNoPanRatePct), tdsThreshold: String(s.tdsThresholdPaise / 100) });
  const [v, setV] = useState(toForm(initial));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(toForm(initial)), [initial]);
  const save = async () => { setBusy(true); try { await saveEarningsSettings({ platformFeePct: v.platformFeePct === '' ? null : Number(v.platformFeePct), settlementHoldDays: Number(v.settlementHoldDays), commissionHoldDays: Number(v.commissionHoldDays), tdsEnabled: v.tdsEnabled, tdsRatePct: Number(v.tdsRatePct), tdsNoPanRatePct: Number(v.tdsNoPanRatePct), tdsThresholdPaise: Math.round(Number(v.tdsThreshold) * 100), tdsOnRewards: v.tdsOnRewards }); setErr({}); toast.success('Saved'); onSaved(); } catch (e) { setErr(errs(e)); toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const n = (k: 'platformFeePct' | 'settlementHoldDays' | 'commissionHoldDays' | 'tdsRatePct' | 'tdsNoPanRatePct' | 'tdsThreshold', l: string, hint?: string, step?: string) => <Num label={l} value={v[k]} hint={hint} step={step} error={err[k === 'tdsThreshold' ? 'tdsThresholdPaise' : k]} onChange={(x) => setV({ ...v, [k]: x })} />;
  return (
    <Card className="p-6"><CardHeader title="Vendor settlement, waiting periods & TDS" />
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {n('platformFeePct', 'Platform fee on sales (%)', 'Blank = not decided: vendors aren’t credited yet. 0 = no fee.')}{n('settlementHoldDays', 'Credit vendors after (days)', 'Days after completion', '1')}{n('commissionHoldDays', 'Commissions payable after (days)', 'Days after completion', '1')}
        {n('tdsRatePct', 'TDS rate with PAN (%)')}{n('tdsNoPanRatePct', 'TDS rate without PAN (%)')}{n('tdsThreshold', 'TDS yearly threshold (₹)', 'TDS applies to payouts after the year’s total passes this')}
        <Checkbox label="Deduct TDS on commissions" checked={v.tdsEnabled} onChange={(e) => setV({ ...v, tdsEnabled: e.target.checked })} /><Checkbox label="Also on cash rewards" checked={v.tdsOnRewards} onChange={(e) => setV({ ...v, tdsOnRewards: e.target.checked })} />
      </div>
      <Button className="mt-5" loading={busy} onClick={save}>Save settlement rules</Button>
    </Card>
  );
}
function WalletForm({ initial, onSaved }: { initial: WalletSettings; onSaved: () => void }) {
  const toForm = (s: WalletSettings) => ({ ...s, topUpMin: String(s.topUpMinPaise / 100), topUpMax: String(s.topUpMaxPaise / 100), transferMax: String(s.transferMaxPaise / 100), withdrawMin: String(s.withdrawMinPaise / 100), withdrawFee: String(s.withdrawFeePaise / 100) });
  const [v, setV] = useState(toForm(initial));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(toForm(initial)), [initial]);
  const p = (s: string) => Math.round(Number(s) * 100);
  const save = async () => { setBusy(true); try { await saveWalletSettings({ topUpEnabled: v.topUpEnabled, topUpMinPaise: p(v.topUpMin), topUpMaxPaise: p(v.topUpMax), transferEnabled: v.transferEnabled, transferMaxPaise: p(v.transferMax), withdrawEnabled: v.withdrawEnabled, withdrawMinPaise: p(v.withdrawMin), withdrawFeePaise: p(v.withdrawFee), withdrawRequiresKyc: v.withdrawRequiresKyc, memberEpinEnabled: v.memberEpinEnabled }); setErr({}); toast.success('Saved'); onSaved(); } catch (e) { setErr(errs(e)); toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <Card className="p-6"><CardHeader title="Wallet" description="Topped-up money can only be spent or transferred. Only earnings can be withdrawn." />
      <div className="grid gap-5">
        <div className="grid items-end gap-4 sm:grid-cols-3"><Checkbox label="Allow top-ups" checked={v.topUpEnabled} onChange={(e) => setV({ ...v, topUpEnabled: e.target.checked })} /><Num label="Minimum top-up (₹)" value={v.topUpMin} onChange={(x) => setV({ ...v, topUpMin: x })} /><Num label="Maximum top-up (₹)" value={v.topUpMax} error={err.topUpMaxPaise} onChange={(x) => setV({ ...v, topUpMax: x })} /></div>
        <div className="grid items-end gap-4 sm:grid-cols-3"><Checkbox label="Allow transfers between members" checked={v.transferEnabled} onChange={(e) => setV({ ...v, transferEnabled: e.target.checked })} /><Num label="Most per transfer (₹)" value={v.transferMax} onChange={(x) => setV({ ...v, transferMax: x })} /></div>
        <div className="grid items-end gap-4 sm:grid-cols-3"><Checkbox label="Allow withdrawals" checked={v.withdrawEnabled} onChange={(e) => setV({ ...v, withdrawEnabled: e.target.checked })} /><Num label="Minimum withdrawal (₹)" value={v.withdrawMin} error={err.withdrawMinPaise} onChange={(x) => setV({ ...v, withdrawMin: x })} /><Num label="Withdrawal fee (₹)" value={v.withdrawFee} onChange={(x) => setV({ ...v, withdrawFee: x })} /></div>
        <Checkbox label="Require approved KYC before withdrawing" checked={v.withdrawRequiresKyc} onChange={(e) => setV({ ...v, withdrawRequiresKyc: e.target.checked })} /><Checkbox label="Members may buy E-PINs from their wallet" checked={v.memberEpinEnabled} onChange={(e) => setV({ ...v, memberEpinEnabled: e.target.checked })} />
      </div>
      <Button className="mt-5" loading={busy} onClick={save}>Save wallet rules</Button>
    </Card>
  );
}

/* ================================================================ Plans */
export function PlansAdminPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'all-plans'], queryFn: allPlans });
  const [edit, setEdit] = useState<PlanRow | 'new'>();
  return (
    <div className="grid grid-cols-1 gap-5">
      {head('Subscription plans', 'What a plan unlocks on the platform is still to be decided; benefits are shown as text.', <Button size="sm" leftIcon={<Plus className="size-4" />} onClick={() => setEdit('new')}>New plan</Button>)}
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? <Skeleton className="h-40" /> : !data?.data.length ? <Card><EmptyState title="No plans yet" /></Card> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.data.map((p) => <Card key={p.id} className="p-5"><p className="flex items-center justify-between gap-2 font-bold">{p.name}<Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'On sale' : 'Off'}</Badge></p><p className="mt-1 text-[22px] font-extrabold">{formatINR(p.pricePaise)}</p><p className="text-[13px] text-muted">{label(p.kind)}{p.durationDays ? `, ${p.durationDays} days` : ''}</p><Button size="sm" variant="outline" className="mt-4" onClick={() => setEdit(p)}>Edit</Button></Card>)}</div>}
      {edit && <PlanDialog plan={edit === 'new' ? null : edit} onClose={() => setEdit(undefined)} onDone={() => { setEdit(undefined); qc.invalidateQueries({ queryKey: ['finance'] }); }} />}
    </div>
  );
}
function PlanDialog({ plan, onClose, onDone }: { plan: PlanRow | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ name: plan?.name ?? '', kind: plan?.kind ?? 'yearly', durationDays: plan?.durationDays ? String(plan.durationDays) : '', price: plan ? String(plan.pricePaise / 100) : '', benefits: plan?.benefits.join('\n') ?? '', active: plan?.active ?? false });
  const [err, setErr] = useState<Record<string, string>>({});
  const go = async () => { try { await savePlan(plan?.id ?? null, { ...v, benefits: v.benefits.split('\n').map((s) => s.trim()).filter(Boolean) } as never); toast.success('Plan saved'); onDone(); } catch (e) { setErr(errs(e)); } };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={plan ? 'Edit plan' : 'New plan'} className="max-h-[90dvh] overflow-y-auto" footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button onClick={go}>Save</Button></>}>
      <div className="grid gap-4">
        <Field label="Name" error={err.name} required>{({ id }) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="Type" hint="Special plans aren’t sold; they need an E-PIN.">{({ id }) => <Select id={id} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as never })}>{PLAN_KINDS.map((k) => <option key={k} value={k}>{label(k)}</option>)}</Select>}</Field>
        {(v.kind === 'time_based' || v.kind === 'special') && <Num label="Days" step="1" value={v.durationDays} error={err.durationDays} onChange={(x) => setV({ ...v, durationDays: x })} />}
        <Num label="Price (₹)" value={v.price} error={err.price} onChange={(x) => setV({ ...v, price: x })} />
        <Field label="Benefits" hint="One per line" error={err.benefits}>{({ id }) => <Textarea id={id} value={v.benefits} onChange={(e) => setV({ ...v, benefits: e.target.value })} />}</Field>
        <Checkbox label="On sale" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        {err._ && <p role="alert" className="text-[13px] text-danger">{err._}</p>}
      </div>
    </Modal>
  );
}

/* ================================================================ Reconciliation */
export function ReconciliationCard() {
  const qc = useQueryClient();
  const { data: r, error, refetch } = useQuery({ queryKey: ['finance', 'reconciliation'], queryFn: getReconciliation });
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { qc.setQueryData(['finance', 'reconciliation'], await runReconciliation()); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <Card className="p-5"><CardHeader title="Ledger check" description="Runs daily: every balance must equal the sum of its ledger entries." actions={<Button size="sm" variant="outline" loading={busy} onClick={run}>Run now</Button>} />
      {error ? <ErrorState onRetry={() => refetch()} /> : !r ? <Skeleton className="h-10" /> : !r.ranAt ? <p className="text-[14px] text-muted">Not run yet.</p> : r.mismatches.length === 0 ? <Alert tone="success">{r.wallets} wallets checked {fmtDateTime(r.ranAt)}. All balanced.</Alert> : <Alert tone="danger" title={`${r.mismatches.length} mismatches`}><ul>{r.mismatches.map((m, i) => <li key={i} className="font-mono text-[12.5px]">{m.user} {m.wallet}: balance {formatINR(m.balancePaise)}, ledger {formatINR(m.ledgerPaise)}</li>)}</ul></Alert>}
    </Card>
  );
}
