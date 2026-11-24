import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, CheckCircle2, Printer, XCircle } from 'lucide-react';
import { EXTERNAL_CHANNELS, NOTIFICATION_EVENTS, REPORTS, ROLES, type CmsPage, type ExternalChannel, type NotificationSettings, type ReportKey } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Select, ServerTable, Skeleton, Textarea, type Column } from '@/design-system';
import { useAuth } from '@/features/auth/AuthProvider';
import { CountBarsCard, MoneyTrendCard } from '@/features/dashboard/charts';
import { MiniStats } from '@/features/dashboard/widgets';
import { orderStats } from '@/features/commerce/api';
import { fmtDateTime } from '@/features/commerce/components';
import { label } from '@/features/finance/components';
import { adminContent, adminPages, adminStats, deleteContent, exportReport, getHealth, getNotificationSettings, getReport, saveContent, saveNotificationSettings, savePage, testMessage, type ContentType } from '@/features/comms/api';
import { ApiError, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

const head = (k: PanelKey, title: string, description?: string, actions?: React.ReactNode) => <PageHeader className="mb-0" breadcrumbs={[{ label: PANELS[k].label, to: PANELS[k].base }, { label: title }]} title={title} description={description} actions={actions} />;
const errs = (e: unknown): Record<string, string> => (e instanceof ApiError && e.fields ? e.fields : { _: errorMessage(e) });

/* ================================================================ Reports */
const AVAILABLE: Record<PanelKey, ReportKey[]> = {
  member: ['credit', 'debit', 'wallet', 'earnings', 'tds', 'withdrawals', 'purchases', 'invoices', 'rewards'], vendor: ['sales', 'invoices', 'settlements', 'credit', 'debit', 'wallet', 'earnings', 'tds', 'withdrawals'],
  admin: Object.keys(REPORTS) as ReportKey[], 'super-admin': Object.keys(REPORTS) as ReportKey[],
};
export function ReportsPage({ panelKey, initial }: { panelKey: PanelKey; initial?: ReportKey }) {
  const [params, setParams] = useSearchParams();
  const list = AVAILABLE[panelKey];
  const key = list.find((k) => k === params.get('report')) ?? initial ?? list[0]!;
  const set = (p: Record<string, string | undefined>) => { const n = new URLSearchParams(params); if (!('page' in p)) n.delete('page'); for (const [k, v] of Object.entries(p)) (v ? n.set(k, v) : n.delete(k)); setParams(n); };
  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? undefined;
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const q = { from: params.get('from') ?? undefined, to: params.get('to') ?? undefined, q: params.get('q') ?? undefined, sort, dir, page, pageSize: 25 };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report', panelKey, key, q], queryFn: () => getReport(panelKey, key, q), placeholderData: keepPreviousData });
  const [busy, setBusy] = useState('');
  const [text, setText] = useState(q.q ?? '');
  useEffect(() => setText(params.get('q') ?? ''), [params]);
  const save = async (f: string) => { setBusy(f); try { await exportReport(panelKey, key, q, f); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); } };
  type Row = Record<string, string | number | null>;
  const cols: Column<Row>[] = (data?.columns ?? []).map((c) => ({ key: c.key, header: c.label, align: c.money || c.number ? 'right' : undefined, cell: (r) => { const v = r[c.key]; return v == null || v === '' ? '—' : c.money ? <span className="whitespace-nowrap">{formatINR(Number(v))}</span> : c.date ? <span className="whitespace-nowrap">{fmtDateTime(String(v))}</span> : String(v); } }));
  const sorts = (data?.columns ?? []).filter((c) => c.date || c.money || ['status', 'orderNo', 'no', 'txnId', 'level', 'person'].includes(c.key));
  return (
    <div className="grid grid-cols-1 gap-5 print-area">
      {head(panelKey, 'Reports', 'Built from actual transaction records.', <span className="flex flex-wrap gap-2 print:hidden">{(['pdf', 'xlsx', 'csv'] as const).map((f) => <Button key={f} size="sm" variant="outline" loading={busy === f} disabled={!!busy} onClick={() => save(f)}>{f === 'xlsx' ? 'Excel' : f.toUpperCase()}</Button>)}<Button size="sm" variant="outline" leftIcon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button></span>)}
      <Card className="p-4 print:hidden">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() || undefined }); }}>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Report<Select className="h-10 w-52" value={key} onChange={(e) => setParams({ report: e.target.value })}>{list.map((k) => <option key={k} value={k}>{REPORTS[k]}</option>)}</Select></label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">From<Input type="date" className="h-10 w-40" value={q.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">To<Input type="date" className="h-10 w-40" value={q.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Sort by<Select className="h-10 w-36" value={sort ?? ''} onChange={(e) => set({ sort: e.target.value || undefined })}><option value="">Date</option>{sorts.filter((c) => c.key !== 'date').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></label>
          <Button variant="outline" className="h-10" aria-label={dir === 'asc' ? 'Ascending: switch to descending' : 'Descending: switch to ascending'} onClick={() => set({ dir: dir === 'asc' ? undefined : 'asc' })}>{dir === 'asc' ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}</Button>
          <Input className="h-10 w-48" aria-label="Search report" placeholder="Search" value={text} onChange={(e) => setText(e.target.value)} /><Button type="submit" className="h-10">Search</Button>
        </form>
      </Card>
      {error instanceof ApiError && error.status === 403 ? <Card><EmptyState title="You don’t have permission for this report" /></Card> : (
        <Card className="p-4"><h2 className="mb-3 text-[16px] font-bold">{REPORTS[key]}</h2>
          {data && Object.keys(data.totals).length > 0 && <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-canvas p-3 text-[14px]">{data.columns.filter((c) => c.key in data.totals).map((c) => <span key={c.key}><span className="text-muted">{c.label}:</span> <b>{formatINR(data.totals[c.key]!)}</b></span>)}</div>}
          <ServerTable rows={data?.data.map((d, i) => ({ ...d, _i: i }))} columns={cols as never} rowKey={(r) => String((r as unknown as { _i: number })._i)} loading={isLoading} error={error} onRetry={() => refetch()} total={data?.meta.total ?? 0} page={page} pageSize={25} onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined })} emptyTitle="No records in this period" />
          {data?.limited && <p className="mt-2 text-[13px] text-muted">Downloads include the first 5,000 records. Narrow the dates for the rest.</p>}
        </Card>
      )}
    </div>
  );
}

/* ================================================================ Content */
const TABS = [{ value: 'pages', label: 'Pages' }, { value: 'posts', label: 'Blog' }, { value: 'testimonials', label: 'Testimonials' }, { value: 'announcements', label: 'Announcements' }, { value: 'ads', label: 'Advertisements' }] as const;
type F = { key: string; label: string; type?: 'textarea' | 'check' | 'date' | 'roles' | 'placement'; hint?: string };
const FIELDS: Record<ContentType, F[]> = {
  posts: [{ key: 'title', label: 'Title' }, { key: 'excerpt', label: 'Summary' }, { key: 'body', label: 'Post', type: 'textarea', hint: 'Blank line = new paragraph. “## ” starts a heading, “- ” a list.' }, { key: 'published', label: 'Published', type: 'check' }],
  testimonials: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role and city' }, { key: 'quote', label: 'Quote', type: 'textarea', hint: 'Only real quotes, used with permission.' }, { key: 'active', label: 'Show on the homepage', type: 'check' }],
  announcements: [{ key: 'title', label: 'Title' }, { key: 'body', label: 'Announcement', type: 'textarea' }, { key: 'audience', label: 'Who sees it', type: 'roles' }, { key: 'pinned', label: 'Pin to top', type: 'check' }, { key: 'active', label: 'Visible', type: 'check' }],
  ads: [{ key: 'title', label: 'Title' }, { key: 'text', label: 'Text' }, { key: 'link', label: 'Link', hint: '/products or https://…' }, { key: 'placement', label: 'Where', type: 'placement' }, { key: 'validFrom', label: 'From', type: 'date' }, { key: 'validTo', label: 'To', type: 'date' }, { key: 'active', label: 'On', type: 'check' }],
};
const BLANK: Record<ContentType, Record<string, unknown>> = {
  posts: { title: '', excerpt: '', body: '', published: false }, testimonials: { name: '', role: '', quote: '', active: false }, announcements: { title: '', body: '', audience: ['member'], pinned: false, active: true }, ads: { title: '', text: '', link: '', placement: 'member', validFrom: '', validTo: '', active: true },
};
export function ContentPage({ panelKey }: { panelKey: PanelKey }) {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.value === params.get('tab'))?.value ?? 'pages';
  return <div className="grid grid-cols-1 gap-5">{head(panelKey, 'Website content')}<div className="overflow-x-auto"><Segmented label="Content" value={tab} onChange={(v) => setParams({ tab: v })} options={[...TABS]} /></div>{tab === 'pages' ? <PagesEditor /> : <ItemsEditor key={tab} type={tab} />}</div>;
}
function PagesEditor() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['content', 'pages'], queryFn: adminPages });
  const [edit, setEdit] = useState<CmsPage>();
  if (error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  if (isLoading) return <Skeleton className="h-60" />;
  return <><Alert tone="info">Privacy policy, terms and refund policy should come from your legal adviser. Pages stay hidden until published.</Alert><Card className="p-5"><ul className="divide-y divide-line-2">{data!.data.map((p) => <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 py-3"><span><b>{p.title}</b> <span className="font-mono text-[12.5px] text-muted">/{p.key}</span></span><span className="flex items-center gap-2"><Badge tone={p.published ? 'green' : 'neutral'}>{p.published ? 'Published' : 'Hidden'}</Badge><Button size="sm" variant="outline" aria-label={`Edit ${p.title}`} onClick={() => setEdit(p)}>Edit</Button></span></li>)}</ul></Card>{edit && <PageDialog page={edit} onClose={() => setEdit(undefined)} onDone={() => { setEdit(undefined); qc.invalidateQueries({ queryKey: ['content'] }); }} />}</>;
}
function PageDialog({ page, onClose, onDone }: { page: CmsPage; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ title: page.title, body: page.body, published: page.published });
  const [err, setErr] = useState<Record<string, string>>({});
  const go = async () => { try { await savePage(page.key, v); toast.success('Saved'); onDone(); } catch (e) { setErr(errs(e)); } };
  return <Modal open onOpenChange={(o) => !o && onClose()} title={`Edit ${page.title}`} className="max-h-[92dvh] max-w-3xl overflow-y-auto" footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button onClick={go}>Save</Button></>}><div className="grid gap-4"><Field label="Title" error={err.title}>{({ id }) => <Input id={id} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field><Field label="Text" error={err.body} hint="Blank line = new paragraph. “## ” starts a heading, “- ” a list.">{({ id }) => <Textarea id={id} className="min-h-72" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field><Checkbox label="Published" checked={v.published} onChange={(e) => setV({ ...v, published: e.target.checked })} />{err._ && <p className="text-[13px] text-danger">{err._}</p>}</div></Modal>;
}
function ItemsEditor({ type }: { type: ContentType }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['content', type], queryFn: () => adminContent(type) });
  const [edit, setEdit] = useState<{ id: string | null; v: Record<string, unknown> }>();
  const refresh = () => qc.invalidateQueries({ queryKey: ['content'] });
  if (error) return <Card><ErrorState onRetry={() => refetch()} /></Card>;
  return (
    <Card className="p-5"><CardHeader title={TABS.find((t) => t.value === type)!.label} actions={<Button size="sm" onClick={() => setEdit({ id: null, v: BLANK[type] })}>Add</Button>} />
      {isLoading ? <Skeleton className="h-40" /> : !data?.data.length ? <EmptyState title="Nothing here yet" /> : <ul className="divide-y divide-line-2">{data.data.map((d) => { const on = !!(d.published ?? d.active); return <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="min-w-0"><b className="break-words">{String(d.title ?? d.name)}</b><span className="block max-w-xl truncate text-[13px] text-muted">{String(d.excerpt ?? d.quote ?? d.text ?? d.body ?? '')}</span></span><span className="flex items-center gap-2"><Badge tone={on ? 'green' : 'neutral'}>{on ? 'On' : 'Hidden'}</Badge><Button size="sm" variant="outline" onClick={() => setEdit({ id: d.id, v: Object.fromEntries(Object.keys(BLANK[type]).map((k) => [k, d[k] ?? BLANK[type][k]])) })}>Edit</Button><ConfirmDialog title="Delete this?" description="This can’t be undone." confirmLabel="Delete" tone="danger" onConfirm={async () => { try { await deleteContent(type, d.id); toast.success('Deleted'); } catch (e) { toast.error(errorMessage(e)); } finally { refresh(); } }} trigger={(o) => <Button size="sm" variant="ghost" onClick={o}>Delete</Button>} /></span></li>; })}</ul>}
      {edit && <ItemDialog type={type} item={edit} onClose={() => setEdit(undefined)} onDone={() => { setEdit(undefined); refresh(); }} />}
    </Card>
  );
}
function ItemDialog({ type, item, onClose, onDone }: { type: ContentType; item: { id: string | null; v: Record<string, unknown> }; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(item.v);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await saveContent(type, item.id, v); toast.success('Saved'); onDone(); } catch (e) { setErr(errs(e)); } finally { setBusy(false); } };
  const set = (k: string, x: unknown) => setV({ ...v, [k]: x });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={item.id ? 'Edit' : 'Add'} className="max-h-[92dvh] max-w-2xl overflow-y-auto" footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button loading={busy} onClick={go}>Save</Button></>}>
      <div className="grid gap-4">{FIELDS[type].map((f) => f.type === 'check' ? <Checkbox key={f.key} label={f.label} checked={!!v[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
        : f.type === 'roles' ? <fieldset key={f.key}><legend className="mb-2 text-[13px] font-semibold">{f.label}</legend><div className="flex flex-wrap gap-4">{ROLES.map((r) => <Checkbox key={r} label={label(r)} checked={(v.audience as string[]).includes(r)} onChange={(e) => set('audience', e.target.checked ? [...(v.audience as string[]), r] : (v.audience as string[]).filter((x) => x !== r))} />)}</div>{err.audience && <p className="text-[13px] text-danger">{err.audience}</p>}</fieldset>
        : <Field key={f.key} label={f.label} hint={f.hint} error={err[f.key]}>{({ id, invalid }) => f.type === 'textarea' ? <Textarea id={id} className="min-h-40" aria-invalid={invalid} value={String(v[f.key])} onChange={(e) => set(f.key, e.target.value)} /> : f.type === 'placement' ? <Select id={id} value={String(v[f.key])} onChange={(e) => set(f.key, e.target.value)}><option value="member">Member panel</option><option value="home">Homepage</option></Select> : <Input id={id} type={f.type === 'date' ? 'date' : 'text'} aria-invalid={invalid} value={String(v[f.key])} onChange={(e) => set(f.key, e.target.value)} />}</Field>)}
        {err._ && <p role="alert" className="text-[13px] text-danger">{err._}</p>}
      </div>
    </Modal>
  );
}

/* ================================================================ Analytics */
export function AnalyticsPage() {
  const s = useQuery({ queryKey: ['admin-stats'], queryFn: adminStats });
  const o = useQuery({ queryKey: ['orders', 'admin', 'stats'], queryFn: () => orderStats('admin') });
  const d = s.data;
  const top = (title: string, rows?: { name: string; orders: number; valuePaise: number }[]) => <Card className="p-5"><CardHeader title={title} /><DataTable rows={rows ?? []} loading={s.isLoading} rowKey={(r) => r.name} pageSize={5} columns={[{ key: 'n', header: 'Name', cell: (r) => r.name }, { key: 'o', header: 'Orders', align: 'right', cell: (r) => r.orders, value: (r) => r.orders }, { key: 'v', header: 'Value', align: 'right', cell: (r) => formatINR(r.valuePaise), value: (r) => r.valuePaise }]} emptyTitle="No paid orders yet" /></Card>;
  return (
    <div className="grid grid-cols-1 gap-5">{head('super-admin', 'Reports & analytics', undefined, <Link to="/super-admin/reports" className="text-[14px] font-semibold text-brand-600 hover:underline">Open reports</Link>)}
      {s.error ? <Card><ErrorState onRetry={() => s.refetch()} /></Card> : <>
        <MiniStats loading={s.isLoading} items={[{ label: 'Members', value: String(d?.members ?? '') }, { label: 'New this month', value: String(d?.membersThisMonth ?? '') }, { label: 'Joined by referral', value: d ? `${d.referredPct}%` : '' }, { label: 'Vendors', value: String(d?.vendors ?? '') }, { label: 'Listings', value: d ? String(d.products + d.services + d.projects) : '' }, { label: 'Open tickets', value: String(d?.openTickets ?? '') }]} />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2"><MoneyTrendCard title="Sales received" data={o.data?.months.map((m) => ({ month: m.month, a: m.valuePaise, b: 0 }))} loading={o.isLoading} names={{ a: 'Received less refunds', b: '' }} /><CountBarsCard title="Registrations" description="Per month" data={d?.growth} loading={s.isLoading} keys={[{ key: 'members', label: 'Members' }, { key: 'vendors', label: 'Vendors' }]} /></div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">{top('Top vendors', d?.topVendors)}{top('Top categories', d?.topCategories)}</div></>}
    </div>
  );
}

/* ================================================================ Messaging settings & health */
export function MessagingPage({ panelKey }: { panelKey: PanelKey }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const s = useQuery({ queryKey: ['settings', 'notifications'], queryFn: getNotificationSettings });
  const h = useQuery({ queryKey: ['health'], queryFn: getHealth });
  const [v, setV] = useState<NotificationSettings>();
  const [busy, setBusy] = useState('');
  useEffect(() => { if (s.data) setV(s.data); }, [s.data]);
  const save = async () => { setBusy('save'); try { qc.setQueryData(['settings', 'notifications'], await saveNotificationSettings(v!)); toast.success('Saved'); } catch (e) { toast.error(errs(e)._ ?? Object.values(errs(e))[0]!); } finally { setBusy(''); } };
  const test = async (c: ExternalChannel) => { setBusy(c); try { await testMessage(c); toast.success(h.data?.messagingDriver === 'console' ? 'Stored in the dev outbox' : 'Sent to your own address'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); } };
  const flip = (e: (typeof NOTIFICATION_EVENTS)[number], c: ExternalChannel) => v && setV({ ...v, events: { ...v.events, [e]: { ...v.events[e], [c]: !v.events[e][c] } } });
  return (
    <div className="grid grid-cols-1 gap-5">{head(panelKey, 'SMS / Email / WhatsApp', 'In-app notifications are always on. Choose what also goes out by other channels.')}
      <Card className="p-6"><CardHeader title="Channels" description="Connected through the server’s environment (MESSAGING_DRIVER=live plus SMTP_URL, SMS_HTTP_URL, WHATSAPP_HTTP_URL). Keys are never stored in the database or shown here." />
        {h.error ? <ErrorState onRetry={() => h.refetch()} /> : !h.data ? <Skeleton className="h-20" /> : <><ul className="grid gap-3 sm:grid-cols-3">{EXTERNAL_CHANNELS.map((c) => <li key={c} className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"><span><b>{label(c)}</b><br /><Badge tone={h.data.messaging[c] ? 'green' : 'neutral'}>{h.data.messaging[c] ? 'Connected' : 'Not connected'}</Badge></span>{can('settings.edit') && <Button size="sm" variant="outline" loading={busy === c} aria-label={`Send test ${c}`} onClick={() => test(c)}>Test</Button>}</li>)}</ul>{h.data.messagingDriver === 'console' && <Alert tone="warn" className="mt-4">Nothing is delivered yet: messages, including sign-up codes, are only stored on the server.</Alert>}</>}
      </Card>
      {s.error ? <Card><ErrorState onRetry={() => s.refetch()} /></Card> : !v ? <Skeleton className="h-96" /> : (
        <Card className="p-6"><CardHeader title="Events" /><div className="overflow-x-auto"><table className="w-full min-w-80 text-[14px]"><thead><tr className="text-left text-muted"><th className="py-2 font-semibold">Event</th>{EXTERNAL_CHANNELS.map((c) => <th key={c} className="py-2 font-semibold">{label(c)}</th>)}</tr></thead><tbody>{NOTIFICATION_EVENTS.map((e) => <tr key={e} className="border-t border-line-2"><td className="py-2.5">{label(e)}</td>{EXTERNAL_CHANNELS.map((c) => <td key={c}><input type="checkbox" className="size-4" aria-label={`${e} by ${c}`} checked={v.events[e][c]} onChange={() => flip(e, c)} /></td>)}</tr>)}</tbody></table></div>
          <div className="mt-5 grid max-w-2xl gap-4"><Field label="Email subject">{({ id }) => <Input id={id} value={v.emailSubject} onChange={(e) => setV({ ...v, emailSubject: e.target.value })} />}</Field><Field label="Message text" hint="{name} {title} {body} {link} {site}">{({ id }) => <Textarea id={id} value={v.template} onChange={(e) => setV({ ...v, template: e.target.value })} />}</Field></div>
          {can('settings.edit') && <Button className="mt-5" loading={busy === 'save'} onClick={save}>Save</Button>}
        </Card>
      )}
    </div>
  );
}
export function HealthPage() {
  const { data: h, isLoading, error, refetch } = useQuery({ queryKey: ['health'], queryFn: getHealth, refetchInterval: 30_000 });
  const row = (k: string, v: React.ReactNode, ok?: boolean) => <div key={k} className="flex items-center justify-between gap-4 border-b border-line-2 py-3 text-[14px] last:border-0"><span className="text-muted">{k}</span><span className="flex items-center gap-2 text-right font-semibold">{ok !== undefined && (ok ? <CheckCircle2 className="size-4 text-success" aria-label="OK" /> : <XCircle className="size-4 text-danger" aria-label="Problem" />)}{v}</span></div>;
  const up = h ? `${Math.floor(h.uptimeSeconds / 86400)}d ${Math.floor((h.uptimeSeconds % 86400) / 3600)}h ${Math.floor((h.uptimeSeconds % 3600) / 60)}m` : '';
  return <div className="grid grid-cols-1 gap-5">{head('super-admin', 'System health', 'Refreshes every 30 seconds.')}{error ? <Card><ErrorState description="The server didn’t answer." onRetry={() => refetch()} /></Card> : isLoading || !h ? <Skeleton className="h-80" /> : <Card className="max-w-2xl p-6">{row('Database', `${h.database.name}, ${h.database.pingMs} ms`, h.database.ok)}{row('Server up for', up)}{row('Memory', `${h.memoryMb} MB`)}{row('Version', `${h.version} · Node ${h.node}`)}{h.jobs.map((j) => row(j.key, j.at ? fmtDateTime(j.at) : 'Not run yet', !!j.at))}{EXTERNAL_CHANNELS.map((c) => row(label(c), h.messaging[c] ? 'Connected' : 'Not connected', h.messaging[c]))}{row('Payments', h.payments, h.payments !== 'off')}{row('File storage', h.storage === 'local' ? 'Local disk: files are lost when the host resets' : h.storage, h.storage !== 'local')}</Card>}</div>;
}
