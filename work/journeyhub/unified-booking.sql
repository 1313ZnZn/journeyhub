-- One inventory reservation and ticket per paid demo item. No supplier or real payment.
-- Apply after demo-wallet.sql, calendar-management.sql and feature3.sql.
-- Integer CNY cents; catalog prices use the disclosed fixed DEMO rate THB 1 = CNY .20.
BEGIN;

ALTER TABLE journey_hub.venues ADD COLUMN demo_owner_id uuid REFERENCES auth.users(id);
ALTER TABLE journey_hub.experiences ADD COLUMN demo_owner_id uuid REFERENCES auth.users(id);
ALTER TABLE journey_hub.sessions ADD COLUMN demo_owner_id uuid REFERENCES auth.users(id);
ALTER TABLE journey_hub.sessions ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE journey_hub.bookings ADD COLUMN demo boolean NOT NULL DEFAULT false;
ALTER TABLE journey_hub.bookings ADD COLUMN source_type text;
ALTER TABLE journey_hub.bookings ADD COLUMN source_id uuid;
ALTER TABLE journey_hub.bookings ADD COLUMN stop_id text;
ALTER TABLE journey_hub.bookings ADD COLUMN unit_price_cny_minor integer;
ALTER TABLE journey_hub.bookings ADD COLUMN amount_cny_minor integer;
ALTER TABLE journey_hub.bookings ADD COLUMN payment_status text NOT NULL DEFAULT 'legacy_unpaid'
 CHECK(payment_status IN('legacy_unpaid','simulated_paid','refunded'));
ALTER TABLE journey_hub.bookings ADD CONSTRAINT bookings_demo_money CHECK(
 (unit_price_cny_minor IS NULL AND amount_cny_minor IS NULL) OR
 (unit_price_cny_minor>=0 AND amount_cny_minor=unit_price_cny_minor*guests));
ALTER TABLE journey_hub.demo_bookings ADD COLUMN booking_id text UNIQUE REFERENCES journey_hub.bookings(booking_id);
ALTER TABLE journey_hub.demo_quotes ADD COLUMN session_id text REFERENCES journey_hub.sessions(session_id);
ALTER TABLE journey_hub.demo_quotes ADD COLUMN guests integer;
ALTER TABLE journey_hub.demo_quotes ADD COLUMN budget_cny_minor integer;
ALTER TABLE journey_hub.demo_quotes ADD COLUMN itinerary_total_minor integer;
ALTER TABLE journey_hub.demo_quotes ADD COLUMN accepted boolean NOT NULL DEFAULT false;
-- The old unique key prevented an explicitly cancelled item from ever being rebooked.
ALTER TABLE journey_hub.demo_bookings DROP CONSTRAINT demo_bookings_user_id_source_type_source_id_stop_id_key;
CREATE UNIQUE INDEX demo_bookings_one_active_stop ON journey_hub.demo_bookings(user_id,source_type,source_id,stop_id)
 WHERE status='simulated_confirmed';
ALTER TABLE journey_hub.demo_bookings DROP CONSTRAINT demo_bookings_source_type_check;
ALTER TABLE journey_hub.demo_bookings ADD CONSTRAINT demo_bookings_source_type_check CHECK(source_type IN('history','run','session'));
ALTER TABLE journey_hub.demo_quotes DROP CONSTRAINT demo_quotes_source_type_check;
ALTER TABLE journey_hub.demo_quotes ADD CONSTRAINT demo_quotes_source_type_check CHECK(source_type IN('history','run','session'));
-- Legacy demo reservations allowed 50 guests. Preserve them when linking the old ledger.
ALTER TABLE journey_hub.bookings DROP CONSTRAINT bookings_guests_check;
ALTER TABLE journey_hub.bookings ADD CONSTRAINT bookings_guests_check CHECK(guests BETWEEN 1 AND 50);
ALTER TABLE journey_hub.sessions DROP CONSTRAINT sessions_capacity_check;
ALTER TABLE journey_hub.sessions ADD CONSTRAINT sessions_capacity_check CHECK(capacity BETWEEN 1 AND 200);
CREATE INDEX venues_demo_owner ON journey_hub.venues(demo_owner_id) WHERE demo_owner_id IS NOT NULL;
CREATE INDEX experiences_demo_owner ON journey_hub.experiences(demo_owner_id) WHERE demo_owner_id IS NOT NULL;
CREATE INDEX sessions_demo_owner ON journey_hub.sessions(demo_owner_id) WHERE demo_owner_id IS NOT NULL;
CREATE INDEX bookings_source ON journey_hub.bookings(source_type,source_id,stop_id);
CREATE INDEX demo_quotes_session ON journey_hub.demo_quotes(session_id) WHERE session_id IS NOT NULL;

CREATE FUNCTION journey_hub.unified_traveler(p_user_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tid uuid;u auth.users;
BEGIN
 SELECT * INTO u FROM auth.users WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT traveler_id INTO tid FROM journey_hub.travelers WHERE auth_user_id=p_user_id;
 IF tid IS NULL THEN
  INSERT INTO journey_hub.travelers(traveler_id,email,display_name,auth_user_id)
  VALUES(gen_random_uuid(),u.email,COALESCE(NULLIF(u.raw_user_meta_data->>'display_name',''),split_part(u.email,'@',1)),p_user_id)
  ON CONFLICT(auth_user_id) DO UPDATE SET auth_user_id=excluded.auth_user_id RETURNING traveler_id INTO tid;
 END IF;
 RETURN tid;
END $$;

CREATE FUNCTION journey_hub.unified_seats(p_session_id text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT greatest(0,s.capacity-s.seats_held_other_channels-COALESCE((SELECT sum(b.guests)::int FROM journey_hub.bookings b WHERE b.session_id=s.session_id AND b.status='confirmed'),0))
 FROM journey_hub.sessions s WHERE s.session_id=p_session_id
$$;

-- Private simulated venue/session: not a supplier inventory or an externally confirmed booking.
CREATE FUNCTION journey_hub.unified_demo_session(p_user_id uuid,p_source_id uuid,p_stop jsonb,p_item jsonb,p_city text,p_zone text,p_capacity integer DEFAULT 40) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token text;vid text;eid text;sid text;title text;dt date;st timestamptz;en timestamptz;price integer;
BEGIN
 token:=md5(p_user_id::text||':'||p_source_id::text||':'||(p_item->>'stopId'));
 vid:='VD-'||token;eid:='ED-'||token;
 title:=left(COALESCE(NULLIF(p_stop->>'title',''),NULLIF(p_stop->>'name',''),NULLIF(p_item->>'displayTitle',''),CASE p_item->>'kind'WHEN 'restaurant'THEN 'Restaurant reservation'WHEN 'cafe'THEN 'Cafe visit'ELSE 'Attraction visit'END),180);
 dt:=(p_item->>'date')::date;st:=(dt::text||' '||(p_item->>'start'))::timestamp AT TIME ZONE p_zone;
 en:=(dt::text||' '||(p_item->>'end'))::timestamp AT TIME ZONE p_zone;
 sid:='SD-'||md5(token||':'||st::text||':'||en::text);
 price:=greatest(1,ceil((p_item->>'unitMinor')::numeric/20)::int);
 INSERT INTO journey_hub.venues(venue_id,name,kind,area,city,country,time_zone,demo_owner_id)
 VALUES(vid,title,'workshop_venue',left(COALESCE(p_stop->>'address',p_city),300),p_city,CASE p_city WHEN 'Shanghai' THEN 'China' WHEN 'Bangkok' THEN 'Thailand' ELSE 'Singapore' END,p_zone,p_user_id)
 ON CONFLICT(venue_id) DO NOTHING;
 INSERT INTO journey_hub.experiences(experience_id,venue_id,name,kind,price_thb,duration_min,host_name,languages,details,demo_owner_id)
 VALUES(eid,vid,title,CASE WHEN p_item->>'kind' IN('restaurant','cafe') THEN 'Food' ELSE 'Culture' END,price,greatest(1,extract(epoch FROM en-st)::int/60),'Demo venue','English',
  jsonb_build_object('demo',true,'provider','simulated','placeId',COALESCE(p_stop->>'placeId',p_stop->>'id'),'image',p_stop->>'photoUrl','reservationKind',p_item->>'kind'),p_user_id)
 ON CONFLICT(experience_id) DO NOTHING;
 INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb,demo_owner_id,is_demo)
 VALUES(sid,eid,st,en,greatest(1,least(p_capacity,200)),price,p_user_id,true) ON CONFLICT(session_id) DO NOTHING;
 RETURN sid;
END $$;

CREATE OR REPLACE FUNCTION journey_hub.demo_booking_json(b journey_hub.demo_bookings) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',b.id,'bookingId',c.booking_id,'quoteId',b.quote_id,'sourceType',b.source_type,'sourceId',b.source_id,'stopId',b.stop_id,
 'kind',b.kind,'date',b.visit_date,'start',b.starts,'end',b.ends,'dayIndex',b.day_index,'unitMinor',b.unit_minor,'quantity',b.quantity,
 'amountMinor',b.amount_minor,'currency','CNY','status',CASE WHEN c.status='cancelled' THEN 'cancelled' ELSE b.status END,
 'canonicalStatus',c.status,'sessionId',c.session_id,'checkinCode',CASE WHEN c.status='confirmed' THEN c.checkin_code END,
 'checkedInAt',c.checked_in_at,'paymentStatus',c.payment_status,'reference',COALESCE(c.booking_id,b.reference),
 'createdAt',b.created_at,'cancelledAt',b.cancelled_at,'demo',true)
 FROM (SELECT 1)z LEFT JOIN journey_hub.bookings c ON c.booking_id=b.booking_id
$$;
CREATE OR REPLACE FUNCTION journey_hub.demo_quote_json(q journey_hub.demo_quotes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',q.id,'sourceType',q.source_type,'sourceId',q.source_id,'sessionId',q.session_id,'guests',q.guests,
 'revision',q.revision,'expiresAt',q.expires_at,'status',q.status,'currency','CNY','items',q.items,
 'totalMinor',q.total_minor,'amountDueMinor',q.total_minor,'itineraryTotalMinor',COALESCE(q.itinerary_total_minor,q.total_minor),
 'budgetCnyMinor',q.budget_cny_minor,'budgetExceeded',q.budget_cny_minor IS NOT NULL AND COALESCE(q.itinerary_total_minor,q.total_minor)>q.budget_cny_minor,
 'createdAt',q.created_at,'bookedAt',q.booked_at,'demo',true,'conversion',jsonb_build_object('type','fixed_demo','THB',0.20,'USD',7,'SGD',5,'CNY',1),
 'disclaimer','Virtual CNY credits only. Fixed illustrative conversion: THB 1 = CNY 0.20. No supplier booking or real payment.')
$$;

-- Revision editing synchronizes saved history and care; accepted day-of-care changes remain authoritative.
CREATE OR REPLACE FUNCTION journey_hub.demo_source(p_user_id uuid,p_source_type text,p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prefs jsonb;plan jsonb;zone text;rev text;q journey_hub.demo_quotes;care journey_hub.trip_care;
BEGIN
 IF p_user_id IS NULL OR p_source_id IS NULL OR p_source_type NOT IN('history','run') THEN RAISE EXCEPTION 'DEMO_SOURCE_NOT_FOUND';END IF;
 IF p_source_type='history' THEN SELECT h.input,h.plan INTO prefs,plan FROM journey_hub.trip_history h WHERE h.user_id=p_user_id AND h.id=p_source_id FOR UPDATE;
 ELSE SELECT r.input,r.plan INTO prefs,plan FROM journey_hub.agent_runs r WHERE r.user_id=p_user_id AND r.id=p_source_id FOR UPDATE;END IF;
 SELECT *INTO care FROM journey_hub.trip_care WHERE user_id=p_user_id AND source_type=p_source_type AND source_id=p_source_id FOR UPDATE;
 IF FOUND THEN prefs:=care.input;plan:=care.plan;END IF;
 IF prefs IS NULL OR plan IS NULL OR jsonb_typeof(plan->'stops') IS DISTINCT FROM 'array' OR jsonb_array_length(plan->'stops') NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'DEMO_SOURCE_NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items WHERE user_id=p_user_id AND kind=p_source_type AND item_id=p_source_id::text) THEN RAISE EXCEPTION 'DEMO_PLAN_REMOVED';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'stops')s WHERE COALESCE(s->>'id',s->>'sessionId') LIKE 'jh_sample_%') THEN RAISE EXCEPTION 'DEMO_SAMPLE_PLAN';END IF;
 zone:=CASE prefs->>'city' WHEN 'Shanghai' THEN 'Asia/Shanghai' WHEN 'Bangkok' THEN 'Asia/Bangkok' ELSE 'Asia/Singapore' END;
 IF (prefs->>'date')::date<(clock_timestamp() AT TIME ZONE zone)::date THEN RAISE EXCEPTION 'DEMO_TRIP_PASSED';END IF;
 rev:=md5(jsonb_build_object('input',prefs,'plan',plan)::text);
 SELECT q2.* INTO q FROM journey_hub.demo_quotes q2 WHERE q2.user_id=p_user_id AND q2.source_type=p_source_type AND q2.source_id=p_source_id
 AND q2.revision=rev AND q2.status='quoted' AND q2.expires_at>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q2.items)x WHERE x->>'bookingId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journey_hub.bookings b WHERE b.booking_id=x->>'bookingId' AND b.status='confirmed'))
 ORDER BY q2.created_at DESC LIMIT 1;
 RETURN jsonb_build_object('input',prefs,'plan',plan,'revision',rev,'sourceType',p_source_type,'sourceId',p_source_id,'quote',CASE WHEN q.id IS NULL THEN NULL ELSE journey_hub.demo_quote_json(q) END);
END $$;

CREATE OR REPLACE FUNCTION journey_hub.demo_quote_save(p_user_id uuid,p_source_type text,p_source_id uuid,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb;s jsonb;x jsonb;items jsonb:='[]';seen text[]:='{}';stopid text;k text;unit int;qty int;dn int;dt date;st text;en text;zone text;
 sid text;ss journey_hub.sessions;e journey_hub.experiences;v journey_hub.venues;old journey_hub.bookings;tid uuid;due int:=0;total int:=0;charge int;prior text;q journey_hub.demo_quotes;budget int;
BEGIN
 PERFORM journey_hub.demo_wallet_lock(p_user_id);tid:=journey_hub.unified_traveler(p_user_id);
 src:=journey_hub.demo_source(p_user_id,p_source_type,p_source_id);
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<>jsonb_array_length(src->'plan'->'stops') THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
 qty:=COALESCE((src->'input'->>'guests')::int,1);IF qty NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
 budget:=NULLIF(src->'input'->>'budgetCnyMinor','')::int;
 zone:=CASE src->'input'->>'city' WHEN 'Shanghai' THEN 'Asia/Shanghai' WHEN 'Bangkok' THEN 'Asia/Bangkok' ELSE 'Asia/Singapore' END;
 FOR s IN SELECT value FROM jsonb_array_elements(src->'plan'->'stops') LOOP
  stopid:=COALESCE(s->>'id',s->>'sessionId');sid:=NULL;prior:=NULL;old:=NULL;
  IF stopid IS NULL OR stopid=ANY(seen) THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;seen:=array_append(seen,stopid);
  IF (SELECT count(*) FROM jsonb_array_elements(p_items)i WHERE i->>'stopId'=stopid)<>1 THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  SELECT value INTO x FROM jsonb_array_elements(p_items) WHERE value->>'stopId'=stopid;
  k:=x->>'kind';IF k IS NULL OR k NOT IN('ticket','restaurant','cafe','free','unavailable') THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  IF p_source_type='run' THEN
   dt:=((s->>'startsAt')::timestamptz AT TIME ZONE zone)::date;dn:=dt-(src->'input'->>'date')::date+1;
   st:=to_char((s->>'startsAt')::timestamptz AT TIME ZONE zone,'HH24:MI');en:=to_char((s->>'endsAt')::timestamptz AT TIME ZONE zone,'HH24:MI');
  ELSE dn:=(s->>'dayIndex')::int;dt:=(src->'input'->>'date')::date+dn-1;st:=s->>'start';en:=s->>'end';END IF;
  IF dn IS NULL OR st IS NULL OR en IS NULL OR dn NOT BETWEEN 1 AND COALESCE((src->'input'->>'days')::int,1) OR st!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR en!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR st>=en THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  IF ((dt::text||' '||st)::timestamp AT TIME ZONE zone)<=clock_timestamp() THEN RAISE EXCEPTION 'DEMO_TRIP_PASSED';END IF;
  IF(x?'quantity'AND x->>'quantity'IS DISTINCT FROM qty::text)OR(x?'dayIndex'AND x->>'dayIndex'IS DISTINCT FROM dn::text)
   OR(x?'date'AND x->>'date'IS DISTINCT FROM dt::text)OR(x?'start'AND x->>'start'IS DISTINCT FROM st)OR(x?'end'AND x->>'end'IS DISTINCT FROM en)THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  SELECT * INTO ss FROM journey_hub.sessions WHERE session_id=s->>'sessionId';
  IF FOUND THEN
   sid:=ss.session_id;SELECT * INTO e FROM journey_hub.experiences WHERE experience_id=ss.experience_id;SELECT * INTO v FROM journey_hub.venues WHERE venue_id=e.venue_id;
   IF ss.demo_owner_id IS NOT NULL AND ss.demo_owner_id<>p_user_id THEN RAISE EXCEPTION 'DEMO_SOURCE_NOT_FOUND';END IF;
   IF ss.status<>'open' OR ss.starts_at<=clock_timestamp() THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
   IF ((dt::text||' '||st)::timestamp AT TIME ZONE zone)<>ss.starts_at OR ((dt::text||' '||en)::timestamp AT TIME ZONE zone)<>ss.ends_at THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
   IF s?'unitPriceThb' AND (s->>'unitPriceThb')::int<>COALESCE(ss.price_thb,e.price_thb) THEN RAISE EXCEPTION 'PRICE_CHANGED';END IF;
   unit:=COALESCE(ss.price_thb,e.price_thb)*20;k:=CASE WHEN e.kind='Food' THEN 'restaurant' ELSE 'ticket' END;
  ELSE
   IF p_source_type='run' OR NULLIF(s->>'sessionId','') IS NOT NULL THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
   IF COALESCE(x->>'unitMinor','')!~'^\d{1,7}$' THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;unit:=(x->>'unitMinor')::int;
   IF (k='ticket' AND unit NOT IN(4000,6000)) OR(k='restaurant' AND unit<>5000) OR(k='cafe' AND unit<>2000) OR(k IN('free','unavailable') AND unit<>0) THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
   IF k NOT IN('free','unavailable') THEN
    sid:=journey_hub.unified_demo_session(p_user_id,p_source_id,s,jsonb_build_object('stopId',stopid,'date',dt,'start',st,'end',en,'unitMinor',unit,'kind',k,'displayTitle',left(x->>'displayTitle',180)),src->'input'->>'city',zone);
    SELECT * INTO ss FROM journey_hub.sessions WHERE session_id=sid;
   END IF;
  END IF;
  SELECT b.* INTO old FROM journey_hub.bookings b WHERE b.traveler_id=tid AND b.status='confirmed' AND ((b.source_type=p_source_type AND b.source_id=p_source_id AND b.stop_id=stopid) OR b.session_id=sid) ORDER BY b.created_at LIMIT 1;
  IF FOUND THEN
   IF old.session_id IS DISTINCT FROM sid OR old.guests<>qty THEN RAISE EXCEPTION 'BOOKING_CHANGE_REQUIRES_CANCEL';END IF;
   prior:=old.booking_id;unit:=COALESCE(old.unit_price_cny_minor,old.unit_price_thb*20);
  END IF;
  charge:=CASE WHEN prior IS NULL THEN unit*qty ELSE 0 END;due:=due+charge;total:=total+unit*qty;
  items:=items||jsonb_build_array(jsonb_build_object('stopId',stopid,'kind',k,'title',COALESCE(s->>'title',s->>'name',x->>'displayTitle',e.name),'sessionId',sid,
   'availableSeats',CASE WHEN sid IS NULL THEN NULL ELSE journey_hub.unified_seats(sid) END,'capacity',CASE WHEN sid IS NULL THEN NULL ELSE ss.capacity END,
   'unitMinor',unit,'quantity',qty,'totalMinor',unit*qty,'amountMinor',unit*qty,'amountDueMinor',charge,'dayIndex',dn,'date',dt,'start',st,'end',en,
   'bookingId',prior,'requiresBooking',prior IS NULL AND sid IS NOT NULL,'demo',true));
 END LOOP;
 INSERT INTO journey_hub.demo_quotes(user_id,source_type,source_id,revision,items,total_minor,guests,budget_cny_minor,itinerary_total_minor)
 VALUES(p_user_id,p_source_type,p_source_id,src->>'revision',items,due,qty,budget,total)RETURNING * INTO q;
 RETURN journey_hub.demo_quote_json(q);
END $$;

CREATE FUNCTION journey_hub.demo_session_quote(p_user_id uuid,p_session_id text,p_guests integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ss journey_hub.sessions;e journey_hub.experiences;v journey_hub.venues;tid uuid;b journey_hub.bookings;q journey_hub.demo_quotes;x jsonb;unit int;sid uuid;rev text;
BEGIN
 IF p_guests IS NULL OR p_guests NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
 PERFORM journey_hub.demo_wallet_lock(p_user_id);tid:=journey_hub.unified_traveler(p_user_id);
 SELECT * INTO ss FROM journey_hub.sessions WHERE session_id=p_session_id;
 IF NOT FOUND OR(ss.demo_owner_id IS NOT NULL AND ss.demo_owner_id<>p_user_id)THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
 IF ss.status<>'open' OR ss.starts_at<=clock_timestamp() THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
 SELECT * INTO e FROM journey_hub.experiences WHERE experience_id=ss.experience_id;SELECT * INTO v FROM journey_hub.venues WHERE venue_id=e.venue_id;
 SELECT * INTO b FROM journey_hub.bookings WHERE traveler_id=tid AND session_id=p_session_id AND status='confirmed' LIMIT 1;
 IF FOUND AND b.guests<>p_guests THEN RAISE EXCEPTION 'BOOKING_CHANGE_REQUIRES_CANCEL';END IF;
 unit:=COALESCE(b.unit_price_cny_minor,b.unit_price_thb*20,COALESCE(ss.price_thb,e.price_thb)*20);
 sid:=md5(p_user_id::text||':'||p_session_id||':'||p_guests::text)::uuid;
 rev:=md5(jsonb_build_object('session',ss,'unitMinor',COALESCE(ss.price_thb,e.price_thb)*20,'guests',p_guests)::text);
 x:=jsonb_build_object('stopId',p_session_id,'title',e.name,'sessionId',p_session_id,'kind',CASE e.kind WHEN 'Food' THEN 'restaurant' ELSE 'ticket' END,
 'date',(ss.starts_at AT TIME ZONE v.time_zone)::date,'start',to_char(ss.starts_at AT TIME ZONE v.time_zone,'HH24:MI'),'end',to_char(ss.ends_at AT TIME ZONE v.time_zone,'HH24:MI'),'dayIndex',1,
 'unitMinor',unit,'quantity',p_guests,'totalMinor',unit*p_guests,'amountMinor',unit*p_guests,'amountDueMinor',CASE WHEN b.booking_id IS NULL THEN unit*p_guests ELSE 0 END,
 'bookingId',b.booking_id,'requiresBooking',b.booking_id IS NULL,'availableSeats',journey_hub.unified_seats(p_session_id),'capacity',ss.capacity,'demo',true);
 INSERT INTO journey_hub.demo_quotes(user_id,source_type,source_id,revision,items,total_minor,session_id,guests,itinerary_total_minor)
 VALUES(p_user_id,'session',sid,rev,jsonb_build_array(x),(x->>'amountDueMinor')::int,p_session_id,p_guests,unit*p_guests)RETURNING * INTO q;
 RETURN journey_hub.demo_quote_json(q);
END $$;

-- Common reservation primitive. Callers lock wallet -> source/quote -> sorted sessions.
-- The canonical booking, virtual debit and immutable receipt are one transaction.
CREATE FUNCTION journey_hub.unified_reserve(p_user_id uuid,p_quote_id uuid,p_item jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q journey_hub.demo_quotes;ss journey_hub.sessions;e journey_hub.experiences;t journey_hub.travelers;bal int;unit int;qty int;bid text;did uuid;code text;prior journey_hub.bookings;
BEGIN
 bal:=journey_hub.demo_wallet_lock(p_user_id);
 SELECT * INTO q FROM journey_hub.demo_quotes WHERE id=p_quote_id AND user_id=p_user_id AND accepted FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q.items)x WHERE x=p_item) THEN RAISE EXCEPTION 'DEMO_QUOTE_NOT_ACCEPTED';END IF;
 PERFORM journey_hub.unified_traveler(p_user_id);SELECT * INTO t FROM journey_hub.travelers WHERE auth_user_id=p_user_id;
 SELECT * INTO ss FROM journey_hub.sessions WHERE session_id=p_item->>'sessionId' FOR UPDATE;
 IF NOT FOUND OR(ss.demo_owner_id IS NOT NULL AND ss.demo_owner_id<>p_user_id) THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
 IF ss.status<>'open' OR ss.starts_at<=clock_timestamp() THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
 SELECT * INTO prior FROM journey_hub.bookings WHERE traveler_id=t.traveler_id AND status='confirmed' AND(session_id=ss.session_id OR(source_type=q.source_type AND source_id=q.source_id AND stop_id=p_item->>'stopId'));
 IF FOUND THEN
  IF prior.booking_id IS DISTINCT FROM p_item->>'bookingId' OR prior.session_id<>ss.session_id OR prior.guests<>(p_item->>'quantity')::int THEN RAISE EXCEPTION 'DEMO_QUOTE_STALE';END IF;
  RETURN prior.booking_id;
 END IF;
 IF NULLIF(p_item->>'bookingId','') IS NOT NULL THEN RAISE EXCEPTION 'DEMO_QUOTE_STALE';END IF;
 SELECT * INTO e FROM journey_hub.experiences WHERE experience_id=ss.experience_id FOR SHARE;
 unit:=(p_item->>'unitMinor')::int;qty:=(p_item->>'quantity')::int;
 IF qty NOT BETWEEN 1 AND 6 OR unit<>COALESCE(ss.price_thb,e.price_thb)*20 THEN RAISE EXCEPTION 'PRICE_CHANGED';END IF;
 IF journey_hub.unified_seats(ss.session_id)<qty THEN RAISE EXCEPTION 'CAPACITY_CHANGED';END IF;
 IF bal<unit*qty THEN RAISE EXCEPTION 'DEMO_INSUFFICIENT_FUNDS';END IF;
 did:=gen_random_uuid();bid:='B-DM-'||upper(replace(did::text,'-',''));
 LOOP
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',1+floor(random()*30)::int,1),'') INTO code FROM generate_series(1,6);
  EXIT WHEN NOT EXISTS(SELECT 1 FROM journey_hub.bookings WHERE checkin_code=code);
 END LOOP;
 INSERT INTO journey_hub.bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code,demo,source_type,source_id,stop_id,unit_price_cny_minor,amount_cny_minor,payment_status)
 VALUES(bid,ss.session_id,t.traveler_id,t.display_name,qty,'app',COALESCE(ss.price_thb,e.price_thb),code,true,q.source_type,q.source_id,p_item->>'stopId',unit,unit*qty,'simulated_paid');
 INSERT INTO journey_hub.demo_bookings(id,user_id,quote_id,source_type,source_id,stop_id,kind,visit_date,starts,ends,day_index,unit_minor,quantity,amount_minor,status,reference,booking_id)
 VALUES(did,p_user_id,q.id,q.source_type,q.source_id,p_item->>'stopId',p_item->>'kind',(p_item->>'date')::date,p_item->>'start',p_item->>'end',(p_item->>'dayIndex')::int,unit,qty,unit*qty,'simulated_confirmed',bid,bid);
 UPDATE journey_hub.demo_wallets SET balance_minor=bal-unit*qty,updated_at=now() WHERE user_id=p_user_id;
 INSERT INTO journey_hub.demo_ledger(user_id,kind,amount_minor,balance_after_minor,quote_id,booking_id)VALUES(p_user_id,'payment',-unit*qty,bal-unit*qty,q.id,did);
 RETURN bid;
END $$;

CREATE OR REPLACE FUNCTION journey_hub.demo_book(p_user_id uuid,p_quote_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bal int;req journey_hub.demo_requests;q journey_hub.demo_quotes;src jsonb;x jsonb;b text;ss journey_hub.sessions;e journey_hub.experiences;rev text;result jsonb;payload jsonb:=jsonb_build_object('quoteId',p_quote_id);
BEGIN
 IF p_request_id IS NULL OR p_quote_id IS NULL THEN RAISE EXCEPTION 'DEMO_INVALID_REQUEST';END IF;
 bal:=journey_hub.demo_wallet_lock(p_user_id);
 SELECT * INTO req FROM journey_hub.demo_requests WHERE user_id=p_user_id AND request_id=p_request_id;
 IF FOUND AND(req.operation<>'book' OR req.payload<>payload)THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED';END IF;
 SELECT * INTO q FROM journey_hub.demo_quotes WHERE user_id=p_user_id AND id=p_quote_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEMO_QUOTE_NOT_FOUND';END IF;
 IF q.status<>'booked' THEN
  IF q.source_type='session' THEN
   SELECT * INTO ss FROM journey_hub.sessions WHERE session_id=q.session_id FOR UPDATE;SELECT * INTO e FROM journey_hub.experiences WHERE experience_id=ss.experience_id;
   rev:=md5(jsonb_build_object('session',ss,'unitMinor',COALESCE(ss.price_thb,e.price_thb)*20,'guests',q.guests)::text);
  ELSE src:=journey_hub.demo_source(p_user_id,q.source_type,q.source_id);rev:=src->>'revision';END IF;
  SELECT * INTO q FROM journey_hub.demo_quotes WHERE id=p_quote_id AND user_id=p_user_id FOR UPDATE;
  IF q.revision IS DISTINCT FROM rev THEN RAISE EXCEPTION 'DEMO_QUOTE_STALE';END IF;
  IF q.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'DEMO_QUOTE_EXPIRED';END IF;
  IF q.source_type<>'session'AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.items)i
   WHERE((i->>'date')||' '||(i->>'start'))::timestamp AT TIME ZONE CASE src->'input'->>'city'WHEN 'Shanghai'THEN 'Asia/Shanghai'WHEN 'Bangkok'THEN 'Asia/Bangkok'ELSE 'Asia/Singapore'END<=clock_timestamp())THEN RAISE EXCEPTION 'DEMO_TRIP_PASSED';END IF;
  -- Unclassified stops are skipped, never charged. Only a plan with nothing bookable is refused.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q.items)i WHERE i->>'kind'<>'unavailable') THEN RAISE EXCEPTION 'DEMO_NOT_READY';END IF;
  IF bal<q.total_minor THEN RAISE EXCEPTION 'DEMO_INSUFFICIENT_FUNDS';END IF;
  -- Lock every capacity row in a stable order. Any later exception rolls back every debit and seat.
  PERFORM s.session_id FROM journey_hub.sessions s WHERE s.session_id IN(SELECT value->>'sessionId' FROM jsonb_array_elements(q.items)) ORDER BY s.session_id FOR UPDATE;
  UPDATE journey_hub.demo_quotes SET accepted=true WHERE id=q.id;
  FOR x IN SELECT value FROM jsonb_array_elements(q.items) ORDER BY value->>'sessionId' LOOP
   IF x->>'sessionId' IS NOT NULL THEN
    b:=journey_hub.unified_reserve(p_user_id,q.id,x);
    IF q.source_type='run' THEN INSERT INTO journey_hub.agent_reservations(run_id,session_id,booking_id)VALUES(q.source_id,x->>'sessionId',b)
     ON CONFLICT(run_id,session_id)DO UPDATE SET booking_id=excluded.booking_id;END IF;
   ELSE
    INSERT INTO journey_hub.demo_bookings(user_id,quote_id,source_type,source_id,stop_id,kind,visit_date,starts,ends,day_index,unit_minor,quantity,amount_minor,status,reference)
    VALUES(p_user_id,q.id,q.source_type,q.source_id,x->>'stopId',x->>'kind',(x->>'date')::date,x->>'start',x->>'end',(x->>'dayIndex')::int,0,(x->>'quantity')::int,0,CASE WHEN x->>'kind'='unavailable' THEN 'unavailable' ELSE 'not_required' END,CASE WHEN x->>'kind'='unavailable' THEN 'DEMO-SKIP-' ELSE 'DEMO-FREE-' END||gen_random_uuid()::text);
   END IF;
  END LOOP;
  IF q.source_type='history' THEN PERFORM public.journeyhub_care_confirm(p_user_id,'history',q.source_id);END IF;
  IF q.source_type='run' THEN UPDATE journey_hub.agent_runs SET status='booked',updated_at=now(),error_code=NULL WHERE id=q.source_id AND user_id=p_user_id;END IF;
  UPDATE journey_hub.demo_quotes SET status='booked',booked_at=now()WHERE id=q.id RETURNING * INTO q;
 END IF;
 INSERT INTO journey_hub.demo_requests(user_id,request_id,operation,payload,resource_id)VALUES(p_user_id,p_request_id,'book',payload,q.id)ON CONFLICT DO NOTHING;
 SELECT COALESCE(jsonb_agg(journey_hub.demo_booking_json(d) ORDER BY d.day_index,d.starts),'[]'::jsonb)INTO result FROM journey_hub.demo_bookings d WHERE d.user_id=p_user_id AND(d.quote_id=q.id OR d.booking_id IN(SELECT value->>'bookingId' FROM jsonb_array_elements(q.items)));
 -- Older unpaid catalog reservations have no wallet extension. Surface their actual
 -- canonical receipt without creating a charge or claiming virtual payment occurred.
 SELECT result||COALESCE(jsonb_agg(jsonb_build_object('id',b.booking_id,'bookingId',b.booking_id,'quoteId',q.id,'sourceType',q.source_type,'sourceId',q.source_id,
  'stopId',receipt_item->>'stopId','kind',receipt_item->>'kind','date',receipt_item->>'date','start',receipt_item->>'start','end',receipt_item->>'end','dayIndex',receipt_item->'dayIndex',
  'unitMinor',receipt_item->'unitMinor','quantity',b.guests,'amountMinor',receipt_item->'totalMinor','currency','CNY','status',CASE WHEN b.status='cancelled'THEN 'cancelled'ELSE 'simulated_confirmed'END,
  'canonicalStatus',b.status,'sessionId',b.session_id,'checkinCode',CASE WHEN b.status='confirmed'THEN b.checkin_code END,'checkedInAt',b.checked_in_at,
  'paymentStatus',b.payment_status,'reference',b.booking_id,'createdAt',b.created_at,'demo',b.demo)),'[]'::jsonb)INTO result
 FROM jsonb_array_elements(q.items)receipt_item JOIN journey_hub.bookings b ON b.booking_id=receipt_item->>'bookingId'
 JOIN journey_hub.travelers t ON t.traveler_id=b.traveler_id AND t.auth_user_id=p_user_id
 WHERE NOT EXISTS(SELECT 1 FROM journey_hub.demo_bookings d WHERE d.booking_id=b.booking_id);
 RETURN jsonb_build_object('demo',true,'wallet',journey_hub.demo_wallet_state(p_user_id),'quote',journey_hub.demo_quote_json(q),'bookings',result);
END $$;

-- Canonical cancellation is the only state transition; detail status is a compatibility projection.
CREATE FUNCTION journey_hub.unified_cancel_effects() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d journey_hub.demo_bookings;bal int;
BEGIN
 IF OLD.status='cancelled' AND NEW.status<>'cancelled' THEN RAISE EXCEPTION 'CANCELLED_BOOKING_CANNOT_REOPEN';END IF;
 IF NEW.status='cancelled' AND OLD.status<>'cancelled' THEN
  SELECT * INTO d FROM journey_hub.demo_bookings WHERE booking_id=NEW.booking_id FOR UPDATE;
  IF FOUND THEN
   IF OLD.payment_status='simulated_paid' THEN
    bal:=journey_hub.demo_wallet_lock(d.user_id);
    IF NOT EXISTS(SELECT 1 FROM journey_hub.demo_ledger WHERE booking_id=d.id AND kind='refund') THEN
     UPDATE journey_hub.demo_wallets SET balance_minor=bal+d.amount_minor,updated_at=now()WHERE user_id=d.user_id;
     INSERT INTO journey_hub.demo_ledger(user_id,kind,amount_minor,balance_after_minor,quote_id,booking_id)VALUES(d.user_id,'refund',d.amount_minor,bal+d.amount_minor,d.quote_id,d.id);
    END IF;
    NEW.payment_status:='refunded';
   END IF;
   UPDATE journey_hub.demo_bookings SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now())WHERE id=d.id;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER unified_cancel_effects BEFORE UPDATE OF status ON journey_hub.bookings FOR EACH ROW EXECUTE FUNCTION journey_hub.unified_cancel_effects();
CREATE UNIQUE INDEX demo_ledger_one_refund ON journey_hub.demo_ledger(booking_id) WHERE kind='refund' AND booking_id IS NOT NULL;

CREATE FUNCTION journey_hub.unified_cancel(p_user_id uuid,p_booking_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b journey_hub.bookings;s journey_hub.sessions;tid uuid;
BEGIN
 PERFORM journey_hub.demo_wallet_lock(p_user_id);
 SELECT traveler_id INTO tid FROM journey_hub.travelers WHERE auth_user_id=p_user_id;
 SELECT * INTO b FROM journey_hub.bookings WHERE booking_id=p_booking_id AND traveler_id=tid;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEMO_BOOKING_NOT_FOUND' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM journey_hub.sessions WHERE session_id=b.session_id FOR UPDATE;
 SELECT * INTO b FROM journey_hub.bookings WHERE booking_id=p_booking_id AND traveler_id=tid FOR UPDATE;
 IF b.status='cancelled' THEN RETURN;END IF;
 IF b.status<>'confirmed' OR b.checked_in_at IS NOT NULL OR s.starts_at<=clock_timestamp()THEN RAISE EXCEPTION 'RESERVATION_CANNOT_BE_CANCELLED';END IF;
 PERFORM id FROM journey_hub.agent_mail_jobs WHERE booking_id=b.booking_id AND status IN('pending','leased') ORDER BY id FOR UPDATE NOWAIT;
 IF EXISTS(SELECT 1 FROM journey_hub.agent_mail_jobs WHERE booking_id=b.booking_id AND status='leased')THEN RAISE EXCEPTION 'REMINDER_IN_PROGRESS';END IF;
 UPDATE journey_hub.agent_mail_jobs SET status='failed',last_error='BOOKING_CANCELLED'WHERE booking_id=b.booking_id AND status='pending';
 UPDATE journey_hub.bookings SET status='cancelled'WHERE booking_id=b.booking_id;
END $$;

CREATE OR REPLACE FUNCTION journey_hub.demo_cancel(p_user_id uuid,p_booking_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req journey_hub.demo_requests;d journey_hub.demo_bookings;payload jsonb:=jsonb_build_object('bookingId',p_booking_id);
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'DEMO_INVALID_REQUEST';END IF;
 PERFORM journey_hub.demo_wallet_lock(p_user_id);
 SELECT * INTO req FROM journey_hub.demo_requests WHERE user_id=p_user_id AND request_id=p_request_id;
 IF FOUND AND(req.operation<>'cancel' OR req.payload<>payload)THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED';END IF;
 SELECT * INTO d FROM journey_hub.demo_bookings WHERE id=p_booking_id AND user_id=p_user_id;
 IF NOT FOUND OR d.booking_id IS NULL THEN RAISE EXCEPTION 'DEMO_BOOKING_NOT_FOUND';END IF;
 PERFORM journey_hub.unified_cancel(p_user_id,d.booking_id);
 INSERT INTO journey_hub.demo_requests(user_id,request_id,operation,payload,resource_id)VALUES(p_user_id,p_request_id,'cancel',payload,p_booking_id)ON CONFLICT DO NOTHING;
 SELECT * INTO d FROM journey_hub.demo_bookings WHERE id=p_booking_id;
 RETURN jsonb_build_object('demo',true,'wallet',journey_hub.demo_wallet_state(p_user_id),'booking',journey_hub.demo_booking_json(d));
END $$;

-- Preserve the mature shopping/staff operations, replacing only manual booking dispatch.
ALTER FUNCTION journey_hub.command(text,jsonb,uuid) RENAME TO command_before_unified;
CREATE FUNCTION journey_hub.command(p_operation text,p_payload jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid();q journey_hub.demo_quotes;r jsonb;
BEGIN
 IF p_operation<>'book' THEN RETURN journey_hub.command_before_unified(p_operation,p_payload,p_request_id);END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='42501';END IF;
 IF NULLIF(p_payload->>'quoteId','')IS NULL THEN RAISE EXCEPTION 'DEMO_QUOTE_REQUIRED';END IF;
 SELECT * INTO q FROM journey_hub.demo_quotes WHERE id=(p_payload->>'quoteId')::uuid AND user_id=uid AND source_type='session';
 IF NOT FOUND OR q.session_id IS DISTINCT FROM p_payload->>'sessionId' OR q.guests IS DISTINCT FROM (p_payload->>'guests')::int THEN RAISE EXCEPTION 'DEMO_QUOTE_STALE';END IF;
 r:=journey_hub.demo_book(uid,q.id,p_request_id);
 RETURN r||jsonb_build_object('id',r->'bookings'->0->>'bookingId');
END $$;

-- Take the wallet lock first, preserving existing calendar events/mail/visibility behavior.
ALTER FUNCTION journey_hub.calendar_manage(text,text,text,uuid) RENAME TO calendar_manage_before_unified;
CREATE FUNCTION journey_hub.calendar_manage(p_kind text,p_id text,p_action text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='42501';END IF;
 IF p_kind='booking' AND p_action='cancel' THEN PERFORM journey_hub.demo_wallet_lock(auth.uid());END IF;
 RETURN journey_hub.calendar_manage_before_unified(p_kind,p_id,p_action,p_request_id);
END $$;

-- Snapshot keeps all forecasting math, historical results and catalog behavior intact.
ALTER FUNCTION journey_hub.snapshot() RENAME TO snapshot_before_unified;
CREATE FUNCTION journey_hub.snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;ops boolean;key text;rows jsonb;
BEGIN
 r:=journey_hub.snapshot_before_unified();ops:=EXISTS(SELECT 1 FROM journey_hub.staff WHERE auth_user_id=auth.uid()AND role IN('coordinator','duty_manager','host'));
 FOREACH key IN ARRAY ARRAY['venues','experiences','sessions']LOOP
  SELECT COALESCE(jsonb_agg(x-'demo_owner_id'),'[]'::jsonb)INTO rows FROM jsonb_array_elements(r->key)x WHERE ops OR x->>'demo_owner_id' IS NULL OR x->>'demo_owner_id'=auth.uid()::text;
  r:=jsonb_set(r,ARRAY[key],rows);
 END LOOP;
 RETURN r||jsonb_build_object('bookingCurrency','CNY','bookingDemoConversion',jsonb_build_object('THB',0.20,'USD',7,'SGD',5,'CNY',1,'type','fixed_demo'));
END $$;

-- Backfill historical payment details without charging or refunding anything.
DO $$
DECLARE d journey_hub.demo_bookings;q journey_hub.demo_quotes;src jsonb;stop jsonb;item jsonb;sid text;tid uuid;bid text;code text;zone text;city text;
BEGIN
 FOR d IN SELECT * FROM journey_hub.demo_bookings WHERE booking_id IS NULL AND kind IN('ticket','restaurant','cafe') ORDER BY created_at,id LOOP
  SELECT * INTO q FROM journey_hub.demo_quotes WHERE id=d.quote_id;
  IF d.source_type='history' THEN SELECT jsonb_build_object('input',input,'plan',plan)INTO src FROM journey_hub.trip_history WHERE id=d.source_id AND user_id=d.user_id;
  ELSE SELECT jsonb_build_object('input',input,'plan',plan)INTO src FROM journey_hub.agent_runs WHERE id=d.source_id AND user_id=d.user_id;END IF;
  SELECT value INTO stop FROM jsonb_array_elements(COALESCE(src->'plan'->'stops','[]'::jsonb))s WHERE COALESCE(s->>'id',s->>'sessionId')=d.stop_id LIMIT 1;
  city:=COALESCE(src->'input'->>'city','Shanghai');zone:=CASE city WHEN 'Shanghai' THEN 'Asia/Shanghai'WHEN 'Bangkok'THEN 'Asia/Bangkok'ELSE 'Asia/Singapore'END;
  item:=jsonb_build_object('stopId',d.stop_id,'date',d.visit_date,'start',d.starts,'end',d.ends,'unitMinor',d.unit_minor,'kind',d.kind);
  -- Historical demo rows never deducted catalog inventory: preserve that truth with private demo slots.
  sid:=journey_hub.unified_demo_session(d.user_id,d.source_id,COALESCE(stop,jsonb_build_object('title','Archived demo visit')),item,city,zone,greatest(40,d.quantity));
  tid:=journey_hub.unified_traveler(d.user_id);bid:='B-DM-'||upper(replace(d.id::text,'-',''));
  LOOP SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',1+floor(random()*30)::int,1),'')INTO code FROM generate_series(1,6);EXIT WHEN NOT EXISTS(SELECT 1 FROM journey_hub.bookings WHERE checkin_code=code);END LOOP;
  INSERT INTO journey_hub.bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,status,checkin_code,created_at,demo,source_type,source_id,stop_id,unit_price_cny_minor,amount_cny_minor,payment_status)
  SELECT bid,sid,tid,t.display_name,d.quantity,'app',greatest(1,ceil(d.unit_minor::numeric/20)::int),CASE d.status WHEN 'cancelled'THEN 'cancelled'ELSE 'confirmed'END,code,d.created_at,true,d.source_type,d.source_id,d.stop_id,d.unit_minor,d.amount_minor,CASE d.status WHEN 'cancelled'THEN 'refunded'ELSE 'simulated_paid'END FROM journey_hub.travelers t WHERE t.traveler_id=tid;
  UPDATE journey_hub.demo_bookings SET booking_id=bid WHERE id=d.id;
 END LOOP;
END $$;

-- The background catalog Agent executes the same paid reservation primitive.
CREATE OR REPLACE FUNCTION journey_hub.agent_process_bookings(p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job journey_hub.agent_booking_jobs;r journey_hub.agent_runs;a journey_hub.agent_approvals;t journey_hub.travelers;
 item jsonb;items jsonb;q jsonb;receipt jsonb;bid text;code text;snapshot jsonb;done int:=0;bad int:=0;err text;retryable boolean;
BEGIN
 WITH stale AS(SELECT id FROM journey_hub.agent_runs WHERE status='planning' AND planning_until<now()-interval '1 minute' ORDER BY planning_until,id LIMIT 100 FOR UPDATE SKIP LOCKED),
 expired AS(UPDATE journey_hub.agent_runs expired_run SET status='failed',error_code='PLANNER_TIMEOUT',updated_at=now() FROM stale s WHERE expired_run.id=s.id AND expired_run.status='planning' RETURNING expired_run.id)
 INSERT INTO journey_hub.agent_events(run_id,type,detail)SELECT id,'planning_failed',jsonb_build_object('code','PLANNER_TIMEOUT','source','watchdog')FROM expired;
 FOR job IN SELECT * FROM journey_hub.agent_booking_jobs WHERE status='pending' AND run_at<=now() ORDER BY run_at,id LIMIT greatest(1,least(COALESCE(p_limit,10),50)) FOR UPDATE SKIP LOCKED LOOP
  UPDATE journey_hub.agent_booking_jobs SET status='processing',attempts=attempts+1 WHERE id=job.id;
  BEGIN
   SELECT * INTO r FROM journey_hub.agent_runs WHERE id=job.run_id;
   PERFORM journey_hub.demo_wallet_lock(r.user_id);
   SELECT * INTO r FROM journey_hub.agent_runs WHERE id=job.run_id FOR UPDATE;
   -- Direct user-confirmed wallet execution can finish a previously queued run.
   -- A later worker claim acknowledges the same receipts instead of overwriting it as failed.
   IF r.status='booked'AND(SELECT count(*)FROM journey_hub.agent_reservations ar WHERE ar.run_id=r.id)=jsonb_array_length(r.plan->'stops')THEN
    UPDATE journey_hub.agent_booking_jobs SET status='succeeded',finished_at=now(),last_error=NULL WHERE id=job.id;done:=done+1;CONTINUE;
   END IF;
   SELECT * INTO a FROM journey_hub.agent_approvals WHERE run_id=r.id;
   IF NOT FOUND OR r.status<>'queued' OR a.plan_hash<>r.plan_hash OR a.snapshot<>r.plan THEN RAISE EXCEPTION 'APPROVAL_MISSING';END IF;
   IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=r.user_id AND email_confirmed_at IS NOT NULL)THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE';END IF;
   PERFORM journey_hub.agent_validate(a.snapshot,r.user_id);
   SELECT * INTO t FROM journey_hub.travelers WHERE auth_user_id=r.user_id;
   SELECT jsonb_agg(jsonb_build_object('stopId',value->>'sessionId','kind','ticket','unitMinor',(value->>'unitPriceThb')::int*20))INTO items FROM jsonb_array_elements(a.snapshot->'stops');
   q:=journey_hub.demo_quote_save(r.user_id,'run',r.id,items);
   IF (q->>'totalMinor')::int<>(a.snapshot->>'totalThb')::int*20 THEN RAISE EXCEPTION 'PRICE_CHANGED';END IF;
   receipt:=journey_hub.demo_book(r.user_id,(q->>'id')::uuid,md5('agent-paid:'||r.id::text||':'||r.version::text)::uuid);
   FOR item IN SELECT value FROM jsonb_array_elements(a.snapshot->'stops') LOOP
    SELECT b.booking_id,b.checkin_code INTO bid,code FROM journey_hub.agent_reservations ar JOIN journey_hub.bookings b USING(booking_id) WHERE ar.run_id=r.id AND ar.session_id=item->>'sessionId';
    IF a.email_opt_in THEN
     snapshot:=jsonb_build_object('booking_id',bid,'session_id',item->>'sessionId','experience_title',item->>'title','starts_at',item->>'startsAt','time_zone',item->>'timeZone','venue_name',item->>'venue','address',item->>'venue','party_size',(a.snapshot->>'guests')::int,'traveler_name',t.display_name,'booking_reference',code,'demo',true);
     INSERT INTO journey_hub.agent_mail_jobs(run_id,session_id,booking_id,template,to_email,snapshot)VALUES(r.id,item->>'sessionId',bid,'booking_confirmation',a.to_email,snapshot);
     IF(item->>'startsAt')::timestamptz>now()+interval '15 minutes'THEN
      INSERT INTO journey_hub.agent_mail_jobs(run_id,session_id,booking_id,template,to_email,snapshot,run_at)VALUES(r.id,item->>'sessionId',bid,'booking_reminder',a.to_email,snapshot,greatest(now()+interval '5 minutes',(item->>'startsAt')::timestamptz-interval '2 hours'));
     END IF;
    END IF;
   END LOOP;
   UPDATE journey_hub.agent_runs SET status='booked',updated_at=now(),error_code=NULL WHERE id=r.id;
   UPDATE journey_hub.agent_booking_jobs SET status='succeeded',finished_at=now(),last_error=NULL WHERE id=job.id;
   INSERT INTO journey_hub.agent_events(run_id,type,detail)VALUES(r.id,'reservations_created',jsonb_build_object('count',jsonb_array_length(a.snapshot->'stops'),'demo',true,'paidCnyMinor',q->'totalMinor'));done:=done+1;
  EXCEPTION WHEN OTHERS THEN
   err:=CASE WHEN SQLERRM IN('APPROVAL_MISSING','ACCOUNT_UNAVAILABLE','PROFILE_REQUIRED','SESSION_CHANGED','ITINERARY_CHANGED','PRICE_CHANGED','CAPACITY_CHANGED','ALREADY_BOOKED','DEMO_INSUFFICIENT_FUNDS','DEMO_QUOTE_STALE','DEMO_TRIP_PASSED')THEN SQLERRM ELSE 'BOOKING_FAILED'END;
   retryable:=SQLSTATE IN('40001','40P01','55P03');
   UPDATE journey_hub.agent_booking_jobs SET status=CASE WHEN retryable AND attempts<max_attempts THEN 'pending'ELSE 'failed'END,
    last_error=CASE WHEN retryable THEN 'TEMPORARY_DATABASE_ERROR'ELSE err END,run_at=now()+make_interval(secs=>least(900,30*(2^least(attempts,5))::int)),finished_at=CASE WHEN retryable AND attempts<max_attempts THEN NULL ELSE now()END WHERE id=job.id;
   IF NOT retryable OR job.attempts+1>=job.max_attempts THEN UPDATE journey_hub.agent_runs SET status='failed',error_code=CASE WHEN retryable THEN 'BOOKING_RETRIES_EXHAUSTED'ELSE err END,updated_at=now()WHERE id=job.run_id;END IF;
   INSERT INTO journey_hub.agent_events(run_id,type,detail)VALUES(job.run_id,'booking_attempt_failed',jsonb_build_object('code',CASE WHEN retryable THEN 'TEMPORARY_DATABASE_ERROR'ELSE err END));bad:=bad+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('booked',done,'failedAttempts',bad);
END $$;

CREATE OR REPLACE FUNCTION journey_hub.agent_catalog(p_city text,p_date date,p_guests integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF COALESCE(p_city,'')NOT IN('Bangkok','Shanghai','Singapore')OR p_date IS NULL OR p_guests IS NULL OR p_guests NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sessionId',s.session_id,'experienceId',e.experience_id,'title',e.name,'kind',e.kind,
 'city',v.city,'venue',v.name,'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',v.time_zone,'unitPriceThb',COALESCE(s.price_thb,e.price_thb),
 'seatsLeft',journey_hub.unified_seats(s.session_id))ORDER BY s.starts_at,s.session_id),'[]'::jsonb)INTO result
 FROM journey_hub.sessions s JOIN journey_hub.experiences e USING(experience_id)JOIN journey_hub.venues v USING(venue_id)
 WHERE s.demo_owner_id IS NULL AND v.city=p_city AND(s.starts_at AT TIME ZONE v.time_zone)::date=p_date AND s.status='open'AND s.starts_at>now()AND journey_hub.unified_seats(s.session_id)>=p_guests;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION journey_hub.agent_catalog_trip(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inp jsonb:=journey_hub.agent_trip_input(p_input);result jsonb;
BEGIN
 SELECT COALESCE(jsonb_agg(row_data ORDER BY preferred DESC,starts_at,session_id),'[]'::jsonb)INTO result FROM(
  SELECT s.starts_at,s.session_id,(inp->'preferredExperienceIds'?e.experience_id)preferred,
  jsonb_build_object('sessionId',s.session_id,'experienceId',e.experience_id,'title',e.name,'kind',e.kind,'city',v.city,'venue',v.name,
  'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',v.time_zone,'unitPriceThb',COALESCE(s.price_thb,e.price_thb),'seatsLeft',s.capacity-s.seats_held_other_channels-COALESCE(b.taken,0),
  'date',(s.starts_at AT TIME ZONE v.time_zone)::date,'dayIndex',(s.starts_at AT TIME ZONE v.time_zone)::date-(inp->>'date')::date+1,
  'lat',v.lat,'lng',v.lng,'coordinateAccuracy',v.coordinate_accuracy,'coordinateSource',v.coordinate_source)row_data
  FROM journey_hub.sessions s JOIN journey_hub.experiences e USING(experience_id)JOIN journey_hub.venues v USING(venue_id)
  LEFT JOIN LATERAL(SELECT sum(guests)taken FROM journey_hub.bookings WHERE session_id=s.session_id AND status='confirmed')b ON true
  WHERE s.demo_owner_id IS NULL AND v.city=inp->>'city'AND(s.starts_at AT TIME ZONE v.time_zone)::date BETWEEN(inp->>'date')::date AND(inp->>'date')::date+(inp->>'days')::int-1
  AND(s.ends_at AT TIME ZONE v.time_zone)::date=(s.starts_at AT TIME ZONE v.time_zone)::date
  AND(s.starts_at AT TIME ZONE v.time_zone)::time>=(inp->>'dayStart')::time AND(s.ends_at AT TIME ZONE v.time_zone)::time<=(inp->>'dayEnd')::time
  AND NOT(inp->'excludedExperienceIds'?e.experience_id)AND s.status='open'AND s.starts_at>now()
  AND s.capacity-s.seats_held_other_channels-COALESCE(b.taken,0)>=(inp->>'guests')::int
  ORDER BY preferred DESC,s.starts_at,s.session_id LIMIT 160
 )q;
 RETURN result;
END $$;

CREATE FUNCTION public.journeyhub_demo_session_quote(p_user_id uuid,p_session_id text,p_guests integer) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT journey_hub.demo_session_quote(p_user_id,p_session_id,p_guests) $$;
CREATE OR REPLACE FUNCTION public.journeyhub_command(p_operation text,p_payload jsonb,p_request_id uuid)RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT journey_hub.command(p_operation,p_payload,p_request_id)$$;
CREATE OR REPLACE FUNCTION public.journeyhub_calendar_manage(p_kind text,p_id text,p_action text,p_request_id uuid)RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT journey_hub.calendar_manage(p_kind,p_id,p_action,p_request_id)$$;
CREATE OR REPLACE FUNCTION public.journeyhub_snapshot()RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT journey_hub.snapshot()$$;

REVOKE ALL ON FUNCTION journey_hub.command_before_unified(text,jsonb,uuid),journey_hub.calendar_manage_before_unified(text,text,text,uuid),journey_hub.snapshot_before_unified() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION journey_hub.unified_traveler(uuid),journey_hub.unified_seats(text),journey_hub.unified_demo_session(uuid,uuid,jsonb,jsonb,text,text,integer),journey_hub.unified_reserve(uuid,uuid,jsonb),journey_hub.unified_cancel(uuid,text),journey_hub.unified_cancel_effects() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION journey_hub.demo_session_quote(uuid,text,integer),public.journeyhub_demo_session_quote(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.demo_session_quote(uuid,text,integer),public.journeyhub_demo_session_quote(uuid,text,integer) TO service_role;
REVOKE ALL ON FUNCTION journey_hub.command(text,jsonb,uuid),journey_hub.calendar_manage(text,text,text,uuid),journey_hub.snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION journey_hub.command(text,jsonb,uuid),journey_hub.calendar_manage(text,text,text,uuid),journey_hub.snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.snapshot() TO anon;

COMMIT;
