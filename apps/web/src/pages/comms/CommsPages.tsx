import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Megaphone, PenLine, Pin, Reply, Send, Trash2 } from 'lucide-react';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, type AttachmentInfo, type FeedbackRow, type MessageRow, type TicketRow } from '@jr/shared';
import { Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea, type Column } from '@/design-system';
import { useAuth } from '@/features/auth/AuthProvider';
import { fmtDate } from '@/features/dashboard/widgets';
import { fmtDateTime } from '@/features/commerce/components';
import { label, ReportPage } from '@/features/finance/components';
import { AttachmentPicker, FileList, RichText, Stars } from '@/features/comms/components';
import {
  closeTicket, createTicket, decideFeedback, deleteDraft, getMessage, getTicket, listAnnouncements, listFeedback, listMessages, listNotifications, listTickets, markRead, memberAds, replyTicket, saveMessage, updateTicket,
} from '@/features/comms/api';
import { AdCard } from './AdCard';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PANELS, type PanelKey } from '@/panels/navigation';

const head = (k: PanelKey, title: string, description?: string, actions?: React.ReactNode, parent?: { label: string; to: string }) => <PageHeader className="mb-0" breadcrumbs={[{ label: PANELS[k].label, to: PANELS[k].base }, ...(parent ? [parent] : []), { label: title }]} title={title} description={description} actions={actions} />;
const errs = (e: unknown): Record<string, string> => (e instanceof ApiError && e.fields ? e.fields : { _: errorMessage(e) });

/* ================================================================ Notifications & announcements */
export function NotificationsPage({ panelKey }: { panelKey: PanelKey }) {
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['comms', 'notifications', page], queryFn: () => listNotifications({ page, pageSize: 20 }), placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['comms'] });
  const read = async (id?: string) => { try { await markRead(id); } catch (e) { toast.error(errorMessage(e)); } finally { refresh(); } };
  const pages = data ? Math.ceil(data.meta.total / 20) : 1;
  return (
    <div className="grid grid-cols-1 gap-5">
      {head(panelKey, 'Notifications', undefined, <Button size="sm" variant="outline" onClick={() => read()}>Mark all as read</Button>)}
      <Card className="p-3">
        {error ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <Skeleton className="h-60" /> : !data?.data.length ? <EmptyState icon={Bell} title="No notifications yet" /> : (
          <ul className="divide-y divide-line-2">{data.data.map((n) => {
            const body = <><span className={cn('mt-2 size-2 flex-none rounded-full', n.read ? 'bg-line' : 'bg-brand-600')} aria-label={n.read ? undefined : 'Unread'} /><span className="min-w-0"><b className="block text-[14.5px] break-words">{n.title}</b>{n.body && <span className="block text-[13.5px] break-words text-ink-2">{n.body}</span>}<span className="text-[12px] text-muted">{fmtDateTime(n.createdAt)}</span></span></>;
            return <li key={n.id}>{n.link ? <Link to={n.link} onClick={() => !n.read && void read(n.id)} className="flex gap-3 rounded-lg p-3 hover:bg-canvas">{body}</Link> : <button type="button" onClick={() => !n.read && void read(n.id)} className="flex w-full gap-3 rounded-lg p-3 text-left hover:bg-canvas">{body}</button>}</li>;
          })}</ul>
        )}
        {pages > 1 && <div className="flex justify-center gap-2 p-3"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button></div>}
      </Card>
    </div>
  );
}
export function AnnouncementsPage({ panelKey }: { panelKey: PanelKey }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['comms', 'announcements'], queryFn: listAnnouncements });
  return <div className="grid grid-cols-1 gap-5">{head(panelKey, 'Announcements')}{error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? <Skeleton className="h-40" /> : !data?.data.length ? <Card><EmptyState icon={Megaphone} title="No announcements" /></Card> : data.data.map((a) => <Card key={a.id} className="p-6"><h2 className="flex items-center gap-2 text-[17px] font-bold">{a.pinned && <Pin className="size-4 text-brand-600" aria-label="Pinned" />}{a.title}</h2><p className="mb-3 text-[12.5px] text-muted">{fmtDate(a.createdAt)}</p><RichText text={a.body} /></Card>)}</div>;
}
export function AdvertisementsPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['comms', 'ads'], queryFn: memberAds });
  return <div className="grid grid-cols-1 gap-5">{head('member', 'Advertisements', 'Offers and promotions from JustReference.')}{error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? <Skeleton className="h-40" /> : !data?.data.length ? <Card><EmptyState icon={Megaphone} title="No advertisements right now" /></Card> : <div className="grid gap-4 sm:grid-cols-2">{data.data.map((a) => <AdCard key={a.id} ad={a} />)}</div>}</div>;
}
/* ================================================================ Messages */
type Box = 'inbox' | 'outbox' | 'drafts';
export function MessagesPage({ panelKey, box, kind, compose }: { panelKey: PanelKey; box: Box; kind?: 'member' | 'vendor'; compose?: boolean }) {
  const { can } = useAuth();
  const base = `${PANELS[panelKey].base}/messages`;
  const staff = panelKey === 'admin' || panelKey === 'super-admin';
  const canWrite = !staff || can('messages.manage');
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const open = params.get('open');
  const [writing, setWriting] = useState<{ draft?: MessageRow; replyTo?: MessageRow } | null>(compose ? {} : null);
  const cols: Column<MessageRow>[] = [
    { key: 'f', header: box === 'inbox' ? 'From' : 'To', cell: (r) => <span className={cn('block min-w-32', !r.read && 'font-bold text-ink')}>{box === 'inbox' ? r.from : r.to}</span> },
    { key: 's', header: 'Subject', cell: (r) => <button type="button" onClick={() => (r.draft ? setWriting({ draft: r }) : setParams({ open: r.id }))} className={cn('text-left hover:text-brand-600', !r.read && 'font-bold text-ink')}>{r.subject}{r.attachments.length > 0 && <span className="ml-2 text-[12px] text-muted">({r.attachments.length} file{r.attachments.length > 1 ? 's' : ''})</span>}</button> },
    { key: 'd', header: 'Date', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</span> },
    ...(box === 'drafts' ? [{ key: 'x', header: '', cell: (r: MessageRow) => <Button size="sm" variant="ghost" aria-label={`Delete draft ${r.subject}`} onClick={async () => { try { await deleteDraft(r.id); } catch (e) { toast.error(errorMessage(e)); } finally { qc.invalidateQueries({ queryKey: ['finance'] }); } }}><Trash2 className="size-4" /></Button> }] : []),
  ];
  const title = compose ? 'Upload documents' : kind ? `${label(kind)} messages` : { inbox: 'Inbox', outbox: 'Outbox', drafts: 'Drafts' }[box];
  const done = () => { setWriting(null); qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['comms'] }); };
  return (
    <div className="grid grid-cols-1 gap-5">
      {head(panelKey, title, staff ? 'Messages to the team, and your own messages.' : 'Messages between you and the JustReference team.', canWrite && !compose && <Button size="sm" leftIcon={<PenLine className="size-4" />} onClick={() => { setParams({}); setWriting({}); }}>New message</Button>)}
      <nav aria-label="Mailboxes" className="flex flex-wrap gap-2">{([['inbox', 'Inbox'], ['outbox', 'Outbox'], ['drafts', 'Drafts']] as const).map(([b, l]) => <ButtonLink key={b} size="sm" variant={b === box && !compose && !kind ? 'primary' : 'outline'} to={`${base}/${b}`} onClick={() => setWriting(null)}>{l}</ButtonLink>)}</nav>
      {writing && canWrite && <Composer key={writing.draft?.id ?? writing.replyTo?.id ?? 'new'} staff={staff} draft={writing.draft} replyTo={writing.replyTo} documents={compose} onDone={done} onCancel={() => setWriting(null)} />}
      {open && !writing && <MessageView id={open} canWrite={canWrite} onReply={(m) => setWriting({ replyTo: m })} onClose={() => { setParams({}); qc.invalidateQueries({ queryKey: ['comms', 'counts'] }); qc.invalidateQueries({ queryKey: ['finance'] }); }} />}
      {!compose && <ReportPage<MessageRow> key={`${box}${kind}`} bare panelKey={panelKey} title="" queryKey={`messages-${box}-${kind}`} load={(q) => listMessages({ ...q, box, kind })} columns={cols} rowKey={(r) => r.id} search="Search messages" dates={false} emptyTitle={box === 'drafts' ? 'No drafts' : 'No messages'} />}
    </div>
  );
}
function MessageView({ id, canWrite, onReply, onClose }: { id: string; canWrite: boolean; onReply: (m: MessageRow) => void; onClose: () => void }) {
  const { data: m, error } = useQuery({ queryKey: ['comms', 'message', id], queryFn: () => getMessage(id) });
  return <Card className="p-6">{error ? <EmptyState title="This message isn’t available" /> : !m ? <Skeleton className="h-32" /> : <><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-[18px] font-bold break-words">{m.subject}</h2><p className="text-[13px] text-muted">From {m.from} to {m.to} · {fmtDateTime(m.createdAt)}</p></div><div className="flex gap-2">{m.canReply && canWrite && <Button size="sm" leftIcon={<Reply className="size-4" />} onClick={() => onReply(m)}>Reply</Button>}<Button size="sm" variant="outline" onClick={onClose}>Close</Button></div></div><div className="mt-4 grid gap-4"><p className="text-[15px] leading-relaxed break-words whitespace-pre-line">{m.body}</p><FileList files={m.attachments} /></div></>}</Card>;
}
function Composer({ staff, draft, replyTo, documents, onDone, onCancel }: { staff: boolean; draft?: MessageRow; replyTo?: MessageRow; documents?: boolean; onDone: () => void; onCancel: () => void }) {
  const reply = replyTo?.id ?? draft?.replyTo ?? undefined;
  const [v, setV] = useState({ to: draft?.toAddress ?? '', subject: draft?.subject ?? (replyTo ? `Re: ${replyTo.subject.replace(/^Re: /, '')}`.slice(0, 120) : documents ? 'Documents' : ''), body: draft?.body ?? '' });
  const [files, setFiles] = useState<AttachmentInfo[]>(draft?.attachments ?? []);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const go = async (asDraft: boolean) => {
    setBusy(asDraft ? 'draft' : 'send');
    try { await saveMessage(draft?.id ?? null, { ...v, attachments: files.map((f) => f.id), replyTo: reply, draft: asDraft }); toast.success(asDraft ? 'Draft saved' : 'Message sent'); if (documents && !asDraft) { setV({ ...v, body: '' }); setFiles([]); } onDone(); } catch (e) { setErr(errs(e)); } finally { setBusy(''); }
  };
  return (
    <Card className="p-6"><CardHeader title={documents ? 'Send documents to the team' : reply ? 'Reply' : draft ? 'Edit draft' : 'New message'} description={staff ? undefined : 'Goes to the JustReference team.'} />
      <div className="grid max-w-3xl gap-4">
        {staff && !reply && <Field label="To" error={err.to} hint="Member ID or email" required>{({ id, invalid }) => <Input id={id} aria-invalid={invalid} value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} />}</Field>}
        <Field label="Subject" error={err.subject} required>{({ id, invalid }) => <Input id={id} maxLength={120} aria-invalid={invalid} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />}</Field>
        <Field label="Message" error={err.body} required>{({ id, invalid }) => <Textarea id={id} className="min-h-36" maxLength={5000} aria-invalid={invalid} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field>
        <AttachmentPicker value={files} onChange={setFiles} />
        {(err._ || err.attachments) && <p role="alert" className="text-[13px] text-danger">{err._ ?? err.attachments}</p>}
        <div className="flex flex-wrap gap-2"><Button loading={busy === 'send'} disabled={!!busy} leftIcon={<Send className="size-4" />} onClick={() => go(false)}>Send</Button><Button variant="outline" loading={busy === 'draft'} disabled={!!busy} onClick={() => go(true)}>Save draft</Button>{!documents && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}</div>
      </div>
    </Card>
  );
}

/* ================================================================ Tickets */
const ticketBase = (k: PanelKey) => (k === 'admin' || k === 'super-admin' ? `${PANELS[k].base}/tickets` : `${PANELS[k].base}/support/tickets`);
export function TicketsPage({ panelKey, done }: { panelKey: PanelKey; done?: boolean }) {
  const admin = panelKey === 'admin' || panelKey === 'super-admin';
  const cols: Column<TicketRow>[] = [
    { key: 't', header: 'Ticket', cell: (r) => <><Link to={`${ticketBase(panelKey)}/${r.id}`} className="block font-mono text-[12.5px] font-semibold text-brand-600 hover:underline">{r.ticketNo}</Link><span className="block min-w-40">{r.subject}</span></> },
    ...(admin ? [{ key: 'u', header: 'From', cell: (r: TicketRow) => <>{r.user.name}<br /><span className="text-[12px] text-muted">{r.user.guest ? `${r.user.email} (visitor)` : r.user.memberId}</span></> }] : []),
    { key: 'c', header: 'Category', cell: (r) => label(r.category) }, { key: 'p', header: 'Priority', cell: (r) => (r.priority === 'normal' ? 'Normal' : <Badge tone={r.priority === 'urgent' ? 'red' : 'amber'}>{label(r.priority)}</Badge>) }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'd', header: 'Updated', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.updatedAt)}</span> },
  ];
  const fixed = admin ? undefined : { status: done ? 'done' : 'active' };
  return <ReportPage<TicketRow> key={String(done)} panelKey={panelKey} title={admin ? 'Support tickets' : done ? 'Ticket history' : 'My tickets'} queryKey="tickets" load={(q) => listTickets(admin, q)} columns={cols} rowKey={(r) => r.id} search="Ticket number or subject" fixed={fixed} filters={admin ? [{ key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, ...TICKET_STATUSES.map((s) => ({ value: s, label: label(s) }))] }] : []} actions={() => !admin && <ButtonLink size="sm" to={`${PANELS[panelKey].base}/support/new`}>New request</ButtonLink>} emptyTitle={done ? 'No finished tickets' : 'No open tickets'} />;
}
export function NewTicketPage({ panelKey }: { panelKey: PanelKey }) {
  const navigate = useNavigate();
  const [v, setV] = useState({ subject: '', category: 'other', body: '' });
  const [files, setFiles] = useState<AttachmentInfo[]>([]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { const t = await createTicket({ ...v, category: v.category as never, attachments: files.map((f) => f.id) }); toast.success(`${t.ticketNo} opened`); navigate(`${ticketBase(panelKey)}/${t.id}`); } catch (x) { setErr(errs(x)); } finally { setBusy(false); } };
  return (
    <div className="grid grid-cols-1 gap-5">{head(panelKey, 'New support request', undefined, undefined, { label: 'My tickets', to: ticketBase(panelKey) })}
      <Card className="max-w-3xl p-6"><form onSubmit={go} noValidate className="grid gap-4">
        <Field label="Subject" error={err.subject} required>{({ id, invalid }) => <Input id={id} maxLength={120} aria-invalid={invalid} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />}</Field>
        <Field label="Category">{({ id }) => <Select id={id} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
        <Field label="Description" error={err.body} required hint="Include order or payment numbers. Never share passwords or OTPs.">{({ id, invalid, describedBy }) => <Textarea id={id} className="min-h-36" maxLength={5000} aria-invalid={invalid} aria-describedby={describedBy} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field>
        <AttachmentPicker value={files} onChange={setFiles} />
        {err._ && <p role="alert" className="text-[13px] text-danger">{err._}</p>}
        <div><Button type="submit" loading={busy}>Open ticket</Button></div>
      </form></Card>
    </div>
  );
}
export function TicketPage({ panelKey }: { panelKey: PanelKey }) {
  const { id = '' } = useParams();
  const admin = panelKey === 'admin' || panelKey === 'super-admin';
  const qc = useQueryClient();
  const key = ['comms', 'ticket', admin, id];
  const { data: t, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => getTicket(admin, id) });
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<AttachmentInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const apply = (d: unknown) => { qc.setQueryData(key, d); qc.invalidateQueries({ queryKey: ['finance', 'tickets'] }); };
  const run = async (f: () => Promise<unknown>, msg?: string) => { setBusy(true); try { apply(await f()); if (msg) toast.success(msg); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const parent = { label: admin ? 'Support tickets' : 'My tickets', to: ticketBase(panelKey) };
  if (error) return <div className="grid gap-5">{head(panelKey, 'Ticket', undefined, undefined, parent)}<Card>{error instanceof ApiError && error.status === 404 ? <EmptyState title="This ticket isn’t available" /> : <ErrorState onRetry={() => refetch()} />}</Card></div>;
  if (isLoading || !t) return <Skeleton className="h-80" />;
  return (
    <div className="grid grid-cols-1 gap-5">
      <PageHeader className="mb-0" breadcrumbs={[{ label: PANELS[panelKey].label, to: PANELS[panelKey].base }, parent, { label: t.ticketNo }]} title={t.subject} description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{t.ticketNo}</span><StatusBadge status={t.status} />{label(t.category)}{admin && <> · {t.user.name} {t.user.guest ? t.user.email : t.user.memberId}</>}</span>}
        actions={admin ? <><Select aria-label="Status" className="h-9 w-36" value={t.status} onChange={(e) => run(() => updateTicket(id, { status: e.target.value }), 'Status updated')}>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select><Select aria-label="Priority" className="h-9 w-32" value={t.priority} onChange={(e) => run(() => updateTicket(id, { priority: e.target.value }), 'Priority updated')}>{TICKET_PRIORITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></> : t.status !== 'closed' && <ConfirmDialog title="Close this ticket?" description="You can open a new one any time." confirmLabel="Close ticket" onConfirm={() => run(() => closeTicket(id), 'Ticket closed')} trigger={(o) => <Button size="sm" variant="outline" onClick={o}>Close ticket</Button>} />} />
      <ol className="grid gap-3">{t.messages.map((m) => <li key={m.id}><Card className={cn('p-5', m.staff && 'border-brand-100 bg-brand-50/40')}><p className="text-[13px] text-muted"><b className="text-ink">{m.from}</b>{m.staff && ' · Support'} · {fmtDateTime(m.createdAt)}</p><p className="mt-2 text-[15px] break-words whitespace-pre-line">{m.body}</p><div className="mt-3"><FileList files={m.attachments} /></div></Card></li>)}</ol>
      {t.status === 'closed' ? <Card className="p-5 text-[14px] text-muted">This ticket is closed.</Card> : admin && t.user.guest ? <Card className="p-5 text-[14px] text-muted">This came from the contact form. Reply by email to <a className="font-semibold text-brand-600 underline" href={`mailto:${t.user.email}`}>{t.user.email}</a>, then set the status.</Card> : (
        <Card className="p-6"><div className="grid gap-4"><Field label="Reply">{({ id: f }) => <Textarea id={f} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />}</Field><AttachmentPicker value={files} onChange={setFiles} /><div><Button loading={busy} disabled={body.trim().length < 2} onClick={() => run(async () => { const d = await replyTicket(admin, id, { body, attachments: files.map((f) => f.id) }); setBody(''); setFiles([]); return d; }, 'Reply sent')}>Send reply</Button></div></div></Card>
      )}
    </div>
  );
}

/* ================================================================ Reviews (admin) */
export function FeedbackPage({ panelKey }: { panelKey: PanelKey }) {
  const qc = useQueryClient();
  const set = async (id: string, s: 'published' | 'hidden') => { try { await decideFeedback(id, s); toast.success(s === 'published' ? 'Published' : 'Hidden'); } catch (e) { toast.error(errorMessage(e)); } finally { qc.invalidateQueries({ queryKey: ['finance'] }); } };
  const cols: Column<FeedbackRow>[] = [{ key: 'o', header: 'Order', cell: (r) => <><span className="block font-mono text-[12.5px] whitespace-nowrap">{r.orderNo}</span><span className="text-[12px] text-muted">{fmtDate(r.createdAt)}</span></> }, { key: 'v', header: 'Vendor', cell: (r) => r.vendor }, { key: 'b', header: 'Buyer', cell: (r) => r.buyer }, { key: 'r', header: 'Rating', cell: (r) => <Stars value={r.rating} /> }, { key: 'c', header: 'Comment', cell: (r) => <span className="block min-w-48 break-words">{r.comment || '—'}</span> }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'x', header: '', cell: (r) => <span className="flex gap-1.5">{r.status !== 'published' && <Button size="sm" onClick={() => set(r.id, 'published')}>Publish</Button>}{r.status !== 'hidden' && <Button size="sm" variant="outline" onClick={() => set(r.id, 'hidden')}>Hide</Button>}</span> }];
  return <ReportPage<FeedbackRow> panelKey={panelKey} title="Customer feedback" description="Reviews from buyers of completed orders. They appear on vendor profiles once published." queryKey="feedback" load={listFeedback} columns={cols} rowKey={(r) => r.id} dates={false} filters={[{ key: 'status', label: 'Status', options: ['pending', 'published', 'hidden'].map((v) => ({ value: v, label: label(v) })) }]} emptyTitle="No reviews yet" />;
}
