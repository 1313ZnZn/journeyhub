LIVE PLACE SEARCH UPDATE
See README-Discovery.txt for Google Places setup, current deployment status,
provider-data limits and the separate self-guided discovery flow. Existing
catalog reservations described below remain unchanged.

JOURNEYHUB — DEEPSEEK AGENT WORKFLOW
25 October 2026

CURRENT DEPLOYMENT
Project: YOUR_PROJECT_REF
The workflow database, journeyhub-agent and journeyhub-mail Edge Functions,
and two minute-by-minute server schedules are deployed on the existing Supabase
project. Existing bookings, sessions, app tabs and local journals are preserved.
DeepSeek is configured and a live two-round planning call passed on 24 Oct 2026.
It queried three real Shanghai catalog sessions and returned a valid itinerary
in 4.515 seconds. Email remains unconfigured at the owner's request.
The UI reports this accurately and never substitutes a sample for a real AI run.
The multi-day preference/progress migration and journeyhub-agent version 9 were
deployed on 25 Oct 2026. A signed-in live DeepSeek run saved three different
Shanghai activities across 26–27 Oct, with a validated travel buffer. Map/day
selection and the approval gate were checked in the browser. The run remains
unconfirmed: zero booking jobs and zero email jobs were created for it.

DEEPSEEK CONFIGURATION (ALREADY SAVED ON THIS PROJECT)
1. Open https://supabase.com/dashboard/project/YOUR_PROJECT_REF/functions/secrets
2. Add a server secret named DEEPSEEK_API_KEY with your own DeepSeek API key.
   Do not paste it in chat, config.js, browser code or a shared file.
3. Defaults already select deepseek / deepseek-flash. Optional overrides:
   JOURNEYHUB_AI_PROVIDER=deepseek and JOURNEYHUB_AI_MODEL=deepseek-flash.
4. In Journey > AI travel agent, press Check connection again. Configuration
   readiness is a key-presence check, not a provider billing/availability probe.
5. Sign in using a verified traveler account and generate a new plan. Successful
   generation is the actual provider verification. It consumes your API quota.
   Review every session and total, tick approval, then confirm reservations.
   The worker normally processes the queue on the next minute tick.

Supabase Auth email confirmation remains enabled. Auth registration emails are
configured separately from trip reminder emails. Public registration may still
need custom Auth SMTP; this work does not silently disable verification or create
an administrator account.

WHAT THE AGENT DOES
DeepSeek receives trip preferences, then calls a read-only available-session
tool. JourneyHub supplies the real catalog from Supabase. A second model response
creates an English itinerary. Both the Edge Function and database validate it.
The model has no booking, payment or email tool.

Trips support 1–4 consecutive days, daily start/end hours and walking/driving.
Swipe choices become wanted or skipped catalog experience IDs. Skipped experiences
are excluded; wanted experiences are prioritized when sessions and budget permit.
The server validates every stop against those dates, hours, prices and inventory,
with at most twelve sessions. A selected day may have no matching bookable session.

The day selector and route map use the saved itinerary's local dates and locations.
Current sample pins are landmark/area references, not confirmed meeting points.
Map lines show stop order, not turn-by-turn routes. Transfer distance/time is an
estimate from area coordinates: straight-line distance x 1.3, walking 4.5 km/h or
driving 25 km/h, plus ten minutes, rounded up to five minutes (minimum fifteen).
Missing coordinates use a thirty-minute buffer with no invented distance. No live
traffic, routing or transit timetable is fetched. Same-day sessions must leave
enough estimated transfer time; there is no transfer leg between overnight days.

Planning progress is saved as work happens: receiving, checking catalog, planning,
validating, then awaiting confirmation. The page can poll the in-flight request;
there is no simulated completion percentage. Booking progress comes from confirmed
run/job state. Completed plans and progress remain available after reopening.

The traveler sees authoritative sessions, venue-local dates/times, guest counts,
and THB prices. Confirmation freezes the exact plan hash/version and email choice.
Server jobs reserve the entire itinerary atomically using existing inventory.
Changed prices, capacity, times, destination or venue stop execution. No partial
itinerary is left behind. Repeated confirmation uses the same approved run.
Queue progress and bookings survive page closure and are private to each account.

These are REAL DATABASE WRITES against the existing SAMPLE JourneyHub catalog.
They are not external supplier tickets, charges, flight bookings or hotel bookings.

EMAIL — OPTIONAL AND CURRENTLY OFF
Booking works with emails off. When configured later, travelers must explicitly
opt in; only their verified account email is used. Each booked session gets a
confirmation and, where timing permits, a reminder around two hours before start.
If booking is within two hours, the reminder is scheduled at least five minutes
after booking; sessions within fifteen minutes get no reminder.

Future SMTP setup: JOURNEYHUB_MAIL_PROVIDER=smtp, SMTP_HOST, SMTP_PORT=465,
SMTP_USER, SMTP_PASSWORD, JOURNEYHUB_MAIL_FROM, and an HTTPS JOURNEYHUB_APP_URL.
Supabase hosted Edge Functions block port 587. Use TLS port 465 with a valid
certificate, or select an API mail provider instead. The included Resend adapter
uses JOURNEYHUB_MAIL_PROVIDER=resend and RESEND_API_KEY plus MAIL_FROM/APP_URL.
MAIL_FROM and APP_URL above mean JOURNEYHUB_MAIL_FROM/JOURNEYHUB_APP_URL.
Do not configure any email provider until you want to enable opt-in reminders.

SMTP cannot guarantee exactly-once delivery. Ambiguous sends and expired SMTP
leases stop with delivery_unknown for manual review; they are not resent blindly.
The UI reports provider acceptance, not delivery. Delivery/bounce webhooks are
not implemented. The worker never trusts recipients submitted by the browser.

SECURITY AND RELIABILITY
All sensitive keys stay in server secrets. The public client key in config.js
is intentionally public. Private workflow tables have RLS and no client writes.
Authenticated users can only list, read and confirm their own runs. Planning and
worker RPCs are service-role-only. Each Edge handler performs its own auth check.
The mail worker uses a dedicated Vault secret generated in the database; it is
not printed or shipped in this package. Requests cannot choose arbitrary jobs.
Plans expire after thirty minutes or at the first session, whichever comes first.
Planning is limited to six new requests per hour and twenty per day per account.
Transient database failures are retried with bounded delays. Booking jobs use
row locks; emails use leases, bounded retries and stable provider identifiers.

FILES AND REDEPLOYMENT
backend/agent-backend.sql: additive workflow schema for an existing JourneyHub DB.
backend/agent-schedule.sql: project-specific extensions, Vault token and cron.
backend/20261023173356_journeyhub_agent_watchdog.sql: stale-planning recovery.
backend/20261025061911_journeyhub_multiday_preferences_progress.sql: multi-day
preferences, area coordinates, estimated transfers and leased progress RPCs.
backend/supabase/functions/: Edge Function sources, SMTP dependency lock.
backend/.env.example: empty server-secret template only.
Do not re-run migrations already applied to this project. For a fresh project,
apply database.sql, then agent-backend.sql, the watchdog SQL and the multi-day SQL.
Then apply backend/20261025071728_journeyhub_catalog_expansion.sql to add the
36 researched sample itineraries and 31 days of illustrative session inventory.
Deploy both Edge Functions, then apply the scheduler after replacing its project
URL. Never reuse another project's keys.
Both functions require verify_jwt=false because their handlers authenticate users
or the dedicated worker secret themselves. Do not remove handler authentication.

UI AND SAMPLE PREVIEWS
Journey is now the default traveler landing page and the first navigation tab.
Its AI destination, date and request form is directly editable at the top; no
intermediate entry button is required. More preferences collapses guests, trip
length, transport, daily hours, swipe choices and sample preview. Saved agent trips,
memories and reservation links appear below. Generating from home shows the same
saved server progress and retains the explicit review/confirmation gate. The
Bangkok planner shortcut is removed. Existing reservations and saved days remain
under Explore > Your reservations, with original ticket controls. Journey shows
only unconfirmed agent drafts; approved/queued/reserved agent itineraries appear
under Explore. This moves navigation only, without changing reservation data.
The homepage includes destination photo cards, additive/toggleable interest chips,
a destination-local Tomorrow shortcut. Travelers submit their requirements first,
then choose places with swipe cards, then generate their AI plan. They can skip
the remaining cards at any time; chosen preferences are retained. Guest choices
are carried through sign-in and return to the cards before explicit generation.
Explore, Journey, Shop, Orders, Me, Bangkok planner, staff screens, checkout,
saved plans, addresses, VAT and travel memories remain. AI is inside Journey.
Sample itinerary preview is a separate, explicit choice; it does not call AI,
automatically reserve anything or send a reminder. Existing manual sample booking
still works. Travel memory photos remain local IndexedDB, scoped by account.

VERIFICATION
Database regression tests run in a local PostgreSQL transaction and roll back.
They exercise ownership, exact approval, changed price/venue/capacity, atomic
rollback/retry, duplicate confirmation, verified recipients and mail leases.
Original database tests also pass. UI tests cover existing features, journals,
confirmation/email gates, account changes and stale response ordering.
The multi-day SQL suite covers local dates/hours, exclusions, preferred ordering,
transfer buffers, progress ownership and lease fencing, immutable coordinates,
atomic rollback when a later day loses inventory, and pre-migration plan approvals.
Handler tests prove progress is persisted while the AI request is still pending.
Provider tests use mocked HTTP/SMTP; no real message or paid ticket was created.
Deployed health reports AI configured and worker ready; email is unconfigured.
The earlier read-only DeepSeek/catalog check is recorded in Agent-Verification.json.
The new signed-in browser check is recorded in MultiDay-Verification.json: the
saved two-day plan has three distinct experiences, one estimated travel leg, all
four saved planning stages, and no confirmation, booking jobs or email jobs.
The browser also verified day filtering, stop selection, and a disabled reservation
button until explicit approval. Booking execution was tested locally with rollback,
not against the user's inventory in this release. Email delivery remains untested.
The 25 Oct security check reported no database policy/function warnings; Auth
leaked-password protection remains disabled. Older test-http.cjs uses expired
temporary-account fixtures and is not part of this release's passing suite.

The provider response is checked for real IDs, distinct experiences, dates, hours,
capacity, budget and travel time. When a distinct, affordable activity is available
for every requested date, each date must be covered. Selected stops are sorted by
catalog time. Empty/unreadable JSON, missing dates or repeated places allow one
shared, time-bounded correction attempt. Persistent errors are shown to the traveler;
no sample or invented itinerary replaces a failed response.

REFERENCES
DeepSeek: https://api-docs.deepseek.com/
Tool calls: https://api-docs.deepseek.com/guides/tool_calls/
Supabase scheduling: https://supabase.com/docs/guides/functions/schedule-functions
Server secrets: https://supabase.com/docs/guides/functions/secrets
