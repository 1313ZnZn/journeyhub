JOURNEYHUB CATALOG EXPANSION — 25 OCTOBER 2026

46 experiences across Bangkok (16), Shanghai (15) and Singapore (15).
The existing 10 experiences remain; 36 sample itineraries based on real places
have been added. Public descriptions and controls are in English.

EXPLORE
Use View all on Explore to open the full catalog. Filter by city and category,
search names, descriptions or neighborhoods, and sort by name, duration or
illustrative price. Detail pages retain favorites, maps and reservation controls,
with official visitor information and individual photo attribution.
New categories include Nature, Family and Art. Existing categories remain.

JOURNEY
35 new itineraries participate in the existing preference cards and session-based
AI planner. The AI reads live catalog inventory; no provider or consent settings
have changed. Pulau Ubin is browse-only because its ferry connection cannot be
represented by the current walk/drive transfer estimator. It has no reservable
sample slots and is excluded from the planning preference deck.

CONTENT AND AVAILABILITY
The migration creates one illustrative slot per eligible day for 31 days from
the date it is applied, respecting the researched weekday closures. These are
sample planning times and internal sample prices, not official venue hours,
admission prices or confirmed supplier inventory. Tickets, meals, transport and
guided services are separate. No payment is taken and no supplier has been booked.
Slots are not automatically extended. Future catalog administration can add new
dates; applying the same migration on the same day does not duplicate entries.
Existing entries, reservations and session capacities are preserved on conflicts.

30 new places have sourced area coordinates. Six remain unmapped until verified.
Coordinates describe the area, not an exact meeting point. Existing estimated
transfer-time labeling and fallback behavior remain.

SOURCES AND PHOTOS
catalog-expansion.json contains the 36 normalized records, official visitor URLs,
individual photo source, author, license, geographic source and verification date.
The three original research JSON files are included under backend/.
34 photos have Wikimedia license/source references. Two photos are official
Shanghai tourism website references with rights reserved; no open license is
claimed. Some historical photographs are explicitly labeled in the detail view.
All 36 remote image URLs were checked successfully during implementation.
Official visitor pages remain the authority for current access and restrictions.

DATABASE INSTALLATION
Existing project: this catalog migration is additive. Do not reinstall database.sql.
Fresh project: follow README-Agent.txt, including the multi-day migration, before
applying backend/20261025071728_journeyhub_catalog_expansion.sql.
The expansion does not alter authentication, RLS, AI secrets, confirmation rules
or email configuration.

VERIFICATION
Catalog-Verification.json records live counts and the AI catalog read-only check.
Local PostgreSQL tests applied the migration twice in a rollback-only transaction:
all old data and edited sample inventory were preserved. UI regression checks
passed for live public catalog browsing, categories/search/sort, input focus,
currencies, journey preferences, confirmation gates, maps and travel journals.
Browser checks verified the new photos render, including the West Bund official
image served as octet-stream. No real AI generation, reservation confirmation or
email delivery was performed for this catalog update.
