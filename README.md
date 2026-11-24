# JustReference.in

Marketplace (products, services, projects), referral management, wallet and vendor platform. MERN stack: MongoDB, Express, React, Node.

- **Architecture, database design and roadmap:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Feature status (what's built / tested / pending):** [docs/CHECKLIST.md](docs/CHECKLIST.md)
- **API reference:** [docs/api/README.md](docs/api/README.md)

## Current status: Phases 1–5 complete (payments in sandbox only)

Working against a real API and database:
- **Accounts (Phase 1):**
  - Registration with mobile OTP, member IDs, referral IDs and the referral upline.
  - Login, sessions, password reset/change and transaction PIN.
  - Role-based access for Super Admin, Admin, Vendor and Member.
  - Administrator, role and member management.
  - Website settings, maintenance mode and the audit log.
- **Vendors & catalog (Phase 2):**
  - Vendor sign-up and KYC: business profile, encrypted PAN and bank details, private documents.
  - Admin approval, suspension, and vendor roles/rights.
  - Categories, and products/services/projects with photos and project documents.
  - The listing approval workflow.
  - Public search, listing pages, vendor profiles and the business directory.
- **Members & referrals (Phase 3):**
  - Member profile (encrypted PAN, Aadhaar last 4 only, bank account, KYC documents, photo) with a completion indicator.
  - Referral link sharing, all/direct/indirect lists, the referral tree and invitations.
  - Daily birthday greetings and sponsor reminders (configurable in Settings → Birthdays).
  - Admin: member bank details with audited reveal, any member's referral network, KYC review on the member page.
- **Commerce (Phase 4):**
  - Cart, checkout, orders for buyers, vendors and admins, cancellations, refunds and GST invoices.
  - Project requests and bidding.
  - Payments through a simulated gateway; a real one still has to be connected.
- **Money (Phase 5):**
  - Wallets on an append-only ledger, transfers, withdrawals, commissions, vendor settlement and TDS records.
  - Coupons, rewards, subscription plans and E-PINs.
  - Everything that moves money is off until a Super Admin sets the rules.

Still on sample data: some admin and Super Admin dashboard figures, notifications and announcements, plus homepage testimonials and blog (Phase 6). Every such screen shows a **Sample data** badge. Sample vendors and listings in the database are flagged `isSample` and tagged "Sample" in the UI.

## Getting started

Requirements: Node.js 22+ (developed on 24) and MongoDB 7+ installed locally (developed on 8.2).

```bash
npm install
node apps/api/scripts/init-env.mjs      # creates apps/api/.env with random dev secrets (once)
npm run db -w @jr/api                   # terminal 1: local MongoDB replica set on port 27117
npm run seed:demo:local -w @jr/api      # once: roles, dev Super Admin, 24 SAMPLE members
npm run dev:local -w @jr/api            # terminal 2: API on http://localhost:4000
npm run dev                             # terminal 3: web app on http://localhost:5173
```

- **Local overrides:** `dev:local` and `seed:demo:local` also read `apps/api/.env.local` (git-ignored). Put your local `MONGODB_URI` and `PAYMENT_DRIVER=sandbox` there when `.env` points at a shared or live database, so development never touches it.
- **Dev Super Admin login:** the email and password are in `apps/api/.env` (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`). They were generated on your machine, and `.env` is git-ignored.
- **OTP codes in development:** no SMS/WhatsApp provider is connected yet, so codes go to the **dev outbox** at http://localhost:5173/dev/outbox instead of a phone.
- **Sample members and vendors** use `@example.test` emails and are flagged `isSample: true` in the database. They can't log in (random passwords), except the root of the sample referral tree, `aarav.sharma@example.test`, whose password is `SEED_DEMO_MEMBER_PASSWORD` in `apps/api/.env` (add that line yourself if your `.env` predates Phase 3, then re-run `seed:demo`).
- **Uploaded files** (listing photos, KYC documents) are stored in `apps/api/uploads/` locally (git-ignored). Public and private files are kept in separate folders.
- `npm run db -w @jr/api` does not touch any MongoDB service already installed. It runs its own instance on port 27117 with data in `apps/api/.data/`.

### Scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript check for all workspaces |
| `npm test` | API tests (Vitest + Supertest against an in-memory MongoDB replica set) |
| `npm run test:e2e` | Browser smoke tests (Playwright, using the installed Microsoft Edge) against the running dev stack |
| `npm run build -w @jr/web` | Production build of the web app → `apps/web/dist` |
| `npm run build -w @jr/api` | Production bundle of the API → `apps/api/dist` (`npm start -w @jr/api` runs it) |
| `npm run seed -w @jr/api` | System roles + first Super Admin only (no sample data). Use this for staging/production |

## Repository layout

```
apps/api          Express 5 + Mongoose API
  src/config          env validation, logger (with redaction), DB connection
  src/core            errors, HTTP helpers, crypto (argon2id, AES-GCM, tokens)
  src/middleware      authenticate / requirePermission / requireRole, rate limits, CSRF, maintenance gate
  src/models          Mongoose models
  src/services        sessions, OTP, messaging driver, settings, audit, identity (member IDs, referral upline)
  src/modules         route modules: auth, me, roles, admins, members, settings, audit/public/dev
  src/seed            idempotent system data + seed script
  test/               API tests
apps/web          React 19 + Vite + Tailwind front end
  src/design-system   Reusable UI components and tokens
  src/features        Per-module API clients, auth provider and guards
  src/pages           Route screens (public, auth, account, admin, super)
  src/mocks           Sample data still used by not-yet-built modules (see its README)
packages/shared   Zod schemas, permission catalog, enums and response types shared by API and web
docs/             Architecture, checklist, API reference, design preview
```

## Before going live

See section 9 of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the business decisions and legal/regulatory points that must be settled. At minimum, the production checklist is:
- Generate fresh secrets.
- Run `npm run seed` (not `seed:demo`).
- Use a managed MongoDB replica set.
- Use HTTPS (cookies are `Secure` in production).
- Connect real SMS/WhatsApp/email providers (Phase 6).
