# Repository map

## Main directories

| Location | Purpose |
| --- | --- |
| `work/journeyhub/` | Frontend, CSS, HTML templates, builds, catalogue and feature tests |
| `work/journeyhub/supabase/functions/` | Edge entrypoints, planner workers and domain tools |
| `work/journeyhub/supabase/migrations/` | Ordered, versioned database migrations |
| `services/agent-api/` | Optional Python/FastAPI LangChain and LangGraph service |
| `scripts/` | Workspace verification wrappers |
| `docs/` | Current guides, architecture notes and historical reports |
| `outputs/JourneyHub-Supabase/` | Generated development package, including SQL; ignored |
| `outputs/JourneyHub-Vercel/` | Generated allowlisted public frontend; ignored |
| `.artifacts/`, `.local/` | Optional private local evidence and scratch files; ignored |

## Find a feature

| Area | Main files under `work/journeyhub/` |
| --- | --- |
| Bootstrap and composition | `frontend.js`, `original.html`, `build.cjs` |
| Homepage and desktop | `journey-home.*`, `desktop-web.*`, `landing-ui.*` |
| Discovery and planning | `place-discovery.*`, `journey-planning.*`, `traveler-planner-ui.*`, `planning-flow.js` |
| Calendar and weather | `calendar-ui.*`, `calendar-weather.js`, `calendar-management.*` |
| Pip and Trip Agent | `pip.*`, `pip-debate.*`, `pip-booking.*`, `trip-chat.*`, `traveler-agent.*` |
| Memories | `journal-store.js`, `journal-ui.*`, `memory-agent.*` |
| Simulated bookings and wallet | `unified-booking-ui.*`, `demo-wallet.*` |
| Account reset | `account-reset.js`, `account-reset.sql` and corresponding migrations |
| Staff publication | `staff-workflow.*`, `staff-feature3.*`, `staff-operations.js` |

Here `.*` denotes related files such as `.js` and `.css`, not a command. The build
concatenates modules in an explicit order; retain that order and relative paths
when making unrelated edits.

## Agent and database

Edge domain modules live in
`work/journeyhub/supabase/functions/journeyhub-agent/`. Planner, care, mail and
visit-research entrypoints have their own sibling directories. The optional
Python service changes the central decision runtime; it does not replace every
Edge helper or activate through a frontend build.

Top-level feature `.sql` files are source definitions or fixtures used by existing
builds and tests. Their presence does not mean they should all be run against a
database. Migration history is specifically in `supabase/migrations/`.

## Selected verification entrypoints

| Command from the repository root | Scope |
| --- | --- |
| `npm test` | Selected weather, Calendar, reset and chat regressions; see `package.json` for the exact list |
| `npm run test:agent` | Python service plus Node/Edge caller regressions |
| `node work/journeyhub/test-staff-direct-publication.cjs` | Staff publication with an isolated database |
| `node work/journeyhub/test-staff-workflow-ui.cjs` | Staff workflow UI with mocked transport |
| `node work/journeyhub/test-journal-store.cjs` | Browser memory storage regression |
| `node work/journeyhub/test-trip-chat-payments.cjs` | Virtual-payment UI and confirmation regressions |

These are entrypoints, not a claim that live website tests passed. SQL rollback
fixtures require a deliberate database target and are not routine frontend
deployment steps.

## File placement

Current how-to guidance belongs in `docs/development/` or `docs/deployment/`.
Dated plans and verification reports belong in the relevant `docs/history/`
feature folder. Add links to the [documentation index](../README.md).

Keep `media/` and vendored assets at their existing paths and retain licenses.
Keep tests beside modules they currently reference. Do not commit generated
output, user data, private screenshots, local credentials or dependencies.
Historical branches and worktrees must not be deleted without checking their
unmerged commits and local changes.
