Calendar management — 4 November 2026

Calendar and Trip history now offer Delete plan for saved history and agent plans.
Deletion removes the complete saved version from personal lists, retains its data,
and pauses linked trip support. It does not cancel separate reservations.
Removed items provides account-scoped restore; restoring does not restart agents.

Future, confirmed JourneyHub inventory reservations offer Cancel reservation in
Calendar and the ticket detail sheet. The database checks ownership, start time,
check-in status and concurrent work, cancels the reservation, releases capacity,
stops pending reminders for that booking, and pauses linked catalog trip support.
Past or checked-in reservations offer Remove from calendar without changing
attendance. No supplier order, payment, refund or Fliggy booking is modified.

Database: calendar-management.sql. Public RPCs journeyhub_calendar_state and
journeyhub_calendar_manage use the signed-in user's identity. Removal state is
stored in journey_hub.calendar_removed_items. Mutations are request-idempotent.
Confirmation is required in the UI; no production user record was deleted for QA.

Validation:
- calendar-management-test.sql runs in BEGIN/ROLLBACK with disposable identities.
  Covers ownership, stale work, reminders, recovery, inventory, Staff Insights,
  checked-in/past protections and unchanged historical results.
- test-calendar-management.cjs tests the built UI with mocked transports.
- test-calendar-ui.cjs covers day grouping, navigation and existing behavior.
- calendar-preview.cjs creates an offline-only visual fixture, never published.

Build: node work/journeyhub/build.cjs
Tests: node work/journeyhub/test-calendar-management.cjs
       node work/journeyhub/test-calendar-ui.cjs
