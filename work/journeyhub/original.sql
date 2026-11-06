-- =====================================================================
-- Journey Hub · database schema and starter data
-- PostgreSQL 15+ · run with:  psql -d journey_hub -f journey_hub_schema.sql
--
-- Mirrors the collections the prototype uses:
--   stores, products, inventory, experiences, sessions, bookings, orders
--   (+ items, events, VAT forms), session_plans, activity_weekly_stats,
--   travelers, cart_items, staff, venues.
-- All money is whole Thai baht (THB). Times are Asia/Bangkok (+07).
-- Starter data is dated relative to the day you run this file (Bangkok),
-- like the app's sample calendar.
-- Rules the database enforces: no overselling a session, no order line
-- beyond stock on hand, stock returned when an order is cancelled, prices
-- and totals fixed when an order is placed, and only a duty manager who
-- didn't submit a session plan can approve it.
-- Sign-in: passwords and PINs are stored only as bcrypt hashes (pgcrypto).
--   Traveler: SELECT traveler_id FROM travelers WHERE email = lower($1) AND password_hash = crypt($2, password_hash);
--   Staff:    SELECT staff_id, role FROM staff WHERE staff_id = upper($1) AND pin_hash = crypt($2, pin_hash);
-- Concept prototype: every name, price and person is illustrative.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Places and people
-- ---------------------------------------------------------------------
CREATE TABLE venues (
  venue_id      text PRIMARY KEY,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('consolidation_hub', 'workshop_venue')),
  area          text NOT NULL
);

CREATE TABLE staff (
  staff_id      text PRIMARY KEY CHECK (staff_id ~ '^[A-Z]{2}-[0-9]{4}$'),   -- printed on the badge, e.g. PS-1024
  display_name  text NOT NULL,
  role          text NOT NULL CHECK (role IN ('coordinator', 'duty_manager', 'host')),
  venue_id      text REFERENCES venues,
  pin_hash      text NOT NULL,                                              -- crypt(pin, gen_salt('bf')), never the PIN
  failed_logins smallint NOT NULL DEFAULT 0,
  locked_until  timestamptz                                                 -- set after 5 failed sign-ins
);

CREATE TABLE travelers (
  traveler_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text UNIQUE CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  password_hash         text,                -- crypt(password, gen_salt('bf')), never the password
  display_name          text NOT NULL,
  home_country          text,
  hotel_name            text,
  hotel_room            text,
  stay_from             date,
  stay_to               date,
  passport_nationality  text,
  passport_last4        char(4),            -- never store the full number
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (stay_to IS NULL OR stay_from IS NULL OR stay_to >= stay_from),
  CHECK ((email IS NULL) = (password_hash IS NULL))   -- guests checked in by partners have no account
);

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
CREATE TABLE stores (
  store_id          text PRIMARY KEY,
  name              text NOT NULL,
  kind              text NOT NULL,
  area              text NOT NULL,
  distance_km       numeric(4,1),
  opening_hours     text,
  issues_vat_forms  boolean NOT NULL DEFAULT true
);

CREATE TABLE products (
  product_id     text PRIMARY KEY,
  store_id       text NOT NULL REFERENCES stores,
  name           text NOT NULL,
  description    text,
  price_thb      integer NOT NULL CHECK (price_thb > 0),          -- list price today
  categories     text[] NOT NULL DEFAULT '{}',
  made_to_order  boolean NOT NULL DEFAULT false,
  ready_days     smallint NOT NULL DEFAULT 0 CHECK (ready_days >= 0),
  image_path     text
);
CREATE INDEX products_store_idx ON products (store_id);

-- Stock on hand, kept apart from the catalog: order lines reserve it,
-- cancellations return it (triggers below).
CREATE TABLE inventory (
  product_id     text PRIMARY KEY REFERENCES products,
  stock          integer NOT NULL CHECK (stock >= 0),
  last_order_id  text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE experiences (
  experience_id      text PRIMARY KEY,
  venue_id           text REFERENCES venues,
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('Workshop', 'Food', 'Culture')),
  price_thb          integer NOT NULL CHECK (price_thb > 0),
  duration_min       integer NOT NULL CHECK (duration_min > 0),
  rating             numeric(2,1) CHECK (rating BETWEEN 0 AND 5),
  review_count       integer NOT NULL DEFAULT 0,
  host_name          text,
  languages          text,
  host_payout_rate   numeric(4,3) NOT NULL DEFAULT 0.500 CHECK (host_payout_rate BETWEEN 0 AND 1),
  material_cost_thb  integer CHECK (material_cost_thb >= 0)   -- NULL = not yet known (shown as Pending)
);

-- One bookable date of an experience.
CREATE TABLE sessions (
  session_id                 text PRIMARY KEY,
  experience_id              text NOT NULL REFERENCES experiences,
  starts_at                  timestamptz NOT NULL,
  ends_at                    timestamptz NOT NULL,
  capacity                   integer NOT NULL CHECK (capacity BETWEEN 1 AND 40),
  seats_held_other_channels  integer NOT NULL DEFAULT 0 CHECK (seats_held_other_channels >= 0),
  price_thb                  integer CHECK (price_thb > 0),   -- NULL = experience price
  status                     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'live', 'closed', 'cancelled')),
  CHECK (ends_at > starts_at),
  CHECK (seats_held_other_channels <= capacity)
);
CREATE INDEX sessions_experience_idx ON sessions (experience_id, starts_at);

-- ---------------------------------------------------------------------
-- Bookings and check-in
-- ---------------------------------------------------------------------
CREATE TABLE bookings (
  booking_id      text PRIMARY KEY,
  session_id      text NOT NULL REFERENCES sessions,
  traveler_id     uuid REFERENCES travelers,          -- NULL for partner-channel guests
  guest_name      text NOT NULL,
  guests          smallint NOT NULL CHECK (guests BETWEEN 1 AND 6),
  channel         text NOT NULL CHECK (channel IN ('app', 'partner_site', 'partner_desk', 'concierge', 'walk_in')),
  unit_price_thb  integer NOT NULL CHECK (unit_price_thb > 0),
  status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'no_show')),
  checkin_code    char(6) NOT NULL UNIQUE CHECK (checkin_code ~ '^[A-HJKMNP-Z2-9]{6}$'),  -- shown as a QR code
  checked_in_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (checked_in_at IS NULL OR status = 'confirmed')
);
CREATE INDEX bookings_session_idx ON bookings (session_id);
CREATE INDEX bookings_traveler_idx ON bookings (traveler_id);

-- A confirmed booking may not oversell its session.
CREATE FUNCTION enforce_session_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cap   integer;
  held  integer;
  taken integer;
BEGIN
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;
  SELECT capacity, seats_held_other_channels INTO cap, held
    FROM sessions WHERE session_id = NEW.session_id FOR UPDATE;
  SELECT COALESCE(SUM(guests), 0) INTO taken
    FROM bookings
   WHERE session_id = NEW.session_id AND status = 'confirmed' AND booking_id <> NEW.booking_id;
  IF held + taken + NEW.guests > cap THEN
    RAISE EXCEPTION 'Session % has % seats left, booking % asks for %',
      NEW.session_id, cap - held - taken, NEW.booking_id, NEW.guests
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bookings_capacity
  BEFORE INSERT OR UPDATE OF guests, status, session_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION enforce_session_capacity();

-- ---------------------------------------------------------------------
-- Shopping: cart, orders, items, events, VAT refund forms
-- ---------------------------------------------------------------------
CREATE TABLE cart_items (
  traveler_id  uuid NOT NULL REFERENCES travelers ON DELETE CASCADE,
  product_id   text NOT NULL REFERENCES products,
  qty          smallint NOT NULL CHECK (qty BETWEEN 1 AND 2),   -- limit 2 per item
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (traveler_id, product_id)
);

CREATE TABLE orders (
  order_id          text PRIMARY KEY,
  traveler_id       uuid REFERENCES travelers,
  guest_name        text NOT NULL,
  hub_id            text NOT NULL REFERENCES venues,
  delivery_method   text NOT NULL CHECK (delivery_method IN ('hotel', 'international')),
  destination       text NOT NULL,
  status            text NOT NULL DEFAULT 'preparing'
                      CHECK (status IN ('preparing', 'combined', 'out_for_delivery', 'delivered', 'cancelled')),
  split_choice      text CHECK (split_choice IN ('together', 'split')),   -- guest answer when an item is late
  choice_at         timestamptz,
  import_check      text NOT NULL DEFAULT 'not_needed' CHECK (import_check IN ('not_needed', 'pending', 'cleared')),
  -- delivery address, copied onto the order when it is placed
  hotel_room        text CHECK (hotel_room ~ '^[A-Za-z0-9-]{1,6}$'),
  recipient_name    text NOT NULL,
  address_line1     text,
  city              text,
  postcode          text CHECK (postcode ~ '^[A-Za-z0-9 -]{3,10}$'),
  country           text,
  phone             text CHECK (phone ~ '^\+?[0-9 ()-]{7,20}$'),
  -- money, fixed at checkout and never recalculated from today's prices
  items_thb         integer NOT NULL CHECK (items_thb > 0),
  delivery_fee_thb  integer NOT NULL CHECK (delivery_fee_thb >= 0),
  split_fee_thb     integer NOT NULL DEFAULT 0 CHECK (split_fee_thb IN (0, 120)),
  total_thb         integer GENERATED ALWAYS AS (items_thb + delivery_fee_thb + split_fee_thb) STORED,
  placed_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at      timestamptz,
  cancelled_at      timestamptz,
  CHECK (delivery_method = 'international' OR import_check = 'not_needed'),
  CHECK (delivery_method <> 'hotel' OR hotel_room IS NOT NULL),
  CHECK (delivery_method <> 'international' OR (address_line1 IS NOT NULL AND city IS NOT NULL AND postcode IS NOT NULL AND country IS NOT NULL AND phone IS NOT NULL)),
  CHECK ((split_fee_thb > 0) = (split_choice IS NOT DISTINCT FROM 'split')),
  CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX orders_traveler_idx ON orders (traveler_id);
CREATE INDEX orders_status_idx ON orders (status);

CREATE TABLE order_items (
  order_id            text NOT NULL REFERENCES orders ON DELETE CASCADE,
  product_id          text NOT NULL REFERENCES products,
  qty                 smallint NOT NULL CHECK (qty BETWEEN 1 AND 2),
  unit_price_thb      integer NOT NULL CHECK (unit_price_thb > 0),   -- price at the time of the order
  ready_by            timestamptz,                                   -- set for made-to-order items
  received_at_hub_at  timestamptz,
  PRIMARY KEY (order_id, product_id)
);

-- An order line reserves stock; it fails if the product would go below zero.
CREATE FUNCTION reserve_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  left_now integer;
BEGIN
  SELECT stock INTO left_now FROM inventory WHERE product_id = NEW.product_id FOR UPDATE;
  IF left_now IS NULL OR left_now < NEW.qty THEN
    RAISE EXCEPTION 'Only % of % left, order % asks for %', COALESCE(left_now, 0), NEW.product_id, NEW.order_id, NEW.qty
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inventory SET stock = stock - NEW.qty, last_order_id = NEW.order_id, updated_at = now()
   WHERE product_id = NEW.product_id;
  RETURN NEW;
END $$;

CREATE TRIGGER order_items_reserve_stock
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION reserve_stock();

-- Cancelling returns every line to stock. Only orders still being prepared can be cancelled.
CREATE FUNCTION return_stock_on_cancel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    IF OLD.status <> 'preparing' THEN
      RAISE EXCEPTION 'Order % is already %, so it can no longer be cancelled', OLD.order_id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE inventory v
       SET stock = v.stock + i.qty, last_order_id = OLD.order_id, updated_at = now()
      FROM order_items i
     WHERE i.order_id = OLD.order_id AND i.product_id = v.product_id;
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orders_return_stock
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION return_stock_on_cancel();

CREATE TABLE order_events (
  event_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id  text NOT NULL REFERENCES orders ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  actor     text NOT NULL CHECK (actor IN ('guest', 'store', 'hub', 'courier', 'system')),
  message   text NOT NULL
);
CREATE INDEX order_events_order_idx ON order_events (order_id, at);

CREATE TABLE vat_refund_forms (
  order_id     text NOT NULL REFERENCES orders ON DELETE CASCADE,
  store_id     text NOT NULL REFERENCES stores,
  form_code    text NOT NULL DEFAULT 'P.P.10',
  issued_at    timestamptz,
  received_at  timestamptz,   -- when the form reached the guest (with the parcel)
  PRIMARY KEY (order_id, store_id)
);

-- ---------------------------------------------------------------------
-- Planning and reporting
-- ---------------------------------------------------------------------
CREATE TABLE session_plans (
  plan_id             text PRIMARY KEY,
  experience_id       text NOT NULL REFERENCES experiences,
  session_date        date NOT NULL,
  start_time          time NOT NULL,
  capacity            integer NOT NULL CHECK (capacity BETWEEN 10 AND 40),
  price_thb           integer NOT NULL CHECK (price_thb > 0),
  promo_budget_thb    integer NOT NULL DEFAULT 0 CHECK (promo_budget_thb >= 0),
  reason              text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 250),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'withdrawn')),
  submitted_by        text REFERENCES staff,
  approved_by         text REFERENCES staff,
  created_session_id  text REFERENCES sessions,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_by IS DISTINCT FROM submitted_by))
);

-- Only a duty manager can approve, and only someone else's plan (the CHECK above covers "someone else").
CREATE FUNCTION check_plan_approver() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND NOT EXISTS (
       SELECT 1 FROM staff WHERE staff_id = NEW.approved_by AND role = 'duty_manager') THEN
    RAISE EXCEPTION 'Only a duty manager can approve a new session (got %)', COALESCE(NEW.approved_by, 'nobody')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER session_plans_approver
  BEFORE INSERT OR UPDATE ON session_plans
  FOR EACH ROW EXECUTE FUNCTION check_plan_approver();

CREATE TABLE plan_events (
  event_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id   text NOT NULL REFERENCES session_plans ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  staff_id  text REFERENCES staff,
  message   text NOT NULL
);

-- Completed-session figures, one row per activity per week.
CREATE TABLE activity_weekly_stats (
  experience_id  text NOT NULL REFERENCES experiences,
  month          date NOT NULL CHECK (EXTRACT(day FROM month) = 1),
  week           smallint NOT NULL CHECK (week BETWEEN 1 AND 5),
  seats_offered  integer NOT NULL CHECK (seats_offered > 0),
  booked         integer NOT NULL CHECK (booked >= 0),
  cancelled      integer NOT NULL CHECK (cancelled >= 0),
  attended       integer NOT NULL CHECK (attended >= 0),
  PRIMARY KEY (experience_id, month, week),
  CHECK (booked <= seats_offered),
  CHECK (cancelled <= booked),
  CHECK (attended <= booked - cancelled)
);

-- ---------------------------------------------------------------------
-- Views the screens read
-- ---------------------------------------------------------------------

-- Seats left and check-in progress per session (Experience page, check-in desk).
CREATE VIEW v_session_seats AS
SELECT s.session_id,
       s.experience_id,
       s.starts_at,
       s.capacity,
       s.seats_held_other_channels
         + COALESCE(SUM(b.guests) FILTER (WHERE b.status = 'confirmed'), 0)                   AS seats_taken,
       s.capacity - s.seats_held_other_channels
         - COALESCE(SUM(b.guests) FILTER (WHERE b.status = 'confirmed'), 0)                   AS seats_left,
       COALESCE(SUM(b.guests) FILTER (WHERE b.status = 'cancelled'), 0)                       AS seats_cancelled,
       COALESCE(SUM(b.guests) FILTER (WHERE b.status = 'confirmed' AND b.checked_in_at IS NOT NULL), 0) AS guests_checked_in
  FROM sessions s
  LEFT JOIN bookings b ON b.session_id = s.session_id
 GROUP BY s.session_id;

-- Order totals and readiness (Bag, Orders, hub exceptions).
-- Totals come from the order row (fixed at checkout); items_match checks the lines agree.
CREATE VIEW v_order_totals AS
SELECT o.order_id,
       o.status,
       COUNT(DISTINCT p.store_id)                                  AS stores,
       SUM(i.qty)                                                   AS items,
       o.items_thb,
       o.delivery_fee_thb + o.split_fee_thb                         AS fees_thb,
       o.total_thb,
       SUM(i.qty * i.unit_price_thb) = o.items_thb                  AS items_match,
       BOOL_AND(i.received_at_hub_at IS NOT NULL)                   AS all_items_at_hub,
       BOOL_OR(p.made_to_order AND i.received_at_hub_at IS NULL)    AS waiting_on_made_to_order
  FROM orders o
  JOIN order_items i ON i.order_id = o.order_id
  JOIN products p    ON p.product_id = i.product_id
 GROUP BY o.order_id;

-- Monthly performance per activity (Insights, Compare).
-- receipts = paid seats × price; contribution = receipts − host payout − materials.
CREATE VIEW v_activity_month AS
WITH t AS (
  SELECT experience_id, month,
         COUNT(*)           AS sessions,
         SUM(seats_offered) AS seats_offered,
         SUM(booked)        AS booked,
         SUM(cancelled)     AS cancelled,
         SUM(attended)      AS attended
    FROM activity_weekly_stats
   GROUP BY experience_id, month
)
SELECT t.experience_id,
       e.name,
       t.month,
       t.sessions,
       t.seats_offered,
       t.booked,
       t.cancelled,
       t.booked - t.cancelled                                            AS paid_seats,
       t.attended,
       ROUND(100.0 * t.booked / t.seats_offered, 1)                      AS seats_filled_pct,
       ROUND(100.0 * t.cancelled / NULLIF(t.booked, 0), 1)               AS cancellation_pct,
       ROUND(100.0 * t.attended / NULLIF(t.booked - t.cancelled, 0), 1)  AS attendance_pct,
       (t.booked - t.cancelled) * e.price_thb                            AS receipts_thb,
       ROUND((t.booked - t.cancelled) * e.price_thb * e.host_payout_rate)::integer AS host_payout_thb,
       t.attended * e.material_cost_thb                                  AS materials_thb,
       (t.booked - t.cancelled) * e.price_thb
         - ROUND((t.booked - t.cancelled) * e.price_thb * e.host_payout_rate)::integer
         - t.attended * e.material_cost_thb                              AS contribution_thb
  FROM t
  JOIN experiences e ON e.experience_id = t.experience_id;

-- =====================================================================
-- Starter data (matches the prototype's seed rows)
-- =====================================================================
INSERT INTO venues VALUES
  ('silom-hub',        'Silom Hub',               'consolidation_hub', 'Silom'),
  ('riverside-hub',    'Riverside Heritage Hub',  'workshop_venue',    'Charoen Krung'),
  ('old-town-pier',    'Old Town pier',           'workshop_venue',    'Rattanakosin');

-- Demo sign-ins match the app: PS-1024 / 2468 (coordinator), NT-2001 / 1357 (duty manager).
INSERT INTO staff (staff_id, display_name, role, venue_id, pin_hash) VALUES
  ('PS-1024', 'Ploy S.',          'coordinator',  'silom-hub',     crypt('2468', gen_salt('bf', 8))),
  ('NT-2001', 'Nok T.',           'duty_manager', 'silom-hub',     crypt('1357', gen_salt('bf', 8))),
  ('SP-3001', 'Khun Somchai P.',  'host',         'riverside-hub', crypt('8642', gen_salt('bf', 8)));

-- d(n, 'HH:MM') = that time in Bangkok, n days from today (Bangkok date).
CREATE FUNCTION pg_temp.d(n integer, t time) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT (((now() AT TIME ZONE 'Asia/Bangkok')::date + n) + t) AT TIME ZONE 'Asia/Bangkok' $$;

-- Demo traveler sign-in matches the app: mia@journeyhub.demo / travel123.
INSERT INTO travelers (traveler_id, email, password_hash, display_name, home_country, hotel_name, hotel_room, stay_from, stay_to) VALUES
  ('00000000-0000-4000-8000-000000000001', 'mia@journeyhub.demo', crypt('travel123', gen_salt('bf', 8)), 'Mia Chen', 'Singapore', 'Riverside Sample Hotel', NULL,   pg_temp.d(-2, '14:00')::date, pg_temp.d(3, '12:00')::date),
  ('00000000-0000-4000-8000-000000000002', 'arjun@example.com',   crypt('arjun-demo-1', gen_salt('bf', 8)), 'Arjun P.', 'India',  'Riverside Sample Hotel', '0812', pg_temp.d(-1, '14:00')::date, pg_temp.d(2, '12:00')::date),
  ('00000000-0000-4000-8000-000000000003', 'lena@example.com',    crypt('lena-demo-1', gen_salt('bf', 8)),  'Lena K.',  'Germany', NULL,                    NULL,   pg_temp.d(-3, '14:00')::date, pg_temp.d(1, '12:00')::date);

INSERT INTO stores VALUES
  ('rf', 'Riverfront Gifts',     'Gifts',    'Charoen Krung', 0.4, '10:00–20:00', true),
  ('ct', 'City Textile Studio',  'Textiles', 'Siam',          3.1, '10:00–19:00', true);

INSERT INTO products (product_id, store_id, name, description, price_thb, categories, made_to_order, ready_days, image_path) VALUES
  ('tote',   'rf', 'Cotton tote',        'Hand-stitched cotton carryall with an embroidered front panel. 40 × 38 cm.', 600,  '{gifts}',          false, 0, 'img/prod-tote.jpg'),
  ('scarf',  'ct', 'Woven silk scarf',   'Hand-woven Thai silk in natural indigo with a neutral border. 180 × 50 cm.', 1200, '{textiles}',       true,  1, 'img/prod-scarf.jpg'),
  ('balm',   'rf', 'Herbal balm set',    'Three small balms made with lemongrass, plai and camphor. 3 × 15 g.',        350,  '{wellness,gifts}', false, 0, 'img/thumb-herbal.jpg'),
  ('runner', 'ct', 'Woven table runner', 'Cotton runner woven on the studio looms. 160 × 35 cm.',                      850,  '{textiles}',       false, 0, 'img/store-textile.jpg');

-- Stock before today's two orders; their lines reserve 2 balms, 1 runner and 1 tote,
-- leaving tote 8, scarf 5, balm 12, runner 4 (the app's starting stock).
INSERT INTO inventory (product_id, stock) VALUES
  ('tote', 9), ('scarf', 5), ('balm', 14), ('runner', 5);

INSERT INTO experiences VALUES
  ('craft',  'riverside-hub', 'Thai Craft Lab',     'Workshop', 1400, 150, 4.9, 148, 'Khun Somchai P.', 'English, Thai', 0.500, 250),
  ('silk',   'riverside-hub', 'Silk Workshop',      'Workshop', 1600, 180, 4.8, 98,  'Khun Panida S.',  'English, Thai', 0.500, 400),
  ('herbal', 'riverside-hub', 'Herbal Workshop',    'Workshop', 900,  120, 4.8, 96,  'Khun Malee T.',   'English, Thai', 0.500, 150),
  ('food',   'old-town-pier', 'Old Town Food Walk', 'Food',     900,  120, 4.9, 212, 'Khun Dao R.',     'English',       0.500, NULL);

-- Session ids are labels; dates follow today, as in the app.
INSERT INTO sessions VALUES
  ('c18', 'craft',  pg_temp.d(0, '14:00'),  pg_temp.d(0, '16:30'),  30, 0,  NULL, 'open'),
  ('c20', 'craft',  pg_temp.d(2, '14:00'),  pg_temp.d(2, '16:30'),  30, 10, NULL, 'open'),
  ('c22', 'craft',  pg_temp.d(4, '14:00'),  pg_temp.d(4, '16:30'),  30, 7,  NULL, 'open'),
  ('c25', 'craft',  pg_temp.d(7, '14:00'),  pg_temp.d(7, '16:30'),  30, 13, NULL, 'open'),
  ('c01', 'craft',  pg_temp.d(14, '14:00'), pg_temp.d(14, '16:30'), 30, 4,  NULL, 'open'),
  ('f18', 'food',   pg_temp.d(0, '11:30'),  pg_temp.d(0, '13:30'),  16, 9,  NULL, 'open'),
  ('f19', 'food',   pg_temp.d(1, '11:30'),  pg_temp.d(1, '13:30'),  16, 5,  NULL, 'open'),
  ('f20', 'food',   pg_temp.d(2, '11:30'),  pg_temp.d(2, '13:30'),  16, 2,  NULL, 'open'),
  ('f22', 'food',   pg_temp.d(4, '11:30'),  pg_temp.d(4, '13:30'),  16, 3,  NULL, 'open'),
  ('f24', 'food',   pg_temp.d(6, '11:30'),  pg_temp.d(6, '13:30'),  16, 1,  NULL, 'open'),
  ('s18', 'silk',   pg_temp.d(0, '15:30'),  pg_temp.d(0, '18:30'),  20, 18, NULL, 'open'),
  ('s21', 'silk',   pg_temp.d(3, '15:30'),  pg_temp.d(3, '18:30'),  20, 9,  NULL, 'open'),
  ('s23', 'silk',   pg_temp.d(5, '15:30'),  pg_temp.d(5, '18:30'),  20, 2,  NULL, 'open'),
  ('s25', 'silk',   pg_temp.d(7, '15:30'),  pg_temp.d(7, '18:30'),  20, 6,  NULL, 'open'),
  ('h18', 'herbal', pg_temp.d(0, '10:00'),  pg_temp.d(0, '12:00'),  25, 24, NULL, 'live'),
  ('h19', 'herbal', pg_temp.d(1, '10:00'),  pg_temp.d(1, '12:00'),  25, 6,  NULL, 'open'),
  ('h21', 'herbal', pg_temp.d(3, '10:00'),  pg_temp.d(3, '12:00'),  25, 4,  NULL, 'open'),
  ('h25', 'herbal', pg_temp.d(7, '10:00'),  pg_temp.d(7, '12:00'),  25, 11, NULL, 'open'),
  ('h01', 'herbal', pg_temp.d(14, '10:00'), pg_temp.d(14, '12:00'), 25, 3,  NULL, 'open');

-- Thai Craft Lab today: 13 bookings, 26 active seats, 21 guests checked in.
-- Check-in codes match the app's sample tickets.
INSERT INTO bookings (booking_id, session_id, traveler_id, guest_name, guests, channel, unit_price_thb, status, checkin_code, checked_in_at, created_at) VALUES
  ('B-4102', 'c18', NULL, 'Preecha S.', 2, 'partner_desk', 1400, 'confirmed', 'KJUGRF', pg_temp.d(0, '13:52'), pg_temp.d(-6, '09:10')),
  ('B-4117', 'c18', NULL, 'Apinya S.',  4, 'concierge',    1400, 'confirmed', 'JQGGK3', pg_temp.d(0, '13:47'), pg_temp.d(-5, '15:22')),
  ('B-4121', 'c18', NULL, 'David S.',   3, 'app',          1400, 'confirmed', 'B7748Z', pg_temp.d(0, '13:58'), pg_temp.d(-4, '08:05')),
  ('B-4126', 'c18', NULL, 'Somsak K.',  2, 'walk_in',      1400, 'confirmed', 'DZJ4WC', pg_temp.d(0, '13:41'), pg_temp.d(0, '13:40')),
  ('B-4133', 'c18', NULL, 'Hana Y.',    2, 'partner_site', 1400, 'confirmed', '2RZD77', pg_temp.d(0, '13:44'), pg_temp.d(-3, '20:31')),
  ('B-4140', 'c18', NULL, 'Marco R.',   3, 'app',          1400, 'confirmed', 'SZEJT5', pg_temp.d(0, '13:50'), pg_temp.d(-2, '11:48')),
  ('B-4146', 'c18', NULL, 'Nina P.',    1, 'partner_site', 1400, 'confirmed', 'MMDKVC', pg_temp.d(0, '13:53'), pg_temp.d(-2, '19:02')),
  ('B-4152', 'c18', NULL, 'Wei L.',     2, 'concierge',    1400, 'confirmed', '2TVJSH', pg_temp.d(0, '13:55'), pg_temp.d(-1, '10:14')),
  ('B-4158', 'c18', NULL, 'Ploy T.',    2, 'app',          1400, 'confirmed', 'K45DCA', pg_temp.d(0, '13:57'), pg_temp.d(-1, '17:40')),
  ('B-4161', 'c18', NULL, 'Elena R.',   2, 'partner_site', 1400, 'cancelled', 'PFGTHC', NULL,                  pg_temp.d(-7, '12:00')),
  ('B-4164', 'c18', NULL, 'Taro T.',    1, 'partner_site', 1400, 'confirmed', '4RG34Q', NULL,                  pg_temp.d(-1, '21:16')),
  ('B-4170', 'c18', NULL, 'Kanya W.',   2, 'walk_in',      1400, 'confirmed', '3GF8QD', NULL,                  pg_temp.d(0, '09:30')),
  ('B-4175', 'c18', NULL, 'Lucas M.',   2, 'app',          1400, 'confirmed', 'A9H4ST', NULL,                  pg_temp.d(0, '10:02'));

-- Two orders already at Silom Hub today. Totals are fixed here, at checkout.
INSERT INTO orders (order_id, traveler_id, guest_name, hub_id, delivery_method, destination, status, import_check,
                    hotel_room, recipient_name, address_line1, city, postcode, country, phone,
                    items_thb, delivery_fee_thb, placed_at) VALUES
  ('JH-1025', '00000000-0000-4000-8000-000000000002', 'Arjun P.', 'silom-hub', 'hotel',         'Riverside Sample Hotel', 'combined',  'not_needed',
   '0812', 'Arjun P.', NULL, NULL, NULL, NULL, NULL, 700, 120, pg_temp.d(0, '09:58')),
  ('JH-1026', '00000000-0000-4000-8000-000000000003', 'Lena K.',  'silom-hub', 'international', 'Singapore',              'preparing', 'pending',
   NULL, 'Lena K.', '88 Sample Road #04-01', 'Singapore', '088444', 'Singapore', '+65 8123 4567', 1450, 480, pg_temp.d(0, '10:05'));

INSERT INTO order_items (order_id, product_id, qty, unit_price_thb, received_at_hub_at) VALUES
  ('JH-1025', 'balm',   2, 350,  pg_temp.d(0, '10:12')),
  ('JH-1026', 'runner', 1, 850,  pg_temp.d(0, '10:36')),
  ('JH-1026', 'tote',   1, 600,  pg_temp.d(0, '10:36'));

INSERT INTO order_events (order_id, at, actor, message) VALUES
  ('JH-1025', pg_temp.d(0, '09:58'), 'system', 'Order placed · 1 store notified · stock reserved'),
  ('JH-1025', pg_temp.d(0, '10:12'), 'hub',    'Balm set received from Riverfront Gifts'),
  ('JH-1025', pg_temp.d(0, '10:31'), 'hub',    'Parcel packed and sealed'),
  ('JH-1026', pg_temp.d(0, '10:05'), 'system', 'Order placed · 2 stores notified · stock reserved'),
  ('JH-1026', pg_temp.d(0, '10:36'), 'hub',    'Both items received at Silom Hub');

INSERT INTO vat_refund_forms (order_id, store_id, issued_at, received_at) VALUES
  ('JH-1025', 'rf', pg_temp.d(0, '10:12'), NULL),
  ('JH-1026', 'rf', pg_temp.d(0, '10:36'), NULL),
  ('JH-1026', 'ct', pg_temp.d(0, '10:36'), NULL);

INSERT INTO cart_items (traveler_id, product_id, qty) VALUES
  ('00000000-0000-4000-8000-000000000001', 'tote',  1),
  ('00000000-0000-4000-8000-000000000001', 'scarf', 1);

INSERT INTO session_plans (plan_id, experience_id, session_date, start_time, capacity, price_thb, promo_budget_thb, reason, status) VALUES
  ('sat-24-oct', 'craft', pg_temp.d(6, '10:00')::date, '10:00', 30, 1400, 1500, 'Test a weekend-style morning slot for families.', 'draft');

-- September 2026, four completed sessions per activity.
INSERT INTO activity_weekly_stats VALUES
  ('craft',  '2026-09-01', 1, 30, 26, 3, 21),
  ('craft',  '2026-09-01', 2, 30, 27, 2, 23),
  ('craft',  '2026-09-01', 3, 30, 28, 3, 23),
  ('craft',  '2026-09-01', 4, 30, 29, 2, 25),
  ('silk',   '2026-09-01', 1, 20, 18, 2, 15),
  ('silk',   '2026-09-01', 2, 20, 19, 1, 17),
  ('silk',   '2026-09-01', 3, 20, 19, 2, 16),
  ('silk',   '2026-09-01', 4, 20, 20, 1, 18),
  ('herbal', '2026-09-01', 1, 25, 16, 1, 13),
  ('herbal', '2026-09-01', 2, 25, 18, 3, 14),
  ('herbal', '2026-09-01', 3, 25, 21, 1, 18),
  ('herbal', '2026-09-01', 4, 25, 25, 3, 19);

COMMIT;

-- Quick checks:
--   SELECT * FROM v_session_seats WHERE session_id = 'c18';   -- 26 taken, 4 left, 21 checked in
--   SELECT name, receipts_thb, contribution_thb FROM v_activity_month ORDER BY contribution_thb DESC;
--   SELECT * FROM v_order_totals;                              -- totals fixed at checkout
--   SELECT * FROM inventory ORDER BY product_id;              -- tote 8, scarf 5, balm 12, runner 4
--   SELECT staff_id, role FROM staff WHERE staff_id = 'NT-2001' AND pin_hash = crypt('1357', pin_hash);   -- signs in
