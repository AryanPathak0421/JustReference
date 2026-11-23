import { Link } from 'react-router';
import { toast } from 'sonner';
import { Activity, AlertTriangle, CheckCircle2, GitBranch, ReceiptIndianRupee, Shield, UserPlus } from 'lucide-react';
import { formatINR } from '@jr/shared/money';
import { Avatar, Button, ButtonLink, Card, CardHeader, ConfirmDialog, DataTable, ErrorState, PageHeader, SampleDataBadge, Skeleton, StatusBadge, type Column } from '@/design-system';
import { fetchSuperAdminDashboard, type SuperAdminDashboard as SD } from '@/features/dashboard/api';
import { MoneyTrendCard } from '@/features/dashboard/charts';
import { fmtDate, StatGrid } from '@/features/dashboard/widgets';
import { useAsync } from '@/lib/useAsync';
import { cn } from '@/lib/cn';

type Admin = SD['admins'][number];

const ADMIN_COLUMNS: Column<Admin>[] = [
  {
    key: 'name', header: 'Administrator', value: (r) => r.name,
    cell: (r) => (
      <span className="flex items-center gap-2.5">
        <Avatar name={r.name} size={30} />
        <span><b className="block font-semibold text-ink">{r.name}</b><span className="text-[12.5px] text-muted">{r.email}</span></span>
      </span>
    ),
  },
  { key: 'scope', header: 'Role', cell: (r) => r.scope, value: (r) => r.scope },
  { key: 'last', header: 'Last active', cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.lastActive)}</span>, value: (r) => r.lastActive },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, value: (r) => r.status },
  {
    key: 'actions', header: '', align: 'right',
    cell: (r) => (
      <ConfirmDialog
        title={r.status === 'active' ? `Deactivate ${r.name}?` : `Reactivate ${r.name}?`}
        description={r.status === 'active' ? 'They will be signed out everywhere and lose admin access until reactivated. This is recorded in the audit log.' : 'They will regain the permissions of their assigned role.'}
        confirmLabel={r.status === 'active' ? 'Deactivate' : 'Reactivate'}
        tone={r.status === 'active' ? 'danger' : 'primary'}
        onConfirm={async () => {
          await new Promise((res) => setTimeout(res, 500));
          toast.info('Not saved: preview mode', { description: 'Administrator management is connected to the API in Phase 1.' });
        }}
        trigger={(open) => <Button variant="ghost" size="sm" onClick={open}>{r.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>}
      />
    ),
  },
];

export function SuperAdminDashboard() {
  const { data, loading, error, reload } = useAsync(fetchSuperAdminDashboard, []);
  if (error) return <Card><ErrorState onRetry={reload} /></Card>;
  const s = data?.stats;

  return (
    <div className="grid grid-cols-1 gap-5 animate-fade-in">
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: 'Super Admin', to: '/super-admin' }, { label: 'Dashboard' }]}
        title="Platform overview"
        description="Administrators, money flows and configuration for the whole platform."
        actions={<><SampleDataBadge /><ButtonLink to="/super-admin/admins" size="sm" leftIcon={<UserPlus className="size-4" />}>Create admin</ButtonLink></>}
      />

      <StatGrid
        loading={loading}
        stats={[
          { label: 'Administrators', value: String(s?.admins ?? ''), icon: Shield, tone: 'navy', note: s ? `${s.adminsInactive} deactivated` : '' },
          { label: 'GMV (30 days)', value: s ? formatINR(s.gmv30Paise, { compact: true }) : '', icon: ReceiptIndianRupee, tone: 'green', delta: s ? `+${s.gmvDeltaPct}%` : undefined, note: 'vs prior period' },
          { label: 'Commissions (30 days)', value: s ? formatINR(s.commissions30Paise, { compact: true }) : '', icon: GitBranch, tone: 'violet', note: s ? (s.activeRuleSets ? `${s.activeRuleSets} active rule sets` : 'No commission rules configured yet') : '' },
          { label: 'Uptime (30 days)', value: s ? `${s.uptimePct}%` : '', icon: Activity, tone: 'blue', note: 'API availability' },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.65fr_1fr]">
        <MoneyTrendCard title="GMV vs platform fees" data={data?.chart} loading={loading} names={{ a: 'GMV', b: 'Platform fees' }} />
        <Card className="p-5">
          <CardHeader title="Launch readiness" description="Configuration that must be completed" />
          <ul className="grid gap-1">
            {loading || !data
              ? Array.from({ length: 5 }, (_, i) => <li key={i}><Skeleton className="h-12 w-full" /></li>)
              : data.config.map((c) => (
                  <li key={c.label}>
                    <Link to={c.to} className="flex items-start gap-3 rounded-[10px] p-2.5 transition hover:bg-canvas">
                      {c.ok ? <CheckCircle2 className="mt-0.5 size-[18px] flex-none text-success" /> : <AlertTriangle className="mt-0.5 size-[18px] flex-none text-warn" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-2"><b className="text-[14px]">{c.label}</b><span className={cn('text-[12.5px] font-semibold', c.ok ? 'text-success' : 'text-warn')}>{c.state}</span></span>
                        <span className="text-[12.5px] text-muted">{c.hint}</span>
                      </span>
                    </Link>
                  </li>
                ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <CardHeader title="Administrators" description="Activate, deactivate and manage admin permissions" actions={<ButtonLink to="/super-admin/roles" variant="outline" size="sm">Roles & permissions</ButtonLink>} />
          <DataTable rows={data?.admins ?? []} columns={ADMIN_COLUMNS} rowKey={(r) => r.id} loading={loading} searchText={(r) => `${r.name} ${r.email} ${r.scope}`} searchPlaceholder="Search admins…" pageSize={5} />
        </Card>
        <Card className="p-5">
          <CardHeader title="Audit log" description="Today" actions={<Link to="/super-admin/audit" className="text-[13px] font-semibold text-brand-600 hover:underline">View all</Link>} />
          <ol className="relative grid gap-4 border-l border-line pl-4">
            {(data?.audit ?? []).map((a) => (
              <li key={a.action} className="relative">
                <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-white bg-brand-500" />
                <p className="text-[13.5px] text-ink-2"><b className="text-ink">{a.actor}</b> {a.action.charAt(0).toLowerCase() + a.action.slice(1)}</p>
                <span className="text-[12px] text-muted">{a.time}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
