import { useQuery } from '@tanstack/react-query';
import type {
  AdminStats, AdRow, AnnouncementRow, AttachmentInfo, CmsPage, ContactInput, ExternalChannel, FeedbackRow, HealthView, MessageInput, MessageRow, NotificationRow, NotificationSettings, PageMeta, PostRow, ReportKey, ReportResult, SearchHit,
  TestimonialRow, TicketDetail, TicketInput, TicketRow,
} from '@jr/shared';
import { api } from '@/lib/api';
import type { PanelKey } from '@/panels/navigation';

export type Paged<T> = { data: T[]; meta: PageMeta };
type Q = Record<string, string | number | undefined>;

export const useCounts = () => useQuery({ queryKey: ['comms', 'counts'], queryFn: () => api.get<{ notifications: number; messages: number }>('/notifications/counts'), refetchInterval: 60_000 });
export const listNotifications = (q: Q) => api.get<Paged<NotificationRow>>('/notifications', q);
export const markRead = (id?: string) => api.post('/notifications/read', id ? { id } : {});
export const uploadFile = (f: File) => { const fd = new FormData(); fd.append('file', f); return api.form<AttachmentInfo>('/attachments', fd); };
export const fileBlob = (id: string) => api.blob(`/attachments/${id}/file`);

export const listMessages = (q: Q) => api.get<Paged<MessageRow>>('/messages', q);
export const getMessage = (id: string) => api.get<MessageRow>(`/messages/${id}`);
export const saveMessage = (id: string | null, v: MessageInput) => (id ? api.put<MessageRow>(`/messages/${id}`, v) : api.post<MessageRow>('/messages', v));
export const deleteDraft = (id: string) => api.del(`/messages/${id}`);

const T = (admin: boolean) => (admin ? '/admin/tickets' : '/tickets');
export const listTickets = (admin: boolean, q: Q) => api.get<Paged<TicketRow>>(T(admin), q);
export const getTicket = (admin: boolean, id: string) => api.get<TicketDetail>(`${T(admin)}/${id}`);
export const createTicket = (v: TicketInput) => api.post<TicketDetail>('/tickets', v);
export const replyTicket = (admin: boolean, id: string, v: { body: string; attachments: string[] }) => api.post<TicketDetail>(`${T(admin)}/${id}/replies`, v);
export const closeTicket = (id: string) => api.post<TicketDetail>(`/tickets/${id}/close`);
export const updateTicket = (id: string, v: { status?: string; priority?: string }) => api.patch<TicketDetail>(`/admin/tickets/${id}`, v);
export const sendContact = (v: ContactInput) => api.post<{ ticketNo: string }>('/contact', v);

export const myReview = (orderId: string) => api.get<{ rating: number; comment: string; status: string } | null>(`/feedback/mine/${orderId}`);
export const saveReview = (orderId: string, v: { rating: number; comment: string }) => api.post(`/feedback/${orderId}`, v);
export const vendorReviews = (slug: string) => api.get<{ count: number; average: number | null; data: { id: string; name: string; rating: number; comment: string; createdAt: string }[] }>(`/feedback/vendor/${slug}`);
export const listFeedback = (q: Q) => api.get<Paged<FeedbackRow>>('/admin/feedback', q);
export const decideFeedback = (id: string, status: 'published' | 'hidden') => api.post(`/admin/feedback/${id}`, { status });

export const getPage = (key: string) => api.get<CmsPage>(`/content/pages/${key}`);
export const listPosts = (page: number, pageSize = 12) => api.get<Paged<PostRow>>('/content/posts', { page, pageSize });
export const getPost = (slug: string) => api.get<PostRow>(`/content/posts/${slug}`);
export const listTestimonials = () => api.get<{ data: TestimonialRow[] }>('/content/testimonials');
export const homeAds = () => api.get<{ data: AdRow[] }>('/content/ads');
export const memberAds = () => api.get<{ data: AdRow[] }>('/content/ads/member');
export const listAnnouncements = () => api.get<{ data: AnnouncementRow[] }>('/content/announcements');
export const adminPages = () => api.get<{ data: CmsPage[] }>('/admin/content/pages');
export const savePage = (key: string, v: { title: string; body: string; published: boolean }) => api.put(`/admin/content/pages/${key}`, v);
export type ContentType = 'posts' | 'testimonials' | 'announcements' | 'ads';
export const adminContent = (t: ContentType) => api.get<{ data: (Record<string, unknown> & { id: string })[] }>(`/admin/content/${t}`);
export const saveContent = (t: ContentType, id: string | null, v: object) => (id ? api.put(`/admin/content/${t}/${id}`, v) : api.post(`/admin/content/${t}`, v));
export const deleteContent = (t: ContentType, id: string) => api.del(`/admin/content/${t}/${id}`);

const R = (k: PanelKey) => (k === 'member' ? '/reports' : k === 'vendor' ? '/reports/vendor' : '/admin/reports');
export const getReport = (k: PanelKey, key: ReportKey, q: Q) => api.get<ReportResult>(`${R(k)}/${key}`, q);
export const exportReport = (k: PanelKey, key: ReportKey, q: Q, format: string) => api.download(`${R(k)}/${key}`, { ...q, page: undefined, pageSize: undefined, format }, `${key}.${format}`);
export const searchAll = (q: string, panel: PanelKey) => api.get<{ data: SearchHit[] }>('/search', { q, panel });
export const adminStats = () => api.get<AdminStats>('/admin/stats');
export const getHealth = () => api.get<HealthView>('/admin/health');
export const testMessage = (channel: ExternalChannel) => api.post('/admin/messaging/test', { channel });
export const getNotificationSettings = () => api.get<NotificationSettings>('/settings/notifications');
export const saveNotificationSettings = (v: NotificationSettings) => api.put<NotificationSettings>('/settings/notifications', v);
