# JustReference.in — Development Checklist

Legend
- ✅ **Done & tested**: works end-to-end against the real API/database, covered by automated tests.
- 🎨 **UI built**: screen exists and was manually tested in the browser, but uses **sample data** or has no backend yet. *Not complete.*
- 🛠 **In progress**
- ⬜ **Pending**

> **Status, 23 Nov 2026:** Phases 1 (platform core) and 2 (vendors & catalog) are done. ✅ items run against the real API and MongoDB and are covered by automated tests: 47 API tests and 4 browser (Playwright) smoke tests. Everything still marked 🎨 uses sample data.

---

## Phase 0: UI foundation

| Item | Status | Notes / how it was tested |
|---|---|---|
| Monorepo (npm workspaces), Vite + React 19 + TypeScript + Tailwind 4 | 🎨 | `npm run typecheck` and `npm run build` pass |
| Shared package `@jr/shared` (Zod schemas, enums, paise money helpers) | 🎨 | Used by the auth forms; the API will reuse it |
| Design system: Button, Badge/StatusBadge, Card, IconTile, Field/Input/Password/Select/Textarea/Checkbox, Alert, Spinner, Skeleton, EmptyState, ErrorState, Modal, ConfirmDialog, PageHeader + Breadcrumbs, StatCard, DataTable (search/sort/paginate/CSV), Segmented, Avatar, Logo | 🎨 | Exercised across all screens below |
| Public header (desktop nav + mobile drawer) and footer | 🎨 | Checked at desktop width and 375 px |
| Homepage (hero search, categories, featured projects/vendors, how it works, referral explainer, benefits, testimonials, blog, CTA) | 🎨 | Featured listings and vendors are **real** since Phase 2. Testimonials and blog are still sample content (Phase 6) |
| Products / Services / Projects listing pages | ✅ | Search, category, location, price range, verified-only, sort and pagination all go through the URL. Tested filters, sorting, empty state and loading skeletons |
| Login (email or mobile) | ✅ | Wired to the API in Phase 1 (see below) |
| Registration (member/vendor, referral ID from `?ref=`, password strength, terms) and WhatsApp OTP step | ✅ | Wired to the API in Phase 1 |
| Forgot password | ✅ | Wired to the API in Phase 1 (request code → reset with code) |
| Panel layout: responsive sidebar with groups/sub-menus, mobile drawer, top bar, account menu | 🎨 | Tested desktop and mobile drawer. Active states and breadcrumbs work |
| Sidebar navigation for all four roles, mapped to every module in the brief | 🎨 | Screens that aren't built say which phase delivers them; no fake forms |
| Member dashboard | 🎨 | Name, member ID, referral ID and referral link are **real** (Phase 1). Metrics, chart, notifications and transactions are still sample data until Phases 3–5 |
| Vendor dashboard | 🎨 | Business status and listing counts are **real** (Phase 2). Orders, sales, earnings and payouts are sample data until Phases 4–5 |
| Admin dashboard | 🎨 | Every metric in the brief, revenue and user-growth charts, pending actions, recent registrations/transactions/orders |
| Super Admin dashboard | 🎨 | Overview, launch-readiness checklist, admin table with a working confirm dialog (preview only, nothing saved), audit feed |
| Code-split routes (charts load only in panels) | 🎨 | Main bundle 163 kB gzipped |
| No horizontal overflow at 375 px | 🎨 | Checked home, listings, register and all four dashboards |

**Known Phase 0 gaps:** no automated UI tests yet (see the Phase 1 notes). Public pages About, Vendors, Directory, Referral, How it works, Contact, Blog and the legal pages show "coming in Phase N". Listing detail pages are pending.

---

## Phase 1: Platform core

| Item | Status | Notes / how it was tested |
|---|---|---|
| Express 5 API scaffold, env validation (refuses to start when misconfigured), JSON error envelope, 404 handler | ✅ | API tests |
| Logging: pino with redaction of passwords, OTPs, tokens, PAN/Aadhaar/bank fields; request logs record method, path and status only | ✅ | Reviewed; no request bodies or query strings are logged |
| MongoDB replica set: `npm run db -w @jr/api` (port 27117, data in `apps/api/.data`); tests use an in-memory replica set with the installed mongod | ✅ | All money and identity writes run in transactions |
| Models: users, members (IDs + referral upline), profiles, roles, sessions, OTPs, security codes, audit logs, settings, counters, dev outbox | ✅ |  |
| Registration → OTP (WhatsApp/SMS per settings) → verify → member ID + referral code + sponsor/upline, in one transaction | ✅ | API tests + browser (new member JR0000025 linked to sponsor JR0000001) |
| Re-submitting sign-up during the 30 s resend cooldown reuses the code already sent | ✅ | Bug found and fixed during testing |
| Login with email or mobile; identical error for unknown user or wrong password; timing-equalised | ✅ | API tests |
| Account lockout: 5 failed logins → 15 min; unverified users sent to verification; blocked/blacklisted refused | ✅ | API tests |
| Sessions: 15-min JWT in memory + rotating httpOnly refresh cookie; replaying an old refresh token revokes the session; CSRF double-submit on cookie routes | ✅ | API tests |
| Every request re-checks user status and session, so blocking/deactivating takes effect immediately | ✅ | API tests |
| Session restore survives an API restart (client retries transient failures) | ✅ | Bug found in browser testing and fixed; re-tested by stopping and restarting the API |
| Forgot/reset password with a code (same response whether or not the account exists); reset signs out all sessions | ✅ | API tests + browser |
| Change password (signs out other devices); forced change for temporary passwords | ✅ | API tests + browser |
| Signed-in devices list, sign out one device, sign out all others | ✅ | API tests + browser |
| Transaction PIN set/change (needs account password; rejects weak PINs) | ✅ | API tests. Used by the wallet in Phase 5 |
| Rate limits per IP on login, OTP and recovery endpoints; helmet security headers; CORS allowlist; 100 kB body limit | ✅ | Disabled only in tests; config refuses to disable them in production |
| RBAC: permission catalog, custom roles, `requirePermission` on every admin route, Super-Admin-only abilities that roles can’t grant | ✅ | API tests |
| UI: route guards per panel, permission-filtered sidebar, `<Can>`, post-login redirect only to panels the user can open | ✅ | Browser |
| Super Admin: administrators list/create/edit/roles/deactivate/reactivate/temporary password | ✅ | API tests + browser |
| Super Admin: roles & permissions (create/edit/delete; system role locked; in-use roles can’t be deleted) | ✅ | API tests |
| Website settings (general + sign-up/OTP) and maintenance mode (admins keep working; visitors and members see the maintenance page) | ✅ | API tests + browser |
| Audit log (append-only) with search, area and date filters | ✅ | API tests + browser |
| Admin: members list with search (name/email/mobile/member ID/referral ID), status, date range, PIN filter, sort, pagination | ✅ | API tests + browser |
| Admin: member CSV export (formula-injection safe, audited) | ✅ | API tests |
| Admin: new registration with temporary password and optional sponsor | ✅ | API tests |
| Admin: member detail/edit profile (DOB, addresses), block / blacklist (reason required) / allow, reset transaction PIN, sign out member | ✅ | API tests + browser |
| Admin menu items: all members, date-wise list, edit profile, security codes, blacklist, allow, blocked list, filter | ✅ | Presets of one members screen |
| Dev outbox (`/dev/outbox`) shows OTPs while no SMS/WhatsApp provider is connected; returns 404 outside development | ✅ | Browser |
| Dev-only "preview dashboards without signing in" shortcuts removed | ✅ |  |
| Production builds: web (Vite) and API (tsup bundle) | ✅ | `npm run build -w @jr/web`, `npm run build -w @jr/api` |

**Not done in Phase 1, and why:**
- **Automated browser (Playwright) tests:** not added yet; the browser flows were tested by hand. Planned alongside Phase 2.
- **Real SMS / WhatsApp / email delivery:** Phase 6 (provider choice is still open). Codes go to the dev outbox for now.
- **Vendor business profile and approval:** vendors can register and log in, but the vendor panel’s data is Phase 2.
- **Profile fields needing encryption (PAN, Aadhaar, bank):** Phase 3. The encryption helper (AES-256-GCM) is already in the API.
- **Mocks still in use:** catalog listings (Phase 2) and dashboard metrics (Phases 3–5). Each screen shows a "Sample data" badge.

**Bugs found and fixed during Phase 1 testing:**
1. Mongoose `sanitizeFilter` stripped the API’s own query operators, so every session check failed. Removed it; input safety comes from Zod parsing every request.
2. Re-registering within the 30 s OTP cooldown left a pending account with no way to verify it.
3. The six-box OTP input dropped digits when typed quickly or autofilled. Replaced with a single field.
4. Reloading during an API restart logged the user out.
5. After logout, the next user to log in could be redirected to the previous user’s page (or one they can’t access).
6. The Super Admin appeared in the administrators list with actions the API rejects.
7. Phase 0 layout bug: header links wrapped between 1024 and 1280 px.

## Phase 2: Vendors & catalog

| Item | Status | Notes / how it was tested |
|---|---|---|
| Vendor sign-up (public form) → OTP → business profile + member/referral IDs + "Standard vendor" rights | ✅ | API tests + browser |
| Business profile: name, type, category, description, office/residence address, city/state/PIN, PAN (AES-256-GCM encrypted, shown masked as AB••••••4F), GSTIN, website, social links, logo | ✅ | API tests + browser |
| Bank account: account number encrypted, only the last 4 digits ever returned; IFSC/PAN/GSTIN/PIN format validation | ✅ | API tests + browser |
| KYC documents (PDF/JPG/PNG, 8 MB): type sniffed from file bytes, images re-encoded, stored privately; served only to the owner and admins with `vendors.view`, with sandboxing headers; every admin view is audited | ✅ | API tests |
| Onboarding checklist and submit for approval (blocked until profile, bank and required documents are complete) | ✅ | API tests + browser |
| Admin: vendor list (search by business/owner/email/mobile/city/GSTIN, status filter), KYC review queue, approve / request changes (reason required) | ✅ | API tests + browser |
| Admin: create vendor (temporary password), edit vendor profile, suspend / reinstate (listings hidden immediately), temporary password | ✅ | API tests |
| Vendor role management ("vendor rights"): create/edit/delete vendor roles, assign/remove per vendor, auto-publish right; roles can’t carry admin permissions | ✅ | API tests |
| Changing business name, PAN or GSTIN on an approved vendor sends it back for re-verification and hides its listings | ✅ | Implemented; covered indirectly |
| Categories & subcategories for products, services and projects: add, rename, reorder, hide, remove (blocked while in use) | ✅ | API tests + browser |
| Default category set created on first seed (editable) | ✅ |  |
| Listings: products (SKU, availability, stock, unit), services (turnaround, remote), projects (cost, duration, advance, balance, full-payment option, special instructions, terms, documents); attributes; GST rate | ✅ | API tests + browser |
| Listing photos: up to 8, re-encoded to WebP (EXIF stripped), cover selection, removal; project documents up to 5 | ✅ | API tests + browser |
| Approval workflow: draft → submit → approve / send back with reason → published; vendors’ edits to live listings go back for review; archive, restore, delete (not while live) | ✅ | API tests + browser |
| Admin: listings by type with status/vendor filters, approvals queue, approve/reject, feature on homepage, archive, delete, create on behalf of a vendor | ✅ | API tests + browser |
| Public: product/service/project search (text, category, subcategory, city, price range, sort, pagination), category counts | ✅ | API tests + browser + Playwright |
| Public: listing detail (gallery, specs, project payment plan, document downloads, vendor card, more from vendor) | ✅ | Browser + Playwright |
| Public: vendors page, vendor profile (KYC-verified badge, listings by type), business directory (A–Z, category, city) | ✅ | API tests + browser |
| Only published listings of approved vendors are ever public | ✅ | API tests |
| Sample catalog (10 vendors, 21 listings) moved from front-end mocks into the database, flagged `isSample` and labelled "Sample" in the UI | ✅ | seed:demo |
| Playwright smoke tests (Edge): catalog browse/filter/detail, member sign-up with OTP, Super Admin pages, login redirect | ✅ | `npm run test:e2e` |

**Not done in Phase 2, and why:**
- **Members adding products** ("Add new product, permission-based" in the member menu): needs a business decision. Today only vendors can list. Should members be able to sell without becoming vendors?
- **Ratings & reviews:** come with orders (Phase 4) so only real buyers can review. The Phase 0 sample star ratings were removed rather than shown as fake numbers.
- **Ordering, cart, "Request this project":** Phase 4. Buttons are visible but disabled with an explanation.
- **Bidding on projects:** Phase 4.
- **Cloud file storage (S3/R2/Azure):** files are stored on local disk behind a storage interface; a cloud driver is needed before running more than one server.
- **Image CDN / thumbnails:** photos are resized to max 1600 px but no separate thumbnails yet.

**Bugs found and fixed during Phase 2 testing:**
1. Prices were multiplied by 100 when saving a listing from the editor (rupees converted to paise in the browser *and* the API). Found in the browser, fixed, and the listing corrected.
2. Every fresh page load opened scrolled down (React Router shares the scroll key "default" across initial loads). Present since Phase 0; fixed for all layouts.
3. The masked PAN revealed 5 of 10 characters; now 4 (AB••••••4F).
4. Signed-in visitors on phones got a sideways-scrolling public header ("My dashboard" button). Fixed.
5. If a pop-up blocker stopped a private document opening in a new tab, the app navigated away to the file. It now downloads instead.

## Phase 3: Members & referrals

| Item | Status | Notes / how it was tested |
|---|---|---|
| Member ID / referral code generation, sponsor + ancestor path (built in Phase 1, now used for direct/indirect queries) | ✅ | API tests |
| My profile: name, DOB, residence/office/billing address, PAN (encrypted, shown masked), GSTIN, Aadhaar **last 4 only**, website, social links, photo | ✅ | API tests + browser |
| Bank account for payouts (encrypted, last 4 shown) and KYC documents (Aadhaar masked copy, PAN card, address proof) with admin approve/reject | ✅ | API tests + browser |
| Profile completion indicator (8 items) on the profile page and member dashboard | ✅ | Browser: 13% → 50% after saving DOB and addresses |
| Referral link: copy, share (native share / WhatsApp) | ✅ | Browser |
| All / direct / indirect referral lists with search and level filter; direct referrals show a masked mobile, others name + member ID only | ✅ | API tests + browser |
| Referral tree, one level at a time, drill-down with a path back up; can’t open anyone outside your own network | ✅ | API tests + browser (desktop and 375 px) |
| Create new referral (invite by WhatsApp / SMS / email, 20 a day, no repeats within 7 days, already-member check); invitation marked "joined" when the person signs up | ✅ | API tests + browser |
| Birthday greetings and sponsor reminders: daily job after 9:00 IST, once per member per year, safe to run on several servers, 29 Feb handled; on/off and channel in Settings → Birthdays | ✅ | API tests + browser (settings) |
| Upcoming birthdays in your network (next 30 days) on the dashboard | ✅ | Browser |
| Admin: member bank details list (members only, masked) with audited reveal (needs `members.bank`), auto-hides after 30 s | ✅ | API tests + browser |
| Admin: direct referral view for any member (by member ID), tree + list | ✅ | API tests + browser |
| Admin: KYC & bank card on member detail (documents, approve/reject, audited downloads) | ✅ | API tests + browser |
| Vendors get the same referral pages and a personal profile page in the vendor panel | ✅ | Typecheck; same components as members |
| Member dashboard wired to real data: referral counts, completion, birthdays | ✅ | Browser. Wallet, earnings, orders, notifications stay **sample data** (labelled) until Phases 4–6 |
| Dev demo login: `npm run seed:demo` sets a password on the root sample member `aarav.sharma@example.test` (from `SEED_DEMO_MEMBER_PASSWORD` in `apps/api/.env`) and gives some sample members upcoming birthdays | ✅ | seed:demo |

**Not done in Phase 3, and why:**
- **Real WhatsApp/SMS/email delivery:** invitations and birthday messages go to the dev outbox (`/dev/outbox`) until providers are connected in Phase 6.
- **Full Aadhaar number:** deliberately never stored (only last 4 + a masked copy), to stay clear of UIDAI storage rules.
- **Members adding products without becoming vendors:** still needs your decision (see Phase 2).
- **Referral earnings/levels payouts:** Phase 5, and the commission rules need your input.

**Bugs found and fixed during Phase 3 testing:**
1. The referral tree scrolled sideways on phones (fixed-width counters). Fixed.
2. The admin bank list included vendors’ payout accounts, whose "member" links led to "Member not found". It now lists member accounts only (vendor accounts stay under Vendors); test added.
3. Profile completion appeared twice on the profile page. Now shown once until complete.

## Phase 4: Commerce

| Item | Status | Notes / how it was tested |
|---|---|---|
| Cart and checkout: re-priced on the server, one order per vendor and type (each project separately), double-submit safe, stock reserved without overselling | ✅ | API tests + Playwright |
| Unpaid orders expire (configurable) and stock is released | ✅ | API tests |
| Payment gateway interface + **sandbox** driver; an order is confirmed only by a signed notification with the right amount; duplicate and late payments are flagged for refund | ✅ sandbox only | API tests + Playwright. **No real gateway is connected** |
| Orders: buyer, vendor and admin views, filters, statuses, shipping/tracking, completion, history | ✅ | API tests + Playwright |
| Cancellation: unpaid at once; paid = request that the vendor or an admin decides | ✅ | API tests |
| Refunds: full/partial, never more than paid, retry-safe, admin-decided amount, credit notes | ✅ sandbox only | API tests + Playwright |
| GST invoices: per-seller financial-year numbering, CGST/SGST or IGST, PDF, purchase/sales lists, monthly GST summary, billing history | ✅ | API tests + Playwright + PDF checked by eye |
| Projects: advance + balance payments, running/completed/cancelled lists | ✅ | API tests + Playwright |
| Bidding: post → admin approval (configurable) → sealed vendor bids → accept/reject → order; admin monitor | ✅ | API tests + Playwright |
| Vendor order summary, customers; order rules in Super Admin → Payment gateway | ✅ | Playwright (page loads); settings save not tested in a browser |
| Order figures on member, vendor and admin dashboards | ✅ | Loaded in Playwright. Wallet, earnings and charts stay sample data |
| All commerce screens at 375 px | ✅ | Playwright |

**Not done in Phase 4, and why:**
- **Live payment gateway:** needs your choice of provider and keys. Payments are off by default (`PAYMENT_DRIVER=none`); sandbox must be switched on explicitly.
- **Coupons at checkout:** moved to Phase 5, where coupons are built.
- **Member sales:** the menu pages explain that selling needs a vendor account until you decide otherwise.
- **Delivery charges, returns/exchanges, cash on delivery:** no rules given.
- **Ratings and reviews:** moved to Phase 6 with customer feedback.
- **Order notifications by SMS/WhatsApp/email:** Phase 6.

**Assumptions to confirm (ideally with your accountant):** GST is added on top of the listed price and only for sellers with a GSTIN; an invoice is issued when the order is fully paid (nothing is issued for a project advance alone); the platform issues invoices on the seller's behalf.

**Bugs found and fixed during Phase 4 testing:**
1. The gateway webhook asked for a login: `/payments/:id/sandbox` also matched `/payments/webhook/sandbox`. The simulator route was renamed.

## Phase 5: Money

Everything that moves money is **off by default**; a Super Admin sets the values in *Commission & money rules*.

| Item | Status | Notes / how it was tested |
|---|---|---|
| Wallets (main + earnings) with an append-only ledger, transaction IDs, idempotent requests, no overdraft under concurrency; sandbox money kept in separate wallets | ✅ | API tests + Playwright |
| Top-up, member transfer (recipient check), earnings → main, pay orders/subscriptions from the wallet, refunds back to the wallet | ✅ sandbox only | API tests + Playwright |
| Wallet password (the transaction PIN), locked for 15 minutes after five wrong tries | ✅ | API tests + Playwright |
| Withdrawals: earnings only, bank + KYC check, approve / reject / paid with a unique UTR, nobody can process their own | ✅ | API tests; screens load in Playwright |
| Commission rules: levels, percent/flat, listing types, basis, cap, dates, versions; inactive until activated; no overlaps | ✅ | API tests + Playwright (create) |
| Commissions on completed sales only, waiting period, manual payment, TDS, proportional reversal on refund | ✅ | API tests |
| Vendor settlement less platform fee, with reversal on refund | ✅ | API tests |
| TDS records and lists (member, admin) | ✅ | API tests; screens load in Playwright |
| Coupons: percent/flat, limits, expiry, assigned members, platform- or vendor-funded, applied in the cart before GST | ✅ | API tests + Playwright |
| Cash and other rewards | ✅ | API tests + Playwright |
| Subscription plans, purchase, E-PINs (generate, issue, fresh/used/search, block, redeem; members buying from the wallet) | ✅ | API tests + Playwright |
| Member business/earnings/account reports, vendor earnings, CSV export of transactions | ✅ | API tests; screens load in Playwright |
| Daily ledger reconciliation + run now | ✅ | API tests + Playwright |
| Dashboards: wallet, earnings, transactions and withdrawals are real | ✅ | Loaded in Playwright |
| All money screens at 375 px | ✅ | Playwright |

**Not done in Phase 5, and why:**
- **Live gateway and automatic bank payouts:** need a provider. Admins transfer by hand and record the UTR.
- **Investment income:** undefined in the brief and possibly regulated (SEBI/RBI/BUDS Act). The page says so.
- **Commissions on sign-ups, subscriptions or E-PINs:** deliberately not built; income from recruiting can be illegal (see ARCHITECTURE §9).
- **What a subscription unlocks:** not decided; benefits are text only. No GST invoice is issued for subscriptions.
- **PDF/Excel exports:** Phase 6 reports. Transactions export as CSV today.

**To confirm with a CA / lawyer before switching on:** TDS sections, rates, threshold treatment and reversals; GST/TCS on marketplace settlements; platform-funded coupons; RBI rules for wallets with transfers; direct-selling rules for multi-level commissions.

**Assumptions to confirm:** several levels pay from one sale up to the sale amount; a blocked member's share is not passed up; a coupon is freed only if the order was never paid; an E-PIN can be used by whoever holds the code; a new subscription starts when the current one ends.

## Phase 6: Communication, reports, hardening

| Item | Status | Notes / how it was tested |
|---|---|---|
| Messages: inbox, outbox, drafts, replies, attachments; member/vendor ↔ team, admin ↔ admin | ✅ | API tests + Playwright |
| Support tickets: number, category, attachments, statuses, replies, history; contact form creates one | ✅ | API tests + Playwright (contact form: API tests) |
| In-app notifications for registration, orders, payments, referrals, commissions, wallet, support, messages, bids and approvals; unread counts | ✅ | API tests + Playwright |
| Email / SMS / WhatsApp: per-event switches, template, channel status, test button | ✅ settings | API tests with the console driver. **No real provider has been tried** |
| Announcements, advertisements, pages, blog, testimonials | ✅ | API tests + Playwright (announcements, blog) |
| Reviews of completed orders, moderated, shown on vendor profiles | ✅ | API tests + Playwright |
| 12 reports with dates, search, sort, totals, PDF, Excel, CSV, print | ✅ | API tests + Playwright downloads; print not tested |
| Search in every panel, limited by role and permission | ✅ | API tests + Playwright |
| Dashboards, analytics, system health on real data; all mocks removed | ✅ | Playwright |
| Password re-entry for money actions | ✅ | API tests + Playwright |
| Security review, deployment runbook | ✅ | [SECURITY.md](SECURITY.md), [DEPLOYMENT.md](DEPLOYMENT.md). Self-review, not an independent test |
| Load test | ✅ local only | One process on the development PC, see below |
| Every menu link in all four panels opens a real screen and fits 375 px | ✅ | Playwright |

**Load test (development PC, 50 parallel clients, local database):** product search 365 requests/s (median 114 ms, p99 356 ms), home page 1,491/s (p99 63 ms), health 6,003/s; no errors. Render's free plan will be far slower. The per-IP limit (300/min) answered 429 as designed.

**Not done, and why:**
- **Live payment gateway, SMS, WhatsApp, email, cloud storage:** need your accounts and keys. Steps are in DEPLOYMENT.md.
- **Privacy policy, terms, refund policy:** text must come from your legal adviser; the pages say they aren't published yet.
- **Investment income, member selling, what subscriptions unlock:** business decisions.
- **MS Graph, IIS, SQL Server, ASP.NET:** replaced by the MERN stack you asked for. **SSR for SEO:** not built.
- **Notification retries:** a failed outside message is logged, not retried.
- **Non-English names in PDFs** print as "?" (the built-in PDF fonts cover Latin letters only).

**Bugs found and fixed during Phase 6 testing:**
1. The referral tree still scrolled sideways on phones with longer names. The Phase 3 fix was incomplete, and that checklist entry was wrong.
2. The public header was 5 px too wide on phones for visitors who aren't signed in.
3. `sharp` (image processing) had high-severity vulnerabilities; upgraded.
4. The architecture promised password re-entry for financial actions, but it had never been built.
