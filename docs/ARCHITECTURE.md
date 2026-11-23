# JustReference.in — Architecture & Development Plan (MERN)

> Status: **Proposal for review.** Nothing below is implemented yet. The original brief specified ASP.NET Core + SQL Server; per your instruction this plan uses the **MERN stack** instead. Every functional requirement from the brief is carried over.
>
> Note: the brief refers to "attached project requirement images". None were attached to the conversation, so this plan is based on the written brief only. Send the images and I'll reconcile any differences.

---

## 1. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 LTS (installed: v24.13.0) | Current LTS |
| API | Express 5 + TypeScript | Native async error handling, typed models shared with client |
| Database | MongoDB 8 (installed: v8.2.4) + Mongoose 8 | **Must run as a replica set** (single-node is fine locally) — multi-document transactions are required for wallet/ledger safety |
| Validation | Zod (shared schemas between client and server) | One source of truth for form + API validation |
| Auth | JWT access token (15 min, memory) + rotating refresh token (httpOnly, Secure, SameSite cookie, hashed in DB) | Session revocation, device list, logout-everywhere |
| Passwords | argon2id | Current OWASP recommendation |
| Frontend | React 18 + Vite + React Router 7 | SPA for panels; public pages prerendered later if SEO requires (see §9) |
| Data fetching | TanStack Query | Caching, loading/error states, pagination |
| Forms | React Hook Form + Zod resolver | Validation with the same schemas as the API |
| Styling | Tailwind CSS with project design tokens + headless components (Radix UI) | Consistent design system, accessible dialogs/menus |
| Charts | Recharts | Dashboard charts |
| Icons | lucide-react | Clean, consistent icon set |
| Tables | TanStack Table | Server-side sort/filter/paginate, column visibility, export |
| Files | Multer → local disk in dev, S3-compatible storage in prod (adapter) | Type/size checking, randomized names, private bucket for KYC docs |
| PDF / Excel | pdfkit (invoices, reports) / exceljs | Server-side generation from real records |
| Jobs | Agenda (Mongo-backed scheduler) | Birthday greetings, coupon expiry, subscription expiry, notification retries — no Redis needed |
| Logging | pino with redaction (passwords, OTPs, tokens, bank/PAN/Aadhaar fields) | Brief forbids sensitive data in logs |
| Security | helmet, express-rate-limit, Zod parsing of every input, CORS allowlist, CSRF double-submit on cookie routes | See §7 (`express-mongo-sanitize` is incompatible with Express 5, so not used) |
| Testing | Vitest + Supertest + mongodb-memory-server (replset), Playwright for E2E | API and UI coverage |
| Deploy | Nginx (or IIS with iisnode/ARR reverse proxy if you must stay on IIS) + PM2, MongoDB Atlas or self-hosted replica set | |

### Pluggable providers (no hard-coding)
Each external integration sits behind an interface with a **console/sandbox driver** for development:

| Interface | Dev driver | Suggested production drivers |
|---|---|---|
| `PaymentGateway` | `mock` (signed fake webhook) | Razorpay, Cashfree, PayU, Stripe |
| `SmsProvider` / `OtpProvider` | `console` (logs "OTP sent" without the code) | MSG91, Twilio, Gupshup |
| `WhatsAppProvider` | `console` | Meta WhatsApp Cloud API, Gupshup, Interakt |
| `EmailProvider` | `smtp` → Mailpit locally | SMTP, Amazon SES, SendGrid, MS Graph |
| `StorageProvider` | `local` | S3, Cloudflare R2, Azure Blob |

Provider choice and credentials are stored in **Settings** (Super Admin → Integrations), secrets encrypted at rest (AES-256-GCM with a key from env), never returned to the browser in full.

---

## 2. Repository layout

```
justreference/
├─ apps/
│  ├─ api/                     Express + Mongoose
│  │  └─ src/
│  │     ├─ config/            env loading (zod-validated), db, logger
│  │     ├─ core/              errors, http helpers, pagination, audit, idempotency, money utils
│  │     ├─ middleware/        auth, rbac (requirePermission), rateLimit, upload, csrf
│  │     ├─ providers/         payment/, sms/, whatsapp/, email/, storage/  (interface + drivers)
│  │     ├─ modules/           one folder per bounded module (see below)
│  │     │   └─ <module>/  model.ts · service.ts · controller.ts · routes.ts · schema.ts · *.test.ts
│  │     ├─ jobs/              scheduled jobs (Agenda)
│  │     └─ seed/              roles, permissions, super admin, DEV-ONLY sample data (flagged)
│  └─ web/                     React + Vite
│     └─ src/
│        ├─ design-system/     tokens, Button, Input, Card, StatCard, DataTable, Modal, ConfirmDialog,
│        │                     Badge, EmptyState, Skeleton, Toast, Breadcrumbs, PageHeader, Tabs…
│        ├─ layouts/           PublicLayout (header/footer), PanelLayout (sidebar/topbar), AuthLayout
│        ├─ features/          mirrors API modules (auth, catalog, orders, wallet, referrals…)
│        ├─ panels/            superadmin/, admin/, vendor/, member/  (route trees + nav configs)
│        ├─ pages/public/      home, about, products, projects, services, vendors, directory…
│        └─ lib/               api client, auth context, permission hooks, formatters (₹, dates)
├─ packages/
│  └─ shared/                  zod schemas, enums (statuses), permission keys, types
└─ docs/                       this file, CHECKLIST.md, API collection (Postman/Bruno), runbooks
```

### Backend modules
`auth` · `users` · `rbac` · `members` · `vendors` · `admins` · `catalog` (categories, products, projects, services) · `bidding` · `cart` · `orders` · `payments` · `invoices` · `wallet` · `ledger` · `commissions` · `referrals` · `withdrawals` · `coupons` · `rewards` · `epins` · `subscriptions` · `messages` · `tickets` · `notifications` · `announcements` · `cms` (blog, pages, ads, testimonials) · `reports` · `settings` · `audit`

Each module exposes only its service to other modules; controllers never touch another module's models directly. Financial writes go through **one** place: `ledger.service.post()`.

---

## 3. Roles & access control (RBAC)

- Four **base roles**: `super_admin`, `admin`, `vendor`, `member`. A user can hold several (e.g. a vendor who is also a member and earns referral income).
- **Permissions** are string keys, e.g. `products.create`, `products.approve`, `wallet.payout.approve`, `epins.generate`, `settings.payment.edit`.
- **Custom roles** (brief §6 "Vendor Role Management") are named bundles of permissions created by Super Admin/Admin and assigned per user, e.g. "Vendor – Catalog only", "Admin – Finance".
- Super Admin implicitly has every permission and is the only role that can manage admins, integrations, commission rules and maintenance mode.
- Enforcement: `requirePermission('products.approve')` on every route + **ownership checks** in services (a vendor can only edit listings where `vendorId === req.user.vendorId`).
- UI uses the same keys (`<Can perm="…">`) to hide nav items and buttons — but the API is the authority.

---

## 4. Database design (MongoDB collections)

Conventions for every collection: `_id` ObjectId, `createdAt`/`updatedAt` (Mongoose timestamps), `status` where applicable, soft delete via `deletedAt` for business records, `createdBy`/`updatedBy` for admin-edited records. **All money is stored as integer paise** (`amountPaise`), never floats.

The brief listed ~40 SQL tables. In Mongo some are merged where that's the idiomatic design; the mapping is shown in the right column.

### 4.1 Identity & access
| Collection | Key fields | Indexes / constraints | Covers brief table |
|---|---|---|---|
| `users` | name, email, mobile, passwordHash, roles[], customRoleIds[], status (`active`/`blocked`/`blacklisted`/`pending`), emailVerifiedAt, mobileVerifiedAt, lastLoginAt, failedLoginCount, lockedUntil | unique(email), unique(mobile) (partial, ignores nulls) | Users, UserRoles |
| `roles` | key, name, permissions[], isSystem, scope (`admin`/`vendor`/`member`) | unique(key) | Roles, Permissions |
| `permissions` | key, module, description (seeded, read-only) | unique(key) | Permissions |
| `profiles` | userId, dob, addresses {residence, office, billing}, pan (encrypted), gstin, website, social {facebook, twitter, instagram, other[]}, avatarUrl, completionPct | unique(userId), index(dob month/day) for birthday job | UserProfiles |
| `members` | userId, memberId (e.g. `JR0000123`), referralCode, sponsorUserId, ancestorIds[], depth, joinedVia (`direct`/`referral`), subscription {planId, expiresAt} | unique(memberId), unique(referralCode), index(sponsorUserId), index(ancestorIds) | Members, Referrals |
| `vendors` | userId, businessName, slug, businessType, gstin, pan (enc), addresses, website, social, logo, kycStatus, approvalStatus, rating | unique(userId), unique(slug) | Vendors |
| `bankAccounts` | userId, holderName, accountNumber (encrypted + last4), ifsc, bankName, branchAddress, isPrimary, verifiedAt | index(userId) | BankAccounts |
| `documents` | userId, type (`aadhaar`/`pan`/`gst`/`other`/`project`), storageKey (private), mime, size, status (`pending`/`approved`/`rejected`), reviewedBy | index(userId, type) | Aadhaar/doc uploads |
| `sessions` | userId, refreshTokenHash, userAgent, ip, expiresAt, revokedAt | TTL(expiresAt), index(userId) | Session management |
| `otps` | target (email/mobile), purpose, codeHash, attempts, expiresAt | TTL(expiresAt) | OTP expiry |
| `securityCodes` | userId, type (`transaction_pin`/`wallet_password`), hash, updatedAt | unique(userId, type) | Members Security Codes, Wallet Password |

### 4.2 Catalog
| Collection | Key fields | Indexes | Covers |
|---|---|---|---|
| `categories` | kind (`product`/`project`/`service`), name, slug, parentId (null = category, set = subcategory), icon, sortOrder, isActive | unique(kind, slug), index(kind, parentId) | Product/Project/Service Categories + Subcategories (6 tables → 1) |
| `listings` | **Mongoose discriminator on `type`**: `product` / `project` / `service`. Common: vendorId, name, slug, categoryId, subcategoryId, description, images[], pricePaise, gstRatePct, status (`draft`/`pending_approval`/`published`/`rejected`/`archived`), availability, attributes{}, approvedBy, rejectionReason. **Product:** sku, stockQty, shippable. **Service:** pricingModel, deliveryTime. **Project:** costPaise, durationDays, paymentPlan {advancePaise, balancePaise, allowFullPayment}, documents[], specialInstructions, terms, biddingOpen | unique(type, slug), index(vendorId, type, status), index(categoryId), text index(name, description) | Products, Projects, Services, ProductImages, ServiceImages |
| `projectRequests` | memberId, title, categoryId, description, budgetPaise, timeline, documents[], status (`pending_approval`/`open`/`awarded`/`running`/`completed`/`cancelled`), awardedBidId | index(memberId, status) | Member "Create New Project" + bidding |
| `bids` | projectRequestId (or listingId), vendorId, amountPaise, proposal, estimatedDays, status (`submitted`/`accepted`/`rejected`/`withdrawn`) | unique(projectRequestId, vendorId), index(status) | ProjectBids |

### 4.3 Commerce
| Collection | Key fields | Covers |
|---|---|---|
| `carts` | userId, items[{listingId, qty, priceSnapshotPaise}], couponCode | Cart |
| `orders` | orderNo (`JR-ORD-2026-000123`), buyerUserId, vendorId (one order per vendor; multi-vendor cart splits), items[] (snapshot: name, type, qty, unitPricePaise, gstPaise), subtotal/discount/tax/totalPaise, couponId, paymentStatus, status (`pending`/`confirmed`/`processing`/`shipped`/`completed`/`cancelled`/`refunded`), statusHistory[{status, at, by, note}], shippingAddress, tracking {carrier, number, url}, milestones[] for projects (`advance`/`balance`/`full`, each with amount + paymentId) | Orders, OrderItems (embedded — items are always read with their order) |
| `payments` | paymentNo, orderId / walletTopupId, provider, providerOrderId, providerPaymentId, amountPaise, status (`created`/`authorized`/`captured`/`failed`/`refunded`), webhookVerifiedAt, rawEventIds[] | Payments |
| `refunds` | paymentId, orderId, amountPaise, reason, status, providerRefundId, approvedBy | Refund management |
| `invoices` | invoiceNo (sequential per financial year, gapless via `counters`), type (`sales`/`purchase`), orderId, seller/buyer snapshot (incl. GSTIN, state), lines[], cgst/sgst/igstPaise, totalPaise, pdfKey | Invoices, GST details |
| `counters` | key (`memberId`, `invoice:2026-27`, `order`), seq | Atomic ID generation |

### 4.4 Money: wallet, ledger, earnings
The core rule: **balances are never edited directly.** Every movement is an immutable ledger entry written inside a MongoDB transaction together with the wallet balance update.

| Collection | Key fields | Indexes | Covers |
|---|---|---|---|
| `wallets` | userId, type (`main`/`earnings`/`rewards` — final set per your rules), balancePaise, holdPaise, version, status | unique(userId, type) | Wallets |
| `ledgerEntries` | txnId (`TXN…`), walletId, userId, direction (`credit`/`debit`), amountPaise, balanceAfterPaise, category (`topup`/`purchase`/`commission`/`reward`/`transfer_in`/`transfer_out`/`withdrawal`/`refund`/`tds`/`adjustment`/`epin`), refType + refId, description, status (`pending`/`completed`/`reversed`), **idempotencyKey** | unique(idempotencyKey), index(userId, createdAt), index(refType, refId) | WalletTransactions, ReferralTransactions, Earnings (credit/debit/balance reports read from here) |
| `commissionRules` | name, trigger (`order_completed`/`subscription_activated`/`epin_used`/…), appliesTo {listingTypes[], categoryIds[]}, levels[{level, kind (`percent`/`flat`), value}], basis (`order_total`/`margin`/`fixed`), maxPayoutPaise, effectiveFrom/To, isActive, version | index(trigger, isActive) | Commission configuration (**no default values — set by Super Admin**) |
| `commissions` | sourceOrderId, earnerUserId, fromUserId, level, ruleId + ruleVersion, grossPaise, tdsPaise, netPaise, status (`pending`/`approved`/`paid`/`reversed`), ledgerEntryId | unique(sourceOrderId, earnerUserId, level), index(earnerUserId, status) | Commissions, Referral Income |
| `withdrawals` | requestNo, userId, amountPaise, feePaise, tdsPaise, bankAccountId (snapshot), status (`requested`/`approved`/`processing`/`paid`/`rejected`), utr, processedBy | index(status, createdAt) | Withdrawals, Bank Transfer Requests, Payout reports |
| `tdsRecords` | userId, pan (masked), financialYear, sourceType, grossPaise, tdsPaise, ratePct, ledgerEntryId | index(userId, financialYear) | TDS list / report |

### 4.5 Promotions & subscriptions
| Collection | Key fields | Covers |
|---|---|---|
| `coupons` | code, kind (`percent`/`flat`), value, minOrderPaise, maxDiscountPaise, appliesTo, validFrom/To, usageLimitTotal, usageLimitPerUser, usedCount, assignedUserIds[] (empty = public), status | Coupons (used/unused/expired derive from `couponRedemptions` + dates) |
| `couponRedemptions` | couponId, userId, orderId, discountPaise | unique(couponId, orderId) |
| `rewards` | userId, kind (`cash`/`coupon`/`other`), title, amountPaise, couponId, reason, status (`pending`/`paid`/`cancelled`), ledgerEntryId | Rewards, Bonus, Cash rewards |
| `subscriptionPlans` | name, kind (`yearly`/`time_based`/`lifetime`/`special`), durationDays (null = lifetime), pricePaise, benefits[], isActive | Subscription types |
| `subscriptions` | userId, planId, startAt, endAt, status, activatedVia (`payment`/`epin`), epinId | Subscriptions |
| `epins` | code (hashed + display suffix), planId, batchId, generatedBy, issuedToUserId, status (`fresh`/`issued`/`used`/`expired`/`blocked`), usedByUserId, usedAt | unique(code), index(status) — Fresh/Used/Search E-PIN |

### 4.6 Communication & content
| Collection | Covers |
|---|---|
| `conversations` + `messages` (sender, recipients, folder state per user: inbox/sent/draft, attachments) | Messages, SMS Inbox/Outbox/Draft (in-app) |
| `tickets` (ticketNo, userId, subject, category, priority, status `open`/`in_progress`/`resolved`/`closed`, assignee) + `ticketMessages` | SupportTickets, TicketMessages |
| `notifications` (userId, type, title, body, link, channels sent {inApp, email, sms, whatsapp}, readAt) + `notificationTemplates` (per event + channel, editable) | Notifications |
| `announcements` (audience: roles, title, body, pinned, publishAt) | Admin announcements |
| `feedback` (userId, orderId, rating, comment, status) | Customer feedback |
| `blogPosts`, `cmsPages` (about, privacy, terms, refund), `testimonials`, `advertisements` | Public content |
| `settings` (single doc per group: general, branding, payment, sms, email, whatsapp, referral, tds, withdrawal, maintenance) — secrets encrypted | Website settings, maintenance mode |
| `auditLogs` (actorId, action, entity, entityId, before/after diff with sensitive fields stripped, ip, userAgent) | AuditLogs |

### 4.7 Referral tree strategy
- Each member stores `sponsorUserId` (direct referrer) and `ancestorIds[]` (full upline, nearest first) plus `depth`.
- **Direct referrals:** `{sponsorUserId: X}`. **Indirect (all downline):** `{ancestorIds: X}` — one indexed query. **Level N:** `{"ancestorIds.N-1": X}`.
- Sponsor can't be changed after registration except by Super Admin through an audited "re-parent" action that rewrites descendants' paths in a transaction.
- Referral tree UI loads lazily one level at a time.

---

## 5. Critical flows

**Registration (member):** form → Zod validation → OTP to mobile (WhatsApp or SMS per settings) and/or email → verify → create `user` + `member` (memberId and referralCode from `counters`) + `profile` + wallets, in one transaction → if referral code given, resolve sponsor, set `ancestorIds` → notify sponsor.

**Checkout & payment:** cart → server re-prices everything (never trusts client prices) → applies coupon → creates `orders` (status `pending`) + `payments` (`created`) → client opens gateway → **only the verified webhook / server-side signature check** moves payment to `captured` and order to `confirmed` → invoice generated → on order `completed`, commission engine runs.

**Commission engine:** on trigger event → load active `commissionRules` matching the order → walk `ancestorIds` up to the configured levels → create `commissions` rows (unique per order/earner/level, so re-running is safe) → post ledger credits (with TDS deduction if configured) in one transaction. If an order is later refunded, matching commissions are reversed with compensating ledger entries.

**Wallet transfer / withdrawal:** requires wallet password → idempotency key from client → transaction: check balance ≥ amount (+ fee), debit sender / place hold, credit receiver or create withdrawal request → admin approves payout → UTR recorded → hold released as final debit.

**Listing approval:** vendor creates listing → `pending_approval` (unless vendor has `listings.autopublish`) → admin approves/rejects with reason → vendor notified.

---

## 6. API surface (REST, `/api/v1`)

Consistent envelope `{ data, meta: { page, pageSize, total } }` / `{ error: { code, message, fields } }`. List endpoints accept `?q=&page=&pageSize=&sort=&from=&to=&status=`; reports accept `?format=json|pdf|xlsx`.

```
/auth            register, verify-otp, login, refresh, logout, forgot-password, reset-password, change-password
/me              profile, documents, bank-accounts, security-codes, sessions
/catalog         categories (CRUD by kind), listings (public browse/search), /vendor/listings (own CRUD), /admin/listings (approve)
/projects        requests, bids (submit/accept/reject)
/cart, /checkout, /orders (buyer | vendor | admin views), /payments/webhook/:provider, /refunds, /invoices/:id/pdf
/wallet          balance, ledger, topup, transfer, withdrawals
/referrals       link, direct, downline, tree/:userId, business
/earnings        commissions, summary, tds
/coupons, /rewards, /epins, /subscriptions
/messages, /tickets, /notifications, /announcements
/admin           members (search, block/blacklist/allow, date-wise), vendors, admins, roles, reports/*, settings/*, maintenance, audit
/public          home feed, vendors, directory, blog, cms pages, contact
```

An API collection (Postman-compatible) will be kept in `docs/api/`.

---

## 7. Security checklist (built in from Phase 1)

- argon2id password hashing; password policy; breached-password check optional
- Login rate limiting per IP + per account, progressive lockout, generic error messages
- OTPs: 6 digits, hashed, 5-minute expiry (configurable), max 5 attempts, resend cooldown
- Short-lived JWT + rotating refresh token with reuse detection → revokes the session family
- RBAC + ownership checks on every route; admin routes additionally require recent re-auth for financial actions
- Zod validation on every input (body, query and params are parsed into plain strings/numbers, so `{ $gt: … }` objects never reach a query); Mongoose `strictQuery`
- XSS: React escaping + DOMPurify for any rich text (blog, listing descriptions) + strict CSP via helmet
- CSRF: refresh/logout endpoints (cookie-based) protected with SameSite=Strict + double-submit token
- Uploads: MIME sniffing (not just extension), size limits, image re-encoding with sharp, private storage + signed URLs for KYC documents
- Field-level encryption for PAN, Aadhaar number, bank account number; masked everywhere in UI except to authorised roles
- pino redaction list for secrets/PII; audit log for every admin and financial action
- Financial integrity: Mongo transactions, idempotency keys, optimistic `version` on wallets, integer paise, daily reconciliation job (sum of ledger == wallet balance) that alerts on drift
- Payment: webhook signature verification, amount/currency re-check against our order, replay protection via stored event IDs
- Maintenance mode: middleware returns 503 for non-admin users; admins can still log in

---

## 8. Development plan

Phases follow the brief, adjusted so each phase ends with something testable end-to-end.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · UI foundation** *(the brief's "first task")* | Design system, public layout (header/footer), homepage, product/project/service listing pages, login/registration/forgot password, panel layout with responsive sidebar, Super Admin / Admin / Vendor / Member dashboards | All pages navigable and responsive; data shown is **clearly labelled sample data** until Phase 1–3 wire it up |
| **1 · Platform core** | Monorepo setup, env/config, Mongo replica set, auth (email/mobile + OTP via console driver), RBAC, Super Admin + Admin panels (admin CRUD, roles, member management, settings, maintenance, audit log) | Real login per role; permissions enforced by API tests |
| **2 · Vendors & catalog** | Vendor registration/profile/KYC, categories, products/projects/services CRUD + images + approval workflow, public browse/search wired to API | Vendor lists a product → admin approves → it appears publicly |
| **3 · Members & referrals** | Registration with referral, member/referral ID generation, profile + documents + bank, referral link/share/tree, member dashboard, birthday job | Referral chains tracked correctly (tested to depth N) |
| **4 · Commerce** | Cart, checkout, orders (3 views), payment gateway adapter (sandbox), webhooks, invoices (GST PDF), refunds, project requests + bidding | Sandbox payment completes order only via webhook |
| **5 · Money** | Wallet, ledger, top-up, transfer, withdrawals/payouts, commission engine + rules UI, TDS, coupons, rewards, E-PINs, subscriptions | Reconciliation test passes; duplicate requests don't double-post |
| **6 · Comms, reports, hardening** | Messaging, tickets, notifications (email/SMS/WhatsApp templates), all reports with PDF/Excel/print, security review, load test, deployment runbook | Checklist fully green |

`docs/CHECKLIST.md` will track every feature as **Pending / In progress / Built / Tested**, and a feature only moves to "Tested" with an automated test or a recorded manual test.

---

## 9. Decisions I need from you (business rules I won't invent)

These are left configurable in code, but someone must decide the values before launch:

1. **Commission structure** — how many referral levels, percentages/flat amounts per level, and what triggers a commission (product sale, service, project, subscription purchase?).
2. **TDS** — rate(s) and threshold to apply on commissions/rewards, and whether PAN-less members get the higher rate.
3. **Withdrawals** — minimum amount, fees, processing schedule, KYC required before first payout?
4. **E-PIN** — what an E-PIN activates (a subscription plan?), who can buy/transfer them, expiry.
5. **Subscriptions** — plan names, prices, durations, and what a subscription unlocks.
6. **Refunds** — window and who bears the commission reversal.
7. **"Investment Income"** (admin feature #20) — what this means for the business.
8. **Providers** — preferred payment gateway (Razorpay is the usual choice for INR), SMS, WhatsApp and email providers.
9. **SEO** — do public pages need server-side rendering (Next.js) for search ranking? Plain Vite SPA is simpler; SSR is better for SEO.

### Regulatory flags (please get legal/CA advice before launch)
- **Multi-level referral payouts:** India's Consumer Protection (Direct Selling) Rules 2021 and the Prize Chits and Money Circulation Schemes (Banning) Act 1978 restrict schemes where income comes from recruiting rather than actual sales. Commissions should be tied to genuine product/service sales; earning purely from sign-ups or E-PIN sales is high-risk.
- **Wallet:** a wallet that only pays for purchases on this platform is a closed-system wallet. Member-to-member transfers and cash-out to bank generally make it a semi-closed prepaid instrument, which requires RBI authorisation. Restricting withdrawals to *earned commissions* (not topped-up money) is a common safer design.
- **"Investment income"** offerings may fall under deposit/collective-investment regulation (BUDS Act 2019 / SEBI).
- **Aadhaar:** store only what's legally permitted; prefer masked Aadhaar and avoid storing full numbers.
