import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import {
  Armchair, BadgeCheck, Calendar, Clock, Code2, Construction, FlaskConical, Globe, Leaf, MapPin, Megaphone, Network, Package, PartyPopper,
  ReceiptIndianRupee, ShieldCheck, Sofa, Sparkles, Sun, Truck, Wrench,
} from 'lucide-react';
import type { ListingSummary, ListingType, VendorCard as VendorCardData } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Badge, ButtonLink, Card, Skeleton } from '@/design-system';
import { cn } from '@/lib/cn';
import { listingPath } from './api';

/* Placeholder artwork for listings without photos, chosen from the category name. */
const ART: { match: RegExp; icon: LucideIcon; bg: string }[] = [
  { match: /solar|energy|inverter|batter/i, icon: Sun, bg: 'from-[#e8eeff] to-[#f4f0ff] text-navy-700' },
  { match: /cctv|security|camera|smart home/i, icon: ShieldCheck, bg: 'from-[#e9f1ff] to-[#eef9f5] text-[#1d4ed8]' },
  { match: /office|furniture|stationery/i, icon: Armchair, bg: 'from-[#f1f5f9] to-[#eef3ff] text-[#334155]' },
  { match: /food|grocery|oil|spice|grain/i, icon: Leaf, bg: 'from-[#e6f6f0] to-[#f5f9e8] text-[#0f6b4d]' },
  { match: /app|web|software|it /i, icon: Code2, bg: 'from-[#e6f6f0] to-[#eef3ff] text-[#0f6b4d]' },
  { match: /network/i, icon: Network, bg: 'from-[#e9f1ff] to-[#f3efff] text-[#1e3a8a]' },
  { match: /finance|tax|legal|account|registration/i, icon: ReceiptIndianRupee, bg: 'from-[#eef3ff] to-[#e8f7f1] text-navy-700' },
  { match: /clean|pest/i, icon: Sparkles, bg: 'from-[#e0f2fe] to-[#f0f9ff] text-[#0e7490]' },
  { match: /maintenance|repair|support/i, icon: Wrench, bg: 'from-[#f1f5f9] to-[#e0f2fe] text-[#334155]' },
  { match: /market|brand/i, icon: Megaphone, bg: 'from-[#f3efff] to-[#fdeef3] text-accent-600' },
  { match: /event|wedding/i, icon: PartyPopper, bg: 'from-[#fff3e4] to-[#fdeef3] text-[#9a4a1c]' },
  { match: /interior/i, icon: Sofa, bg: 'from-[#fff3e4] to-[#fdeef3] text-[#9a4a1c]' },
  { match: /construct/i, icon: Construction, bg: 'from-[#fdf6e7] to-[#fff3e4] text-[#92400e]' },
];
const artFor = (hint: string) => ART.find((a) => a.match.test(hint)) ?? { icon: Package, bg: 'from-[#eef3ff] to-[#f3efff] text-navy-700' };
const TYPE_TONE = { product: 'navy', service: 'green', project: 'violet' } as const;

/** Listing photo, or category artwork when the listing has no photo yet. */
export function ListingImage({ src, hint, type, alt, className }: { src?: string | null; hint: string; type?: ListingType; alt: string; className?: string }) {
  const a = artFor(hint);
  const Icon = a.icon;
  return (
    <div className={cn('relative grid h-42 place-items-center overflow-hidden', !src && `bg-gradient-to-br ${a.bg}`, className)}>
      {type && <Badge tone={TYPE_TONE[type]} className="absolute top-3 left-3 z-10 bg-white/92 capitalize shadow-xs">{type}</Badge>}
      {src ? <img src={src} alt={alt} loading="lazy" className="absolute inset-0 size-full object-cover" /> : <Icon className="size-13 opacity-75" strokeWidth={1.4} aria-hidden />}
    </div>
  );
}

export function SampleTag({ className }: { className?: string }) {
  return (
    <span title="Sample listing created for testing. Not a real business." className={cn('inline-flex items-center gap-1 rounded-full bg-warn-50 px-2 py-0.5 text-[11px] font-semibold text-warn', className)}>
      <FlaskConical className="size-3" />Sample
    </span>
  );
}

export function ListingCard({ listing: l }: { listing: ListingSummary }) {
  const to = listingPath(l);
  const meta: { icon: LucideIcon; text: string }[] = [{ icon: MapPin, text: l.city }];
  if (l.project) meta.push({ icon: Clock, text: `${l.project.durationDays} days` });
  if (l.service) {
    if (l.service.remote) meta.push({ icon: Globe, text: 'Works remotely' });
    meta.push({ icon: Calendar, text: `${l.service.deliveryDays}-day turnaround` });
  }
  if (l.product) meta.push({ icon: Truck, text: { in_stock: 'In stock', out_of_stock: 'Out of stock', made_to_order: 'Made to order' }[l.product.availability] ?? 'Available' });

  return (
    <Card hover className="flex flex-col overflow-hidden">
      <Link to={to} tabIndex={-1} aria-hidden><ListingImage src={l.image} hint={`${l.category.name} ${l.subcategory?.name ?? ''}`} type={l.type} alt="" /></Link>
      <div className="flex flex-1 flex-col p-4.5">
        <div className="flex items-center justify-between gap-2 text-[12.5px] text-muted">
          <span className="truncate">{l.category.name}{l.subcategory && ` · ${l.subcategory.name}`}</span>
          {l.isSample && <SampleTag />}
        </div>
        <h3 className="mt-1.5 text-[16px] leading-snug font-bold"><Link to={to} className="hover:text-brand-600">{l.name}</Link></h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] text-muted">{l.summary}</p>
        <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-muted">
          {meta.map(({ icon: Icon, text }) => <span key={text} className="inline-flex items-center gap-1.5"><Icon className="size-3.5" aria-hidden />{text}</span>)}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-2 pt-3.5">
          <div className="min-w-0">
            <div className="text-[18px] font-extrabold tracking-tight text-navy-950">
              {formatINR(l.pricePaise)} {l.priceNote && <small className="text-[12px] font-medium text-muted">{l.priceNote}</small>}
            </div>
            <Link to={`/vendors/${l.vendor.slug}`} className="inline-flex max-w-full items-center gap-1 truncate text-[12.5px] text-muted hover:text-ink">
              <span className="truncate">{l.vendor.name}</span>{l.vendor.verified && <BadgeCheck className="size-3.5 flex-none text-success" aria-label="Verified vendor" />}
            </Link>
          </div>
          <ButtonLink to={to} variant="outline" size="sm">View details</ButtonLink>
        </div>
      </div>
    </Card>
  );
}

export function ListingCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="h-42 rounded-none" />
      <div className="grid gap-2.5 p-4.5"><Skeleton className="h-3.5 w-1/2" /><Skeleton className="h-5 w-4/5" /><Skeleton className="h-3.5 w-full" /><Skeleton className="mt-3 h-8 w-full" /></div>
    </Card>
  );
}

const VENDOR_COLORS = ['bg-navy-800', 'bg-accent-600', 'bg-success', 'bg-brand-600'];

export function VendorLogo({ vendor: v, size = 52, index = 0 }: { vendor: Pick<VendorCardData, 'name' | 'logoUrl'>; size?: number; index?: number }) {
  if (v.logoUrl) return <img src={v.logoUrl} alt="" className="flex-none rounded-[14px] border border-line bg-white object-cover" style={{ width: size, height: size }} />;
  const initials = v.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={cn('grid flex-none place-items-center rounded-[14px] font-extrabold text-white', VENDOR_COLORS[index % VENDOR_COLORS.length])} style={{ width: size, height: size, fontSize: size * 0.33 }} aria-hidden>
      {initials}
    </span>
  );
}

export function VendorCard({ vendor: v, index = 0 }: { vendor: VendorCardData; index?: number }) {
  return (
    <Card hover className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center gap-3.5">
        <VendorLogo vendor={v} index={index} />
        <div className="min-w-0">
          <h3 className="truncate text-[15.5px] font-bold"><Link to={`/vendors/${v.slug}`} className="hover:text-brand-600">{v.name}</Link></h3>
          <p className="truncate text-[13px] text-muted">{[v.category, v.city].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{v.listingCount != null ? `${v.listingCount} listing${v.listingCount === 1 ? '' : 's'}` : ''}</span>
        <span className="flex gap-1.5">
          {v.isSample && <SampleTag />}
          {v.verified && <Badge tone="green"><BadgeCheck className="size-3.5" />Verified</Badge>}
        </span>
      </div>
    </Card>
  );
}
