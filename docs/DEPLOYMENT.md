# Deployment runbook

| Part | Where | Deploys |
|---|---|---|
| Web | Vercel (`vercel.json`, proxies `/api` to Render) | On push to `main` |
| API | Render (`render.yaml`, health check `/api/v1/health`) | On push to `main` |
| Database | MongoDB Atlas (replica set, required for transactions) | – |

## Before every push
1. `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` (local stack: `npm run db -w @jr/api`, `npm run dev:local -w @jr/api`, `npm run dev`).
2. Check that no `.env`, `LOGINS.local.md` or upload is staged.

## After a push
1. `/api/v1/health` on Render answers `{"ok":true}`; the Vercel site loads.
2. Super Admin → System health: database, jobs, channels.
3. Super Admin → Wallet monitor → Run now: all balanced.

## Environment (Render)

| Variable | Notes |
|---|---|
| `MONGODB_URI`, `JWT_ACCESS_SECRET`, `FIELD_ENCRYPTION_KEY` | Required. **Never change `FIELD_ENCRYPTION_KEY`** once PAN/bank data exists; keep a copy somewhere safe |
| `PUBLIC_WEB_URL`, `CORS_ORIGINS` | The public web address |
| `PAYMENT_DRIVER` | `none` (default). `sandbox` also needs `ALLOW_SANDBOX_PAYMENTS=true`; demo only |
| `MESSAGING_DRIVER` | `console` (default, nothing delivered) or `live` |
| `SMTP_URL`, `MAIL_FROM` | Email, e.g. `smtps://user:pass@host:465` |
| `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`, `WHATSAPP_HTTP_URL`, `WHATSAPP_HTTP_TOKEN` | Endpoint that accepts `POST {"to","text"}` with a bearer token. Providers with their own format need a small adapter. India needs DLT-registered SMS templates; WhatsApp needs approved templates |

## Connecting a real payment gateway
Add a driver in `apps/api/src/services/gateway.ts` implementing `createOrder`, `verifyWebhook` (over the raw body) and `refund`; register it and its name in `PAYMENT_DRIVER`; point the provider's webhook at `/api/v1/payments/webhook/<name>`; run `test/commerce.test.ts` against it in the provider's test mode.

## Roll back
Render → Deploys → an earlier deploy → Rollback. Vercel → Deployments → Promote to Production. Database changes so far are additive, so an earlier version keeps working.

## Backups
Turn on Atlas backups (free clusters have none) and practise a restore. Money can't be rebuilt without the `ledgerentries`, `wallets`, `orders`, `payments` and `invoices` collections.

## Incidents
- **Pause the site:** Super Admin → Maintenance mode. Payment webhooks keep working.
- **Ledger mismatch:** switch off withdrawals and transfers (Commission & money rules), then compare the listed wallet with its ledger. Never edit a balance by hand.
- **Leaked secret:** rotate it in Render. Changing `JWT_ACCESS_SECRET` signs everyone out and makes unused E-PINs unredeemable, so block and reissue those.
