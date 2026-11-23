/**
 * ⚠️ SAMPLE DATA — dashboard figures for the UI preview. Not real accounts or money.
 * Each block is replaced by an aggregate API in the phase that builds the underlying module.
 * Amounts are integer paise, matching the real API contract.
 */

const MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
const series = (a: number[], b: number[]) => MONTHS.map((month, i) => ({ month, a: a[i]!, b: b[i]! }));

export const SAMPLE_MEMBER = {
  memberId: 'JR0004812',
  referralCode: 'JR7K2Q',
  firstName: 'Arjun',
  profileCompletion: 80,
  missingProfileItems: ['your bank account', 'PAN'],
  subscription: { plan: 'Annual', validTill: '2027-03-14' },
  stats: {
    walletPaise: 1842000, earningsPaise: 6438000, earningsDeltaPct: 12.4,
    referralsTotal: 47, referralsDirect: 12, referralsIndirect: 35,
    purchasesPaise: 21450000, activeOrders: 3, pendingOrders: 1, completedProjects: 2,
  },
  chart: series([4200, 4800, 4500, 6000, 5800, 7200, 6800, 8000, 7700, 9200, 8800, 10400].map((x) => x * 100), [3000, 2800, 3600, 3400, 4000, 3800, 4600, 4400, 5200, 5000, 5800, 6200].map((x) => x * 100)),
  announcements: [
    { title: 'Festive coupons are live', body: 'Check My Coupons for your unused codes.', tone: 'violet' as const, date: '2026-11-20' },
    { title: 'Riya Desai’s birthday is today 🎂', body: 'Send a greeting to your referral.', tone: 'amber' as const, date: '2026-11-23' },
  ],
  notifications: [
    { text: 'Reward of ₹1,240 credited for order JR-ORD-2026-004812', time: '2 h ago', unread: true },
    { text: 'Your withdrawal of ₹10,000 is being processed', time: 'Yesterday', unread: true },
    { text: 'Rohan Sen joined using your referral link', time: '2 days ago', unread: false },
  ],
  transactions: [
    { id: 'TXN2611230184', description: 'Referral reward · Order JR-ORD-2026-004812', direction: 'credit', amountPaise: 124000, status: 'completed', date: '2026-11-23' },
    { id: 'TXN2611220951', description: 'Purchase · 4-Camera HD CCTV Kit', direction: 'debit', amountPaise: 1499900, status: 'completed', date: '2026-11-22' },
    { id: 'TXN2611210337', description: 'Withdrawal to HDFC ••4821', direction: 'debit', amountPaise: 1000000, status: 'processing', date: '2026-11-21' },
    { id: 'TXN2611190762', description: 'Wallet top-up · UPI', direction: 'credit', amountPaise: 500000, status: 'completed', date: '2026-11-19' },
    { id: 'TXN2611170415', description: 'Order refund · JR-ORD-2026-004377', direction: 'credit', amountPaise: 249900, status: 'refunded', date: '2026-11-17' },
    { id: 'TXN2611150122', description: 'Coupon cashback · FESTIVE10', direction: 'credit', amountPaise: 50000, status: 'completed', date: '2026-11-15' },
    { id: 'TXN2611120988', description: 'Purchase · GST filing (Nov)', direction: 'debit', amountPaise: 149900, status: 'completed', date: '2026-11-12' },
  ],
};

export const SAMPLE_VENDOR = {
  businessName: 'Pixelcraft Labs',
  stats: {
    products: 12, projects: 8, services: 16, pendingApproval: 4,
    ordersTotal: 214, ordersNew: 8, ordersPending: 5, ordersCompleted: 196,
    salesPaise: 38420000, salesDeltaPct: 9.1, earningsPaise: 33803000, walletPaise: 5264000, pendingPayoutPaise: 1800000,
    referrals: 9,
  },
  chart: series([18, 22, 21, 26, 24, 30, 29, 33, 31, 36, 35, 38].map((x) => x * 1000000), [12, 18, 16, 20, 22, 24, 23, 28, 26, 30, 31, 32].map((x) => x * 1000000)),
  attention: [
    { title: '3 new orders to confirm', sub: 'Oldest placed 6 hours ago', kind: 'orders' },
    { title: '2 project bids shortlisted', sub: 'Buyers are waiting for your reply', kind: 'bids' },
    { title: '4 listings in review', sub: 'Submitted to admin for approval', kind: 'listings' },
    { title: 'Payout of ₹18,000 processing', sub: 'Expected in 2 working days', kind: 'payout' },
  ],
  orders: [
    { id: 'JR-ORD-2026-004921', customer: 'Neha Kapoor', item: 'E-commerce Website Development', amountPaise: 4500000, status: 'confirmed', date: '2026-11-23' },
    { id: 'JR-ORD-2026-004917', customer: 'Vikram Rao', item: 'Social Media Marketing Package', amountPaise: 2500000, status: 'pending', date: '2026-11-23' },
    { id: 'JR-ORD-2026-004880', customer: 'Sana Sheikh', item: 'Restaurant Mobile Ordering App (advance)', amountPaise: 9600000, status: 'processing', date: '2026-11-21' },
    { id: 'JR-ORD-2026-004802', customer: 'Aman Gupta', item: 'Social Media Marketing Package', amountPaise: 2500000, status: 'completed', date: '2026-11-18' },
    { id: 'JR-ORD-2026-004755', customer: 'Farah Khan', item: 'E-commerce Website Development', amountPaise: 4500000, status: 'completed', date: '2026-11-14' },
    { id: 'JR-ORD-2026-004701', customer: 'Rahul Verma', item: 'Website maintenance (monthly)', amountPaise: 800000, status: 'cancelled', date: '2026-11-11' },
  ],
};

export const SAMPLE_ADMIN = {
  stats: {
    members: 12486, membersDelta: 384, vendors: 2417, vendorsPending: 4,
    products: 9820, projects: 1210, services: 6943,
    orders: 31862, salesPaise: 1420000000, salesDeltaPct: 14.2, earningsPaise: 98400000,
    pendingPaymentsPaise: 4210000, walletPaise: 286000000, withdrawalsPending: 7, withdrawalsPendingPaise: 12640000,
    referralsThisMonth: 1240, referralConversionPct: 31,
  },
  revenue: series([88, 92, 97, 104, 101, 112, 118, 121, 126, 133, 129, 142].map((x) => x * 1000000), [6, 6.4, 6.8, 7.2, 7, 7.8, 8.1, 8.5, 8.8, 9.3, 9, 9.8].map((x) => Math.round(x * 1000000))),
  growth: MONTHS.map((month, i) => ({ month, members: [610, 702, 655, 790, 820, 880, 940, 1010, 990, 1120, 1180, 1240][i]!, vendors: [42, 51, 47, 58, 62, 66, 70, 75, 73, 81, 86, 92][i]! })),
  registrations: [
    { id: 'JR0012486', name: 'Riya Desai', role: 'member', city: 'Surat', sponsor: 'JR7K2Q', date: '2026-11-23', status: 'active' },
    { id: 'JR0012485', name: 'BrightPath Tutors', role: 'vendor', city: 'Lucknow', sponsor: '—', date: '2026-11-23', status: 'pending' },
    { id: 'JR0012484', name: 'Imran Qureshi', role: 'member', city: 'Bhopal', sponsor: 'JR4M9X', date: '2026-11-22', status: 'active' },
    { id: 'JR0012483', name: 'Lakshmi Pillai', role: 'member', city: 'Kochi', sponsor: '—', date: '2026-11-22', status: 'active' },
    { id: 'JR0012482', name: 'FreshFold Laundry', role: 'vendor', city: 'Pune', sponsor: 'JR2P7T', date: '2026-11-21', status: 'pending' },
    { id: 'JR0012481', name: 'Deepak Joshi', role: 'member', city: 'Indore', sponsor: 'JR7K2Q', date: '2026-11-21', status: 'blocked' },
  ],
  transactions: [
    { id: 'TXN2611230201', user: 'Arjun Mehta', type: 'Commission', direction: 'credit', amountPaise: 124000, status: 'completed', date: '2026-11-23' },
    { id: 'TXN2611230188', user: 'SunGrid Energy', type: 'Order payment', direction: 'credit', amountPaise: 18000000, status: 'completed', date: '2026-11-23' },
    { id: 'TXN2611220977', user: 'Priya Nair', type: 'Payout', direction: 'debit', amountPaise: 1800000, status: 'processing', date: '2026-11-22' },
    { id: 'TXN2611220911', user: 'Neha Kapoor', type: 'Wallet top-up', direction: 'credit', amountPaise: 500000, status: 'completed', date: '2026-11-22' },
    { id: 'TXN2611210450', user: 'Vikram Rao', type: 'Refund', direction: 'debit', amountPaise: 249900, status: 'refunded', date: '2026-11-21' },
  ],
  orders: [
    { id: 'JR-ORD-2026-004921', buyer: 'Neha Kapoor', vendor: 'Pixelcraft Labs', amountPaise: 4500000, payment: 'captured', status: 'confirmed', date: '2026-11-23' },
    { id: 'JR-ORD-2026-004919', buyer: 'Arjun Mehta', vendor: 'SunGrid Energy', amountPaise: 18000000, payment: 'captured', status: 'processing', date: '2026-11-23' },
    { id: 'JR-ORD-2026-004917', buyer: 'Vikram Rao', vendor: 'Pixelcraft Labs', amountPaise: 2500000, payment: 'created', status: 'pending', date: '2026-11-23' },
    { id: 'JR-ORD-2026-004910', buyer: 'Sana Sheikh', vendor: 'OfficeHub Supplies', amountPaise: 849900, payment: 'captured', status: 'shipped', date: '2026-11-22' },
    { id: 'JR-ORD-2026-004899', buyer: 'Imran Qureshi', vendor: 'SparkClean Services', amountPaise: 349900, payment: 'captured', status: 'completed', date: '2026-11-22' },
  ],
  pending: [
    { title: '12 listings awaiting approval', sub: '5 products · 4 services · 3 projects', kind: 'listings' },
    { title: '4 vendor KYC reviews', sub: 'GST and PAN documents uploaded', kind: 'kyc' },
    { title: '7 withdrawal requests', sub: '₹1,26,400 requested in total', kind: 'withdrawals' },
    { title: '9 open support tickets', sub: '2 marked urgent', kind: 'tickets' },
  ],
};

export const SAMPLE_SUPER = {
  stats: { admins: 6, adminsInactive: 1, gmv30Paise: 386000000, gmvDeltaPct: 11.8, commissions30Paise: 0, activeRuleSets: 0, uptimePct: 99.98 },
  chart: series([30, 31, 33, 32, 34, 35, 36, 35, 37, 38, 37, 38.6].map((x) => Math.round(x * 10000000)), [2.1, 2.2, 2.3, 2.3, 2.4, 2.5, 2.6, 2.5, 2.7, 2.8, 2.8, 2.9].map((x) => Math.round(x * 10000000))),
  admins: [
    { id: 'a1', name: 'Karan Shah', email: 'karan.s@example.in', role: 'Admin', scope: 'Full admin', lastActive: '2026-11-23', status: 'active' },
    { id: 'a2', name: 'Divya Rao', email: 'divya.r@example.in', role: 'Admin', scope: 'Finance', lastActive: '2026-11-23', status: 'active' },
    { id: 'a3', name: 'Sameer Patil', email: 'sameer.p@example.in', role: 'Admin', scope: 'Catalog & vendors', lastActive: '2026-11-22', status: 'active' },
    { id: 'a4', name: 'Ananya Bose', email: 'ananya.b@example.in', role: 'Admin', scope: 'Support', lastActive: '2026-11-21', status: 'active' },
    { id: 'a5', name: 'Rohit Malhotra', email: 'rohit.m@example.in', role: 'Admin', scope: 'Members', lastActive: '2026-11-02', status: 'deactivated' },
  ],
  config: [
    { label: 'Commission rules', state: 'Not configured', ok: false, hint: 'Define referral levels and rates before launch', to: '/super-admin/commission-rules' },
    { label: 'Payment gateway', state: 'Sandbox mode', ok: false, hint: 'Switch to live keys when ready', to: '/super-admin/payment-gateway' },
    { label: 'SMS / OTP provider', state: 'Console driver', ok: false, hint: 'Connect MSG91, Twilio or similar', to: '/super-admin/messaging' },
    { label: 'Email provider', state: 'Local SMTP', ok: false, hint: 'Connect SES, SendGrid or SMTP', to: '/super-admin/messaging' },
    { label: 'Maintenance mode', state: 'Off', ok: true, hint: 'Site is open to all users', to: '/super-admin/maintenance' },
  ],
  audit: [
    { actor: 'Divya Rao', action: 'Approved withdrawal WD-2026-00871 (₹12,000)', time: '10:42' },
    { actor: 'Karan Shah', action: 'Blocked member JR0012481', time: '09:58' },
    { actor: 'Sameer Patil', action: 'Approved 5 product listings', time: '09:31' },
    { actor: 'System', action: 'Daily ledger reconciliation passed', time: '02:00' },
  ],
};
