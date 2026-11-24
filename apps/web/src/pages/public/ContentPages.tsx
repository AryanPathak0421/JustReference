import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Mail, MapPin, Phone } from 'lucide-react';
import type { CmsPageKey } from '@jr/shared';
import { Alert, Button, ButtonLink, Card, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton, Textarea } from '@/design-system';
import { RichText } from '@/features/comms/components';
import { getPage, getPost, listPosts, sendContact } from '@/features/comms/api';
import { fmtDate } from '@/features/dashboard/widgets';
import { usePublicStatus } from '@/features/system/api';
import { ApiError, errorMessage } from '@/lib/api';

const missing = (e: unknown) => e instanceof ApiError && e.status === 404;
const TITLES: Record<CmsPageKey, string> = { about: 'About us', 'how-it-works': 'How it works', referral: 'Referral program', privacy: 'Privacy policy', terms: 'Terms & conditions', 'refund-policy': 'Refund policy' };

/** Facts about how the site works, shown until an administrator publishes their own text. Legal pages have no default. */
const DEFAULTS: Partial<Record<CmsPageKey, string>> = {
  'how-it-works': '## Buying\n\n- Search products, services and projects from verified vendors.\n- Add them to your cart and check out. Each vendor gets a separate order.\n- Follow your order, download the invoice and review the vendor when it’s complete.\n\n## Getting a custom project done\n\n- Post what you need with a budget and timeline.\n- Verified vendors send bids that other vendors can’t see.\n- Accept one, pay the advance or full amount, and the work starts.\n\n## Selling\n\n- Register as a vendor and submit your business documents.\n- Once approved, add listings. Our team reviews them before they go live.\n- Receive orders, ship or deliver, and follow your earnings.',
  referral: 'Every member has a referral link. People who sign up with it are linked to you for good.\n\n## What you can see\n\n- Your direct referrals and the people they bring in, as a list and a tree.\n- Business done by your network and any commissions on it.\n\n## Commissions\n\nWhen commission rules are switched on, they apply only to completed sales. Nothing is paid for sign-ups alone, and commission on a refunded sale is taken back.',
};

export function CmsPageView({ pageKey }: { pageKey: CmsPageKey }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['public-page', pageKey], queryFn: () => getPage(pageKey), retry: false });
  const fallback = missing(error) ? DEFAULTS[pageKey] : undefined;
  return (
    <div className="container-page py-10">
      <PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: data?.title ?? TITLES[pageKey] }]} title={data?.title ?? TITLES[pageKey]} description={data?.updatedAt ? `Updated ${fmtDate(data.updatedAt)}` : undefined} />
      <Card className="max-w-3xl p-6 sm:p-8">{isLoading ? <Skeleton className="h-60" /> : data ? <RichText text={data.body} /> : fallback ? <RichText text={fallback} /> : missing(error) ? <EmptyState icon={FileText} title="This page hasn’t been published yet" description="Please contact us if you need this information." action={<ButtonLink to="/contact">Contact us</ButtonLink>} /> : <ErrorState onRetry={() => refetch()} />}</Card>
    </div>
  );
}

export function BlogPage() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['posts', page], queryFn: () => listPosts(page) });
  return (
    <div className="container-page py-10"><PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Blog' }]} title="Blog" description="Guides and updates." />
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? <Skeleton className="h-60" /> : !data?.data.length ? <Card><EmptyState title="No posts yet" /></Card> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{data.data.map((p) => <Link key={p.slug} to={`/blog/${p.slug}`}><Card hover className="h-full p-6"><time className="text-[12.5px] text-muted" dateTime={p.publishedAt!}>{fmtDate(p.publishedAt!)}</time><h2 className="mt-1 text-[17px] font-bold">{p.title}</h2><p className="mt-2 text-[14px] text-muted">{p.excerpt}</p></Card></Link>)}</div>}
      {data && data.meta.total > 12 && <div className="mt-6 flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>Newer</Button><Button variant="outline" disabled={page * 12 >= data.meta.total} onClick={() => setParams({ page: String(page + 1) })}>Older</Button></div>}
    </div>
  );
}
export function PostPage() {
  const { slug = '' } = useParams();
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['post', slug], queryFn: () => getPost(slug), retry: false });
  return <div className="container-page py-10"><PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Blog', to: '/blog' }, { label: p?.title ?? 'Post' }]} title={p?.title ?? (missing(error) ? 'Post not found' : '')} description={p ? fmtDate(p.publishedAt!) : undefined} /><Card className="max-w-3xl p-6 sm:p-8">{isLoading ? <Skeleton className="h-60" /> : p ? <RichText text={p.body} /> : missing(error) ? <EmptyState title="This post isn’t available" action={<ButtonLink to="/blog">All posts</ButtonLink>} /> : <ErrorState onRetry={() => refetch()} />}</Card></div>;
}

export function ContactPage() {
  const { data: s } = usePublicStatus();
  const [v, setV] = useState({ name: '', email: '', subject: '', body: '', website: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { setDone((await sendContact(v)).ticketNo); } catch (x) { setErr(x instanceof ApiError && x.fields ? x.fields : { _: errorMessage(x) }); } finally { setBusy(false); } };
  const input = (k: 'name' | 'email' | 'subject', l: string, type = 'text') => <Field label={l} error={err[k]} required>{({ id, invalid }) => <Input id={id} type={type} autoComplete={k === 'subject' ? 'off' : k} aria-invalid={invalid} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}</Field>;
  const info = [[Mail, s?.support.email], [Phone, s?.support.phone], [MapPin, s?.support.address]] as const;
  return (
    <div className="container-page py-10"><PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Contact us' }]} title="Contact us" description="We’ll reply to your email." />
      <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-6">{done ? <Alert tone="success" title="Message received"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" />Your reference is <b className="font-mono">{done}</b>.</span></Alert> : (
          <form onSubmit={go} noValidate className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2">{input('name', 'Your name')}{input('email', 'Email', 'email')}</div>{input('subject', 'Subject')}<Field label="Message" error={err.body} required>{({ id, invalid }) => <Textarea id={id} className="min-h-36" maxLength={3000} aria-invalid={invalid} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field><input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden name="website" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />{err._ && <p role="alert" className="text-[13px] text-danger">{err._}</p>}<div><Button type="submit" loading={busy}>Send message</Button></div></form>)}
        </Card>
        <Card className="p-6"><h2 className="font-bold">Other ways to reach us</h2><ul className="mt-3 grid gap-3 text-[14px]">{info.filter(([, x]) => x).map(([I, x]) => <li key={x} className="flex gap-2"><I className="mt-0.5 size-4 flex-none text-subtle" /><span className="break-words">{x}</span></li>)}{!info.some(([, x]) => x) && <li className="text-muted">Members and vendors can open a support ticket from their panel.</li>}</ul></Card>
      </div>
    </div>
  );
}
