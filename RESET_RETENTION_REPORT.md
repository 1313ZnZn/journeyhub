# Retain started / checked-in reservations during reset

The prior reset aborted if any simulated reservation was no longer cancellable. The server now returns owned retained booking IDs; the UI excludes those from cancellation and reports how many are kept. Confirmation repeats the classification to handle a reservation starting after preflight. Missing/unknown session details still fail closed.

The wallet guard allows confirmed started or checked-in canonical bookings, including their linked demo records. Future unchecked bookings must still be cancelled first; unlinked legacy records remain blocked for review. Retained records keep their status, payment and seat usage. No refund is made for them.

Cloud migration applied: 20261118084408_journeyhub_reset_retain_past_bookings, project hmnbrqykvjvplrsarsta. The file version matches the actual recorded migration. Do not reapply manually. No table structure or RLS changed. Frontend awaits manual PR merge.

Validation:
- npm test: all existing suites and reset regressions passed.
- New regressions cover mixed future/past/checked-in reservations, confirmation-time reclassification, unchanged retained rows, and future-booking guard.
- build:preview passed with fake public config, 19 whitelisted resources.
- Cloud integration under coordinator.ecc364b0@example.com ran in a rollback-only transaction. Three disposable simulated bookings: one started, one checked-in, one future. Only future booking cancelled/refunded; the other two booking rows remained byte-for-byte unchanged. Wallet reset succeeded and two history records archived. Transaction rolled back, retaining no fixture changes.
- First fixture attempt failed plan validation because reason fields were missing; corrected fixture then passed. No product code workaround.
- No real order/payment or user-account reset occurred.

Not verified: browser Preview end-to-end with the new UI. Existing production page still uses previous frontend until merge/deployment. The cloud test SQL is a manually invoked rollback-only verification fixture, never a deployment migration.
