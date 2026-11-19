# Staff direct publication — 19 November 2026

## Delivered behavior

All employees use the shared Staff capabilities introduced by PR #35. Travelers do not gain staff access. A staff member can edit any draft and publish their own plan without a second account. The workflow keeps Insights, Comparison, activity selection, existing Forecast formulas and the traveler catalogue.

Session plans replaces Approvals and has Drafts / Published tabs. Publish session flushes pending edits, validates inputs, creates the canonical bookable session, reloads the server snapshot and shows “Session published successfully” with “View published session”. Publication stores the employee and timestamp. Row locks, version checks, an activity/time advisory lock and idempotent publication prevent duplicate sessions. Published records are immutable; duplicate creates a separate draft.

The existing internal `approved` status is retained for published records to preserve snapshot/statistics compatibility. It is displayed as Published. Historical approval audit messages are preserved as history, not active workflow instructions.

## Cloud migration — already applied, do not reapply

Project: hmnbrqykvjvplrsarsta. Migration: `20261119073922_staff_direct_publication`.

- Converted 4 submitted and 1 returned plan into shared editable drafts, retaining their content, assumptions, review notes and history.
- 27 drafts and 16 published plans after migration.
- All 16 old publisher IDs and known publication times preserved/backfilled from audit events.
- Published plan/session link checksum unchanged: `646f1ccdde9c6440e57f88395cbf8a6b`.
- Session count stayed 1,304; booking count stayed 120 after rollback tests.
- No customer orders, reservations, balances, RLS policies or Auth accounts changed by the tests.

This replaces the independent-approver policy in STAFF_UNIFICATION_PLAN.md and STAFF_UNIFICATION_REPORT.md. The frontend changes still require PR merge. Cached old clients using submit/approve must refresh onto the new release; those retired command actions are rejected. Do not restore the old self-approval constraint after self-published records exist without a separate data review.

## Verification

PASS: `npm test` (weather, calendar, account-reset regressions).

PASS: `test-staff-direct-publication.cjs`, isolated PostgreSQL: former Coordinator and Host each independently create/save/publish; original craft and expanded museum activities; shared draft editing; pending/returned conversion; old published links preserved; publisher/time; retry idempotency; stale-version and duplicate-slot rejection; date/capacity/price/assumption validation; traveler/anonymous denied staff publication; guest list, seat counts and live metrics after booking.

PASS: production-bundle `test-staff-workflow-ui.cjs` with mocked transport: shared Drafts / Published lists, pending edit flush, double-click guard, success message, publisher metadata and correct traveler session link.

PASS: `test-staff-navigation.cjs` and `test-staff-agent.cjs`: workspace routing/account isolation, draft state and assistant regressions.

PASS: `npm run build`, `npm run build:preview` with explicitly non-real public test configuration, 19 allowed output files, built-in sensitive-file/configuration checks, `git diff --check`.

PASS: hosted database rollback transaction using existing test accounts formerly Coordinator and Host, and a separate example.com traveler. Executed current public command RPC logic, current demo quote, virtual wallet and booking functions. Activities: Thai Craft Lab (`craft`) and Museum Siam Culture Explorer (`bk-museum-siam`). Each creator published their own session; traveler snapshot had correct activity, price and capacity; booking two guests left two seats; repeated publication and booking returned the same record; staff guest lists matched. All transactional test writes, including virtual top-ups and payments, rolled back. Reproducible SQL is in `work/journeyhub/test-staff-direct-publication-rollback.sql`.

NOT YET VERIFIED: live browser login and click-through against the new Vercel frontend with both accounts, after deployment. SQL identity claims were used for hosted backend verification; this is not an interactive login test. No real orders were created.

Security advisors unchanged: 10 existing RLS-without-policy informational findings and existing disabled leaked-password protection warning. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection . No new access policies or credential configuration were added.

## Files

- `staff-workflow.js`: shared draft/publication views, validation, metadata, idempotent UI and consistent staff navigation.
- `staff-feature3.js`: enable Publish as inputs change; correct traveler-link hint.
- `staff-agent.js`: direct-publication copy and draft summaries; remove former Host restriction.
- `staff-desktop.js`, `desktop-web.js`, `original.html`: shared capabilities and consistent navigation/copy; preserve visual design.
- New migration: existing canonical session creation with direct publication, preservation/backfill and shared draft permissions.
- Workflow UI/navigation tests plus new PostgreSQL and rollback tests: meaningful state/association/security verification.

No Agent architecture, traveler booking implementation, Forecast arithmetic or design system was rewritten. Main is not modified or merged by this task.

## Vercel Preview

PR: https://github.com/1313ZnZn/journeyhub/pull/36

Verified deployment: https://journeyhub-preview-rdru7c13y-zicn.vercel.app/ . Source commit `1421dae`, branch `feat/staff-direct-publication`, Ready. Vercel API reports `target: null` (non-production Git Preview); only branch aliases are assigned. Cloud build ran `npm run build:preview`, produced 19 files, and completed successfully.

Authenticated Vercel fetch checks: `/` and `/ai-plan.html` returned actual HTML with HTTP 200; the main bundle contains direct-publication UI and Session plans. `/config.js` returned JavaScript (HTTP 200, application/javascript) with the correct project URL and a Publishable Key. `/database.sql` and `/test-staff-direct-publication-rollback.sql` returned HTTP 404. Plain unauthenticated requests reached the Vercel protection page and were not counted as application passes. Browser login and interactive user-flow testing remain pending.
