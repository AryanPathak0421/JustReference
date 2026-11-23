import type { LucideIcon } from 'lucide-react';
import {
  Activity, Award, BadgeCheck, Banknote, BarChart3, Bell, BookOpen, Briefcase, Building2, Construction, CreditCard, Crown, FileText,
  FolderKanban, FolderTree, Gavel, Gift, GitBranch, HandCoins, KeyRound, KeySquare, Landmark, LayoutDashboard, LifeBuoy, Mail, Megaphone, MessageSquare,
  Package, Percent, ReceiptIndianRupee, ScrollText, Send, Settings, Shield, ShieldBan, ShoppingBag, ShoppingCart, Star, Store, Tag, TicketPercent,
  TrendingUp, UserCog, UserPlus, Users, Wallet, Wrench,
} from 'lucide-react';

/** The roadmap phase a screen is delivered in (see docs/ARCHITECTURE.md §8). 0 = built now. */
export type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface NavLeaf {
  label: string;
  to: string;
  phase: Phase;
  /** Hide unless the user has this permission (UI only; the API enforces it). */
  perm?: string;
}
export interface NavItem extends NavLeaf {
  icon: LucideIcon;
  children?: NavLeaf[];
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export type PanelKey = 'member' | 'vendor' | 'admin' | 'super-admin';

export interface PanelConfig {
  key: PanelKey;
  label: string;
  base: string;
  nav: NavGroup[];
}

const leaf = (label: string, to: string, phase: Phase, perm?: string): NavLeaf => ({ label, to, phase, perm });

/* ------------------------------------------------------------------ Member (brief §10) */
const m = '/member';
const member: PanelConfig = {
  key: 'member',
  label: 'Member',
  base: m,
  nav: [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', icon: LayoutDashboard, to: m, phase: 0 },
        { label: 'Notifications', icon: Bell, to: `${m}/notifications`, phase: 6 },
        { label: 'Announcements', icon: Megaphone, to: `${m}/announcements`, phase: 6 },
      ],
    },
    {
      label: 'Business',
      items: [
        {
          label: 'Projects', icon: FolderKanban, to: `${m}/projects`, phase: 4,
          children: [
            leaf('Running projects', `${m}/projects/running`, 4), leaf('Completed projects', `${m}/projects/completed`, 4),
            leaf('Cancelled projects', `${m}/projects/cancelled`, 4), leaf('Create new project', `${m}/projects/new`, 4),
          ],
        },
        {
          label: 'Purchases', icon: ShoppingBag, to: `${m}/purchases`, phase: 4,
          children: [leaf('New purchase', `${m}/purchases/new`, 4), leaf('Old purchases', `${m}/purchases/history`, 4), leaf('My cart', `${m}/cart`, 4)],
        },
        {
          label: 'Sales', icon: Tag, to: `${m}/sales`, phase: 4,
          children: [leaf('New sale', `${m}/sales/new`, 4), leaf('Old sales', `${m}/sales/history`, 4)],
        },
        {
          label: 'Products', icon: Package, to: `${m}/products`, phase: 2,
          children: [leaf('Browse products', '/products', 0), leaf('Product categories', '/products?view=categories', 0), leaf('Add new product', `${m}/products/new`, 3)],
        },
        {
          label: 'Services', icon: Wrench, to: `${m}/services`, phase: 2,
          children: [leaf('Browse services', '/services', 0), leaf('Service categories', '/services?view=categories', 0), leaf('My services', `${m}/services/mine`, 4)],
        },
        {
          label: 'Invoices', icon: FileText, to: `${m}/invoices`, phase: 4,
          children: [leaf('Sales invoices', `${m}/invoices/sales`, 4), leaf('Purchase invoices', `${m}/invoices/purchases`, 4), leaf('Billing history', `${m}/invoices/billing`, 4), leaf('GST details', `${m}/invoices/gst`, 4)],
        },
      ],
    },
    {
      label: 'Earnings',
      items: [
        {
          label: 'Earnings', icon: TrendingUp, to: `${m}/earnings`, phase: 5,
          children: [leaf('My business', `${m}/earnings/my-business`, 5), leaf('Referral business', `${m}/earnings/referral-business`, 5), leaf('Search business', `${m}/earnings/search`, 5), leaf('Total business', `${m}/earnings/total`, 5)],
        },
        {
          label: 'My referrals', icon: Users, to: `${m}/referrals`, phase: 3,
          children: [leaf('All referrals', `${m}/referrals/all`, 3), leaf('Direct referrals', `${m}/referrals/direct`, 3), leaf('Indirect referrals', `${m}/referrals/indirect`, 3), leaf('Referral tree', `${m}/referrals/tree`, 3), leaf('Create new referral', `${m}/referrals/new`, 3)],
        },
        {
          label: 'Bonus & rewards', icon: Gift, to: `${m}/rewards`, phase: 5,
          children: [leaf('Cash rewards', `${m}/rewards/cash`, 5), leaf('Coupons', `${m}/rewards/coupons`, 5), leaf('Other rewards', `${m}/rewards/other`, 5)],
        },
        {
          label: 'My coupons', icon: TicketPercent, to: `${m}/coupons`, phase: 5,
          children: [leaf('Unused coupons', `${m}/coupons/unused`, 5), leaf('Used coupons', `${m}/coupons/used`, 5), leaf('Expired coupons', `${m}/coupons/expired`, 5)],
        },
        {
          label: 'E-PIN & subscription', icon: KeyRound, to: `${m}/epin`, phase: 5,
          children: [leaf('Subscription plans', `${m}/epin/plans`, 5), leaf('Generate E-PIN', `${m}/epin/generate`, 5), leaf('Special subscription', `${m}/epin/special`, 5)],
        },
      ],
    },
    {
      label: 'Money',
      items: [
        {
          label: 'Wallet', icon: Wallet, to: `${m}/wallet`, phase: 5,
          children: [leaf('Top up', `${m}/wallet/top-up`, 5), leaf('Transfer funds', `${m}/wallet/transfer`, 5), leaf('Withdraw / payout', `${m}/wallet/withdraw`, 5), leaf('Payout report', `${m}/wallet/payouts`, 5), leaf('Transaction report', `${m}/wallet/transactions`, 5), leaf('Change wallet password', `${m}/wallet/password`, 5)],
        },
        {
          label: 'Account report', icon: BookOpen, to: `${m}/account-report`, phase: 5,
          children: [leaf('Credit', `${m}/account-report/credit`, 5), leaf('Debit', `${m}/account-report/debit`, 5), leaf('Balance', `${m}/account-report/balance`, 5), leaf('TDS report', `${m}/account-report/tds`, 5)],
        },
      ],
    },
    {
      label: 'Help',
      items: [
        {
          label: 'Messages', icon: Mail, to: `${m}/messages`, phase: 6,
          children: [leaf('Inbox', `${m}/messages/inbox`, 6), leaf('Outbox', `${m}/messages/outbox`, 6), leaf('Drafts', `${m}/messages/drafts`, 6), leaf('Upload documents', `${m}/messages/documents`, 6)],
        },
        {
          label: 'Support', icon: LifeBuoy, to: `${m}/support`, phase: 6,
          children: [leaf('New support request', `${m}/support/new`, 6), leaf('My tickets', `${m}/support/tickets`, 6), leaf('Ticket history', `${m}/support/history`, 6)],
        },
        { label: 'Advertisements', icon: Megaphone, to: `${m}/advertisements`, phase: 6 },
        { label: 'Profile', icon: UserCog, to: `${m}/profile`, phase: 3 },
        { label: 'Account & security', icon: KeyRound, to: `${m}/account`, phase: 1 },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ Vendor (brief §8) */
const v = '/vendor';
const vendor: PanelConfig = {
  key: 'vendor',
  label: 'Vendor',
  base: v,
  nav: [
    { label: 'Overview', items: [{ label: 'Dashboard', icon: LayoutDashboard, to: v, phase: 0 }, { label: 'Notifications', icon: Bell, to: `${v}/notifications`, phase: 6 }] },
    {
      label: 'Catalog',
      items: [
        { label: 'Products', icon: Package, to: `${v}/products`, phase: 2 },
        { label: 'Services', icon: Wrench, to: `${v}/services`, phase: 2 },
        { label: 'Projects', icon: FolderKanban, to: `${v}/projects`, phase: 2 },
        { label: 'Bids', icon: Gavel, to: `${v}/bids`, phase: 4 },
      ],
    },
    {
      label: 'Sales',
      items: [
        {
          label: 'Orders', icon: ShoppingCart, to: `${v}/orders`, phase: 4,
          children: [leaf('All orders', `${v}/orders/all`, 4), leaf('Order summary', `${v}/orders/summary`, 4), leaf('Order tracking', `${v}/orders/tracking`, 4)],
        },
        { label: 'Customers', icon: Users, to: `${v}/customers`, phase: 4 },
        { label: 'Invoices', icon: FileText, to: `${v}/invoices`, phase: 4 },
      ],
    },
    {
      label: 'Money',
      items: [
        { label: 'Wallet', icon: Wallet, to: `${v}/wallet`, phase: 5 },
        { label: 'Payout requests', icon: Banknote, to: `${v}/payouts`, phase: 5 },
        { label: 'Earnings report', icon: BarChart3, to: `${v}/earnings`, phase: 5 },
        { label: 'Account reports', icon: BookOpen, to: `${v}/reports`, phase: 6 },
        {
          label: 'Referrals', icon: GitBranch, to: `${v}/referrals`, phase: 3,
          children: [leaf('All referrals', `${v}/referrals/all`, 3), leaf('Referral tree', `${v}/referrals/tree`, 3), leaf('Invite someone', `${v}/referrals/new`, 3)],
        },
      ],
    },
    {
      label: 'Account',
      items: [
        { label: 'Business profile', icon: Building2, to: `${v}/profile`, phase: 2 },
        { label: 'Personal profile', icon: UserCog, to: `${v}/personal-profile`, phase: 3 },
        { label: 'Messages', icon: MessageSquare, to: `${v}/messages`, phase: 6 },
        { label: 'Admin support', icon: LifeBuoy, to: `${v}/support`, phase: 6 },
        { label: 'Account & security', icon: KeyRound, to: `${v}/account`, phase: 1 },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ Admin (brief §5) */
const a = '/admin';
const admin: PanelConfig = {
  key: 'admin',
  label: 'Admin',
  base: a,
  nav: [
    { label: 'Overview', items: [{ label: 'Dashboard', icon: LayoutDashboard, to: a, phase: 0 }, { label: 'Reports', icon: BarChart3, to: `${a}/reports`, phase: 6 }] },
    {
      label: 'People',
      items: [
        {
          label: 'Members', icon: Users, to: `${a}/members`, phase: 1, perm: 'members.view',
          children: [
            leaf('All members', `${a}/members/all`, 1, 'members.view'), leaf('New registration', `${a}/members/new`, 1, 'members.create'), leaf('Date-wise list', `${a}/members/date-wise`, 1, 'members.view'),
            leaf('Edit member profile', `${a}/members/edit`, 1, 'members.edit'), leaf('Security codes', `${a}/members/security-codes`, 1, 'members.security'), leaf('Bank details', `${a}/members/bank-details`, 3, 'members.bank'),
            leaf('Direct referral view', `${a}/members/referrals`, 3, 'members.view'), leaf('Member reports', `${a}/members/reports`, 6), leaf('Member messages', `${a}/members/messages`, 6),
          ],
        },
        {
          label: 'Manage members', icon: ShieldBan, to: `${a}/member-control`, phase: 1, perm: 'members.view',
          children: [
            leaf('Blacklist member', `${a}/member-control/blacklist`, 1, 'members.status'), leaf('Allow member', `${a}/member-control/allow`, 1, 'members.status'),
            leaf('Blocked members', `${a}/member-control/blocked`, 1, 'members.view'), leaf('Filter members', `${a}/member-control/filter`, 1, 'members.view'),
          ],
        },
        {
          label: 'Vendors', icon: Store, to: `${a}/vendors`, phase: 2, perm: 'vendors.view',
          children: [leaf('All vendors', `${a}/vendors`, 2, 'vendors.view'), leaf('KYC reviews', `${a}/vendor-kyc`, 2, 'vendors.view'), leaf('Vendor roles & rights', `${a}/vendor-roles`, 2, 'vendors.view')],
        },
        { label: 'New registration', icon: UserPlus, to: `${a}/members/new`, phase: 1, perm: 'members.create' },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { label: 'Approvals', icon: BadgeCheck, to: `${a}/approvals`, phase: 2, perm: 'catalog.view' },
        { label: 'Products', icon: Package, to: `${a}/products`, phase: 2, perm: 'catalog.view' },
        { label: 'Services', icon: Wrench, to: `${a}/services`, phase: 2, perm: 'catalog.view' },
        { label: 'Projects', icon: FolderKanban, to: `${a}/projects`, phase: 2, perm: 'catalog.view' },
        { label: 'Categories', icon: FolderTree, to: `${a}/categories`, phase: 2, perm: 'catalog.view' },
        { label: 'Bids monitor', icon: Gavel, to: `${a}/bids`, phase: 4 },
      ],
    },
    {
      label: 'Finance',
      items: [
        { label: 'Orders', icon: ReceiptIndianRupee, to: `${a}/orders`, phase: 4 },
        { label: 'Invoice search', icon: FileText, to: `${a}/invoices`, phase: 4 },
        {
          label: 'Commissions', icon: HandCoins, to: `${a}/commissions`, phase: 5,
          children: [leaf('Pay commissions', `${a}/commissions/pay`, 5), leaf('Referral income', `${a}/commissions/referral-income`, 5), leaf('Investment income', `${a}/commissions/investment-income`, 5)],
        },
        {
          label: 'Balances & withdrawals', icon: Landmark, to: `${a}/withdrawals`, phase: 5,
          children: [leaf('Member account balance', `${a}/withdrawals/balances`, 5), leaf('Withdrawn balance', `${a}/withdrawals/withdrawn`, 5), leaf('Withdrawn list', `${a}/withdrawals/list`, 5), leaf('Bank transfer requests', `${a}/withdrawals/bank-transfers`, 5)],
        },
        {
          label: 'Rewards', icon: Award, to: `${a}/rewards`, phase: 5,
          children: [leaf('Pay rewards', `${a}/rewards/pay`, 5), leaf('Rewards list', `${a}/rewards/list`, 5)],
        },
        { label: 'TDS list', icon: Percent, to: `${a}/tds`, phase: 5 },
        {
          label: 'E-PINs', icon: KeyRound, to: `${a}/epins`, phase: 5,
          children: [leaf('Generate / issue E-PIN', `${a}/epins/generate`, 5), leaf('Fresh E-PINs', `${a}/epins/fresh`, 5), leaf('Used E-PINs', `${a}/epins/used`, 5), leaf('Search E-PIN', `${a}/epins/search`, 5)],
        },
      ],
    },
    {
      label: 'Support',
      items: [
        { label: 'Messages', icon: MessageSquare, to: `${a}/messages`, phase: 6 },
        { label: 'Support tickets', icon: LifeBuoy, to: `${a}/tickets`, phase: 6 },
        { label: 'Customer feedback', icon: Star, to: `${a}/feedback`, phase: 6 },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Settings', icon: Settings, to: `${a}/settings`, phase: 1, perm: 'settings.view' },
        { label: 'Website maintenance', icon: Construction, to: `${a}/maintenance`, phase: 1, perm: 'maintenance.manage' },
        { label: 'Audit log', icon: ScrollText, to: `${a}/audit`, phase: 1, perm: 'audit.view' },
        { label: 'Account & security', icon: KeyRound, to: `${a}/account`, phase: 1 },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ Super Admin (brief §4) */
const s = '/super-admin';
const superAdmin: PanelConfig = {
  key: 'super-admin',
  label: 'Super Admin',
  base: s,
  nav: [
    { label: 'Overview', items: [{ label: 'Dashboard', icon: LayoutDashboard, to: s, phase: 0 }, { label: 'Reports & analytics', icon: BarChart3, to: `${s}/analytics`, phase: 6 }] },
    {
      label: 'Administration',
      items: [
        { label: 'Administrators', icon: Shield, to: `${s}/admins`, phase: 1 },
        { label: 'Roles & permissions', icon: KeySquare, to: `${s}/roles`, phase: 1 },
        { label: 'Audit log', icon: ScrollText, to: `${s}/audit`, phase: 1 },
        { label: 'Account & security', icon: KeyRound, to: `${s}/account`, phase: 1 },
      ],
    },
    {
      label: 'Platform',
      items: [
        {
          label: 'Members', icon: Users, to: `${s}/members`, phase: 1,
          children: [leaf('All members', `${s}/members`, 1), leaf('Bank details', `${s}/members/bank-details`, 3), leaf('Referral view', `${s}/members/referrals`, 3)],
        },
        { label: 'Vendors', icon: Store, to: `${s}/vendors`, phase: 2 },
        {
          label: 'Catalog', icon: Briefcase, to: `${s}/catalog`, phase: 2,
          children: [leaf('Approvals', `${s}/catalog`, 2), leaf('Products', `${s}/products`, 2), leaf('Services', `${s}/services`, 2), leaf('Projects', `${s}/projects`, 2), leaf('Categories', `${s}/categories`, 2), leaf('Vendor roles', `${s}/vendor-roles`, 2)],
        },
        { label: 'Transactions', icon: ReceiptIndianRupee, to: `${s}/transactions`, phase: 5 },
        { label: 'Wallet monitor', icon: Wallet, to: `${s}/wallets`, phase: 5 },
      ],
    },
    {
      label: 'Monetisation',
      items: [
        { label: 'Commission rules', icon: GitBranch, to: `${s}/commission-rules`, phase: 5 },
        { label: 'Subscriptions', icon: Crown, to: `${s}/subscriptions`, phase: 5 },
        { label: 'E-PINs', icon: KeyRound, to: `${s}/epins`, phase: 5 },
        { label: 'Coupons & rewards', icon: TicketPercent, to: `${s}/coupons`, phase: 5 },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { label: 'Website settings', icon: Settings, to: `${s}/settings`, phase: 1 },
        { label: 'Payment gateway', icon: CreditCard, to: `${s}/payment-gateway`, phase: 4 },
        { label: 'SMS / Email / WhatsApp', icon: Send, to: `${s}/messaging`, phase: 6 },
        { label: 'Maintenance mode', icon: Construction, to: `${s}/maintenance`, phase: 1 },
        { label: 'System health', icon: Activity, to: `${s}/health`, phase: 6 },
      ],
    },
  ],
};

export const PANELS: Record<PanelKey, PanelConfig> = { member, vendor, admin, 'super-admin': superAdmin };

/** Find the nav entry (item or child) for a path, for page titles on not-yet-built screens. */
export function findNavEntry(panel: PanelConfig, pathname: string): { entry: NavLeaf; parent?: NavItem; group: NavGroup } | undefined {
  for (const group of panel.nav) {
    for (const item of group.items) {
      if (item.to === pathname) return { entry: item, group };
      const child = item.children?.find((c) => c.to === pathname);
      if (child) return { entry: child, parent: item, group };
    }
  }
  return undefined;
}
