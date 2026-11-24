import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, FileText, Mail, Paperclip, Search, Star, X } from 'lucide-react';
import type { AttachmentInfo } from '@jr/shared';
import { Button, Field, Modal, PasswordInput } from '@/design-system';
import { openBlob } from '@/features/vendor/api';
import { api, errorMessage, setReauthHandler } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { PanelConfig } from '@/panels/navigation';
import { fileBlob, searchAll, uploadFile, useCounts } from './api';

/* ---------------------------------------------------------------- Plain text with simple headings and lists (always escaped by React) */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className={cn('grid gap-4 text-[15.5px] leading-relaxed text-ink-2', className)}>
      {blocks.map((b, i) => {
        if (b.startsWith('## ') && !b.includes('\n')) return <h2 key={i} className="mt-3 text-[19px] font-bold text-navy-950">{b.slice(3)}</h2>;
        const lines = b.split('\n');
        if (lines.every((l) => l.startsWith('- '))) return <ul key={i} className="grid list-disc gap-1.5 pl-5">{lines.map((l, n) => <li key={n}>{l.slice(2)}</li>)}</ul>;
        return <p key={i} className="break-words whitespace-pre-line">{b}</p>;
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Attachments */
export function AttachmentPicker({ value, onChange }: { value: AttachmentInfo[]; onChange: (v: AttachmentInfo[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (list: FileList | null) => {
    setBusy(true);
    const out = [...value];
    try { for (const f of Array.from(list ?? []).slice(0, 5 - value.length)) out.push(await uploadFile(f)); } catch (e) { toast.error(errorMessage(e)); } finally { onChange(out); setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div className="grid gap-2">
      <input ref={ref} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" aria-label="Attach files" tabIndex={-1} onChange={(e) => pick(e.target.files)} />
      <div><Button variant="outline" size="sm" loading={busy} disabled={value.length >= 5} leftIcon={<Paperclip className="size-4" />} onClick={() => ref.current?.click()}>Attach files</Button> <span className="text-[12.5px] text-muted">PDF or photos, up to 8 MB each</span></div>
      <FileList files={value} onRemove={(id) => onChange(value.filter((f) => f.id !== id))} />
    </div>
  );
}
export function FileList({ files, onRemove }: { files: AttachmentInfo[]; onRemove?: (id: string) => void }) {
  if (!files.length) return null;
  return <ul className="flex flex-wrap gap-2">{files.map((f) => <li key={f.id} className="flex max-w-full items-center gap-1 rounded-lg border border-line bg-white pr-1 text-[13px]"><button type="button" className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 hover:text-brand-600" onClick={() => openBlob(() => fileBlob(f.id), f.name).catch((e) => toast.error(errorMessage(e)))}><FileText className="size-4 flex-none" /><span className="truncate">{f.name}</span></button>{onRemove && <button type="button" aria-label={`Remove ${f.name}`} className="grid size-6 place-items-center rounded hover:bg-canvas" onClick={() => onRemove(f.id)}><X className="size-3.5" /></button>}</li>)}</ul>;
}

/* ---------------------------------------------------------------- Stars */
export const Stars = ({ value, size = 16 }: { value: number; size?: number }) => <span className="inline-flex gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Star key={n} style={{ width: size, height: size }} className={n <= Math.round(value) ? 'fill-[#f5b301] text-[#f5b301]' : 'text-line'} />)}</span>;

/* ---------------------------------------------------------------- Header: counts and search */
export function HeaderIcons({ panel }: { panel: PanelConfig }) {
  const { data } = useCounts();
  const icon = (to: string, label: string, n: number, I: typeof Bell) => (
    <Link to={to} className="relative grid size-10 place-items-center rounded-[10px] text-ink-2 hover:bg-canvas" aria-label={n ? `${label}, ${n} unread` : label}>
      <I className="size-[18px]" />{n > 0 && <span className="absolute top-1 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
  return <>{icon(`${panel.base}/messages/inbox`, 'Messages', data?.messages ?? 0, Mail)}{icon(`${panel.base}/notifications`, 'Notifications', data?.notifications ?? 0, Bell)}</>;
}

export function GlobalSearch({ panel }: { panel: PanelConfig }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  const { data, isFetching, error } = useQuery({ queryKey: ['search', panel.key, term], queryFn: () => searchAll(term, panel.key), enabled: term.length >= 2 });
  const hits = data?.data ?? [];
  const go = (to: string) => { setOpen(false); setQ(''); navigate(to); };
  return (
    <div ref={box} className="relative hidden max-w-md flex-1 md:block" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (hits[0]) go(hits[0].to); }}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} maxLength={60} placeholder="Search" aria-label="Search" className="h-10 w-full rounded-[10px] border border-line bg-canvas pr-3 pl-9 text-[14px] outline-none focus:border-brand-500 focus:bg-white" />
      </form>
      {open && term.length >= 2 && (
        <div className="absolute inset-x-0 top-12 z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-white p-2 shadow-pop">
          {error ? <p className="p-3 text-[14px] text-danger">{errorMessage(error)}</p> : isFetching && !data ? <p className="p-3 text-[14px] text-muted">Searching…</p> : !hits.length ? <p className="p-3 text-[14px] text-muted">Nothing found</p> : [...new Set(hits.map((h) => h.group))].map((g) => (
            <div key={g} className="mb-1"><p className="px-2 pt-1 text-[11px] font-bold tracking-wide text-subtle uppercase">{g}</p>{hits.filter((h) => h.group === g).map((h) => <button key={h.to} type="button" onClick={() => go(h.to)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas"><b className="block truncate text-[14px]">{h.title}</b><span className="block truncate text-[12.5px] text-muted">{h.sub}</span></button>)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- "Confirm your password" for money actions; the API client calls it and then retries */
export function ReauthDialog() {
  const [ask, setAsk] = useState<((ok: boolean) => void) | null>(null);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let pending: Promise<boolean> | null = null;
    setReauthHandler(() => (pending ??= new Promise<boolean>((resolve) => setAsk(() => (ok: boolean) => { pending = null; setAsk(null); setPw(''); setError(''); resolve(ok); }))));
    return () => setReauthHandler(null);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try { await api.post('/auth/reauth', { password: pw }); ask?.(true); } catch (x) { setError(errorMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!ask} onOpenChange={(o) => !o && ask?.(false)} title="Confirm your password" description="For your security, money actions need your password again after 15 minutes.">
      <form onSubmit={submit} className="grid gap-4"><Field label="Account password" error={error}>{({ id, invalid }) => <PasswordInput id={id} autoComplete="current-password" aria-invalid={invalid} value={pw} onChange={(e) => setPw(e.target.value)} />}</Field><div className="flex justify-end"><Button type="submit" loading={busy} disabled={!pw}>Continue</Button></div></form>
    </Modal>
  );
}
