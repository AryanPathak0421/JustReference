import { ScrollRestoration } from 'react-router';

/**
 * Scroll restoration for every layout.
 * React Router keys history entries by `location.key`, but every *initial* page load has the key
 * "default", so a fresh load of one page would restore the scroll position saved for another.
 * Keying those entries by path fixes that; back/forward navigation still restores per entry.
 */
export function ScrollReset() {
  return <ScrollRestoration getKey={(loc) => (loc.key === 'default' ? `initial:${loc.pathname}` : loc.key)} />;
}
