import { useQuery } from '@tanstack/react-query';
import type {
  Address, AddressInput, BidInput, CartView, CommerceSettings, CustomerRow, GstSummaryRow, InvoiceRow, OrderDetail, OrderRow, OrderStats, PageMeta, PaymentPlan, PaymentView,
  ProjectRequestInput, ProjectRequestView,
} from '@jr/shared';
import { api } from '@/lib/api';
import type { PanelKey } from '@/panels/navigation';
import { useAuth } from '@/features/auth/AuthProvider';

export type Paged<T> = { data: T[]; meta: PageMeta };
/** The same screens serve three audiences; only the API prefix differs. */
export const prefix = (k: PanelKey) => (k === 'member' ? '' : k === 'vendor' ? '/vendor' : '/admin');
export const newKey = () => crypto.randomUUID();

/* Cart & checkout (members) */
export const getCart = () => api.get<CartView>('/cart');
export function useCart() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: !!user?.roles.includes('member') });
}
export const addToCart = (v: { listingId: string; qty?: number; plan?: PaymentPlan }) => api.post<CartView>('/cart/items', v);
export const updateCartItem = (id: string, v: { qty?: number; plan?: PaymentPlan; note?: string }) => api.patch<CartView>(`/cart/items/${id}`, v);
export const removeCartItem = (id: string) => api.del<CartView>(`/cart/items/${id}`);
export const placeOrder = (v: { address: AddressInput; expectedTotalPaise: number; idempotencyKey: string }) => api.post<PaymentView>('/checkout', v);
export const lastAddress = () => api.get<{ address: Address | null }>('/orders/last-address');
export const getPayment = (id: string) => api.get<PaymentView>(`/payments/${id}`);
export const listPayments = (page: number) => api.get<Paged<PaymentView>>('/payments', { page, pageSize: 20 });
export const simulatePayment = (id: string, outcome: 'success' | 'failure') => api.post<PaymentView>(`/payments/${id}/simulate`, { outcome });
export const payOrder = (id: string) => api.post<PaymentView>(`/orders/${id}/pay`);

/* Orders */
export interface OrderQuery { q?: string; status?: string; kind?: string; group?: string; attention?: string; from?: string; to?: string; page?: number; pageSize?: number }
export const listOrders = (k: PanelKey, q: OrderQuery) => api.get<Paged<OrderRow>>(`${prefix(k)}/orders`, { ...q });
export const getOrder = (k: PanelKey, id: string) => api.get<OrderDetail>(`${prefix(k)}/orders/${id}`);
export const orderStats = (k: PanelKey) => api.get<OrderStats>(`${prefix(k)}/orders/stats`);
export const cancelOrder = (k: PanelKey, id: string, reason: string) => api.post<OrderDetail>(`${prefix(k)}/orders/${id}/cancel`, { reason });
export const decideCancellation = (k: PanelKey, id: string, decision: 'accept' | 'decline', note?: string) => api.post<OrderDetail>(`${prefix(k)}/orders/${id}/cancellation`, { decision, note });
export const completeOrder = (id: string) => api.post<OrderDetail>(`/orders/${id}/complete`);
export const setOrderStatus = (k: PanelKey, id: string, v: { to: string; note?: string; tracking?: { carrier: string; number: string; url?: string } }) => api.post<OrderDetail>(`${prefix(k)}/orders/${id}/status`, v);
export const refundOrder = (id: string, v: { amount: number; reason: string; idempotencyKey: string }) => api.post<OrderDetail>(`/admin/orders/${id}/refunds`, v);
export const dismissRefund = (id: string, reason: string) => api.post<OrderDetail>(`/admin/orders/${id}/refund-request/dismiss`, { reason });

/* Invoices & customers */
export const listInvoices = (k: PanelKey, q: { q?: string; from?: string; to?: string; page?: number; pageSize?: number }) => api.get<Paged<InvoiceRow>>(`${prefix(k)}/invoices`, { ...q });
export const invoiceBlob = (k: PanelKey, id: string) => api.download(`${prefix(k)}/invoices/${id}/pdf`, {}, 'invoice.pdf');
export const gstSummary = (k: PanelKey) => api.get<{ data: GstSummaryRow[] }>(`${prefix(k)}/invoices/gst-summary`);
export const listCustomers = (page: number) => api.get<Paged<CustomerRow>>('/vendor/customers', { page, pageSize: 20 });

/* Project requests & bids */
export const listRequests = (k: PanelKey, q: { status?: string; q?: string; mine?: string; page?: number; pageSize?: number }) => api.get<Paged<ProjectRequestView>>(`${prefix(k)}/project-requests`, { ...q });
export const getRequest = (k: PanelKey, id: string) => api.get<ProjectRequestView>(`${prefix(k)}/project-requests/${id}`);
export const createRequest = (v: ProjectRequestInput) => api.post<ProjectRequestView>('/project-requests', v);
export const cancelRequest = (id: string) => api.post<ProjectRequestView>(`/project-requests/${id}/cancel`);
export const rejectBid = (id: string, bidId: string) => api.post<ProjectRequestView>(`/project-requests/${id}/bids/${bidId}/reject`);
export const acceptBid = (id: string, bidId: string, v: { address: AddressInput; plan: PaymentPlan }) => api.post<{ orderId: string }>(`/project-requests/${id}/bids/${bidId}/accept`, v);
export const saveBid = (id: string, v: BidInput) => api.put<ProjectRequestView>(`/vendor/project-requests/${id}/bid`, v);
export const withdrawBid = (id: string) => api.del<ProjectRequestView>(`/vendor/project-requests/${id}/bid`);
export const decideRequest = (id: string, decision: 'approve' | 'reject', reason?: string) => api.post<ProjectRequestView>(`/admin/project-requests/${id}/decision`, { decision, reason });
export const closeRequest = (id: string, reason: string) => api.post<ProjectRequestView>(`/admin/project-requests/${id}/close`, { reason });

/* Settings */
export const getGateway = () => api.get<{ provider: string | null; testMode: boolean; webhookPath: string | null }>('/admin/payment-gateway');
export const getCommerceSettings = () => api.get<CommerceSettings>('/settings/commerce');
export const saveCommerceSettings = (v: CommerceSettings) => api.put<CommerceSettings>('/settings/commerce', v);
