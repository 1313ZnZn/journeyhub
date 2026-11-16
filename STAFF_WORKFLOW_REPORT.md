# Staff workflow / Feature 3 implementation report

Date: 2026-11-16. Branch: `feat/staff-workflow-20261116`, isolated from the original dirty development worktree. Base: `585f0a8` (origin/main). **Not deployed. Production acceptance is BLOCKED pending migration approval and hosted testing.**

## Changes

- `staff-workflow.js` and `.css`: Approvals navigation/dashboard entry, actionable counts, status/activity/date/submitter filters, review/return/revise/resubmit, published record links, activity-specific planning and explicit financial assumptions. Retains the existing dark, lime and purple design.
- `staff-feature3.js`: persists assumptions with the existing serialized/versioned save mechanism; distinguishes session phases.
- `staff-navigation.js`, `frontend.js`, `desktop-web.js`: account-scoped record IDs/filter restoration, correct Host landing/routes and Approvals command entry.
- `staff-operations.js`: removes first-session fallback; distinguishes upcoming, booking closed, fully booked, in progress, ended and cancelled sessions.
- `staff-agent.js`: suppresses expired opportunities in returned tasks. Existing assistant architecture is unchanged.
- `staff-desktop.js`: approval instructions name a different authorized Duty Manager.
- `build.cjs`: loads the new module last; replaces the hard-coded craft capacity description with session-specific capacity guidance.
- `supabase/migrations/20261116083047_staff_approval_workflow.sql`: additive ownership, return reasons, submission timestamps and assumptions; authenticated role/ownership checks, future-time validation, version checks, atomic/idempotent publication, activity settings and scoped snapshots. **Prepared only, not executed on Supabase.**
- Tests: new PostgreSQL and compiled-UI regression suites; updated navigation and assistant fixtures. PGlite 0.3.14 is a pinned development-only dependency in `work/journeyhub/package.json` and lockfile.

## Actual verification

| Check | Result | Evidence / limits |
| --- | --- | --- |
| `npm run build` | PASS | Full existing application bundle with extension |
| `npm test` | PASS | Four existing calendar/weather suites; mocked transport |
| `test-staff-workflow-db.cjs` | PASS | Real isolated in-memory PostgreSQL (PGlite); no hosted writes |
| Three activities | PASS locally | Independent craft, food and culture records; draft/save/submit, manager list, publication and matching IDs/duration/capacity/price |
| Return/revise/resubmit | PASS locally | Required reason, retained history, fresh version |
| Authorization and validation | PASS locally | Self-approval, stale version, expired save/approval, Host venue scope, owner isolation and duplicate publication |
| Booking data propagation | PASS locally | Independent traveler identity and SQL booking inserts exercise actual DB triggers/snapshot/live metrics; overbooking blocked and cancellation restores capacity |
| Compiled UI suite | PASS | Approval counts/filtering, missing-ID errors, restoration, Host routing, activity selection and incomplete forecast; RPC transport mocked |
| Existing navigation / Feature 3 / assistant suites | PASS | Auth handoff, autosave, account isolation, roster/check-in ID safety and existing assistant behavior; mocked transport |
| Local desktop browser | PASS visual | Approvals and review pages opened in IAB at 1280×720 using explicitly labelled test fixtures |
| Preview build safety | PASS | Test-only public configuration; 19 current allowlisted assets including the existing desktop media. SQL, tests, server files and private-key patterns excluded |
| Cloud read-only audit | PASS | Existing Supabase schema, functions, roles and permissions inspected; no schema/data mutation |
| Hosted Auth / cross-account refresh | BLOCKED | New migration not approved or deployed; local fixtures do not prove hosted Auth |
| Traveler simulated wallet payment → staff order | BLOCKED | DB booking-trigger verification is not a wallet/RPC/browser payment test |
| Existing Features 1/2 live provider regression | BLOCKED | No real Agent/provider or payment flow run in this change |

Screenshots (local test data, not production): `outputs/staff-workflow/approvals.jpg`, `outputs/staff-workflow/review.jpg`. Database test evidence: `outputs/staff-workflow/db-results.json`.

## Remaining limitations and rollout risks

1. Apply the separately reviewed migration before enabling this front-end. The new planner is deliberately gated by `staffWorkflowVersion`; without the migration it shows an upgrade-pending message. Do not merge a production-auto-deploying PR until rollout is approved.
2. Legacy drafts with neither creator nor submitter retain their records but cannot be assigned an owner safely. Managers can inspect/duplicate them; there is no ownership backfill.
3. Activities with no explicit capacity setting use their existing maximum session capacity, capped at 40, with a visible manager-verification notice. Missing historical/cost assumptions must be entered explicitly. No historical rows are fabricated.
4. Existing Staff assistant proposals remain their original scope. The generalized planner supports all authorized catalogue activities. Expiry filtering covers returned assistant tasks; counts for more than the backend page limit require a follow-up server-side assistant audit. This is not claimed complete.
5. The PostgreSQL suite loads the baseline schema/backend/Feature 3 plus this migration, not every historical production migration. A hosted staging migration check and full public booking RPC/wallet flow remain required.
6. No production database changes, real orders, existing records, sold seats or historical samples were modified. No production deployment or merge was performed. Original development worktree changes are preserved.

## Reproduction

From repository root: `npm ci --prefix work/journeyhub`, `npm run build`, `npm test`.
Then run `node work/journeyhub/test-staff-workflow-db.cjs`, `node work/journeyhub/test-staff-workflow-ui.cjs`, `node work/journeyhub/test-staff-navigation.cjs`, `node work/journeyhub/test-staff-feature3-ui.cjs`, and `node work/journeyhub/test-staff-agent.cjs`.
For a local-only safe build set the two public build variables to `https://test.supabase.co` and `sb_publishable_test_build_only`, then run `node work/journeyhub/build-preview.cjs`. Never deploy that test configuration.
