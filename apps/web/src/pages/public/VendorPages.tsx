import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BadgeCheck, Building2, ChevronLeft, ChevronRight, ExternalLink, Globe, MapPin, Search, Store, X } from 'lucide-react';
import { LISTING_TYPES, type ListingType } from '@jr/shared';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorState, Input, PageHeader, Segmented, Select, Skeleton } from '@/design-system';
import { useListings, useVendorFacets, useVendorProfile, useVendors, type VendorQuery } from '@/features/catalog/api';
import { ListingCard, ListingCardSkeleton, SampleTag, VendorCard, VendorLogo } from '@/features/catalog/components';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

function usePagedParams() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!keepPage) next.delete('page');
    setParams(next);
  };
  return { params, set, clear: () => setParams(new URLSearchParams()) };
}

function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-2 text-[14px]">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
      <span className="px-2 text-muted">Page {page} of {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
    </nav>
  );
}

function VendorFilters({ q, onSearch, city, category, onChange }: { q?: string; onSearch: (q: string) => void; city?: string; category?: string; onChange: (k: 'city' | 'category', v?: string) => void }) {
  const facets = useVendorFacets();
  const [draft, setDraft] = useState(q ?? '');
  useEffect(() => setDraft(q ?? ''), [q]);
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSearch(draft.trim()); }} role="search" className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1"><Input leftIcon={<Search />} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Business name or what they do" aria-label="Search businesses" /></div>
      <Select value={category ?? ''} onChange={(e) => onChange('category', e.target.value || undefined)} aria-label="Category" className="w-52">
        <option value="">All categories</option>
        {facets.data?.categories.map((c) => <option key={c}>{c}</option>)}
      </Select>
      <Select value={city ?? ''} onChange={(e) => onChange('city', e.target.value || undefined)} aria-label="City" className="w-44">
        <option value="">All cities</option>
        {facets.data?.cities.map((c) => <option key={c}>{c}</option>)}
      </Select>
      <Button type="submit" className="h-11">Search</Button>
    </form>
  );
}

/* ======================================================================== /vendors */

export function VendorsPage() {
  const { params, set, clear } = usePagedParams();
  const query: VendorQuery = { q: params.get('q') ?? undefined, city: params.get('city') ?? undefined, category: params.get('category') ?? undefined, sort: 'newest', page: Number(params.get('page') ?? 1), pageSize: 12 };
  const { data, isLoading, error, refetch } = useVendors(query);
  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Vendors' }]}
        title="Verified vendors"
        description="Every business here has passed KYC checks: PAN, address proof and bank details."
        actions={<ButtonLink to="/register?type=vendor" variant="outline">Become a vendor</ButtonLink>}
      />
      <Card className="mb-6 p-4"><VendorFilters q={query.q} city={query.city} category={query.category} onSearch={(q) => set({ q: q || undefined })} onChange={(k, v) => set({ [k]: v })} /></Card>
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : !data?.data.length ? (
        <Card><EmptyState icon={Store} title="No vendors match" description="Try a different search or clear the filters." action={[...params.keys()].length > 0 && <Button variant="outline" onClick={clear}>Clear filters</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{data.data.map((v, i) => <VendorCard key={v.id} vendor={v} index={i} />)}</div>
          <Pager page={query.page!} total={data.meta.total} pageSize={12} onPage={(p) => set({ page: p > 1 ? String(p) : undefined }, true)} />
        </>
      )}
    </div>
  );
}

/* ======================================================================== /directory */

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

export function DirectoryPage() {
  const { params, set, clear } = usePagedParams();
  const query: VendorQuery = {
    q: params.get('q') ?? undefined, city: params.get('city') ?? undefined, category: params.get('category') ?? undefined,
    letter: params.get('letter') ?? undefined, sort: 'name', page: Number(params.get('page') ?? 1), pageSize: 25,
  };
  const { data, isLoading, error, refetch } = useVendors(query);
  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Business directory' }]} title="Business directory" description="Find verified businesses by name, category and city." />
      <Card className="mb-4 p-4"><VendorFilters q={query.q} city={query.city} category={query.category} onSearch={(q) => set({ q: q || undefined })} onChange={(k, v) => set({ [k]: v })} /></Card>
      <nav aria-label="Filter by first letter" className="mb-5 flex flex-wrap gap-1">
        <button type="button" onClick={() => set({ letter: undefined })} className={cn('rounded-md px-2.5 py-1 text-[13px] font-semibold', !query.letter ? 'bg-navy-900 text-white' : 'text-muted hover:bg-canvas')}>All</button>
        {LETTERS.map((l) => (
          <button key={l} type="button" onClick={() => set({ letter: l })} aria-pressed={query.letter === l} className={cn('min-w-8 rounded-md px-2 py-1 text-[13px] font-semibold', query.letter === l ? 'bg-navy-900 text-white' : 'text-muted hover:bg-canvas')}>{l}</button>
        ))}
      </nav>
      {error ? <Card><ErrorState onRetry={() => refetch()} /></Card> : (
        <Card className="divide-y divide-line-2">
          {isLoading ? Array.from({ length: 6 }, (_, i) => <div key={i} className="p-4"><Skeleton className="h-12" /></div>) : !data?.data.length ? (
            <EmptyState icon={Building2} title="No businesses found" action={[...params.keys()].length > 0 && <Button variant="outline" onClick={clear} leftIcon={<X className="size-4" />}>Clear filters</Button>} />
          ) : data.data.map((v, i) => (
            <div key={v.id} className="flex flex-wrap items-center gap-4 p-4">
              <VendorLogo vendor={v} size={44} index={i} />
              <div className="min-w-0 flex-1">
                <Link to={`/vendors/${v.slug}`} className="flex items-center gap-1.5 text-[15px] font-bold hover:text-brand-600">{v.name}<BadgeCheck className="size-4 text-success" aria-label="Verified" />{v.isSample && <SampleTag />}</Link>
                <p className="text-[13px] text-muted">{v.category}</p>
                <p className="mt-0.5 flex items-start gap-1.5 text-[13px] text-ink-2"><MapPin className="mt-0.5 size-3.5 flex-none text-subtle" />{v.officeAddress || v.city}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {v.website && <a href={v.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-canvas"><Globe className="size-3.5" />Website</a>}
                <ButtonLink to={`/vendors/${v.slug}`} variant="outline" size="sm">{v.listingCount} listing{v.listingCount === 1 ? '' : 's'}</ButtonLink>
              </div>
            </div>
          ))}
        </Card>
      )}
      {data && <Pager page={query.page!} total={data.meta.total} pageSize={25} onPage={(p) => set({ page: p > 1 ? String(p) : undefined }, true)} />}
    </div>
  );
}

/* ======================================================================== /vendors/:slug */

const TYPE_LABEL: Record<ListingType, string> = { product: 'Products', service: 'Services', project: 'Projects' };

export function VendorProfilePage() {
  const { slug = '' } = useParams();
  const { data: v, isLoading, error, refetch } = useVendorProfile(slug);
  const [picked, setType] = useState<ListingType>();
  // Default to the first type this vendor actually has listings for.
  const type: ListingType = picked ?? LISTING_TYPES.find((t) => (v?.listingCounts[t] ?? 0) > 0) ?? 'product';
  const listings = useListings({ type, vendor: slug, sort: 'newest', pageSize: 12 }, !!v);

  if (error instanceof ApiError && error.status === 404) {
    return <div className="container-page py-10"><Card><EmptyState icon={Store} title="Vendor not found" description="This business isn’t listed right now." action={<ButtonLink to="/vendors">Browse vendors</ButtonLink>} /></Card></div>;
  }
  if (error) return <div className="container-page py-10"><Card><ErrorState onRetry={() => refetch()} /></Card></div>;
  if (isLoading || !v) return <div className="container-page grid gap-6 py-10"><Skeleton className="h-40" /><Skeleton className="h-96" /></div>;

  const socials = Object.entries(v.social ?? {}).filter(([, url]) => url);
  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Vendors', to: '/vendors' }, { label: v.name }]} title="" className="mb-4" />
      {v.isSample && <Alert tone="warn" className="mb-5">This is a <b>sample vendor</b> created for testing. It is not a real business.</Alert>}
      <Card className="p-6">
        <div className="flex flex-wrap items-start gap-5">
          <VendorLogo vendor={v} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-950">{v.name}<Badge tone="green"><BadgeCheck className="size-3.5" />KYC verified</Badge>{v.gstRegistered && <Badge tone="blue">GST registered</Badge>}</h1>
            <p className="mt-1 text-[14.5px] text-muted">{v.category} · {v.city}{v.state && `, ${v.state}`} · on JustReference since {new Date(v.memberSince).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</p>
            {v.description && <p className="mt-3 max-w-3xl text-[15px] whitespace-pre-line text-ink-2">{v.description}</p>}
            <div className="mt-4 flex flex-wrap gap-2 text-[13.5px]">
              {v.officeAddress && <span className="inline-flex items-center gap-1.5 rounded-lg bg-canvas px-3 py-1.5"><MapPin className="size-3.5 text-subtle" />{v.officeAddress}</span>}
              {v.website && <a href={v.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-lg bg-canvas px-3 py-1.5 hover:text-brand-600"><Globe className="size-3.5" />Website<ExternalLink className="size-3" /></a>}
              {socials.map(([name, url]) => <a key={name} href={url} target="_blank" rel="noopener noreferrer nofollow" className="rounded-lg bg-canvas px-3 py-1.5 capitalize hover:text-brand-600">{name}</a>)}
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-8 mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight">Listings</h2>
        <Segmented label="Listing type" value={type} onChange={setType} options={LISTING_TYPES.map((t) => ({ value: t, label: `${TYPE_LABEL[t]} (${v.listingCounts[t]})` }))} />
      </div>
      {listings.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <ListingCardSkeleton key={i} />)}</div>
      ) : !listings.data?.data.length ? (
        <Card><EmptyState title={`No ${TYPE_LABEL[type].toLowerCase()} yet`} /></Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{listings.data.data.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
      )}
    </div>
  );
}
