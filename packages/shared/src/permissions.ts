/**
 * Permission catalog. The API enforces these keys; the web app uses the same keys to show/hide UI.
 * New keys are added as each phase ships its module.
 */

/** Admin-scope permissions: granted to administrators through admin roles. */
export const PERMISSIONS = [
  { key: 'members.view', group: 'Members', label: 'View, search and export members' },
  { key: 'members.create', group: 'Members', label: 'Register new members' },
  { key: 'members.edit', group: 'Members', label: 'Edit member profiles' },
  { key: 'members.status', group: 'Members', label: 'Block, blacklist and allow members' },
  { key: 'members.security', group: 'Members', label: 'View and reset member security codes' },
  { key: 'members.bank', group: 'Members', label: 'View member bank details and KYC documents (revealing a full account number is audited)' },
  { key: 'vendors.view', group: 'Vendors', label: 'View vendors, their documents and listings' },
  { key: 'vendors.manage', group: 'Vendors', label: 'Create and edit vendors, suspend vendors, manage vendor roles' },
  { key: 'vendors.approve', group: 'Vendors', label: 'Approve or reject vendor KYC' },
  { key: 'catalog.view', group: 'Catalog', label: 'View all listings, including unpublished ones' },
  { key: 'catalog.manage', group: 'Catalog', label: 'Manage categories; create, edit and remove listings' },
  { key: 'catalog.approve', group: 'Catalog', label: 'Approve, reject and feature listings' },
  { key: 'settings.view', group: 'Settings', label: 'View website settings' },
  { key: 'settings.edit', group: 'Settings', label: 'Change website settings' },
  { key: 'maintenance.manage', group: 'Settings', label: 'Turn maintenance mode on or off' },
  { key: 'audit.view', group: 'Security', label: 'View the audit log' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as Permission[];

/** Vendor-scope permissions ("vendor rights"): granted to approved vendors through vendor roles. */
export const VENDOR_PERMISSIONS = [
  { key: 'vendor.listings.manage', group: 'Listings', label: 'Create and edit their own products, services and projects' },
  { key: 'vendor.listings.autopublish', group: 'Listings', label: 'Publish listings without admin approval' },
] as const;

export type VendorPermission = (typeof VENDOR_PERMISSIONS)[number]['key'];
export const VENDOR_PERMISSION_KEYS = VENDOR_PERMISSIONS.map((p) => p.key) as VendorPermission[];

export const ROLE_SCOPES = ['admin', 'vendor'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/**
 * Abilities only the Super Admin has. They are never assignable through roles,
 * so an admin can never grant themselves control over administrators.
 */
export const SUPER_ADMIN_ABILITIES = ['admins.manage', 'roles.manage'] as const;

/** Key of the seeded system role that grants every assignable admin permission. */
export const FULL_ADMIN_ROLE_KEY = 'admin_full';
/** Key of the seeded vendor role every approved vendor gets by default. */
export const STANDARD_VENDOR_ROLE_KEY = 'vendor_standard';
