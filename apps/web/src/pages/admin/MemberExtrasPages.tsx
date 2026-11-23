import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Eye, FileText, GitBranch, Landmark, Search, X, XCircle } from 'lucide-react';
import { DOCUMENT_LABELS, type MemberBankRow, type MemberProfile, type ReferralRow } from '@jr/shared';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Segmented, ServerTable, Skeleton, StatusBadge, type Column } from '@/design-system';
import {
  adminMemberProfile, adminReferralSummary, adminReferrals, adminTree, decideMemberDocument, listBankAccounts, memberDocumentBlob, revealBankAccount,
} from '@/features/members/api';
import { CompletionMeter, ReferralTreeView } from '@/features/members/components';
import { openBlob } from '@/features/vendor/api';
import { Can, useAuth } from '@/features/auth/AuthProvider';
import { ApiError, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

/* ======================================================================== Reveal full account number */

export function RevealAccountButton({ userId, last4 }: { userId: string; last4: string }) {
  const [number, setNumber] = useState<string>();
  useEffect(() => { if (!number) return; const t = setTimeout(() => setNumber(undefined), 30_000); return () => clearTimeout(t); }, [number]);
  return (
    <>
      <ConfirmDialog title="Show the full account number?" description={`Account ending ${last4}. This is recorded in the audit log. The number hides again after 30 seconds.`} confirmLabel="Show number"
        onConfirm={async () => { try { setNumber((await revealBankAccount(userId)).accountNumber); } catch (e) { toast.error(errorMessage(e)); } }}
        trigger={(open) => <Button variant="ghost" size="sm" leftIcon={<Eye className="size-3.5" />} onClick={(e) => { e.stopPropagation(); open(); }}>Reveal</Button>} />
      {number && (
        <Modal open onOpenChange={(o) => !o && setNumber(undefined)} title="Account number" description="Hides automatically in 30 seconds.">
          <p className="rounded-lg bg-canvas p-4 text-center font-mono text-xl font-bold tracking-wider select-all">{number}</p>
        </Modal>
      )}
    </>
  );
}

/* ======================================================================== Member bank details */

export function BankDetailsPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const [params, setParams] = useSearchParams();
  const query = { q: params.get('q') || undefined, page: Number(params.get('page') ?? 1), pageSize: 20 };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['admin', 'bank-accounts', query], queryFn: () => listBankAccounts(query), placeholderData: keepPreviousData });
  const [search, setSearch] = useState(query.q ?? '');
  const columns: Column<MemberBankRow>[] = [
    { key: 'member', header: 'Member', cell: (r) => <Link to={`${panel.base}/members/${r.userId}`} className="block hover:text-brand-600"><b className="block font-semibold">{r.name}</b><span className="font-mono text-[12px] text-muted">{r.memberId ?? '—'}</span></Link> },
    { key: 'holder', header: 'Account holder', cell: (r) => r.holderName },
    { key: 'bank', header: 'Bank', cell: (r) => <span className="text-[13px]">{r.bankName}<br /><span className="text-muted">{r.branchAddress}</span></span> },
    { key: 'acct', header: 'Account', cell: (r) => <span className="font-mono">••••{r.accountLast4}</span> },
    { key: 'ifsc', header: 'IFSC', cell: (r) => <span className="font-mono text-[13px]">{r.ifsc}</span> },
    { key: 'actions', header: '', align: 'right', cell: (r) => <RevealAccountButton userId={r.userId} last4={r.accountLast4} /> },
  ];
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Members', to: `${panel.base}/members/all` }, { label: 'Bank details' }]}
        title="Member bank details" description="Payout accounts on file. Numbers are encrypted; revealing one is recorded in the audit log." />
      <Card className="p-4">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); setParams(search.trim() ? { q: search.trim() } : {}); }} role="search" className="flex flex-wrap gap-3">
          <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Member name, member ID, holder, bank or IFSC" aria-label="Search bank accounts" className="h-10" /></div>
          <Button type="submit" className="h-10">Search</Button>
          {query.q && <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={() => { setSearch(''); setParams({}); }}>Clear</Button>}
        </form>
      </Card>
      <Card className="p-4">
        <ServerTable rows={data?.data} columns={columns} rowKey={(r) => r.userId} loading={isLoading} error={error} onRetry={() => refetch()}
          total={data?.meta.total ?? 0} page={query.page} pageSize={20} onPageChange={(p) => setParams({ ...(query.q ? { q: query.q } : {}), page: String(p) })}
          emptyTitle="No bank accounts on file" />
      </Card>
    </div>
  );
}

/* ======================================================================== Direct referral view */

export function AdminReferralViewPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const [params, setParams] = useSearchParams();
  const member = params.get('member') ?? '';
  const node = params.get('node') ?? undefined;
  const view = (params.get('view') as 'tree' | 'list') ?? 'tree';
  const [input, setInput] = useState(member);
  useEffect(() => setInput(member), [member]);
  const summary = useQuery({ queryKey: ['admin', 'ref-summary', member], queryFn: () => adminReferralSummary(member), enabled: !!member, retry: false });
  const tree = useQuery({ queryKey: ['admin', 'tree', member, node], queryFn: () => adminTree(member, node), enabled: !!member && view === 'tree', placeholderData: keepPreviousData, retry: false });
  const listPage = Number(params.get('page') ?? 1);
  const list = useQuery({ queryKey: ['admin', 'ref-list', member, listPage], queryFn: () => adminReferrals(member, { scope: 'all', page: listPage, pageSize: 20 }), enabled: !!member && view === 'list', placeholderData: keepPreviousData });
  const notFound = summary.error instanceof ApiError && summary.error.status === 404;
  const href = (id?: string) => `?member=${encodeURIComponent(member)}${id ? `&node=${id}` : ''}`;

  const columns: Column<ReferralRow>[] = [
    { key: 'name', header: 'Member', cell: (r) => <Link to={`${panel.base}/members/${r.userId}`} className="hover:text-brand-600"><b className="block font-semibold">{r.name}</b><span className="font-mono text-[12px] text-muted">{r.memberId}</span></Link> },
    { key: 'level', header: 'Level', cell: (r) => <Badge tone={r.level === 1 ? 'blue' : 'violet'}>{r.level === 1 ? 'Direct' : `Level ${r.level}`}</Badge> },
    { key: 'via', header: 'Referred by', cell: (r) => <span className="text-[13px]">{r.sponsor ? `${r.sponsor.name} (${r.sponsor.memberId})` : 'This member'}</span> },
    { key: 'their', header: 'Their referrals', align: 'right', cell: (r) => r.directCount },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'Members', to: `${panel.base}/members/all` }, { label: 'Referral view' }]}
        title="Referral view" description="See any member’s referral network: direct referrals, levels below, and the full tree." />
      <Card className="p-4">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (input.trim()) setParams({ member: input.trim().toUpperCase() }); }} role="search" className="flex flex-wrap gap-3">
          <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Member ID, e.g. JR0000001" aria-label="Member ID" className="h-10" /></div>
          <Button type="submit" className="h-10">Show network</Button>
        </form>
      </Card>
      {!member ? <Card><EmptyState icon={GitBranch} title="Enter a member ID" description="You can also open this from any member’s page." /></Card>
        : notFound ? <Card><EmptyState title="No member with that ID" /></Card>
        : summary.error ? <Card><ErrorState onRetry={() => summary.refetch()} /></Card>
        : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[['Direct', summary.data?.direct], ['Indirect', summary.data?.indirect], ['Total network', summary.data?.total], ['Deepest level', summary.data?.byLevel.at(-1)?.level ?? 0]].map(([k, v]) => (
                <Card key={k as string} className="p-4"><div className="text-[12.5px] text-muted">{k}</div><div className="mt-0.5 text-2xl font-extrabold text-navy-950">{v ?? '–'}</div></Card>
              ))}
            </div>
            <div className="flex justify-end">
              <Segmented label="View" value={view} onChange={(v) => setParams({ member, view: v })} options={[{ value: 'tree', label: 'Tree' }, { value: 'list', label: 'List' }]} />
            </div>
            {view === 'tree'
              ? <ReferralTreeView tree={tree.data} loading={tree.isLoading} nodeHref={href} rootLabel={member} />
              : (
                <Card className="p-4">
                  <ServerTable rows={list.data?.data} columns={columns} rowKey={(r) => r.userId} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
                    total={list.data?.meta.total ?? 0} page={listPage} pageSize={20} onPageChange={(p) => setParams({ member, view: 'list', page: String(p) })} emptyTitle="No referrals" />
                </Card>
              )}
          </>
        )}
    </div>
  );
}

/* ======================================================================== KYC & bank card (member detail page) */

export function MemberKycCard({ memberUserId, memberId, panelBase }: { memberUserId: string; memberId?: string; panelBase: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: p, isLoading } = useQuery({ queryKey: ['admin', 'member-profile', memberUserId], queryFn: () => adminMemberProfile(memberUserId) });
  const update = (next: MemberProfile) => qc.setQueryData(['admin', 'member-profile', memberUserId], next);
  if (isLoading || !p) return <Skeleton className="h-48" />;
  return (
    <Card className="p-5">
      <CardHeader title="KYC & bank" actions={memberId && <Link to={`${panelBase}/members/referrals?member=${memberId}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:underline"><GitBranch className="size-3.5" />Referral network</Link>} />
      <CompletionMeter completion={p.completion} compact />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[13.5px]">
        <div><dt className="text-muted">PAN</dt><dd className="font-medium">{p.panMasked ?? 'Not provided'}</dd></div>
        <div><dt className="text-muted">Aadhaar (last 4)</dt><dd className="font-medium">{p.aadhaarLast4 ? `•••• ${p.aadhaarLast4}` : 'Not provided'}</dd></div>
        <div><dt className="text-muted">GSTIN</dt><dd className="font-medium">{p.gstin ?? '—'}</dd></div>
      </dl>
      <Can perm="members.bank" fallback={<Alert tone="info" className="mt-4">You need the “member bank details” permission to see bank details and documents.</Alert>}>
        <div className="mt-4 rounded-xl border border-line p-3 text-[13.5px]">
          {p.bank ? (
            <div className="flex flex-wrap items-center gap-3">
              <Landmark className="size-5 text-brand-600" />
              <div className="flex-1"><b>{p.bank.bankName} ••••{p.bank.accountLast4}</b><p className="text-muted">{p.bank.holderName} · IFSC {p.bank.ifsc}</p></div>
              <RevealAccountButton userId={memberUserId} last4={p.bank.accountLast4} />
            </div>
          ) : <p className="text-muted">No bank account on file.</p>}
        </div>
        <h4 className="mt-4 mb-2 text-[13.5px] font-bold">Documents</h4>
        {p.documents.length === 0 ? <p className="text-[13.5px] text-muted">None uploaded.</p> : (
          <ul className="divide-y divide-line-2">
            {p.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <FileText className="size-4 text-brand-600" />
                <span className="min-w-0 flex-1 truncate text-[13.5px]"><b>{DOCUMENT_LABELS[d.type]}</b> · {d.name}</span>
                <StatusBadge status={d.status} />
                <Button variant="ghost" size="sm" onClick={() => openBlob(() => memberDocumentBlob(memberUserId, d.id), d.name).catch((e) => toast.error(errorMessage(e)))}>View</Button>
                {can('members.bank') && d.status === 'pending' && (
                  <>
                    <Button variant="ghost" size="sm" aria-label="Verify document" onClick={async () => { try { update(await decideMemberDocument(memberUserId, d.id, 'approved')); toast.success('Document verified'); } catch (e) { toast.error(errorMessage(e)); } }}><CheckCircle2 className="size-4 text-success" /></Button>
                    <Button variant="ghost" size="sm" aria-label="Reject document" onClick={async () => { try { update(await decideMemberDocument(memberUserId, d.id, 'rejected')); toast.success('Document rejected'); } catch (e) { toast.error(errorMessage(e)); } }}><XCircle className="size-4 text-danger" /></Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Can>
    </Card>
  );
}

