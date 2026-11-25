> Superseded on 19 November 2026: the user now requires direct publication by any Staff member, including the creator. See STAFF_DIRECT_PUBLICATION_REPORT.md. The independent-approver policy below is historical.

# Unified Staff — implementation and verification

## Applied cloud change

Approved on 19 November 2026. Migration `20261119071829_unified_staff_capabilities` is already applied to project `hmnbrqykvjvplrsarsta`. Do not apply it again. The local filename matches the cloud migration history (the MCP assigned the final version).

All five Staff records now use the existing internal `duty_manager` role: one former Coordinator, one former Host and three existing Duty Managers. This preserves the existing RPC security checks while granting identical capabilities. Original roles are preserved in an RLS-protected, client-inaccessible rollback table. A SECURITY INVOKER trigger normalizes future deliberate staff provisioning and role assignments; invalid role values still fail. No Auth-user trigger or automatic staff enrollment was added.

Existing sessions may need a refresh to load the updated staff profile. Frontend changes in this PR label roles as Staff and request approval by another staff member. No production frontend deployment or merge was performed by the agent.

## Checks passed

- `npm run build` and `npm test`.
- `test-staff-navigation.cjs`: traveler-first login, explicit staff entry, account isolation and sign-out navigation (mocked transport).
- `test-staff-workflow-ui.cjs`: all three migrated identities share the approval UI; self-approval remains absent; legacy pre-migration fixtures remain covered (mocked transport).
- `test-staff-feature3-ui.cjs`: durable saves, approval handoff and publication link (mocked transport).
- `test-staff-workflow-db.cjs`: pre-migration workflow regression.
- `test-staff-workflow-db.cjs --unified`: isolated PostgreSQL tests normalize existing and future staff, reject invalid role assignments, protect rollback records and prevent client self-provisioning. Each former role creates/submits a plan and another former role approves it. Self-approval and editing another person's draft fail. Cross-venue planning, version checks, publication idempotency, test-booking capacity and cancellation checks pass.
- Cloud read-only `snapshot()` checks under each former role's auth identity: identical visibility of 2 orders, 120 reservations, 41 plans and 45 plannable activities at verification time. These are authorization checks using existing Auth IDs, not browser sign-in tests. No customer records were output or modified.
- Security advisors unchanged before/after: 10 existing RLS-with-no-policy INFO findings and one existing leaked-password-protection WARN. No new finding from this migration. Existing warning: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- `git diff --check` passes.

## Limits

No new live session or real order was published to test this change. Full click-through authentication and publishing in the hosted UI are not re-tested here; write-flow coverage uses isolated PostgreSQL and a production frontend bundle with mocked transport. Existing customer data, wallet balances, bookings and traveler login behavior were not changed.

## Rollback (administrator only; not executed)

First inventory staff created since the migration. Their previous role does not exist and must be chosen explicitly. Then, in a transaction, remove `normalize_staff_role` from `journey_hub.staff`, drop `journey_hub.normalize_staff_role()`, and restore `staff.role` by joining `staff_role_backup_20261119` on `staff_id`. Keep the backup table for audit. Revert the UI PR if necessary. Never delete staff records, orders or approval history as part of rollback.

Independent review remains required: all staff can approve others' plans; nobody can approve their own plan. Draft ownership, venue/time/capacity checks and publication audit records remain intact.
