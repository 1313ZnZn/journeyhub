# Account reset implementation and rollout review

Branch: feat/account-reset-20261118; baseline origin/main 01a5056.
No production data changed, no migration applied, no deployment or Git push performed.

## Behavior
- Me > Reset account content, English UI using existing button/page styles.
- Preflight requires the server wallet reset RPC before enabling confirmation.
- Requires typing RESET; lists all paginated owned searches/trips and up to 49 agent runs.
- Moves owned trips/searches to existing Removed items and pauses linked support. This is reversible archival, not permanent database erasure.
- Cancels owned, future, unredeemed simulated bookings through the existing cancellation RPC (seat release, ticket invalidation and refund implementation reused).
- Clears refunded and remaining virtual credits, recording a new immutable reset ledger entry. Login, staff permissions, real/product orders and audit records remain.
- Optional permanent deletion of owned Travel Memories and photos on this browser only; backup entry points to existing exports. Other devices and guest/other-account data remain.
- Clears personal preferences/favorites and owner-scoped Pip/chat cache; auth session keys remain.
- Partial failures show progress; retry reuses per-step request IDs and skips acknowledged steps. A new browser session does not resume the old UI operation automatically.

## Files
- work/journeyhub/account-reset.js: reset view, preflight, cancellation/archive orchestration, account guards and retry.
- work/journeyhub/account-reset.sql: proposed server helper/public RPC, balance lock/idempotency and ledger reset classification.
- work/journeyhub/demo-wallet.js: readable reset transaction label.
- work/journeyhub/build.cjs: include new frontend module.
- package.json: include reset regression tests in npm test.
- work/journeyhub/test-account-reset.mjs: isolated frontend orchestration tests.
- work/journeyhub/test-account-reset-db.mjs: isolated PostgreSQL/PGlite tests using actual wallet schema and lock function.

## Verification
PASS npm test: existing four calendar/weather suites and two reset suites.
PASS local build:preview with explicitly fake public configuration, 19 output resources, built-in sensitive/forbidden-file checks.
PASS reset tests: own-account scope, all history pages, explicit confirmation, missing-RPC safety, partial failure retry, changed identity rejection, memory opt-in, preservation of other-account cache and auth keys.
PASS PostgreSQL tests: anonymous rejection, authenticated role execution, active booking blocks reset, balance and ledger changes scoped to caller, duplicate request leaves later top-ups untouched.
Not tested: live cloud schema compatibility, real cancellation/refund integration, live browser reset flow, simultaneous activity from multiple devices. No claim of production readiness.

## Database change awaiting approval
Review account-reset.sql before applying. It changes two demo_ledger check constraints to admit reset, adds an ownership-enforcing wallet-reset function and an authenticated public wrapper. Existing records and RLS are not altered; no data is cleared merely by applying the SQL. Uses auth.uid(), no client-supplied account ID, existing wallet row lock, immutable ledger and request deduplication.
Before approval/apply: read cloud constraints/function grants and migration inventory; create a migration with the Supabase CLI; test in a non-production database and verify existing cancellation/refund integration. After migration approval, stage frontend in Preview and test with disposable accounts before requesting production release.
Security guidance reviewed: https://supabase.com/docs/guides/database/functions and https://supabase.com/changelog.md (2026-11-18).

## Known limits and blocked cases
- Started, checked-in or otherwise uncancellable simulated reservations block reset; they are not silently discarded.
- Legacy active simulated bookings that lack canonical cancellable bookings block wallet reset and require review.
- Agent listing currently caps at 50; 50 or more returned runs block reset rather than claim full completion. Pagination expansion is outside this patch.
- Pending agent work and transient server failures may stop midway. Completed cancellations cannot be rolled back; remaining steps can be retried.
- No cross-device atomic reset transaction: activity initiated concurrently may create fresh content. Current server ownership/locking checks still apply.
- Travel Memories are browser-local; this feature cannot clear copies in other browsers.
- SQL is a review proposal, not an automatically discovered/applied migration. Frontend fails closed until RPC exists.

## Approved database rollout — 2026-11-18
User approved the reviewed database change. Applied via Supabase MCP to hmnbrqykvjvplrsarsta as migration 20261118082609_journeyhub_account_reset. Local migration was created with the CLI and aligned to the actual cloud-recorded version (not a second migration).
Verified cloud constraints and required columns before application. Verified anon EXECUTE=false, authenticated EXECUTE=true and public wrapper SECURITY INVOKER after application. Read-only p_commit=false probe under authenticated role returned ready=true inside a rolled-back transaction using a synthetic subject. No wallet reset, booking cancellation or user content removal was executed.
Security advisor: no reset-function finding; ten INFO notices on existing RLS-enabled tables without policies, plus leaked-password protection disabled WARN. Remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
Frontend is still local, not deployed. Live browser reset/cancellation integration remains unverified. Existing local tests passed in the previous implementation step.
