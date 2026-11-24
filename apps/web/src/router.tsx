import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { PublicLayout } from '@/layouts/PublicLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { HomePage } from '@/pages/public/HomePage';
import { NotFoundPage, PlannedPublicPage } from '@/pages/PlannedPages';
import { PanelGuard } from '@/features/auth/guards';
import type { PanelKey } from '@/panels/navigation';
import type { ListingType } from '@jr/shared';
import type { MembersPreset } from '@/pages/admin/MembersPage';
import type { OrdersPreset } from '@/pages/commerce/OrderPages';

/** Lazy route helper: `lazy(() => import(x), (m) => () => <m.Page />)`. */
const lazy = <M,>(load: () => Promise<M>, pick: (m: M) => ComponentType) => async () => ({ Component: pick(await load()) });

const Planned = (key: PanelKey) => lazy(() => import('@/pages/PlannedPages'), (m) => () => <m.PlannedPanelPage panelKey={key} />);
const Account = (key: PanelKey) => lazy(() => import('@/pages/account/AccountSettingsPage'), (m) => () => <m.AccountSettingsPage panelKey={key} />);
const Members = (key: PanelKey, preset: MembersPreset) =>
  lazy(() => import('@/pages/admin/MembersPage'), (m) => () => <m.MembersPage key={`${key}-${preset}`} panelKey={key} preset={preset} />);
const MemberDetail = (key: PanelKey) => lazy(() => import('@/pages/admin/MemberDetailPage'), (m) => () => <m.MemberDetailPage panelKey={key} />);
const Settings = (key: PanelKey) => lazy(() => import('@/pages/admin/SettingsPages'), (m) => () => <m.SettingsPage panelKey={key} />);
const Maintenance = (key: PanelKey) => lazy(() => import('@/pages/admin/SettingsPages'), (m) => () => <m.MaintenancePage panelKey={key} />);
const Audit = (key: PanelKey) => lazy(() => import('@/pages/admin/AuditLogPage'), (m) => () => <m.AuditLogPage panelKey={key} />);
const ListingsMgr = (key: PanelKey, type: ListingType, mode: 'vendor' | 'admin') =>
  lazy(() => import('@/pages/catalog/ListingsManagerPage'), (m) => () => <m.ListingsManagerPage key={type} panelKey={key} type={type} mode={mode} />);
const ListingEditor = (key: PanelKey, type: ListingType, mode: 'vendor' | 'admin') =>
  lazy(() => import('@/pages/catalog/ListingEditorPage'), (m) => () => <m.ListingEditorPage panelKey={key} type={type} mode={mode} />);
/** Products / services / projects list + new + edit routes for a panel. */
const catalogRoutes = (key: PanelKey, mode: 'vendor' | 'admin'): RouteObject[] =>
  (['product', 'service', 'project'] as const).flatMap((t) => [
    { path: `${t}s`, lazy: ListingsMgr(key, t, mode) },
    { path: `${t}s/new`, lazy: ListingEditor(key, t, mode) },
    { path: `${t}s/:id`, lazy: ListingEditor(key, t, mode) },
  ]);
const VendorsAdmin = (key: PanelKey, preset?: 'pending') => lazy(() => import('@/pages/admin/VendorAdminPages'), (m) => () => <m.VendorsAdminPage key={preset ?? 'all'} panelKey={key} preset={preset} />);
const VendorDetail = (key: PanelKey) => lazy(() => import('@/pages/admin/VendorAdminPages'), (m) => () => <m.VendorAdminDetailPage panelKey={key} />);
const VendorRoles = (key: PanelKey) => lazy(() => import('@/pages/admin/VendorAdminPages'), (m) => () => <m.VendorRolesPage panelKey={key} />);
const Categories = (key: PanelKey) => lazy(() => import('@/pages/admin/CatalogAdminPages'), (m) => () => <m.CategoriesPage panelKey={key} />);
const RefList = (key: PanelKey, scope: 'all' | 'direct' | 'indirect') =>
  lazy(() => import('@/pages/member/ReferralPages'), (m) => () => <m.ReferralListPage key={scope} panelKey={key} scope={scope} />);
/** Own referral network (members and vendors both have a member record). */
const referralRoutes = (key: PanelKey): RouteObject[] => [
  { path: 'referrals', lazy: RefList(key, 'all') },
  { path: 'referrals/all', lazy: RefList(key, 'all') },
  { path: 'referrals/direct', lazy: RefList(key, 'direct') },
  { path: 'referrals/indirect', lazy: RefList(key, 'indirect') },
  { path: 'referrals/tree', lazy: lazy(() => import('@/pages/member/ReferralPages'), (m) => () => <m.ReferralTreePage panelKey={key} />) },
  { path: 'referrals/new', lazy: lazy(() => import('@/pages/member/ReferralPages'), (m) => () => <m.InvitePage panelKey={key} />) },
];
const BankDetails = (key: PanelKey) => lazy(() => import('@/pages/admin/MemberExtrasPages'), (m) => () => <m.BankDetailsPage panelKey={key} />);
const AdminReferrals = (key: PanelKey) => lazy(() => import('@/pages/admin/MemberExtrasPages'), (m) => () => <m.AdminReferralViewPage panelKey={key} />);
const Approvals = (key: PanelKey) => lazy(() => import('@/pages/admin/CatalogAdminPages'), (m) => () => <m.ApprovalsPage panelKey={key} />);

/* Commerce (Phase 4) */
const Orders = (key: PanelKey, preset: OrdersPreset) => lazy(() => import('@/pages/commerce/OrderPages'), (m) => () => <m.OrdersPage key={preset.title} panelKey={key} preset={preset} />);
const OrderPage = (key: PanelKey) => lazy(() => import('@/pages/commerce/OrderPages'), (m) => () => <m.OrderDetailPage panelKey={key} />);
const Invoices = (key: PanelKey, title: string) => lazy(() => import('@/pages/commerce/OrderPages'), (m) => () => <m.InvoicesPage panelKey={key} title={title} />);
const Requests = (key: PanelKey) => lazy(() => import('@/pages/commerce/BiddingPages'), (m) => () => <m.RequestsPage panelKey={key} />);
const RequestDetail = (key: PanelKey) => lazy(() => import('@/pages/commerce/BiddingPages'), (m) => () => <m.RequestDetailPage panelKey={key} />);
const Selling = lazy(() => import('@/pages/commerce/OrderPages'), (m) => m.MemberSellingPage);
const myProjects = (path: string, title: string, q: Partial<OrdersPreset>) => ({ path: `projects/${path}`, lazy: Orders('member', { title, description: 'Projects you have ordered.', kind: 'project', ...q }) });
const memberCommerce: RouteObject[] = [
  { path: 'cart', lazy: lazy(() => import('@/pages/commerce/CartPages'), (m) => m.CartPage) },
  { path: 'checkout', lazy: lazy(() => import('@/pages/commerce/CartPages'), (m) => m.CheckoutPage) },
  { path: 'pay/:id', lazy: lazy(() => import('@/pages/commerce/CartPages'), (m) => m.PaymentPage) },
  { path: 'purchases/new', element: <Navigate to="/products" replace /> },
  { path: 'purchases/history', lazy: Orders('member', { title: 'My purchases', description: 'Every order you have placed.' }) },
  { path: 'services/mine', lazy: Orders('member', { title: 'My services', description: 'Services you have booked.', kind: 'service' }) },
  { path: 'orders/:id', lazy: OrderPage('member') },
  myProjects('running', 'Running projects', { group: 'active' }),
  myProjects('completed', 'Completed projects', { status: 'completed' }),
  myProjects('cancelled', 'Cancelled projects', { group: 'cancelled' }),
  { path: 'projects/new', lazy: lazy(() => import('@/pages/commerce/BiddingPages'), (m) => m.NewRequestPage) },
  { path: 'projects/requests', lazy: Requests('member') },
  { path: 'projects/requests/:id', lazy: RequestDetail('member') },
  { path: 'invoices/purchases', lazy: Invoices('member', 'Purchase invoices') },
  { path: 'invoices/billing', lazy: lazy(() => import('@/pages/commerce/OrderPages'), (m) => m.BillingPage) },
  { path: 'invoices/gst', lazy: lazy(() => import('@/pages/commerce/OrderPages'), (m) => m.GstPage) },
  ...['sales/new', 'sales/history', 'invoices/sales', 'products/new'].map((path) => ({ path, lazy: Selling })),
];
const vendorCommerce: RouteObject[] = [
  { path: 'orders/all', lazy: Orders('vendor', { title: 'Orders', description: 'Paid orders for your listings and accepted bids.' }) },
  { path: 'orders/summary', lazy: lazy(() => import('@/pages/commerce/OrderPages'), (m) => m.OrderSummaryPage) },
  { path: 'orders/tracking', lazy: Orders('vendor', { title: 'Order tracking', description: 'Orders on their way to the buyer.', status: 'shipped' }) },
  { path: 'orders/:id', lazy: OrderPage('vendor') },
  { path: 'customers', lazy: lazy(() => import('@/pages/commerce/OrderPages'), (m) => m.CustomersPage) },
  { path: 'invoices', lazy: Invoices('vendor', 'Sales invoices') },
  { path: 'bids', lazy: Requests('vendor') },
  { path: 'bids/:id', lazy: RequestDetail('vendor') },
];
const adminCommerce: RouteObject[] = [
  { path: 'orders', lazy: Orders('admin', { title: 'Orders', description: 'Every order on the platform.' }) },
  { path: 'orders/:id', lazy: OrderPage('admin') },
  { path: 'invoices', lazy: Invoices('admin', 'Invoice search') },
  { path: 'bids', lazy: Requests('admin') },
  { path: 'bids/:id', lazy: RequestDetail('admin') },
];

const dashboards: Record<PanelKey, () => Promise<{ Component: ComponentType }>> = {
  member: lazy(() => import('@/pages/panels/MemberDashboard'), (m) => m.MemberDashboard),
  vendor: lazy(() => import('@/pages/panels/VendorDashboard'), (m) => m.VendorDashboard),
  admin: lazy(() => import('@/pages/panels/AdminDashboard'), (m) => m.AdminDashboard),
  'super-admin': lazy(() => import('@/pages/panels/SuperAdminDashboard'), (m) => m.SuperAdminDashboard),
};

/** Screens built so far, per panel. Anything else in the sidebar falls through to the "planned" page. */
const PANEL_ROUTES: Record<PanelKey, RouteObject[]> = {
  member: [
    { path: 'profile', lazy: lazy(() => import('@/pages/member/MyProfilePage'), (m) => () => <m.MyProfilePage panelKey="member" />) },
    ...referralRoutes('member'),
    ...memberCommerce,
  ],
  vendor: [
    { path: 'profile', lazy: lazy(() => import('@/pages/vendor/BusinessProfilePage'), (m) => m.BusinessProfilePage) },
    ...catalogRoutes('vendor', 'vendor'),
    { path: 'personal-profile', lazy: lazy(() => import('@/pages/member/MyProfilePage'), (m) => () => <m.MyProfilePage panelKey="vendor" />) },
    ...referralRoutes('vendor'),
    ...vendorCommerce,
  ],
  admin: [
    { path: 'members/all', lazy: Members('admin', 'all') },
    { path: 'members/date-wise', lazy: Members('admin', 'datewise') },
    { path: 'members/edit', lazy: Members('admin', 'edit') },
    { path: 'members/security-codes', lazy: Members('admin', 'security') },
    { path: 'members/new', lazy: lazy(() => import('@/pages/admin/NewMemberPage'), (m) => m.NewMemberPage) },
    // Later-phase member screens must be listed before `members/:id` so they aren't read as an id.
    { path: 'members/bank-details', lazy: BankDetails('admin') },
    { path: 'members/referrals', lazy: AdminReferrals('admin') },
    ...['reports', 'messages'].map((p) => ({ path: `members/${p}`, lazy: Planned('admin') })),
    { path: 'members/:id', lazy: MemberDetail('admin') },
    { path: 'member-control/blacklist', lazy: Members('admin', 'blacklist') },
    { path: 'member-control/allow', lazy: Members('admin', 'allow') },
    { path: 'member-control/blocked', lazy: Members('admin', 'blocked') },
    { path: 'member-control/filter', lazy: Members('admin', 'filter') },
    { path: 'settings', lazy: Settings('admin') },
    { path: 'maintenance', lazy: Maintenance('admin') },
    { path: 'audit', lazy: Audit('admin') },
    { path: 'vendors', lazy: VendorsAdmin('admin') },
    { path: 'vendor-kyc', lazy: VendorsAdmin('admin', 'pending') },
    { path: 'vendors/:id', lazy: VendorDetail('admin') },
    { path: 'vendor-roles', lazy: VendorRoles('admin') },
    { path: 'approvals', lazy: Approvals('admin') },
    { path: 'categories', lazy: Categories('admin') },
    ...catalogRoutes('admin', 'admin'),
    ...adminCommerce,
  ],
  'super-admin': [
    { path: 'admins', lazy: lazy(() => import('@/pages/super/AdminsPage'), (m) => m.AdminsPage) },
    { path: 'roles', lazy: lazy(() => import('@/pages/super/RolesPage'), (m) => m.RolesPage) },
    { path: 'audit', lazy: Audit('super-admin') },
    { path: 'members', lazy: Members('super-admin', 'all') },
    { path: 'members/bank-details', lazy: BankDetails('super-admin') },
    { path: 'members/referrals', lazy: AdminReferrals('super-admin') },
    { path: 'members/:id', lazy: MemberDetail('super-admin') },
    { path: 'payment-gateway', lazy: lazy(() => import('@/pages/super/PaymentGatewayPage'), (m) => m.PaymentGatewayPage) },
    { path: 'settings', lazy: Settings('super-admin') },
    { path: 'maintenance', lazy: Maintenance('super-admin') },
    { path: 'vendors', lazy: VendorsAdmin('super-admin') },
    { path: 'vendors/:id', lazy: VendorDetail('super-admin') },
    { path: 'vendor-roles', lazy: VendorRoles('super-admin') },
    { path: 'catalog', lazy: Approvals('super-admin') },
    { path: 'categories', lazy: Categories('super-admin') },
    ...catalogRoutes('super-admin', 'admin'),
  ],
};

function panelRoute(key: PanelKey): RouteObject {
  return {
    path: key,
    lazy: lazy(() => import('@/layouts/PanelLayout'), (m) => () => <PanelGuard panel={key}><m.PanelLayout panelKey={key} /></PanelGuard>),
    children: [
      { index: true, lazy: dashboards[key] },
      { path: 'account', lazy: Account(key) },
      ...PANEL_ROUTES[key],
      { path: '*', lazy: Planned(key) },
    ],
  };
}

const listings = (type: 'product' | 'service' | 'project') =>
  lazy(() => import('@/pages/public/ListingsPage'), (m) => () => <m.ListingsPage key={type} type={type} />);

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'products', lazy: listings('product') },
      { path: 'services', lazy: listings('service') },
      { path: 'projects', lazy: listings('project') },
      ...(['product', 'service', 'project'] as const).map((t) => ({ path: `${t}s/:slug`, lazy: lazy(() => import('@/pages/public/ListingDetailPage'), (m) => () => <m.ListingDetailPage type={t} />) })),
      { path: 'vendors', lazy: lazy(() => import('@/pages/public/VendorPages'), (m) => m.VendorsPage) },
      { path: 'vendors/:slug', lazy: lazy(() => import('@/pages/public/VendorPages'), (m) => m.VendorProfilePage) },
      { path: 'directory', lazy: lazy(() => import('@/pages/public/VendorPages'), (m) => m.DirectoryPage) },
      ...(import.meta.env.DEV ? [{ path: 'dev/outbox', lazy: lazy(() => import('@/pages/DevOutboxPage'), (m) => m.DevOutboxPage) }] : []),
      { path: '*', element: <PlannedPublicPage /> },
    ],
  },
  {
    element: <AuthLayout />,
    children: [
      { path: 'login', lazy: lazy(() => import('@/pages/auth/LoginPage'), (m) => m.LoginPage) },
      { path: 'register', lazy: lazy(() => import('@/pages/auth/RegisterPage'), (m) => m.RegisterPage) },
      { path: 'verify', lazy: lazy(() => import('@/pages/auth/VerifyPage'), (m) => m.VerifyPage) },
      { path: 'forgot-password', lazy: lazy(() => import('@/pages/auth/ForgotPasswordPage'), (m) => m.ForgotPasswordPage) },
    ],
  },
  panelRoute('member'),
  panelRoute('vendor'),
  panelRoute('admin'),
  panelRoute('super-admin'),
  { path: '*', element: <NotFoundPage /> },
]);
