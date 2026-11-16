# Staff workflow migration — awaiting approval

Target existing project: `hmnbrqykvjvplrsarsta`, schema `journey_hub`.
Proposed file: `work/journeyhub/supabase/migrations/20261116080425_staff_approval_workflow.sql`.
This document is a review plan, not confirmation of application.

## Proposed database changes

1. Add nullable `created_by`, `submitted_at`, `return_reason` and default-empty `assumptions` to session plans. Relax the lower capacity constraint from 10 to 1; retain the upper bound of 40.
2. Replace plan-command internals while keeping the public command RPC and existing request-id deduplication. Enforce ownership, role/venue scope, distinct approving manager, current version, valid local future start, price/budget/capacity and explicit forecast assumptions. Publish plan and session atomically with exact activity/session references and concurrency locks.
3. Keep the current snapshot implementation under a private name and add an authenticated wrapper exposing authorized planning settings and plan ownership/history. Keep the invoker-facing snapshot executable for anon/authenticated, with all staff fields checked against `auth.uid()`. Private helpers remain non-executable by those roles.
4. Do not change Auth, RLS policies, booking/payment commands, existing sessions/orders, historical samples, sold seats or user data. No seeds, deletion or ownership backfill.

## Permission model

Existing Coordinators and Duty Managers retain catalogue-wide operational scope; Hosts can plan only activities at their assigned venue. Coordinators/Hosts see their own plans. Managers see plans within their authorized catalogue scope and may review others, but may not edit another owner's draft or approve their own submission. Private traveler demo activities and browse-only venues are excluded.

## Required approval and rollout

- User approval is required before executing this schema migration, per the earlier migration constraint. No cloud apply has occurred.
- Before apply: capture deployed function definitions and schema backup, verify the migration has not already run and that baseline functions/constraints match the audited versions. Test against an isolated staging copy with the current unified booking migrations.
- After approval: apply through the existing migration mechanism, then deploy the front-end Preview with real public configuration. Do not expose a front-end-only rollout that blocks existing planners.
- Use separate test Coordinator, Host, Duty Manager and traveler accounts and visibly labelled records for craft, food and culture. Verify the actual UI → RPC → publication → simulated wallet booking → order/roster/capacity/live metrics flow, then reload and reauthenticate. Do not create real orders.
- Check DB logs and public snapshot accessibility; verify private helper permissions. Verify a different manager is required and stale/expired/duplicate actions fail without extra sessions.
- Production merge/deployment remains a separate decision after hosted acceptance.

## Recovery

The migration is transactional. Failure before COMMIT rolls back its changes. After successful deployment, prefer a reviewed forward fix. Do not automatically drop columns, delete newly created sessions or restore old plan commands over new records. If rollback is necessary, restore captured function definitions under a reviewed migration and preserve all plan/session/booking data.
