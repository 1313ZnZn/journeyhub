LIVE PLACE DISCOVERY — GOOGLE PLACES + DEEPSEEK

2026-11-04 card counts and daily coverage
- Fresh searches target 8 / 12 / 14 / 16 cards for 1 / 2 / 3 / 4 days.
- Search and curation preserve distinct verified places and mixed interests. A
  bounded re-ranking attempt fills a short AI selection from existing candidates.
  If suitable provider results are insufficient, the UI reports the shortfall.
- Every newly generated day contains at least one selected stop. Too few liked
  places prompts the traveler to select more; Skip choices are never overridden.
- Invalid AI schedules are repaired from verified stop ordering, then validated
  for daily coverage, hours and transfer time. Invalid repairs fail explicitly.
- New itinerary revisions use the daily-coverage-v2 identity; old history stays
  readable. discovery-card-limits.sql raises persisted stops from 12 to 16.
- test-discovery-card-limits.sql verifies 16-stop save/reopen in a rollback-only
  transaction. Tests and preview fixtures create no real bookings or emails.

Status of this delivery
Updated 2026-10-26: the quota SQL is deployed and journeyhub-agent version 13 is
active. Health reports Google Places and DeepSeek configured. A signed-in Shanghai
search returned 12 live places with provider photos and credits. DeepSeek generated a 4-day Shanghai itinerary with 10 verified places; the
skipped People's Park was excluded. Day filtering was checked. No reservations
or emails were triggered. Bangkok/Singapore live discovery was not tested in
this verification. Details are in Live-Discovery-Verification.json.

Activation
1. In Google Cloud, enable billing and Places API (New) for your project.
   Create an API key restricted to Places API (New). Keep it server-side.
   Set usage quotas and billing alerts in Google Cloud for your intended traffic.
2. Save GOOGLE_PLACES_API_KEY in Supabase > Edge Functions > Secrets.
   Existing DEEPSEEK_API_KEY and configured AI model remain in use.
   Do not place credentials in frontend config.js or send them in chat.
3. Apply backend/discovery-backend.sql using the project's SQL editor or a
   trusted migration workflow. It adds a private, RLS-enabled per-user quota and
   a service-role-only RPC. No existing catalog or booking records are changed.
4. Redeploy journeyhub-agent with index.ts, handler.mjs, planner.mjs and the NEW
   discovery.mjs, plus the existing shared mail module. Keep existing secrets.
   This handler verifies the user's token itself; preserve its current deployment
   verify_jwt setting. Never deploy discovery.mjs without the quota SQL.
5. Health should report discovery.ready=true. That reports configuration only;
   perform a signed-in search and itinerary generation to verify actual access.
6. Verify Shanghai, Singapore and Bangkok separately. A live search uses paid
   Places and AI calls. Confirm place sources, photos/credits, city bounds and
   recommendations; skip a place, generate, and verify it is absent. No booking
   or email request should be produced by these actions.

User flow
Requirements -> sign in if needed -> live place search -> swipe shortlist ->
self-guided itinerary with suggested times, estimated transfers and source links.
Missing setup, empty search and provider failures are explicit. A separate
"Browse JourneyHub experiences" action preserves the existing catalog planner
and its explicit confirmation-before-reservation workflow.

Data and safety boundaries
- Google supplies IDs, names, addresses, coordinates, regular hours and photos.
  DeepSeek derives search keywords, selects verified IDs and proposes visit times.
- Closed places and results outside bounded destination areas are discarded.
  AI-invented IDs, duplicates, invalid daily times and insufficient travel buffers
  are rejected. One bounded itinerary repair attempt is allowed.
- A one-hour HMAC shortlist is bound to the authenticated owner and their original
  preferences. Details are fetched again before planning. Client-supplied names,
  coordinates, prices or booking flags are never accepted.
- 12 search/plan attempts per verified user per hour, enforced atomically in SQL.
  A search involves up to 2 AI calls, 1 Places search and up to 12 photo calls;
  planning involves up to 12 place-details calls and 2 AI calls. Google Cloud
  quotas are still needed to bound total project spending.
- Provider content stays in memory in the current page session. It is not placed
  in IndexedDB, localStorage, a database, signed tokens or exported journals.
  The token contains only place IDs, preferences, owner and expiry. Reloading
  clears the live search and itinerary. Existing catalog plans remain saved.
- Photos are shown only when Google returns a usable photo URL, with author
  attribution. Otherwise a graphic card is shown, never a false venue photo.
- Google data is shown on an embedded Google map with per-day colors, numbered
  markers and Google Routes road polylines. No Google data is drawn on the
  original catalog OpenStreetMap map; that catalog map remains available.
- Regular hours are not verified for the travel date. Proposed times and
  transfers are estimates. No admission fee, ticket or supplier booking is implied.
- This release offers a separate self-guided itinerary; it does not combine it
  with fixed inventory sessions into one jointly optimized schedule. Users can
  still open the existing JourneyHub planner to request bookable experiences.
- Email is still unconfigured; this feature never sends an email or reserves.

Verification
node backend/test-discovery.cjs (from packaged backend folder)
Local SQL regression: backend/test-discovery-db.sql, rollback-only test fixtures.
Source UI suite: work/journeyhub/test-journey-planning-ui.cjs tests live discovery,
swipes, skipped-ID forwarding, unconfigured fallback and account/stale responses.
Mock tests do not demonstrate real API permission, quota, billing or regional
coverage. These remain activation checks after configuration/deployment.

Official references
https://developers.google.com/maps/documentation/places/web-service/get-api-key
https://developers.google.com/maps/documentation/places/web-service/text-search
https://developers.google.com/maps/documentation/places/web-service/place-photos
https://developers.google.com/maps/documentation/places/web-service/policies
https://supabase.com/docs/guides/functions/secrets

GOOGLE ROAD MAP UPDATE — 2026-10-26
Backend version 16 adds daily Google Routes queries after itinerary generation.
Maps JavaScript loads once per plan/account and reuses the map across day filters.
Set GOOGLE_MAPS_BROWSER_KEY to a SEPARATE browser key limited to Maps JavaScript
API and authorized website referrers (localhost and 127.0.0.1 during development).
Keep GOOGLE_PLACES_API_KEY server-side; allow Places API New and Routes API.
Optionally use GOOGLE_ROUTES_API_KEY as a separate server-only Routes key.
Never replace the server key with a website-restricted browser key. The public
map configuration endpoint rejects a browser key equal to a known server key.
Routes preserve itinerary order, request no alternatives and exclude live traffic.
Only provider polylines are drawn. Missing routes show an explicit warning, with
no invented straight road lines. Transfer-time conflicts are highlighted rather
than silently declared feasible. Single-stop/empty days require no route call.
Each generated itinerary adds at most one Routes request per multi-stop day
(up to four). Day switching does not call Routes or construct another map.
Local tests: test-place-map.cjs, test-roads.cjs, test-discovery.cjs, agent/planning
regressions and input-stability checks passed. Live verification passed on 2026-10-26 after separate keys were configured:
Singapore search returned 12 places; a 4-day/10-stop itinerary displayed Google
Maps, all four daily Google Routes results, numbered markers, day filtering,
place popup and View in itinerary linkage. Day 3 total was 7.8 km. One Day 4
transfer-buffer conflict was visibly flagged. No reservations or emails were
triggered. These checks do not verify other cities or live traffic. A subsequent
local regression also verifies passive refresh does not dismiss map popups.
