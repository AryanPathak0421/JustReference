import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as DM from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Download, Eye, KeyRound, MoreHorizontal, Search, ShieldOff, UserPlus, X } from 'lucide-react';
import type { MemberRow } from '@jr/shared';
import { Badge, Button, ButtonLink, Card, Input, PageHeader, Select, ServerTable, StatusBadge, type Column } from '@/design-system';
import { exportMembers, listMembers, type MemberQuery } from '@/features/admin/api';
import { StatusDialog, type StatusAction } from '@/features/admin/StatusDialog';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PANELS, type PanelKey } from '@/panels/navigation';

export type MembersPreset = 'all' | 'datewise' | 'edit' | 'security' | 'blacklist' | 'allow' | 'blocked' | 'filter';

const PRESETS: Record<MembersPreset, { title: string; description: string; defaults?: Partial<MemberQuery>; showDates?: boolean; showAdvanced?: boolean }> = {
  all: { title: 'All members', description: 'Search, filter and manage every member account.' },
  datewise: { title: 'Date-wise member list', description: 'Members who joined within a date range.', showDates: true },
  edit: { title: 'Edit member profile', description: 'Find the member, then open their record to edit it.' },
  security: { title: 'Member security codes', description: 'See who has set a transaction PIN, and reset it if a member is locked out.', showAdvanced: true },
  blacklist: { title: 'Blacklist a member', description: 'Find an active member and choose “Blacklist” from the row menu.', defaults: { status: 'active' } },
  allow: { title: 'Allow members', description: 'Blocked and blacklisted members. Choose “Allow” to restore access.', defaults: { group: 'restricted' } },
  blocked: { title: 'Blocked members', description: 'Everyone currently blocked or blacklisted.', defaults: { group: 'restricted' } },
  filter: { title: 'Filter members', description: 'Combine filters to find exactly who you need.', showDates: true, showAdvanced: true },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const PAGE_SIZE = 20;

export function MembersPage({ panelKey, preset = 'all' }: { panelKey: PanelKey; preset?: MembersPreset }) {
  const panel = PANELS[panelKey];
  const cfg = PRESETS[preset];
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{ member: MemberRow; action: StatusAction } | null>(null);

  const read = (k: keyof MemberQuery) => params.get(k) ?? (cfg.defaults?.[k] as string | undefined) ?? undefined;
  const query: MemberQuery = {
    q: read('q'),
    status: read('status'),
    group: read('group') as MemberQuery['group'],
    hasPin: read('hasPin') as MemberQuery['hasPin'],
    from: read('from'),
    to: read('to'),
    sort: (read('sort') as MemberQuery['sort']) ?? 'newest',
    page: Number(params.get('page') ?? 1),
    pageSize: PAGE_SIZE,
  };
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete('page');
    setParams(next);
  };

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin', 'members', query],
    queryFn: () => listMembers(query),
    placeholderData: keepPreviousData,
  });

  const [search, setSearch] = useState(query.q ?? '');
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);
  const onSearch = (e: FormEvent) => { e.preventDefault(); set({ q: search.trim() || undefined }); };

  const detail = (id: string) => `${panel.base}/members/${id}`;
  const statusFilter = query.group === 'restricted' ? 'restricted' : (query.status ?? '');

  const columns: Column<MemberRow>[] = [
    {
      key: 'member', header: 'Member',
      cell: (r) => (
        <Link to={detail(r.id)} className="group block" onClick={(e) => e.stopPropagation()}>
          <b className="block font-semibold text-ink group-hover:text-brand-600">{r.name}</b>
          <span className="font-mono text-[12px] text-muted">{r.memberId ?? 'Not verified'}</span>
        </Link>
      ),
    },
    { key: 'contact', header: 'Contact', cell: (r) => <span className="block text-[13px] leading-snug">{r.email}<br /><span className="text-muted">{r.mobile}</span></span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'sponsor', header: 'Referred by', cell: (r) => (r.sponsor ? <span className="text-[13px]">{r.sponsor.name}<br /><span className="font-mono text-[12px] text-muted">{r.sponsor.memberId}</span></span> : <span className="text-subtle">—</span>) },
    ...(preset === 'security' || query.hasPin
      ? [{ key: 'pin', header: 'Transaction PIN', cell: (r: MemberRow) => <Badge tone={r.hasTransactionPin ? 'green' : 'neutral'}>{r.hasTransactionPin ? 'Set' : 'Not set'}</Badge> }]
      : []),
    { key: 'joined', header: 'Joined', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.createdAt)}</span> },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) => <RowMenu row={r} onView={() => navigate(detail(r.id))} onStatus={(action) => setDialog({ member: r, action })} />,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Members', to: `${panel.base}/members/all` }, { label: cfg.title }]}
        title={cfg.title}
        description={cfg.description}
        actions={
          <>
            <Button
              variant="outline" size="sm" leftIcon={<Download className="size-4" />}
              onClick={() => exportMembers(query).catch((e) => toast.error(errorMessage(e)))}
              disabled={!data?.meta.total}
            >
              Export CSV
            </Button>
            {can('members.create') && panelKey === 'admin' && <ButtonLink to={`${panel.base}/members/new`} size="sm" leftIcon={<UserPlus className="size-4" />}>New registration</ButtonLink>}
          </>
        }
      />

      <Card className="p-4">
        <form onSubmit={onSearch} role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input leftIcon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, mobile, member ID or referral ID" aria-label="Search members" className="h-10" />
          </div>
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">
            Status
            <Select
              value={statusFilter}
              onChange={(e) => {
                const v = e.target.value;
                set(v === 'restricted' ? { group: 'restricted', status: undefined } : { status: v || undefined, group: undefined });
              }}
              className="h-10 w-44"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending verification</option>
              <option value="restricted">Blocked or blacklisted</option>
              <option value="blocked">Blocked</option>
              <option value="blacklisted">Blacklisted</option>
            </Select>
          </label>
          {(cfg.showDates || query.from || query.to) && (
            <>
              <label className="grid gap-1 text-[12.5px] font-semibold text-muted">
                Joined from
                <Input type="date" value={query.from ?? ''} max={query.to} onChange={(e) => set({ from: e.target.value || undefined })} className="h-10 w-40" />
              </label>
              <label className="grid gap-1 text-[12.5px] font-semibold text-muted">
                to
                <Input type="date" value={query.to ?? ''} min={query.from} onChange={(e) => set({ to: e.target.value || undefined })} className="h-10 w-40" />
              </label>
            </>
          )}
          {(cfg.showAdvanced || query.hasPin) && (
            <label className="grid gap-1 text-[12.5px] font-semibold text-muted">
              Transaction PIN
              <Select value={query.hasPin ?? ''} onChange={(e) => set({ hasPin: e.target.value || undefined })} className="h-10 w-36">
                <option value="">Any</option>
                <option value="yes">Set</option>
                <option value="no">Not set</option>
              </Select>
            </label>
          )}
          <label className="grid gap-1 text-[12.5px] font-semibold text-muted">
            Sort
            <Select value={query.sort} onChange={(e) => set({ sort: e.target.value === 'newest' ? undefined : e.target.value })} className="h-10 w-36">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A–Z</option>
            </Select>
          </label>
          <Button type="submit" className="h-10">Search</Button>
          {[...params.keys()].some((k) => k !== 'page') && (
            <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={() => setParams(new URLSearchParams())}>Clear</Button>
          )}
        </form>
      </Card>

      <Card className={cn('p-4 transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        <ServerTable
          rows={data?.data}
          columns={columns}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          total={data?.meta.total ?? 0}
          page={query.page ?? 1}
          pageSize={PAGE_SIZE}
          onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined }, true)}
          onRowClick={(r) => navigate(detail(r.id))}
          emptyTitle="No members match"
          emptyDescription="Try a different search or clear the filters."
        />
      </Card>

      {dialog && <StatusDialog member={dialog.member} action={dialog.action} onClose={() => setDialog(null)} />}
    </div>
  );
}

function RowMenu({ row, onView, onStatus }: { row: MemberRow; onView: () => void; onStatus: (a: StatusAction) => void }) {
  const { can } = useAuth();
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-ink-2 outline-none data-[highlighted]:bg-canvas data-[highlighted]:text-ink';
  const restricted = row.status === 'blocked' || row.status === 'blacklisted';
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <DM.Root>
        <DM.Trigger className="grid size-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink" aria-label={`Actions for ${row.name}`}>
          <MoreHorizontal className="size-4" />
        </DM.Trigger>
        <DM.Portal>
          <DM.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-xl border border-line bg-white p-1.5 shadow-pop">
            <DM.Item className={item} onSelect={onView}><Eye className="size-4" />View &amp; edit</DM.Item>
            {can('members.status') && (
              <>
                <DM.Separator className="my-1 h-px bg-line-2" />
                {restricted ? (
                  <DM.Item className={item} onSelect={() => onStatus('active')}><CheckCircle2 className="size-4 text-success" />Allow</DM.Item>
                ) : (
                  <DM.Item className={item} onSelect={() => onStatus('blocked')}><ShieldOff className="size-4 text-warn" />Block</DM.Item>
                )}
                {row.status !== 'blacklisted' && (
                  <DM.Item className={cn(item, 'text-danger data-[highlighted]:bg-danger-50 data-[highlighted]:text-danger')} onSelect={() => onStatus('blacklisted')}><Ban className="size-4" />Blacklist</DM.Item>
                )}
              </>
            )}
            {can('members.security') && row.hasTransactionPin && (
              <DM.Item className={item} onSelect={onView}><KeyRound className="size-4" />Reset PIN…</DM.Item>
            )}
          </DM.Content>
        </DM.Portal>
      </DM.Root>
    </span>
  );
}
