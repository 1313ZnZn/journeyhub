# Approved cloud migration verification

2026-11-16: user explicitly approved the migration. Applied successfully to existing Supabase project `hmnbrqykvjvplrsarsta` using the migration tool.

- Cloud migration: `20261116083047_staff_approval_workflow` (the tool assigned the cloud timestamp; SQL matches reviewed repository migration `20261116080425`). The repository file and test reference have been renamed to match the recorded cloud version, preventing a duplicate migration apply.
- Pre-change deployed function definitions, ACLs, columns and constraints captured locally in ignored `outputs/staff-workflow/cloud-before.json`.
- No Supabase development branch existed. No paid branch was created.
- Cloud public command RPC tested under SQL-simulated Coordinator, different Duty Manager and Host identities in a transaction ending in ROLLBACK.
- Three existing activities passed create/save/submit/manager snapshot/publish/public catalogue visibility: `craft`, `food`, `sh-bund`. Capacity, price and activity duration matched; repeated creation/publication reused the same record; stale-version approval was rejected.
- Return → revise → resubmit and Host assigned-venue access passed.
- The first test script had an ambiguous local `session_id` variable. That transaction failed and rolled back. Correcting the test variable produced the passing run; no product change was needed.
- After rollback, counts exactly matched pre-migration counts: 1,261 sessions, 96 bookings, 8 plans. No test plans, sessions or orders persisted.
- Anonymous direct plan execution and authenticated direct private-settings execution remain denied. Public snapshot and authenticated command entry permissions remain enabled.
- Security advisors returned the previously observed ten INFO RLS/no-policy notices and disabled leaked-password protection warning; no new advisor category appeared. References: [RLS lint](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No unrelated Auth/RLS settings were changed.

## Still not verified

SQL identity simulation is not browser Auth. Real browser multi-account login, the unified wallet/booking RPC and hosted UI round-trip remain unverified. No real order or payment was created.

Vercel deployment inspection was blocked by HTTP 403: connection lacks team `zicn` access (`team_flpZttYxUjMJKQMPEMamP5ev`). A team authorization link was requested. This is a connector access issue, not evidence that the build failed.

PR #27 remains a draft for manual review. No merge or Production deployment was performed. Earlier reports describe pre-approval status; this addendum supersedes their migration-pending statements, but does not mark all acceptance checks as complete.
