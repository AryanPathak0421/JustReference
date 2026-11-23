import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ScrollReset } from '@/lib/ScrollReset';
import * as RD from '@radix-ui/react-dialog';
import * as DM from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, ArrowLeftRight, Bell, ChevronDown, ChevronRight, KeyRound, LogOut, Mail, PanelLeft, Search, X } from 'lucide-react';
import { Avatar, Logo } from '@/design-system';
import { cn } from '@/lib/cn';
import { PANELS, type NavGroup, type NavItem, type PanelConfig, type PanelKey } from '@/panels/navigation';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePublicStatus } from '@/features/system/api';

function isActivePath(pathname: string, to: string, base: string) {
  return to === base ? pathname === base : pathname === to || pathname.startsWith(`${to}/`);
}

/** Remove nav entries the user lacks permission for (and groups left empty). */
function visibleNav(nav: NavGroup[], can: (p: string) => boolean): NavGroup[] {
  return nav
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => !i.perm || can(i.perm))
        .map((i) => (i.children ? { ...i, children: i.children.filter((c) => !c.perm || can(c.perm)) } : i)),
    }))
    .filter((g) => g.items.length > 0);
}

function SidebarItem({ item, panel, pathname }: { item: NavItem; panel: PanelConfig; pathname: string }) {
  const childActive = !!item.children?.some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`));
  const active = isActivePath(pathname, item.to, panel.base) || childActive;
  const [open, setOpen] = useState(childActive);
  useEffect(() => { if (childActive) setOpen(true); }, [childActive]);
  const Icon = item.icon;
  const rowCls = cn(
    'group flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[14px] font-medium text-ink-2 transition hover:bg-canvas hover:text-ink',
    active && 'bg-brand-50 font-semibold text-navy-800',
  );
  const icon = <Icon className={cn('size-[18px] flex-none text-[#8794ab]', active && 'text-brand-600')} strokeWidth={1.9} />;

  if (!item.children?.length) {
    return <NavLink to={item.to} end={item.to === panel.base} className={rowCls}>{icon}<span className="truncate">{item.label}</span></NavLink>;
  }
  return (
    <div>
      <button type="button" className={rowCls} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
        <span className="truncate">{item.label}</span>
        <ChevronRight className={cn('ml-auto size-4 text-subtle transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="mt-0.5 mb-1 ml-[21px] grid gap-0.5 border-l border-line pl-3">
          {item.children.map((c) => (
            <li key={c.to}>
              <NavLink to={c.to} className={({ isActive }) => cn('block rounded-md px-2.5 py-1.5 text-[13.5px] text-muted transition hover:bg-canvas hover:text-ink', isActive && 'font-semibold text-navy-800')}>
                {c.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SidebarNav({ panel }: { panel: PanelConfig }) {
  const { pathname } = useLocation();
  const { can } = useAuth();
  return (
    <nav aria-label={`${panel.label} navigation`} className="flex-1 overflow-y-auto px-3 py-3.5">
      {visibleNav(panel.nav, can).map((g) => (
        <div key={g.label} className="mb-3.5">
          <h5 className="px-2.5 pt-2 pb-1.5 text-[11px] font-bold tracking-[0.08em] text-subtle uppercase">{g.label}</h5>
          <div className="grid gap-0.5">
            {g.items.map((item) => <SidebarItem key={item.label} item={item} panel={panel} pathname={pathname} />)}
          </div>
        </div>
      ))}
    </nav>
  );
}

function UserMenu({ panel }: { panel: PanelConfig }) {
  const { user, panels, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const otherPanels = panels.filter((p) => p !== panel.key);
  const subtitle = user.memberId ?? panel.label;
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] text-ink-2 outline-none data-[highlighted]:bg-canvas data-[highlighted]:text-ink';
  return (
    <DM.Root>
      <DM.Trigger className="flex items-center gap-2.5 rounded-[10px] border border-line py-1 pr-2.5 pl-1 transition hover:bg-canvas" aria-label="Account menu">
        <Avatar name={user.name} size={32} />
        <span className="hidden max-w-40 text-left leading-tight md:block">
          <b className="block truncate text-[13.5px]">{user.name}</b>
          <span className="text-[12px] text-muted">{subtitle}</span>
        </span>
        <ChevronDown className="hidden size-4 text-subtle md:block" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={8} className="z-50 min-w-60 rounded-xl border border-line bg-white p-1.5 shadow-pop data-[state=open]:animate-fade-in">
          <DM.Label className="px-2.5 py-2 text-[12px] text-muted">
            Signed in as <b className="text-ink">{user.name}</b>
            <span className="block truncate">{user.email}</span>
          </DM.Label>
          <DM.Separator className="my-1 h-px bg-line-2" />
          <DM.Item className={item} onSelect={() => navigate(`${panel.base}/account`)}><KeyRound className="size-4" />Account &amp; security</DM.Item>
          {otherPanels.map((p) => (
            <DM.Item key={p} className={item} onSelect={() => navigate(PANELS[p].base)}><ArrowLeftRight className="size-4" />Switch to {PANELS[p].label} panel</DM.Item>
          ))}
          <DM.Separator className="my-1 h-px bg-line-2" />
          <DM.Item
            className={cn(item, 'text-danger data-[highlighted]:bg-danger-50 data-[highlighted]:text-danger')}
            // Leave the panel first so the route guard doesn't record this page as a post-login destination.
            onSelect={() => { navigate('/login', { replace: true }); void signOut(); }}
          >
            <LogOut className="size-4" />Log out
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function PanelLayout({ panelKey }: { panelKey: PanelKey }) {
  const panel = PANELS[panelKey];
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);
  const { data: site } = usePublicStatus();
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-white lg:flex">
        <div className="flex h-17 flex-none items-center border-b border-line-2 px-5"><Logo /></div>
        <SidebarNav panel={panel} />
        <div className="border-t border-line-2 px-5 py-3 text-[12px] text-muted">{panel.label} panel</div>
      </aside>

      <RD.Root open={drawer} onOpenChange={setDrawer}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-50 bg-navy-950/40 data-[state=open]:animate-fade-in lg:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(288px,86vw)] flex-col bg-white shadow-pop focus:outline-none data-[state=open]:animate-slide-in lg:hidden">
            <div className="flex h-16 flex-none items-center justify-between border-b border-line-2 px-4">
              <RD.Title asChild><span><Logo /></span></RD.Title>
              <RD.Close className="grid size-9 place-items-center rounded-lg hover:bg-canvas" aria-label="Close menu"><X className="size-5" /></RD.Close>
            </div>
            <RD.Description className="sr-only">{panel.label} navigation</RD.Description>
            <SidebarNav panel={panel} />
          </RD.Content>
        </RD.Portal>
      </RD.Root>

      <div className="min-w-0">
        {site?.maintenance.enabled && (
          <div role="status" className="flex items-center justify-center gap-2 bg-warn-50 px-4 py-2 text-[13px] font-medium text-[#7a5212]">
            <AlertTriangle className="size-4" />
            Maintenance mode is ON. Members and vendors see a maintenance page; admins can keep working.
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:h-17 sm:px-7">
          <button type="button" onClick={() => setDrawer(true)} className="grid size-10 place-items-center rounded-[10px] text-ink-2 hover:bg-canvas lg:hidden" aria-label="Open navigation">
            <PanelLeft className="size-5" />
          </button>
          <div className="lg:hidden"><Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" /></div>
          <label className="relative hidden max-w-md flex-1 md:block">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            {/* Global search is wired to the API in Phase 6. */}
            <input placeholder="Search (coming in Phase 6)" disabled className="h-10 w-full rounded-[10px] border border-line bg-canvas pr-3 pl-9 text-[14px] outline-none disabled:cursor-not-allowed" />
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            <Link to={`${panel.base}/messages`} className="grid size-10 place-items-center rounded-[10px] text-ink-2 hover:bg-canvas" aria-label="Messages"><Mail className="size-[18px]" /></Link>
            <Link to={`${panel.base}/notifications`} className="grid size-10 place-items-center rounded-[10px] text-ink-2 hover:bg-canvas" aria-label="Notifications"><Bell className="size-[18px]" /></Link>
            <UserMenu panel={panel} />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1400px] p-4 sm:p-7">
          <Outlet />
        </main>
      </div>
      <ScrollReset />
    </div>
  );
}
