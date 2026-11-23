import { Link, useLocation } from 'react-router';
import { ArrowLeft, Compass, Hammer } from 'lucide-react';
import { ButtonLink, Card, EmptyState, PageHeader } from '@/design-system';
import { findNavEntry, PANELS, type PanelKey, type Phase } from '@/panels/navigation';

const PHASE_NAMES: Record<number, string> = {
  1: 'Platform core (auth, roles, admin tools)',
  2: 'Vendors & catalog',
  3: 'Members & referrals',
  4: 'Orders, payments & bidding',
  5: 'Wallet, commissions & rewards',
  6: 'Messaging, reports & hardening',
};

/** Screen inside a panel that is on the roadmap but not built yet. Honest about it, never a fake form. */
export function PlannedPanelPage({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const { pathname } = useLocation();
  const found = findNavEntry(panel, pathname) ?? commonEntry(panel.base, pathname);
  const title = found?.entry.label ?? 'Page';
  const phase = found?.entry.phase;
  const crumbs = [{ label: panel.label, to: panel.base }, ...(found ? [{ label: found.group.label }] : []), ...(found?.parent ? [{ label: found.parent.label }] : []), { label: title }];

  if (!found) return <PanelNotFound base={panel.base} />;

  return (
    <>
      <PageHeader breadcrumbs={crumbs} title={title} />
      <Card>
        <EmptyState
          icon={Hammer}
          title={`${title} is coming in Phase ${phase}`}
          description={<>This screen is part of <b>{PHASE_NAMES[phase ?? 1]}</b>. It will be built against the real API rather than shown as a mock-up.</>}
          action={<ButtonLink to={panel.base} variant="outline" leftIcon={<ArrowLeft className="size-4" />}>Back to dashboard</ButtonLink>}
        />
      </Card>
    </>
  );
}

/** Account screens reachable from the top bar in every panel, even when not in that panel's sidebar. */
const COMMON: Record<string, { label: string; phase: Phase }> = {
  profile: { label: 'Profile', phase: 3 },
  notifications: { label: 'Notifications', phase: 6 },
  messages: { label: 'Messages', phase: 6 },
};

function commonEntry(base: string, pathname: string) {
  const seg = pathname.slice(base.length + 1);
  const c = COMMON[seg];
  return c ? { entry: { ...c, to: pathname }, group: { label: 'Account', items: [] }, parent: undefined } : undefined;
}

function PanelNotFound({ base }: { base: string }) {
  return (
    <Card>
      <EmptyState icon={Compass} title="Page not found" description="This address doesn’t match any screen in your panel." action={<ButtonLink to={base}>Go to dashboard</ButtonLink>} />
    </Card>
  );
}

const PUBLIC_PLANNED: Record<string, { title: string; phase: number; text: string }> = {
  '/about': { title: 'About us', phase: 6, text: 'Company story, mission and team. Content is managed from the CMS.' },
  '/referral': { title: 'Referral program', phase: 3, text: 'How referral links, direct/indirect referrals and rewards work.' },
  '/how-it-works': { title: 'How it works', phase: 6, text: 'Step-by-step guides for members, buyers and vendors.' },
  '/contact': { title: 'Contact us', phase: 6, text: 'Contact form (creates a support ticket), phone, email and office address.' },
  '/blog': { title: 'Blog', phase: 6, text: 'Guides, product updates and announcements.' },
  '/privacy': { title: 'Privacy policy', phase: 6, text: 'Your legal team’s privacy policy, published through the CMS.' },
  '/terms': { title: 'Terms & conditions', phase: 6, text: 'Your legal team’s terms of use, published through the CMS.' },
  '/refund-policy': { title: 'Refund policy', phase: 6, text: 'Refund and cancellation rules, once the business has decided them.' },
};

export function PlannedPublicPage() {
  const { pathname } = useLocation();
  const key = Object.keys(PUBLIC_PLANNED).find((k) => pathname === k || pathname.startsWith(`${k}/`));
  const detailSection = pathname.match(/^\/(products|services|projects)\/[^/]+$/)?.[1];

  const info = key
    ? PUBLIC_PLANNED[key]!
    : detailSection
      ? { title: 'Listing details', phase: 2, text: 'Full listing page with gallery, vendor profile, reviews, add-to-cart and bidding.' }
      : undefined;

  if (!info) return <NotFoundPage />;

  return (
    <div className="container-page py-10">
      <PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, ...(detailSection ? [{ label: detailSection[0]!.toUpperCase() + detailSection.slice(1), to: `/${detailSection}` }] : []), { label: info.title }]} title={info.title} />
      <Card>
        <EmptyState
          icon={Hammer}
          title={`Coming in Phase ${info.phase}`}
          description={info.text}
          action={<ButtonLink to={detailSection ? `/${detailSection}` : '/'} variant="outline" leftIcon={<ArrowLeft className="size-4" />}>{detailSection ? 'Back to listings' : 'Back to home'}</ButtonLink>}
        />
      </Card>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-16 text-center">
      <div>
        <p className="text-[13px] font-bold tracking-[0.08em] text-brand-600 uppercase">404</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-navy-950">Page not found</h1>
        <p className="mt-3 text-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <div className="mt-7 flex justify-center gap-3">
          <ButtonLink to="/">Go home</ButtonLink>
          <Link to="/contact" className="inline-flex h-10.5 items-center px-4 font-semibold text-brand-600">Contact support</Link>
        </div>
      </div>
    </div>
  );
}
