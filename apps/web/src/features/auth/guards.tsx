import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Construction, Loader2, ShieldX } from 'lucide-react';
import type { AuthUser } from '@jr/shared';
import { ButtonLink, Card, EmptyState, Logo } from '@/design-system';
import { PANELS, type PanelKey } from '@/panels/navigation';
import { panelsFor, useAuth } from './AuthProvider';
import { usePublicStatus } from '@/features/system/api';

export const homePath = (user: AuthUser | null) => PANELS[panelsFor(user)[0] ?? 'member'].base;

/**
 * Validate a post-login "next" path: same-site relative paths only (prevents open redirects),
 * and — when a user is given — only panels that user can actually open.
 */
export function safeNext(next: string | null, user?: AuthUser | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  const panel = next.split(/[/?#]/)[1] as PanelKey;
  if (user && panel in PANELS && !panelsFor(user).includes(panel)) return null;
  return next;
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas" role="status" aria-label="Loading">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <Loader2 className="size-5 animate-spin text-brand-600" />
      </div>
    </div>
  );
}

export function MaintenanceScreen({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-4 py-16 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-warn-50 text-warn"><Construction className="size-7" /></span>
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-navy-950">We’ll be right back</h1>
        <p className="mt-3 text-[16px] text-muted">{message}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * Guards a panel: requires login, the right role, a changed temporary password, and no maintenance
 * (admins can keep working during maintenance).
 */
export function PanelGuard({ panel, children }: { panel: PanelKey; children: ReactNode }) {
  const { status, user, panels, signedOut } = useAuth();
  const location = useLocation();
  const { data: site } = usePublicStatus();
  const base = PANELS[panel].base;

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous' || !user) {
    if (signedOut) return <Navigate to="/login" replace />;
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (!panels.includes(panel)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas p-4">
        <Card className="w-full max-w-lg">
          <EmptyState
            icon={ShieldX}
            title="You don’t have access to this area"
            description={`Your account can’t open the ${PANELS[panel].label} panel.`}
            action={<ButtonLink to={homePath(user)}>Go to my dashboard</ButtonLink>}
          />
        </Card>
      </div>
    );
  }
  if (user.mustChangePassword && location.pathname !== `${base}/account`) {
    return <Navigate to={`${base}/account`} replace />;
  }
  const isAdmin = user.roles.includes('admin') || user.roles.includes('super_admin');
  if (site?.maintenance.enabled && !isAdmin) {
    return <div className="min-h-dvh bg-canvas"><MaintenanceScreen message={site.maintenance.message} /></div>;
  }
  return <>{children}</>;
}
