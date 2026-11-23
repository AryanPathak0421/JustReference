/**
 * Domain enums shared by the API and the web app.
 * Changing a value here is a data migration — never rename casually.
 */

export const ROLES = ['super_admin', 'admin', 'vendor', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const LISTING_TYPES = ['product', 'project', 'service'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_STATUSES = ['draft', 'pending_approval', 'published', 'rejected', 'archived'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'completed',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ['created', 'authorized', 'captured', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const LEDGER_DIRECTIONS = ['credit', 'debit'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const LEDGER_STATUSES = ['pending', 'completed', 'reversed'] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const BID_STATUSES = ['submitted', 'accepted', 'rejected', 'withdrawn'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const WITHDRAWAL_STATUSES = ['requested', 'approved', 'processing', 'paid', 'rejected'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const USER_STATUSES = ['pending', 'active', 'blocked', 'blacklisted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
