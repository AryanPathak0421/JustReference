# Security review (Phase 6)

Reviewed by reading the code, with automated tests for each control. This is not an independent penetration test; get one before taking real money.

| Area | Control | Checked by |
|---|---|---|
| Sign-in | argon2id, lockout after 5 tries, per-IP limits, generic errors, rotating refresh tokens with reuse detection | API tests |
| Money actions | Password must be re-entered after 15 minutes (refunds, payouts, commissions, rewards, coupons, E-PINs, money rules); wrong tries count to the lockout | API tests + Playwright |
| Access | Role and permission checks on every route, ownership checks on every personal record, reports limited to modules the admin can view | API tests |
| Input | Every body, query and parameter parsed by Zod; search text escaped before use in a regular expression | API tests |
| XSS | React escaping only; no HTML rendering of user or CMS text; link fields accept `/path` or `https://` only; strict CSP on the API and on Vercel | API tests + Playwright |
| CSRF | Access token in memory; cookie routes use SameSite=Strict plus a double-submit token | API tests |
| Uploads | Type read from the bytes, images re-encoded, PDFs served sandboxed, private files only to owner, recipient or staff | API tests |
| Money | Append-only ledger, transactions, idempotency keys, integer paise, daily reconciliation, sandbox money kept apart | API tests |
| Payments | Signature over raw body, amount and currency re-check, replay protection | API tests |
| Exports | Spreadsheet formulas neutralised in CSV; Excel cells are typed values, never formulas | API tests |
| Abuse | Daily limits on messages, tickets, files and invitations; hourly limit and hidden field on the contact form | API tests |
| Privacy | Encrypted PAN and bank numbers, Aadhaar last 4 only, staff names hidden from members, no codes or message texts in logs | API tests |

## Known gaps

1. **Live demo passwords.** Accounts on the live site were reported to use a weak shared password. Change them, and the Atlas database password, before anything else.
2. **Uploads are on the server's disk.** On Render they vanish on redeploy. Cloud storage is needed before real KYC documents.
3. **Rate limits are kept in memory** per server process. Use a shared store before running more than one.
4. **No malware scan** of uploaded PDFs.
5. **No two-factor sign-in** for administrators.
6. **`npm audit`:** `exceljs` pulls `uuid` 8 (moderate, affects v3/v5/v6 with a caller-supplied buffer). ExcelJS only uses v4, so it is not reachable here. `sharp` was upgraded to 0.35.5 to close high-severity image-parsing issues.
7. **OTP delivery.** Until SMS or WhatsApp is connected, codes are stored in the database for 24 hours and can't be received by users.
