import type {
  BankAccountInput, CategoryNode, DocumentType, ListingInput, ListingStatus, ListingType, ManagedListing, PageMeta, RoleRow, VendorDetail,
  VendorProfileInput, VendorRow, VendorSelf, VendorStatus,
} from '@jr/shared';
import { api } from '@/lib/api';

export type Paged<T> = { data: T[]; meta: PageMeta };

/** Multipart upload with the same auth/refresh handling as JSON calls. */
async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', file);
  return api.form<T>(path, fd);
}

/* ---------------------------------------------------------------- Vendor self-service */
export const getMyVendor = () => api.get<VendorSelf>('/vendor/profile');
export const saveMyProfile = (v: VendorProfileInput) => api.put<VendorSelf>('/vendor/profile', v);
export const saveMyBank = (v: BankAccountInput) => api.put<VendorSelf>('/vendor/bank', v);
export const uploadLogo = (f: File) => upload<VendorSelf>('/vendor/logo', f);
export const uploadDocument = (type: DocumentType, f: File) => upload<VendorSelf>('/vendor/documents', f, { type });
export const deleteDocument = (id: string) => api.del<VendorSelf>(`/vendor/documents/${id}`);
export const submitForApproval = () => api.post<VendorSelf>('/vendor/submit');
export const getVendorSummary = () => api.get<{ vendorStatus: VendorStatus; byType: Record<ListingType, number>; byStatus: Record<string, number> }>('/vendor/summary');

/**
 * Listing endpoints are the same shape for vendors (/vendor/listings) and admins (/admin/listings),
 * so the editor takes a base path.
 */
export function listingApi(base: '/vendor/listings' | '/admin/listings') {
  return {
    list: (q: { type?: ListingType; status?: ListingStatus; q?: string; vendorId?: string; featured?: 'yes'; page?: number; pageSize?: number }) =>
      api.get<Paged<ManagedListing>>(base, { ...q }),
    get: (id: string) => api.get<ManagedListing>(`${base}/${id}`),
    create: (input: ListingInput & { vendorId?: string }) => api.post<ManagedListing>(base, input),
    update: (id: string, input: ListingInput) => api.patch<ManagedListing>(`${base}/${id}`, input),
    remove: (id: string) => api.del(`${base}/${id}`),
    archive: (id: string) => api.post<ManagedListing>(`${base}/${id}/archive`),
    restore: (id: string) => api.post<ManagedListing>(`${base}/${id}/restore`),
    submit: (id: string) => api.post<ManagedListing>(`${base}/${id}/submit`),
    addImage: (id: string, f: File) => upload<ManagedListing>(`${base}/${id}/images`, f),
    removeImage: (id: string, imageId: string) => api.del<ManagedListing>(`${base}/${id}/images/${imageId}`),
    makeCover: (id: string, imageId: string) => api.post<ManagedListing>(`${base}/${id}/images/${imageId}/cover`),
    addDocument: (id: string, f: File, name: string) => upload<ManagedListing>(`${base}/${id}/documents`, f, { name }),
    removeDocument: (id: string, docId: string) => api.del<ManagedListing>(`${base}/${id}/documents/${docId}`),
    decide: (id: string, decision: 'approve' | 'reject', reason?: string) => api.post<ManagedListing>(`${base}/${id}/decision`, { decision, reason }),
    feature: (id: string, featured: boolean) => api.post<ManagedListing>(`${base}/${id}/feature`, { featured }),
  };
}

/* ---------------------------------------------------------------- Admin: vendors, categories, approvals */
export const listVendors = (q: { q?: string; status?: VendorStatus; sort?: string; page?: number; pageSize?: number }) => api.get<Paged<VendorRow>>('/admin/vendors', q);
export const getVendor = (id: string) => api.get<VendorDetail>(`/admin/vendors/${id}`);
export const createVendor = (v: { name: string; email: string; mobile: string; password: string; businessName: string }) => api.post<{ id: string }>('/admin/vendors', v);
export const adminSaveVendorProfile = (id: string, v: VendorProfileInput) => api.put(`/admin/vendors/${id}/profile`, v);
export const decideVendor = (id: string, decision: 'approve' | 'reject', reason?: string) => api.post(`/admin/vendors/${id}/decision`, { decision, reason });
export const setVendorStatus = (id: string, status: 'approved' | 'suspended', reason?: string) => api.post(`/admin/vendors/${id}/status`, { status, reason });
export const setVendorRoles = (id: string, roleIds: string[]) => api.put(`/admin/vendors/${id}/roles`, { roleIds });
export const resetVendorPassword = (id: string, password: string) => api.post(`/admin/vendors/${id}/reset-password`, { password });
export const vendorDocumentBlob = (vendorId: string, docId: string) => api.blob(`/admin/vendors/${vendorId}/documents/${docId}/file`);
export const myDocumentBlob = (docId: string) => api.blob(`/vendor/documents/${docId}/file`);

export const listVendorRoles = () => api.get<{ data: RoleRow[] }>('/admin/vendor-roles');
export const listVendorPermissions = () => api.get<{ data: { key: string; group: string; label: string }[] }>('/admin/vendor-permissions');
export const createVendorRole = (v: { name: string; description?: string; permissions: string[] }) => api.post<{ id: string }>('/admin/vendor-roles', v);
export const updateVendorRole = (id: string, v: { name: string; description?: string; permissions: string[] }) => api.patch(`/admin/vendor-roles/${id}`, v);
export const deleteVendorRole = (id: string) => api.del(`/admin/vendor-roles/${id}`);

export const adminCategories = (kind: ListingType) => api.get<{ data: CategoryNode[] }>('/admin/categories', { kind });
export const createCategory = (v: { kind: ListingType; name: string; parentId?: string | null; sortOrder?: number }) => api.post<{ id: string }>('/admin/categories', v);
export const updateCategory = (id: string, v: { name: string; sortOrder: number; isActive: boolean }) => api.patch(`/admin/categories/${id}`, v);
export const deleteCategory = (id: string) => api.del(`/admin/categories/${id}`);
export const approvalsSummary = () => api.get<{ listings: Record<ListingType, number>; vendors: number }>('/admin/approvals/summary');

/**
 * Open a private file (fetched with auth) in a new tab. The tab is opened synchronously in the click
 * handler so pop-up blockers allow it; if one blocks it anyway, download the file instead of navigating
 * away from the app.
 */
export async function openBlob(load: () => Promise<Blob>, fileName = 'document') {
  const win = window.open('', '_blank');
  try {
    const blob = await load();
    const url = URL.createObjectURL(blob);
    if (win) {
      win.location.href = url;
    } else {
      const ext = blob.type === 'application/pdf' ? '.pdf' : blob.type === 'image/webp' ? '.webp' : '';
      Object.assign(document.createElement('a'), { href: url, download: fileName.replace(/\.[a-z0-9]+$/i, '') + ext }).click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}
