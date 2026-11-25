> Superseded on 19 November 2026: the user now requires direct publication by any Staff member, including the creator. See STAFF_DIRECT_PUBLICATION_REPORT.md. The independent-approver policy below is historical.

# Unified Staff capabilities — approval plan

Status: approved by the user and implemented. See STAFF_UNIFICATION_REPORT.md for the applied migration and test evidence.

## Requested behavior

Every existing and future Staff account receives the same operations capabilities: orders and delivery, reservations and check-in, insights, draft creation/submission, review, return, approval and publication. Traveler accounts receive no staff access. Ordinary traveler login continues to land on the traveler home (PR #34).

## Verified cloud state (19 November 2026)

Project: hmnbrqykvjvplrsarsta; schema: journey_hub.

- staff roles: 1 coordinator, 3 duty_manager, 1 host.
- staff.role permits coordinator, duty_manager and host.
- Direct client access to staff is denied by RLS.
- Backend checks exist in plan_command, check_plan_approver, staff_can_plan, snapshot layers, command_before_unified and staff_agent.
- Host restrictions include assigned-venue scope and merchandise-order restrictions; changing frontend buttons alone is insufficient.

## Minimal implementation proposed for approval

1. Keep the existing internal duty_manager role as the single effective Staff role, avoiding a rewrite of existing privileged RPCs and RLS.
2. In one reviewed migration, preserve each current staff ID and original role in a private rollback mapping, then change the coordinator and host records to duty_manager. The three existing duty_manager records remain unchanged.
3. Normalize roles on future staff creation and explicit role assignment to the same internal role. Apply only after a staff record is deliberately provisioned; do not create staff records for ordinary Auth users. Reject unknown role values rather than normalizing invalid input.
4. Display the role as Staff in the interface. Replace manager-specific approval instructions with another staff member. Keep the current UI design.
5. Retain the independent-review rule: a plan's creator/submitter cannot approve their own plan. Any other Staff account can review it. Retain owner-only draft editing, version checks, date/capacity validation, duplicate-publication protection and audit history.
6. Do not change orders, wallet balances, reservations, sessions, traveler data, account passwords or login routing.

## Verification before PR completion

- Test former Coordinator, Host and Duty Manager accounts against the same capability matrix.
- Confirm cross-venue visibility for the former Host and identical order-management access.
- With isolated fixtures, test create -> submit -> other-staff approval -> publish; test self-approval rejection.
- Confirm travelers and unauthenticated clients cannot call staff commands or assign staff access.
- Confirm ordinary sign-in remains traveler-first and manual Staff workspace switching still works.
- Build and run staff navigation, workflow, feature3 and database tests. Never create real orders or modify user bookings for verification.

## Rollout and rollback

Production database migration requires the user's approval under their earlier migration requirement. Prepare a CLI-named migration, UI changes, tests and rollback instructions after scope approval. Review the PR manually; do not auto-merge or deploy production.

Rollback removes the normalization trigger first and restores previous roles by staff ID from the private mapping. Staff accounts created after the migration require explicit role assignment on rollback; do not guess a previous role.

## Approval scope

Approve unifying all five current Staff accounts, including the Host, to the same operations capabilities and applying the same policy to future deliberately provisioned Staff accounts. This expands the former Host's access beyond its assigned venue. Independent review remains required.
