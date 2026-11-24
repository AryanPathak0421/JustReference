import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { setWakingHandler } from './api';

/** Shown while the server starts after being idle. Appears after a second, so short blips stay invisible. */
export function WakingNotice() {
  const [waking, setWaking] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => { setWakingHandler(setWaking); return () => setWakingHandler(null); }, []);
  useEffect(() => { if (!waking) return setShow(false); const t = setTimeout(() => setShow(true), 1000); return () => clearTimeout(t); }, [waking]);
  if (!show) return null;
  return <div role="status" className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl bg-navy-950 px-4 py-3 text-[14px] text-white shadow-pop"><Loader2 className="size-4 flex-none animate-spin" />The server is starting. This can take up to a minute; please keep this page open.</div>;
}
