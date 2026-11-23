import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import type { AuditRow } from '@jr/shared';
import { Badge, Button, Card, Input, PageHeader, Select, ServerTable, type Column, type Tone } from '@/design-system';
import { listAudit } from '@/features/admin/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

const AREAS = [
  { value: '', label: 'All activity' },
  { value: 'auth.', label: 'Sign-ins & passwords' },
  { value: 'member.', label: 'Member management' },
  { value: 'admin.', label: 'Administrators' },
  { value: 'role.', label: 'Roles' },
  { value: 'settings.', label: 'Settings & maintenance' },
  { value: 'security.', label: 'Security codes' },
];

const toneFor = (action: string): Tone =>
  /block|blacklist|deactivate|lockout|revoke|delete/.test(action) ? 'red' : /settings|role/.test(action) ? 'violet' : /auth\./.test(action) ? 'blue' : 'neutral';

const PAGE_SIZE = 25;

export function AuditLogPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const [params, setParams] = useSearchParams();
  const query = {
    q: params.get('q') ?? undefined,
    action: params.get('action') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete('page');
    setParams(next);
  };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['audit', query], queryFn: () => listAudit(query), placeholderData: keepPreviousData });
  const [search, setSearch] = useState(query.q ?? '');
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);
  const onSearch = (e: FormEvent) => { e.preventDefault(); set({ q: search.trim() || undefined }); };

  const columns: Column<AuditRow>[] = [
    { key: 'when', header: 'When', cell: (r) => <span className="text-[13px] whitespace-nowrap">{new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> },
    { key: 'actor', header: 'Who', cell: (r) => <b className="font-semibold text-ink">{r.actor?.name ?? 'System'}</b> },
    { key: 'what', header: 'What happened', cell: (r) => <span className="text-[13.5px]">{r.summary}</span> },
    { key: 'action', header: 'Type', cell: (r) => <Badge tone={toneFor(r.action)} className="font-mono text-[11px]">{r.action}</Badge> },
    { key: 'ip', header: 'IP', cell: (r) => <span className="font-mono text-[12px] text-muted">{r.ip ?? '—'}</span> },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Audit log' }]}
        title="Audit log"
        description="A permanent record of sign-ins, account changes and admin actions. Entries can’t be edited or deleted."
      />
      <Card className="p-4">
        <form onSubmit={onSearch} role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by person or description" aria-label="Search audit log" className="h-10" /></div>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Area
            <Select value={query.action ?? ''} onChange={(e) => set({ action: e.target.value || undefined })} className="h-10 w-52">
              {AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">From<Input type="date" value={query.from ?? ''} max={query.to} onChange={(e) => set({ from: e.target.value || undefined })} className="h-10 w-40" /></label>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">To<Input type="date" value={query.to ?? ''} min={query.from} onChange={(e) => set({ to: e.target.value || undefined })} className="h-10 w-40" /></label>
          <Button type="submit" className="h-10">Search</Button>
          {[...params.keys()].some((k) => k !== 'page') && <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={() => setParams(new URLSearchParams())}>Clear</Button>}
        </form>
      </Card>
      <Card className="p-4">
        <ServerTable
          rows={data?.data} columns={columns} rowKey={(r) => r.id} loading={isLoading} error={error} onRetry={() => refetch()}
          total={data?.meta.total ?? 0} page={query.page} pageSize={PAGE_SIZE}
          onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined }, true)}
          emptyTitle="No matching activity"
        />
      </Card>
    </div>
  );
}
