/**
 * HTTP client for the JustReference API.
 * - Access token lives in memory only (never localStorage).
 * - The refresh token is an httpOnly cookie; refreshes send the CSRF double-submit header.
 * - A 401 with TOKEN_EXPIRED triggers one refresh (shared by concurrent requests) and a single retry.
 */
import type { ApiErrorBody, AuthResponse } from '@jr/shared';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const hasCsrfCookie = () => document.cookie.split('; ').some((c) => c.startsWith('jr_csrf='));
const csrfToken = () => decodeURIComponent(document.cookie.split('; ').find((c) => c.startsWith('jr_csrf='))?.slice(8) ?? '');

type Listener = (r: AuthResponse | null) => void;
const listeners = new Set<Listener>();
/** Notified after a silent refresh (new user data) or when the session is gone (null). */
export const onSessionChange = (fn: Listener) => { listeners.add(fn); return () => void listeners.delete(fn); };

type Query = Record<string, string | number | boolean | undefined | null>;
const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try { body = await res.json(); } catch { /* non-JSON */ }
  const e = body.error;
  if (!e) return new ApiError(res.status, res.status >= 500 ? 'INTERNAL' : 'HTTP_ERROR', res.status >= 500 ? 'The server is unavailable. Please try again shortly.' : 'Request failed');
  return new ApiError(res.status, e.code, e.message, e.fields, e.details);
}

/** The host (not our API) answered: the server is asleep or restarting. Our own errors are always JSON. */
const asleep = (res: Response) => [502, 503, 504].includes(res.status) && !res.headers.get('content-type')?.includes('json');

let onWaking: ((waking: boolean) => void) | null = null;
export const setWakingHandler = (f: ((waking: boolean) => void) | null) => { onWaking = f; };
let waking: Promise<boolean> | null = null;
/** Ask the health check until the server answers (up to 90 seconds). Shared by everything that is waiting. */
function waitForServer(): Promise<boolean> {
  waking ??= (async () => {
    onWaking?.(true);
    try {
      for (const end = Date.now() + 90_000; Date.now() < end; ) {
        try {
          const res = await fetch(`${BASE}/health`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
          if (res.ok) return true;
        } catch { /* still starting */ }
        await new Promise((ok) => setTimeout(ok, 2000));
      }
      return false;
    } finally { onWaking?.(false); waking = null; }
  })();
  return waking;
}

let refreshing: Promise<AuthResponse | null> | null = null;

/** Exchange the refresh cookie for a new access token. Resolves null when there is no valid session. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      if (!hasCsrfCookie()) return null;
      // A server restart or network blip must not log the user out: retry transient failures
      // (network errors, 5xx) with backoff. Only a definite 401/403 ends the session.
      for (let attempt = 0; ; attempt++) {
        let res: Response | undefined;
        try {
          res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrfToken() } });
        } catch { /* network error: retry below */ }
        if (res?.ok) {
          const data = (await res.json()) as AuthResponse;
          setAccessToken(data.accessToken);
          return data;
        }
        if (res && (res.status === 401 || res.status === 403)) { setAccessToken(null); return null; }
        if (res && asleep(res) && attempt < 4 && (await waitForServer())) continue;
        if (attempt >= 4 || (res && asleep(res))) throw res ? await toError(res) : new ApiError(0, 'NETWORK', 'Can’t reach the server. Check your connection and try again.');
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt)); // 0.4s, 0.8s, 1.6s, 3.2s
      }
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })().then((r) => { listeners.forEach((l) => l(r)); return r; });
  return refreshing;
}

/** Asks the person to confirm their password; resolves true once confirmed. Set by the app shell. */
let reauth: (() => Promise<boolean>) | null = null;
export const setReauthHandler = (f: (() => Promise<boolean>) | null) => { reauth = f; };

interface Opts { query?: Query; body?: unknown; form?: FormData; csrf?: boolean; signal?: AbortSignal; noReauth?: boolean; woke?: boolean }

async function send(method: string, path: string, opts: Opts = {}, retried = false): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.csrf) headers['x-csrf-token'] = csrfToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
      method, headers, credentials: 'include', signal: opts.signal,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Can’t reach the server. Check your connection and try again.');
  }
  // Only requests that are safe to repeat are retried; anything that moves money is left to the person.
  if (asleep(res) && !opts.woke && (method === 'GET' || path === '/auth/login') && (await waitForServer())) return send(method, path, { ...opts, woke: true }, retried);
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const err = await toError(res.clone());
    if (err.code === 'TOKEN_EXPIRED' || err.code === 'UNAUTHORIZED') {
      const r = await refreshSession();
      if (r) return send(method, path, opts, true);
    }
  }
  if (res.status === 403 && reauth && !opts.noReauth) {
    const err = await toError(res.clone());
    if (err.code === 'REAUTH_REQUIRED' && (await reauth())) return send(method, path, { ...opts, noReauth: true }, retried);
  }
  return res;
}

async function json<T>(method: string, path: string, opts?: Opts): Promise<T> {
  const res = await send(method, path, opts);
  if (!res.ok) throw await toError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => json<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts?: { csrf?: boolean }) => json<T>('POST', path, { body: body ?? {}, ...opts }),
  put: <T>(path: string, body: unknown) => json<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => json<T>('PATCH', path, { body }),
  del: <T = void>(path: string) => json<T>('DELETE', path),
  /** Multipart upload (the browser sets the boundary header). */
  form: <T>(path: string, form: FormData) => json<T>('POST', path, { form }),
  /** Authenticated binary fetch (e.g. private documents). */
  async blob(path: string): Promise<Blob> {
    const res = await send('GET', path);
    if (!res.ok) throw await toError(res);
    return res.blob();
  },
  /** Authenticated file download (e.g. CSV export). */
  async download(path: string, query: Query, fallbackName: string) {
    const res = await send('GET', path, { query });
    if (!res.ok) throw await toError(res);
    const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
  },
};

/** Copy server field errors onto a react-hook-form instance. Returns true if any were applied. */
export function applyFieldErrors(err: unknown, setError: (name: never, e: { type: string; message: string }) => void): boolean {
  if (!(err instanceof ApiError) || !err.fields) return false;
  for (const [name, message] of Object.entries(err.fields)) setError(name as never, { type: 'server', message });
  return Object.keys(err.fields).length > 0;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
