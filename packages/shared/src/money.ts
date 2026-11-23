/**
 * All money in JustReference is stored and transported as integer paise.
 * Convert to rupees only at the display edge.
 */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 2 });

export function formatINR(paise: number, opts: { compact?: boolean } = {}): string {
  const rupees = paise / 100;
  return opts.compact ? inrCompact.format(rupees) : inr.format(rupees);
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
