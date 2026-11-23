/** Public catalog API (Phase 2: real data from /api/v1/catalog). */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CategoryNode, ListingDetail, ListingSummary, ListingType, PageMeta, PublicVendorProfile, VendorCard } from '@jr/shared';
import { api } from '@/lib/api';

export type SortKey = 'relevance' | 'newest' | 'price_asc' | 'price_desc';

export interface ListingQuery {
  type: ListingType;
  q?: string;
  category?: string;
  subcategory?: string;
  city?: string;
  min?: number;
  max?: number;
  vendor?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
}

export type Paged<T> = { data: T[]; meta: PageMeta };
export type DirectoryVendor = VendorCard & { officeAddress: string; website?: string };

export const useListings = (q: ListingQuery, enabled = true) =>
  useQuery({
    queryKey: ['catalog', 'listings', q],
    queryFn: () => api.get<Paged<ListingSummary>>('/catalog/listings', { ...q }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useCategories = (kind: ListingType) =>
  useQuery({ queryKey: ['catalog', 'categories', kind], queryFn: () => api.get<{ data: CategoryNode[] }>('/categories', { kind }), staleTime: 60_000 });

export const useListingFacets = (type: ListingType) =>
  useQuery({
    queryKey: ['catalog', 'facets', type],
    queryFn: () => api.get<{ cities: string[]; priceRange: { min: number; max: number } | null }>('/catalog/listings/facets', { type }),
    staleTime: 60_000,
  });

export const useListing = (type: ListingType, slug: string) =>
  useQuery({
    queryKey: ['catalog', 'listing', type, slug],
    queryFn: () => api.get<{ listing: ListingDetail; moreFromVendor: ListingSummary[] }>(`/catalog/listings/${type}/${encodeURIComponent(slug)}`),
  });

export const useFeatured = () =>
  useQuery({ queryKey: ['catalog', 'featured'], queryFn: () => api.get<{ listings: ListingSummary[]; vendors: VendorCard[] }>('/catalog/featured') });

export interface VendorQuery { q?: string; city?: string; category?: string; letter?: string; sort?: 'name' | 'newest'; page?: number; pageSize?: number }

export const useVendors = (q: VendorQuery) =>
  useQuery({ queryKey: ['catalog', 'vendors', q], queryFn: () => api.get<Paged<DirectoryVendor>>('/catalog/vendors', { ...q }), placeholderData: keepPreviousData });

export const useVendorFacets = () =>
  useQuery({ queryKey: ['catalog', 'vendor-facets'], queryFn: () => api.get<{ cities: string[]; categories: string[] }>('/catalog/vendors/facets'), staleTime: 60_000 });

export const useVendorProfile = (slug: string) =>
  useQuery({ queryKey: ['catalog', 'vendor', slug], queryFn: () => api.get<PublicVendorProfile>(`/catalog/vendors/${encodeURIComponent(slug)}`) });

export const listingPath = (l: Pick<ListingSummary, 'type' | 'slug'>) => `/${l.type}s/${l.slug}`;
