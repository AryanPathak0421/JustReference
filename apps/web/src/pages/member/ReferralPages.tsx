import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { GitBranch, List, Mail, MessageCircle, Search, Send, Smartphone, UserPlus, Users, X } from 'lucide-react';
import { INVITE_CHANNELS, invitationSchema, type InvitationInput, type InvitationRow, type ReferralRow } from '@jr/shared';
import { Badge, Button, ButtonLink, Card, CardHeader, Field, Input, PageHeader, Select, ServerTable, StatusBadge, Textarea, type Column } from '@/design-system';
import { getMyTree, getReferralSummary, listInvitations, listMyReferrals, sendInvitation } from '@/features/members/api';
import { ReferralLinkCard, ReferralTreeView } from '@/features/members/components';
import { applyFieldErrors, errorMessage } from '@/lib/api';
import { PANELS, type PanelKey } from '@/panels/navigation';

type Scope = 'all' | 'direct' | 'indirect';
const TITLES: Record<Scope, { title: string; description: string }> = {
  all: { title: 'All referrals', description: 'Everyone in your referral network, at every level.' },
  direct: { title: 'Direct referrals', description: 'People who joined with your referral link.' },
  indirect: { title: 'Indirect referrals', description: 'People your referrals brought in, and so on down the network.' },
};
const PAGE_SIZE = 20;
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const useReferralSummary = () => useQuery({ queryKey: ['me', 'referral-summary'], queryFn: getReferralSummary });

function SummaryStrip() {
  const { data: s } = useReferralSummary();
  const items = [['Direct', s?.direct], ['Indirect', s?.indirect], ['Total network', s?.total], ['Joined this month', s?.joinedThisMonth]] as const;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([k, v]) => (
        <Card key={k} className="p-4"><div className="text-[12.5px] text-muted">{k}</div><div className="mt-0.5 text-2xl font-extrabold text-navy-950">{v ?? '–'}</div></Card>
      ))}
    </div>
  );
}

/* ======================================================================== List */

export function ReferralListPage({ panelKey, scope }: { panelKey: PanelKey; scope: Scope }) {
  const panel = PANELS[panelKey];
  const [params, setParams] = useSearchParams();
  const query = { scope, q: params.get('q') || undefined, level: params.get('level') ? Number(params.get('level')) : undefined, page: Number(params.get('page') ?? 1), pageSize: PAGE_SIZE };
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete('page');
    setParams(next);
  };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['me', 'referrals', query], queryFn: () => listMyReferrals(query), placeholderData: keepPreviousData });
  const summary = useReferralSummary();
  const [search, setSearch] = useState(query.q ?? '');
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);
  const onSearch = (e: FormEvent) => { e.preventDefault(); set({ q: search.trim() || undefined }); };
  const maxLevel = summary.data?.byLevel.at(-1)?.level ?? 1;

  const columns: Column<ReferralRow>[] = [
    { key: 'name', header: 'Member', cell: (r) => <span><b className="block font-semibold text-ink">{r.name}</b><span className="font-mono text-[12px] text-muted">{r.memberId}</span></span> },
    { key: 'level', header: 'Level', cell: (r) => <Badge tone={r.level === 1 ? 'blue' : 'violet'}>{r.level === 1 ? 'Direct' : `Level ${r.level}`}</Badge> },
    ...(scope !== 'direct' ? [{ key: 'via', header: 'Referred by', cell: (r: ReferralRow) => (r.sponsor ? <span className="text-[13px]">{r.sponsor.name}<br /><span className="font-mono text-[12px] text-muted">{r.sponsor.memberId}</span></span> : <span className="text-[13px] text-muted">You</span>) }] : []),
    ...(scope !== 'indirect' ? [{ key: 'contact', header: 'Mobile', cell: (r: ReferralRow) => <span className="text-[13px] text-muted">{r.mobileMasked ?? '—'}</span> }] : []),
    { key: 'their', header: 'Their referrals', align: 'right', cell: (r) => r.directCount },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'joined', header: 'Joined', cell: (r) => <span className="text-[13px] whitespace-nowrap">{fmt(r.joinedAt)}</span> },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'My referrals', to: `${panel.base}/referrals/all` }, { label: TITLES[scope].title }]}
        title={TITLES[scope].title} description={TITLES[scope].description}
        actions={<><ButtonLink to={`${panel.base}/referrals/tree`} variant="outline" size="sm" leftIcon={<GitBranch className="size-4" />}>Tree view</ButtonLink><ButtonLink to={`${panel.base}/referrals/new`} size="sm" leftIcon={<UserPlus className="size-4" />}>Invite someone</ButtonLink></>} />
      <SummaryStrip />
      <Card className="p-4">
        <form onSubmit={onSearch} role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or member ID" aria-label="Search referrals" className="h-10" /></div>
          {scope !== 'direct' && (
            <label className="grid gap-1 text-[12.5px] font-semibold text-muted">Level
              <Select value={query.level ?? ''} onChange={(e) => set({ level: e.target.value || undefined })} className="h-10 w-36">
                <option value="">All levels</option>
                {Array.from({ length: maxLevel }, (_, i) => i + 1).filter((l) => scope === 'all' || l > 1).map((l) => <option key={l} value={l}>{l === 1 ? 'Direct (1)' : `Level ${l}`}</option>)}
              </Select>
            </label>
          )}
          <Button type="submit" className="h-10">Search</Button>
          {[...params.keys()].some((k) => k !== 'page') && <Button variant="ghost" className="h-10" leftIcon={<X className="size-4" />} onClick={() => setParams(new URLSearchParams())}>Clear</Button>}
        </form>
      </Card>
      <Card className="p-4">
        <ServerTable rows={data?.data} columns={columns} rowKey={(r) => r.userId} loading={isLoading} error={error} onRetry={() => refetch()}
          total={data?.meta.total ?? 0} page={query.page} pageSize={PAGE_SIZE} onPageChange={(p) => set({ page: p > 1 ? String(p) : undefined }, true)}
          emptyTitle={query.q ? 'No referrals match' : scope === 'indirect' ? 'No indirect referrals yet' : 'No referrals yet'}
          emptyDescription={query.q ? 'Try a different name or member ID.' : 'Share your referral link. Everyone who joins with it appears here.'}
          emptyAction={!query.q && <ButtonLink to={`${panel.base}/referrals/new`} leftIcon={<UserPlus className="size-4" />}>Invite someone</ButtonLink>} />
      </Card>
      <p className="text-[12.5px] text-muted">For privacy, you only see the names and member IDs of people in your network, plus a masked mobile number for your direct referrals.</p>
    </div>
  );
}

/* ======================================================================== Tree */

export function ReferralTreePage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const [params] = useSearchParams();
  const node = params.get('node') ?? undefined;
  const { data, isLoading } = useQuery({ queryKey: ['me', 'tree', node], queryFn: () => getMyTree(node), placeholderData: keepPreviousData });
  const href = (id?: string) => `${panel.base}/referrals/tree${id ? `?node=${id}` : ''}`;
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'My referrals', to: `${panel.base}/referrals/all` }, { label: 'Referral tree' }]}
        title="Referral tree" description="Open anyone with referrals to see their part of your network."
        actions={<ButtonLink to={`${panel.base}/referrals/all`} variant="outline" size="sm" leftIcon={<List className="size-4" />}>List view</ButtonLink>} />
      <SummaryStrip />
      <ReferralTreeView tree={data} loading={isLoading} nodeHref={href} />
    </div>
  );
}

/* ======================================================================== Invite ("Create new referral") */

const CHANNEL_ICON = { whatsapp: MessageCircle, sms: Smartphone, email: Mail };
const CHANNEL_LABEL = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

export function InvitePage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const qc = useQueryClient();
  const summary = useReferralSummary();
  const invites = useQuery({ queryKey: ['me', 'invitations'], queryFn: () => listInvitations() });
  const { register, handleSubmit, control, reset, setError, formState: { errors, isSubmitting } } = useForm<InvitationInput>({
    resolver: zodResolver(invitationSchema), defaultValues: { name: '', channel: 'whatsapp', mobile: '', email: '', note: '' },
  });
  const channel = useWatch({ control, name: 'channel' });
  const onSubmit = async (v: InvitationInput) => {
    try {
      await sendInvitation(v);
      toast.success(`Invitation sent to ${v.name}`);
      reset({ name: '', channel: v.channel, mobile: '', email: '', note: v.note });
      qc.invalidateQueries({ queryKey: ['me', 'invitations'] });
      qc.invalidateQueries({ queryKey: ['me', 'referral-summary'] });
    } catch (e) {
      if (!applyFieldErrors(e, setError)) toast.error(errorMessage(e));
    }
  };

  const columns: Column<InvitationRow>[] = [
    { key: 'name', header: 'Invited', cell: (r) => <b className="font-semibold text-ink">{r.name}</b> },
    { key: 'via', header: 'Sent via', cell: (r) => { const I = CHANNEL_ICON[r.channel]; return <span className="inline-flex items-center gap-1.5 text-[13px]"><I className="size-3.5" />{CHANNEL_LABEL[r.channel]} · {r.contactMasked}</span>; } },
    { key: 'status', header: 'Status', cell: (r) => (r.status === 'joined' ? <Badge tone="green">Joined{r.joined?.memberId ? ` · ${r.joined.memberId}` : ''}</Badge> : <Badge tone="neutral">Invited</Badge>) },
    { key: 'date', header: 'Sent', cell: (r) => <span className="text-[13px]">{fmt(r.createdAt)}</span> },
  ];

  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: panel.label, to: panel.base }, { label: 'My referrals', to: `${panel.base}/referrals/all` }, { label: 'Invite someone' }]}
        title="Invite someone" description="Send your referral link by WhatsApp, SMS or email. When they join, they’re linked to you." />
      {summary.data && <ReferralLinkCard code={summary.data.referralCode} />}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.3fr]">
        <Card className="p-6">
          <CardHeader title="Send an invitation" description="We’ll send a short message with your link. Up to 20 invitations a day." />
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
            <Field label="Their name" error={errors.name?.message} required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} {...register('name')} />}</Field>
            <Field label="Send by">{({ id }) => <Select id={id} {...register('channel')}>{INVITE_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</Select>}</Field>
            {channel === 'email'
              ? <Field label="Their email" error={errors.email?.message} required>{({ id, invalid }) => <Input id={id} type="email" aria-invalid={invalid} {...register('email')} />}</Field>
              : <Field label="Their mobile number" error={errors.mobile?.message} required>{({ id, invalid }) => <Input id={id} type="tel" inputMode="numeric" aria-invalid={invalid} {...register('mobile')} />}</Field>}
            <Field label="Personal note" error={errors.note?.message} hint="Optional, up to 200 characters">{({ id, describedBy }) => <Textarea id={id} maxLength={200} className="min-h-18" aria-describedby={describedBy} {...register('note')} />}</Field>
            <div><Button type="submit" loading={isSubmitting} leftIcon={<Send className="size-4" />}>Send invitation</Button></div>
          </form>
        </Card>
        <Card className="p-5">
          <CardHeader title="Your invitations" description={summary.data ? `${summary.data.invitations.joined} of ${summary.data.invitations.sent} joined` : undefined} />
          <ServerTable rows={invites.data?.data} columns={columns} rowKey={(r) => r.id} loading={invites.isLoading} error={invites.error} onRetry={() => invites.refetch()}
            total={invites.data?.meta.total ?? 0} page={1} pageSize={20} onPageChange={() => {}} emptyTitle="No invitations yet" emptyDescription="Invite friends, family or business contacts." />
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><Users className="size-3.5" />Only invite people who’d welcome it. Messages sent from JustReference must follow our <Link to="/terms" className="underline">terms</Link>.</p>
    </div>
  );
}
