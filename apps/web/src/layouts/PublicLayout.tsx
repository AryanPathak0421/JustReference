import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { ScrollReset } from '@/lib/ScrollReset';
import * as RD from '@radix-ui/react-dialog';
import { ArrowRight, Facebook, Instagram, Linkedin, Menu, ShoppingCart, X, Youtube } from 'lucide-react';
import { Button, ButtonLink, Logo } from '@/design-system';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/AuthProvider';
import { homePath, MaintenanceScreen } from '@/features/auth/guards';
import { useCart } from '@/features/commerce/api';
import { usePublicStatus } from '@/features/system/api';

function AccountButtons({ mobile }: { mobile?: boolean }) {
  const { status, user } = useAuth();
  if (status === 'authenticated' && user) {
    // On phones the header has no room next to the logo; the menu drawer shows this button instead.
    return <ButtonLink to={homePath(user)} className={mobile ? undefined : 'hidden sm:inline-flex'}>My dashboard</ButtonLink>;
  }
  return mobile ? (
    <>
      <ButtonLink to="/login" variant="outline">Log in</ButtonLink>
      <ButtonLink to="/register">Create free account</ButtonLink>
    </>
  ) : (
    <>
      <ButtonLink to="/login" variant="ghost" className="hidden sm:inline-flex">Log in</ButtonLink>
      <ButtonLink to="/register">Join free</ButtonLink>
    </>
  );
}

export function CartLink() {
  const { data } = useCart();
  const { user } = useAuth();
  if (!user?.roles.includes('member')) return null;
  const n = data?.count ?? 0;
  return (
    <Link to="/member/cart" aria-label={`Cart, ${n} item${n === 1 ? '' : 's'}`} className="relative grid size-10 flex-none place-items-center rounded-lg hover:bg-canvas">
      <ShoppingCart className="size-5" />
      {n > 0 && <span className="absolute top-0.5 right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">{n}</span>}
    </Link>
  );
}

const NAV = [
  { to: '/products', label: 'Products' },
  { to: '/services', label: 'Services' },
  { to: '/projects', label: 'Projects' },
  { to: '/vendors', label: 'Vendors' },
  { to: '/directory', label: 'Directory' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/blog', label: 'Blog' },
];

function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line-2 bg-white/85 backdrop-blur-md backdrop-saturate-150">
      <div className="container-page flex h-17 items-center gap-2 sm:gap-7">
        <Logo />
        <nav aria-label="Main" className="hidden flex-1 gap-1 xl:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn('rounded-lg px-3 py-2 text-[14.5px] font-medium whitespace-nowrap text-ink-2 transition hover:bg-canvas hover:text-ink', isActive && 'text-navy-900 bg-brand-50')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <CartLink />
          <AccountButtons />
          <RD.Root open={open} onOpenChange={setOpen}>
            <RD.Trigger asChild>
              <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Open menu"><Menu className="size-5" /></Button>
            </RD.Trigger>
            <RD.Portal>
              <RD.Overlay className="fixed inset-0 z-50 bg-navy-950/40 data-[state=open]:animate-fade-in xl:hidden" />
              <RD.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(320px,88vw)] flex-col bg-white p-5 shadow-pop focus:outline-none xl:hidden">
                <div className="flex items-center justify-between">
                  <RD.Title asChild><span><Logo /></span></RD.Title>
                  <RD.Close className="grid size-9 place-items-center rounded-lg hover:bg-canvas" aria-label="Close menu"><X className="size-5" /></RD.Close>
                </div>
                <RD.Description className="sr-only">Site navigation</RD.Description>
                <nav aria-label="Mobile" className="mt-6 grid gap-1">
                  {NAV.map((n) => (
                    <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('rounded-lg px-3 py-2.5 font-medium text-ink-2 hover:bg-canvas', isActive && 'bg-brand-50 text-navy-900')}>
                      {n.label}
                    </NavLink>
                  ))}
                  <NavLink to="/referral" className="rounded-lg px-3 py-2.5 font-medium text-ink-2 hover:bg-canvas">Referral program</NavLink>
                  <NavLink to="/contact" className="rounded-lg px-3 py-2.5 font-medium text-ink-2 hover:bg-canvas">Contact</NavLink>
                </nav>
                <div className="mt-auto grid gap-2">
                  <AccountButtons mobile />
                </div>
              </RD.Content>
            </RD.Portal>
          </RD.Root>
        </div>
      </div>
    </header>
  );
}

const FOOTER = [
  { title: 'Marketplace', links: [['Products', '/products'], ['Services', '/services'], ['Projects', '/projects'], ['Vendors', '/vendors'], ['Business directory', '/directory']] },
  { title: 'Company', links: [['About us', '/about'], ['How it works', '/how-it-works'], ['Referral program', '/referral'], ['Blog', '/blog'], ['Contact', '/contact']] },
  { title: 'For business', links: [['Become a vendor', '/register?type=vendor'], ['Vendor login', '/login'], ['Post a project', '/member/projects/new'], ['Support', '/contact']] },
  { title: 'Legal', links: [['Privacy policy', '/privacy'], ['Terms & conditions', '/terms'], ['Refund policy', '/refund-policy']] },
] as const;

function Footer() {
  const { data: site } = usePublicStatus();
  return (
    <footer className="mt-22 bg-navy-950 pt-16 pb-7 text-[#aab6d3]">
      <div className="container-page">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo light />
            <p className="mt-4 max-w-xs text-[14px]">India&apos;s marketplace for products, services and projects, powered by trusted references.</p>
            <div className="mt-5 flex gap-2">
              {([[Facebook, 'facebook'], [Instagram, 'instagram'], [Linkedin, 'linkedin'], [Youtube, 'youtube']] as const).map(([I, key]) => site?.social[key] && <a key={key} href={site.social[key]} target="_blank" rel="noopener noreferrer" aria-label={key} className="grid size-9 place-items-center rounded-[10px] bg-white/6 transition hover:bg-white/14 hover:text-white"><I className="size-4" /></a>)}
            </div>
          </div>
          {FOOTER.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3.5 text-[14px] font-semibold text-white">{col.title}</h4>
              <ul className="grid gap-2.5 text-[14px]">
                {col.links.map(([label, to]) => (
                  <li key={label}><Link to={to} className="transition hover:text-white">{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap justify-between gap-3 border-t border-white/8 pt-6 text-[13px]">
          <span>© {new Date().getFullYear()} JustReference.in. All rights reserved.</span>
          <Link to="/register?type=vendor" className="inline-flex items-center gap-1.5 hover:text-white">
            List your business <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  const { data: site } = usePublicStatus();
  const { user } = useAuth();
  const isAdmin = !!user && (user.roles.includes('admin') || user.roles.includes('super_admin'));
  const down = site?.maintenance.enabled && !isAdmin;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop">Skip to content</a>
      <Header />
      <main id="main" className="flex-1">
        {down ? (
          <MaintenanceScreen message={site.maintenance.message}>
            {site.support.email && <p className="mt-4 text-[14px] text-muted">Need help? Email <a className="font-semibold text-brand-600" href={`mailto:${site.support.email}`}>{site.support.email}</a></p>}
          </MaintenanceScreen>
        ) : (
          <Outlet />
        )}
      </main>
      <Footer />
      <ScrollReset />
    </div>
  );
}
