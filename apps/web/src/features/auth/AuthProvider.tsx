import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, AuthUser } from '@jr/shared';
import { onSessionChange, refreshSession, setAccessToken } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import * as authApi from './api';
import type { PanelKey } from '@/panels/navigation';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  /** True right after the user logged out themselves (so guards don't remember a "return to" page). */
  signedOut: boolean;
  /** Store the result of login / verification / refresh. */
  signIn: (r: AuthResponse) => void;
  setUser: (u: AuthUser) => void;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
  panels: PanelKey[];
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Which panels a user may open, in priority order. */
export function panelsFor(user: AuthUser | null): PanelKey[] {
  if (!user) return [];
  const p: PanelKey[] = [];
  if (user.roles.includes('super_admin')) p.push('super-admin');
  if (user.roles.includes('admin') || user.roles.includes('super_admin')) p.push('admin');
  if (user.roles.includes('vendor')) p.push('vendor');
  if (user.roles.includes('member')) p.push('member');
  return p;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const signIn = useCallback((r: AuthResponse) => {
    setAccessToken(r.accessToken);
    setUser(r.user);
    setSignedOut(false);
    setStatus('authenticated');
  }, []);

  // Restore the session on load (refresh cookie → access token), and follow silent refreshes.
  useEffect(() => {
    const off = onSessionChange((r) => {
      if (r) { setUser(r.user); setStatus('authenticated'); }
      else { setUser(null); setStatus('anonymous'); queryClient.clear(); }
    });
    refreshSession().catch(() => { setStatus('anonymous'); });
    return off;
  }, []);

  const signOut = useCallback(async () => {
    setSignedOut(true);
    try { await authApi.logout(); } catch { /* already signed out server-side */ }
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const perms = new Set(user?.permissions ?? []);
    return { status, user, signedOut, signIn, setUser, signOut, can: (p) => perms.has(p), panels: panelsFor(user) };
  }, [status, user, signedOut, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Render children only when the current user has the permission. UI convenience — the API enforces it. */
export function Can({ perm, children, fallback = null }: { perm: string; children: ReactNode; fallback?: ReactNode }) {
  return useAuth().can(perm) ? <>{children}</> : <>{fallback}</>;
}
