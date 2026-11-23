import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BadgeCheck, ChevronLeft, ChevronRight, PackageSearch, Search, SlidersHorizontal, X } from 'lucide-react';
import type { ListingType } from '@jr/shared';
import { Button, ButtonLink, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton } from '@/design-system';
import { useCategories, useListingFacets, useListings, type SortKey } from '@/features/catalog/api';
import { ListingCard, ListingCardSkeleton } from '@/features/catalog/components';
import { cn } from '@/lib/cn';

const COPY: Record<ListingType, { title: string; description: string; cta: { label: string; to: string } }> = {
  product: { title: 'Products', description: 'Shop quality products from KYC-verified sellers across India.', cta: { label: 'Sell on JustReference', to: '/register?type=vendor' } },
  service: { title: 'Services', description: 'Book trusted professionals for your home and business.', cta: { label: 'Offer a service', to: '/register?type=vendor' } },
  project: { title: 'Projects', description: 'Commission end-to-end projects from verified vendors.', cta: { label: 'List your projects', to: '/register?type=vendor' } },
};

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: 'Featured first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

const PAGE_SIZE = 12;
const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined);

export function ListingsPage({ type }: { type: ListingType }) {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const copy = COPY[type];

  const query = {
    type,
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    subcategory: params.get('subcategory') ?? undefined,
    city: params.get('city') ?? undefined,
    min: num(params.get('min')),
    max: num(params.get('max')),
    sort: (params.get('sort') as SortKey) ?? 'relevance',
    page: num(params.get('page')) ?? 1,
    pageSize: PAGE_SIZE,
  };

  const listings = useListings(query);
  const categories = useCategories(type);
  const facets = useListingFacets(type);

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (resetPage) next.delete('page');
    setParams(next);
  };

  const [searchDraft, setSearchDraft] = useState(query.q ?? '');
  useEffect(() => setSearchDraft(params.get('q') ?? ''), [params]);
  const onSearch = (e: FormEvent) => { e.preventDefault(); update({ q: searchDraft.trim() || undefined }); };

  const activeFilters = ['q', 'category', 'subcategory', 'city', 'min', 'max'].filter((k) => params.get(k));
  const total = listings.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCat = categories.data?.data.find((c) => c.slug === query.category);

  const filters = (
    <div className="grid gap-5">
      <div>
        <h3 className="mb-2 text-[13.5px] font-semibold text-ink-2">Category</h3>
        {categories.isLoading ? <Skeleton className="h-40" /> : (
          <ul className="grid gap-0.5 text-[14px]">
            <li>
              <button type="button" onClick={() => update({ category: undefined, subcategory: undefined })} className={cn('w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-canvas', !query.category && 'bg-brand-50 font-semibold text-navy-800')}>
                All {copy.title.toLowerCase()}
              </button>
            </li>
            {categories.data?.data.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => update({ category: c.slug, subcategory: undefined })}
                  className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-canvas', query.category === c.slug && !query.subcategory && 'bg-brand-50 font-semibold text-navy-800')}
                >
                  <span>{c.name}</span><span className="text-[12px] text-subtle">{c.listingCount}</span>
                </button>
                {query.category === c.slug && c.children.length > 0 && (
                  <ul className="mt-0.5 ml-3 grid gap-0.5 border-l border-line pl-2">
                    {c.children.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => update({ subcategory: query.subcategory === s.slug ? undefined : s.slug })}
                          className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[13.5px] text-muted hover:bg-canvas', query.subcategory === s.slug && 'font-semibold text-navy-800')}
                        >
                          <span>{s.name}</span><span className="text-[12px] text-subtle">{s.listingCount}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Field label="Location">
        {({ id }) => (
          <Select id={id} value={query.city ?? ''} onChange={(e) => update({ city: e.target.value || undefined })}>
            <option value="">All locations</option>
            {facets.data?.cities.map((c) => <option key={c}>{c}</option>)}
          </Select>
        )}
      </Field>
      <PriceFilter key={`${params.get('min')}-${params.get('max')}`} min={query.min} max={query.max} onApply={(min, max) => update({ min, max })} />
      <p className="flex items-start gap-2 rounded-lg bg-success-50 p-2.5 text-[12.5px] text-[#0b6b49]"><BadgeCheck className="mt-0.5 size-4 flex-none" />Every vendor listed here has passed KYC verification.</p>
      {activeFilters.length > 0 && (
        <Button variant="ghost" size="sm" className="justify-start px-0 text-brand-600 hover:bg-transparent" onClick={() => setParams(new URLSearchParams())} leftIcon={<X className="size-4" />}>Clear all filters</Button>
      )}
    </div>
  );

  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: copy.title, to: activeCat ? `/${type}s` : undefined }, ...(activeCat ? [{ label: activeCat.name }] : [])]}
        title={activeCat ? activeCat.name : copy.title}
        description={activeCat ? `${copy.title} in ${activeCat.name}` : copy.description}
        actions={<ButtonLink to={copy.cta.to} variant="outline">{copy.cta.label}</ButtonLink>}
      />

      <form onSubmit={onSearch} role="search" className="mb-6 flex gap-2">
        <div className="flex-1"><Input leftIcon={<Search />} value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder={`Search ${copy.title.toLowerCase()}…`} aria-label={`Search ${copy.title.toLowerCase()}`} /></div>
        <Button type="submit" className="h-11">Search</Button>
        <Button variant="outline" className="h-11 lg:hidden" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} leftIcon={<SlidersHorizontal className="size-4" />}>
          <span className="hidden sm:inline">Filters</span>{activeFilters.length > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] text-white">{activeFilters.length}</span>}
        </Button>
      </form>

      <div className="grid gap-7 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className={cn('lg:block', filtersOpen ? 'block' : 'hidden')} aria-label="Filters">
          <Card className="p-5 lg:sticky lg:top-24">
            <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold"><SlidersHorizontal className="size-4" />Filters</h2>
            {filters}
          </Card>
        </aside>

        <section aria-live="polite" aria-busy={listings.isFetching}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-muted">
              {listings.isLoading ? 'Loading…' : <><b className="text-ink">{total}</b> {total === 1 ? 'result' : 'results'}{query.q && <> for “<b className="text-ink">{query.q}</b>”</>}</>}
            </p>
            <label className="flex items-center gap-2 text-[13.5px] text-muted">
              Sort by
              <Select value={query.sort} onChange={(e) => update({ sort: e.target.value === 'relevance' ? undefined : e.target.value })} className="h-9 w-auto text-[13.5px]">
                {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </label>
          </div>

          {listings.error ? (
            <Card><ErrorState onRetry={() => listings.refetch()} /></Card>
          ) : listings.isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <ListingCardSkeleton key={i} />)}</div>
          ) : !listings.data?.data.length ? (
            <Card>
              <EmptyState
                icon={PackageSearch}
                title={`No ${copy.title.toLowerCase()} found`}
                description={activeFilters.length ? 'Try a different search term or remove some filters.' : 'Nothing has been published here yet. Check back soon.'}
                action={activeFilters.length > 0 && <Button variant="outline" onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>}
              />
            </Card>
          ) : (
            <>
              <div className={cn('grid gap-5 transition-opacity sm:grid-cols-2 xl:grid-cols-3', listings.isFetching && 'opacity-70')}>
                {listings.data.data.map((l) => <ListingCard key={l.id} listing={l} />)}
              </div>
              {pages > 1 && (
                <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
                  <Button variant="outline" size="sm" disabled={query.page <= 1} onClick={() => update({ page: String(query.page - 1) }, false)} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
                  {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                    <Button key={p} variant={p === query.page ? 'primary' : 'outline'} size="sm" className="min-w-8.5" aria-current={p === query.page ? 'page' : undefined} onClick={() => update({ page: p === 1 ? undefined : String(p) }, false)}>{p}</Button>
                  ))}
                  <Button variant="outline" size="sm" disabled={query.page >= pages} onClick={() => update({ page: String(query.page + 1) }, false)} aria-label="Next page"><ChevronRight className="size-4" /></Button>
                </nav>
              )}
            </>
          )}
          {categories.data && categories.data.data.length > 0 && !query.category && (
            <div className="mt-10">
              <h2 className="mb-3 text-[15px] font-bold">Browse by category</h2>
              <div className="flex flex-wrap gap-2">
                {categories.data.data.map((c) => (
                  <Link key={c.id} to={`?category=${c.slug}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 text-[13.5px] font-medium text-ink-2 transition hover:border-brand-500 hover:text-brand-600">
                    {c.name} <span className="text-subtle">({c.listingCount})</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PriceFilter({ min, max, onApply }: { min?: number; max?: number; onApply: (min?: string, max?: string) => void }) {
  const [lo, setLo] = useState(min?.toString() ?? '');
  const [hi, setHi] = useState(max?.toString() ?? '');
  const invalid = lo !== '' && hi !== '' && Number(lo) > Number(hi);
  return (
    <Field label="Price (₹)" error={invalid ? 'Minimum must be less than maximum' : undefined}>
      {({ invalid: inv }) => (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) onApply(lo || undefined, hi || undefined); }}>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} inputMode="numeric" placeholder="Min" value={lo} onChange={(e) => setLo(e.target.value)} aria-label="Minimum price" aria-invalid={inv} className="h-10" />
            <span className="text-subtle">–</span>
            <Input type="number" min={0} inputMode="numeric" placeholder="Max" value={hi} onChange={(e) => setHi(e.target.value)} aria-label="Maximum price" aria-invalid={inv} className="h-10" />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={invalid}>Apply price</Button>
        </form>
      )}
    </Field>
  );
}
