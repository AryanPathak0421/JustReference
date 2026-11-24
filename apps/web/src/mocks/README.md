# Sample data — development preview only

Everything in this folder is **fake data** used to preview screens whose modules aren't built yet.

Rules:
- Only `src/features/*/api.ts` files may import from `src/mocks`. Pages and components never do.
- Any screen showing data from here must display `<SampleDataBadge />`.
- As each phase connects a module to the real API (see `docs/CHECKLIST.md`), its `api.ts` switches to HTTP and the matching mock file is deleted.

Remaining mocks:
- `dashboard.ts`: notifications/announcements and some admin and Super Admin figures (Phase 6). Orders (Phase 4) and money (Phase 5) are real. The member dashboard's referral counts, profile completion and birthdays are already real (Phase 3); the mock's referral fields are no longer shown.
- `content.ts`: homepage testimonials and blog posts (Phase 6).

Removed so far: `users.ts` (Phase 1, real login) and `catalog.ts` (Phase 2). Sample vendors and listings now live in the database via `npm run seed:demo -w @jr/api`, flagged `isSample`.
