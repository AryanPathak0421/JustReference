# API reference (v1)

Base URL: `/api/v1`. JSON in and out. Errors always look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Please correct the highlighted fields", "fields": { "mobile": "Enter a valid 10-digit Indian mobile number" } } }
```

**Auth:** send `Authorization: Bearer <accessToken>` (valid for 15 minutes). The refresh token is an httpOnly cookie (`jr_rt`, path `/api/v1/auth`). Cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) also need the header `x-csrf-token` set to the value of the `jr_csrf` cookie.

List endpoints accept `page` (default 1) and `pageSize` (default 20, max 100) and return `{ data, meta: { page, pageSize, total } }`.

## Public
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/public/status` | Site name, support contacts, social links, maintenance flag + message |
| GET / DELETE | `/dev/outbox` | **Development only** (404 otherwise): messages from the console messaging driver |

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `accountType, name, email, mobile, password, confirmPassword, referralCode?, businessName?, acceptTerms` | 201 → `{ userId, otp: { channel, target (masked), expiresInSec, resendInSec } }` |
| POST | `/auth/register/resend` | `userId` | 429 `OTP_COOLDOWN` with `details.retryAfterSec` |
| POST | `/auth/register/verify` | `userId, code` | 201 → `{ accessToken, user }` and sets cookies |
| POST | `/auth/login` | `identifier (email or mobile), password, remember?` | 401 `INVALID_CREDENTIALS`, 429 `ACCOUNT_LOCKED`, 403 `VERIFICATION_REQUIRED` (`details.userId`, `details.otp`), 403 `ACCOUNT_BLOCKED` |
| POST | `/auth/refresh` | (cookie + CSRF header) | Rotates the refresh token. Replaying an old one → 401 `SESSION_REVOKED` |
| POST | `/auth/logout` | (cookie + CSRF header) | 204 |
| GET | `/auth/me` | | `{ user }` |
| POST | `/auth/forgot-password` | `identifier` | Always 200 with the same body |
| POST | `/auth/reset-password` | `identifier, code, password, confirmPassword` | Signs out all sessions |
| POST | `/auth/change-password` | `currentPassword, newPassword, confirmPassword` | Signs out other sessions; clears the temporary-password flag |

Users with a temporary password get 403 `PASSWORD_CHANGE_REQUIRED` on everything except `/auth/*` and `/me/*`.

## Self-service (`/me`, any signed-in user)
| Method | Path | Notes |
|---|---|---|
| GET | `/me/sessions` | Signed-in devices (`current: true` for this one) |
| DELETE | `/me/sessions/:id` | Sign out one device |
| POST | `/me/sessions/revoke-others` | `{ revoked }` |
| GET | `/me/security` | `{ transactionPin: { isSet, updatedAt } }` |
| PUT | `/me/transaction-pin` | `currentPassword, pin, confirmPin` (4–6 digits, no repeats/sequences) |

## Administration
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/permissions` | any admin | Permission catalog |
| GET / POST | `/roles` | Super Admin | |
| PATCH / DELETE | `/roles/:id` | Super Admin | System roles are read-only; in-use roles → 409 `ROLE_IN_USE` |
| GET / POST | `/super-admin/admins` | Super Admin | `?q&status` |
| PATCH | `/super-admin/admins/:id` | Super Admin | name, email, mobile, roleIds |
| POST | `/super-admin/admins/:id/status` | Super Admin | `{ status: active \| blocked }`; blocking ends their sessions |
| POST | `/super-admin/admins/:id/reset-password` | Super Admin | Temporary password; forces a change at next login |
| GET | `/admin/members` | `members.view` | `?q&status&group=restricted&from&to&hasPin=yes\|no&sort=newest\|oldest\|name` |
| GET | `/admin/members/export.csv` | `members.view` | Same filters; up to 10,000 rows; audited |
| POST | `/admin/members` | `members.create` | Temporary password + optional `referralCode` |
| GET | `/admin/members/:id` | `members.view` | Detail with sponsor, referrals count and sessions |
| PATCH | `/admin/members/:id` | `members.edit` | name, email, mobile, dob, addresses |
| POST | `/admin/members/:id/status` | `members.status` | `{ status: active \| blocked \| blacklisted, reason }` (reason required to restrict) |
| POST | `/admin/members/:id/security-codes/transaction_pin/reset` | `members.security` | |
| POST | `/admin/members/:id/sessions/revoke` | `members.status` | |
| GET | `/settings/:group` | `settings.view` | `general`, `auth`, `maintenance` |
| PUT | `/settings/:group` | `settings.edit` (`maintenance.manage` for maintenance) | Validated; audited |
| GET | `/audit` | `audit.view` | `?q&action=<prefix>&from&to` |

Dates in `from` / `to` are `YYYY-MM-DD`, read as whole days in IST.

## Catalog: public (Phase 2)
Only published listings of approved vendors are returned. Prices are integer **paise**.

| Method | Path | Notes |
|---|---|---|
| GET | `/categories?kind=product\|service\|project` | Active category tree with published-listing counts |
| GET | `/catalog/listings` | `?type` (required) `&q&category=<slug>&subcategory=<slug>&city&min&max` (rupees) `&vendor=<slug>&sort=relevance\|newest\|price_asc\|price_desc&page&pageSize` |
| GET | `/catalog/listings/facets?type=` | Cities and price range |
| GET | `/catalog/listings/:type/:slug` | `{ listing, moreFromVendor }` |
| GET | `/catalog/listings/project/:slug/documents/:docId` | Download (attachment) |
| GET | `/catalog/featured` | Homepage: featured (or newest) listings + recently approved vendors |
| GET | `/catalog/vendors` | `?q&city&category&letter=A-Z\|#&sort=name\|newest` |
| GET | `/catalog/vendors/facets` | Cities and categories |
| GET | `/catalog/vendors/:slug` | Public profile with listing counts per type |
| GET | `/media/:yyyy/:mm/:file.webp` | Public images (immutable cache) |

## Vendor self-service (`/vendor`, role vendor)
| Method | Path | Notes |
|---|---|---|
| GET / PUT | `/vendor/profile` | Business profile. `pan` is write-only; responses carry `panMasked`. Changing name/PAN/GSTIN when approved → re-verification |
| PUT | `/vendor/bank` | `holderName, accountNumber, confirmAccountNumber, ifsc, bankName, branchAddress` (account number encrypted; only last 4 returned) |
| POST | `/vendor/logo` | multipart `file` (image ≤ 5 MB) |
| POST | `/vendor/documents` | multipart `file` (PDF/JPG/PNG ≤ 8 MB) + `type` |
| GET / DELETE | `/vendor/documents/:id[/file]` | Own documents only |
| POST | `/vendor/submit` | Submit for approval (400 `ONBOARDING_INCOMPLETE` with `details.checklist`) |
| GET | `/vendor/summary` | Status and listing counts |
| GET / POST | `/vendor/listings` | Own listings (`?type&status&q`); create → draft. Needs right `vendor.listings.manage` |
| GET / PATCH / DELETE | `/vendor/listings/:id` | Edits to live listings go back for review unless `vendor.listings.autopublish` |
| POST | `/vendor/listings/:id/submit \| archive \| restore` | Submit needs an approved vendor and ≥ 1 photo |
| POST / DELETE | `/vendor/listings/:id/images[/:imageId]`, `…/images/:imageId/cover` | Up to 8 photos |
| POST / DELETE | `/vendor/listings/:id/documents[/:docId]` | Projects only, up to 5 |

Listing body (`POST`/`PATCH`): `type, name, categoryId, subcategoryId?, summary, description?, city, price (rupees), priceNote?, gstRatePct, attributes[]` plus `product{sku?, availability, stockQty?, unit?}` or `service{deliveryDays, remote}` or `project{durationDays, advance (rupees), allowFullPayment, specialInstructions?, terms?}`.

## Catalog & vendors: admin (`/admin`)
| Method | Path | Permission |
|---|---|---|
| GET | `/admin/categories?kind=` | `catalog.view` (includes hidden) |
| POST / PATCH / DELETE | `/admin/categories[/:id]` | `catalog.manage` (delete blocked while in use) |
| GET | `/admin/listings` | `catalog.view` (`?type&status&vendorId&q&featured=yes`) |
| GET | `/admin/approvals/summary` | `catalog.view` |
| POST | `/admin/listings` | `catalog.manage` (+ `vendorId`; published immediately for approved vendors) |
| PATCH / DELETE | `/admin/listings/:id` | `catalog.manage` |
| POST | `/admin/listings/:id/decision` | `catalog.approve` (`decision: approve\|reject`, `reason` required to reject) |
| POST | `/admin/listings/:id/feature` | `catalog.approve` |
| POST | `/admin/listings/:id/archive`, images, documents | `catalog.manage` |
| GET / POST | `/admin/vendors` | `vendors.view` / `vendors.manage` |
| GET | `/admin/vendors/:id` | `vendors.view` |
| PUT | `/admin/vendors/:id/profile` | `vendors.manage` |
| POST | `/admin/vendors/:id/decision` | `vendors.approve` |
| POST | `/admin/vendors/:id/status` | `vendors.manage` (`approved\|suspended`, reason to suspend) |
| PUT | `/admin/vendors/:id/roles` | `vendors.manage` |
| POST | `/admin/vendors/:id/reset-password` | `vendors.manage` |
| GET | `/admin/vendors/:id/documents/:docId/file` | `vendors.view` (audited) |
| GET | `/admin/vendor-permissions` | `vendors.view` |
| GET / POST / PATCH / DELETE | `/admin/vendor-roles[/:id]` | `vendors.view` / `vendors.manage` |

## Members & referrals: self-service (`/me`, Phase 3)

Works for anyone with a member record (members and vendors).

| Method | Path | Notes |
|---|---|---|
| GET / PUT | `/me/profile` | Profile + completion. PAN is write-only (returned masked); Aadhaar last 4 only |
| PUT | `/me/bank` | Payout account; number encrypted, last 4 returned |
| POST | `/me/avatar` | multipart `file` (image), re-encoded to WebP |
| POST | `/me/documents` | multipart `file` + `type` (`aadhaar`, `pan_card`, `address_proof`, `other`) |
| GET | `/me/documents/:id/file` | Own document (private, sandboxed) |
| DELETE | `/me/documents/:id` | Not allowed once approved |
| GET | `/me/referrals/summary` | Direct / indirect / total, by level, invitations, upcoming birthdays (30 days) |
| GET | `/me/referrals?scope=all\|direct\|indirect&q=&level=&page=` | Paged list; masked mobile for direct referrals only |
| GET | `/me/referrals/tree?node=&page=` | One level at a time; `node` must be in your downline (else 404) |
| GET / POST | `/me/invitations` | 20 a day (429 `INVITE_LIMIT`); 409 `ALREADY_MEMBER` / `ALREADY_INVITED` (7 days) |

## Members & referrals: admin (`/admin/members`, Phase 3)

`:id` accepts a user id or a member ID (e.g. `JR0000001`).

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/members/bank-accounts?q=&page=` | `members.bank` (member accounts only, masked) |
| POST | `/admin/members/:id/bank/reveal` | `members.bank` (audited) |
| GET | `/admin/members/:id/profile` | `members.view` (bank/documents hidden without `members.bank`) |
| GET | `/admin/members/:id/documents/:docId/file` | `members.bank` (audited) |
| POST | `/admin/members/:id/documents/:docId/decision` | `members.bank` — `{ status: approved\|rejected }` |
| GET | `/admin/members/:id/referrals/summary` · `/referrals` · `/referrals/tree` | `members.view` |
| GET / PUT | `/settings/engagement` | `settings.view` / `settings.edit` — birthday greetings, sponsor reminders, channel |

## Commerce: buyer (role member, Phase 4)

| Method | Path | Notes |
|---|---|---|
| GET | `/cart` | Priced on the server |
| POST / PATCH / DELETE | `/cart/items[/:id]` | |
| POST | `/checkout` | `{ address, expectedTotalPaise, idempotencyKey }`; 409 `PRICE_CHANGED` / `CART_PROBLEM`, 503 `PAYMENTS_OFF` |
| GET | `/orders` · `/orders/stats` · `/orders/:id` | Own orders |
| POST | `/orders/:id/pay` · `/cancel` · `/complete` | |
| GET | `/payments[/:id]` | |
| POST | `/payments/:id/simulate` | Sandbox driver only |
| POST | `/payments/webhook/:provider` | No login; HMAC signature over the raw body in `x-webhook-signature` |
| GET | `/invoices` · `/invoices/gst-summary` · `/invoices/:id/pdf` | |
| GET / POST | `/project-requests[/:id]` | 10 a day |
| POST | `/project-requests/:id/cancel` · `/bids/:bidId/accept` · `/bids/:bidId/reject` | |

## Commerce: vendor (`/vendor`)

Orders are visible only once paid. Changes need `vendor.orders.manage`; bidding needs `vendor.bids.submit` and an approved business.

| Method | Path |
|---|---|
| GET | `/vendor/orders` · `/stats` · `/:id` |
| POST | `/vendor/orders/:id/status` · `/cancel` · `/cancellation` |
| GET | `/vendor/customers` · `/vendor/invoices` · `/vendor/invoices/gst-summary` · `/vendor/invoices/:id/pdf` |
| GET | `/vendor/project-requests[/:id]` (own bid only) |
| PUT / DELETE | `/vendor/project-requests/:id/bid` |

## Commerce: admin (`/admin`)

| Method | Path | Permission |
|---|---|---|
| GET | `/admin/orders` · `/stats` · `/:id`, `/admin/invoices[/:id/pdf]` | `orders.view` |
| POST | `/admin/orders/:id/status` · `/cancel` · `/cancellation` | `orders.manage` (audited) |
| POST | `/admin/orders/:id/refunds` · `/refund-request/dismiss` | `orders.refund` (audited) |
| GET | `/admin/project-requests[/:id]` | `bids.view` |
| POST | `/admin/project-requests/:id/decision` · `/close` | `bids.moderate` (audited) |
| GET | `/admin/payment-gateway` | `settings.view` |
| GET / PUT | `/settings/commerce` | `settings.view` / `settings.edit` |
