-- Virtual demo credits only. No payment network, supplier order, or catalog seat is touched.
-- Apply after history, care and calendar-management. Values are integer CNY cents.
BEGIN;
CREATE TABLE journey_hub.demo_wallets (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 balance_minor integer NOT NULL DEFAULT 0 CHECK(balance_minor BETWEEN 0 AND 100000000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE journey_hub.demo_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source_type text NOT NULL CHECK(source_type IN('history','run')),source_id uuid NOT NULL,
 revision text NOT NULL,items jsonb NOT NULL,total_minor integer NOT NULL CHECK(total_minor BETWEEN 0 AND 100000000),
 status text NOT NULL DEFAULT 'quoted' CHECK(status IN('quoted','booked')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',booked_at timestamptz,
 CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 16),CHECK(octet_length(items::text)<=20000)
);
CREATE INDEX demo_quotes_owner_source ON journey_hub.demo_quotes(user_id,source_type,source_id,created_at DESC);
CREATE TABLE journey_hub.demo_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 quote_id uuid NOT NULL REFERENCES journey_hub.demo_quotes(id) ON DELETE CASCADE,
 source_type text NOT NULL CHECK(source_type IN('history','run')),source_id uuid NOT NULL,stop_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN('ticket','restaurant','cafe','free','unavailable')),
 visit_date date NOT NULL,starts text NOT NULL,ends text NOT NULL,day_index integer NOT NULL,
 unit_minor integer NOT NULL CHECK(unit_minor BETWEEN 0 AND 1000000),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 50),
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 0 AND 100000000),
 status text NOT NULL CHECK(status IN('simulated_confirmed','not_required','unavailable','cancelled')),
 reference text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),cancelled_at timestamptz,
 UNIQUE(user_id,source_type,source_id,stop_id),CHECK(amount_minor=unit_minor*quantity),
 CHECK(starts~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND ends~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND starts<ends)
);
CREATE INDEX demo_bookings_owner_recent ON journey_hub.demo_bookings(user_id,created_at DESC,id);
CREATE INDEX demo_bookings_quote ON journey_hub.demo_bookings(quote_id);
CREATE TABLE journey_hub.demo_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('topup','payment','refund')),amount_minor integer NOT NULL,
 balance_after_minor integer NOT NULL CHECK(balance_after_minor BETWEEN 0 AND 100000000),
 quote_id uuid REFERENCES journey_hub.demo_quotes(id),booking_id uuid REFERENCES journey_hub.demo_bookings(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='topup' AND amount_minor>0) OR (kind='payment' AND amount_minor<=0) OR (kind='refund' AND amount_minor>=0))
);
CREATE INDEX demo_ledger_owner_recent ON journey_hub.demo_ledger(user_id,created_at DESC,id);
CREATE INDEX demo_ledger_quote ON journey_hub.demo_ledger(quote_id);
CREATE INDEX demo_ledger_booking ON journey_hub.demo_ledger(booking_id);
CREATE TABLE journey_hub.demo_requests (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,request_id uuid NOT NULL,
 operation text NOT NULL,payload jsonb NOT NULL,resource_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id)
);
ALTER TABLE journey_hub.demo_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_hub.demo_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_hub.demo_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_hub.demo_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_hub.demo_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_wallets_owner ON journey_hub.demo_wallets FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY demo_quotes_owner ON journey_hub.demo_quotes FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY demo_bookings_owner ON journey_hub.demo_bookings FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY demo_ledger_owner ON journey_hub.demo_ledger FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY demo_requests_owner ON journey_hub.demo_requests FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
REVOKE ALL ON journey_hub.demo_wallets,journey_hub.demo_quotes,journey_hub.demo_bookings,journey_hub.demo_ledger,journey_hub.demo_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION journey_hub.demo_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'DEMO_LEDGER_IMMUTABLE';
END $$;
CREATE TRIGGER demo_ledger_immutable BEFORE UPDATE OR DELETE ON journey_hub.demo_ledger FOR EACH ROW EXECUTE FUNCTION journey_hub.demo_ledger_immutable();

CREATE FUNCTION journey_hub.demo_booking_json(b journey_hub.demo_bookings) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',b.id,'quoteId',b.quote_id,'sourceType',b.source_type,'sourceId',b.source_id,'stopId',b.stop_id,
  'kind',b.kind,'date',b.visit_date,'start',b.starts,'end',b.ends,'dayIndex',b.day_index,'unitMinor',b.unit_minor,'quantity',b.quantity,
  'amountMinor',b.amount_minor,'currency','CNY','status',b.status,'reference',b.reference,'createdAt',b.created_at,'cancelledAt',b.cancelled_at,'demo',true)
$$;
CREATE FUNCTION journey_hub.demo_quote_json(q journey_hub.demo_quotes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',q.id,'sourceType',q.source_type,'sourceId',q.source_id,'revision',q.revision,'expiresAt',q.expires_at,
 'status',q.status,'currency','CNY','items',q.items,'totalMinor',q.total_minor,'createdAt',q.created_at,'bookedAt',q.booked_at,'demo',true)
$$;
CREATE FUNCTION journey_hub.demo_wallet_state(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'DEMO_ACCOUNT_REQUIRED';END IF;
 SELECT jsonb_build_object('demo',true,'currency','CNY','balanceMinor',COALESCE((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=p_user_id),0),
 'ledger',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'kind',l.kind,'amountMinor',l.amount_minor,'balanceAfterMinor',l.balance_after_minor,'quoteId',l.quote_id,'bookingId',l.booking_id,'createdAt',l.created_at,'demo',true) ORDER BY l.created_at DESC,l.id) FROM(SELECT * FROM journey_hub.demo_ledger WHERE user_id=p_user_id ORDER BY created_at DESC,id LIMIT 100)l),'[]'::jsonb),
 'bookings',COALESCE((SELECT jsonb_agg(journey_hub.demo_booking_json(b) ORDER BY b.created_at DESC,b.id) FROM(SELECT * FROM journey_hub.demo_bookings WHERE user_id=p_user_id ORDER BY created_at DESC,id LIMIT 500)b),'[]'::jsonb),
 'ledgerCount',(SELECT count(*) FROM journey_hub.demo_ledger WHERE user_id=p_user_id),'bookingCount',(SELECT count(*) FROM journey_hub.demo_bookings WHERE user_id=p_user_id)) INTO result;
 RETURN result;
END $$;

-- Every mutation locks wallet, then source, then care/quote/booking rows. External
-- calendar actions already lock source before care; they never take wallet locks.
CREATE FUNCTION journey_hub.demo_wallet_lock(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE balance integer;
BEGIN
 IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'DEMO_ACCOUNT_REQUIRED';END IF;
 INSERT INTO journey_hub.demo_wallets(user_id)VALUES(p_user_id)ON CONFLICT DO NOTHING;
 SELECT balance_minor INTO balance FROM journey_hub.demo_wallets WHERE user_id=p_user_id FOR UPDATE;
 RETURN balance;
END $$;
CREATE FUNCTION journey_hub.demo_source(p_user_id uuid,p_source_type text,p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE prefs jsonb;plan jsonb;care journey_hub.trip_care;zone text;today date;v_revision text;q journey_hub.demo_quotes;
BEGIN
 IF p_user_id IS NULL OR p_source_id IS NULL OR p_source_type IS NULL OR p_source_type NOT IN('history','run') THEN RAISE EXCEPTION 'DEMO_SOURCE_NOT_FOUND';END IF;
 IF p_source_type='history' THEN
  SELECT h.input,h.plan INTO prefs,plan FROM journey_hub.trip_history h WHERE h.user_id=p_user_id AND h.id=p_source_id FOR UPDATE;
 ELSE
  SELECT r.input,r.plan INTO prefs,plan FROM journey_hub.agent_runs r WHERE r.user_id=p_user_id AND r.id=p_source_id FOR UPDATE;
 END IF;
 IF prefs IS NULL OR plan IS NULL THEN RAISE EXCEPTION 'DEMO_SOURCE_NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items WHERE user_id=p_user_id AND kind=p_source_type AND item_id=p_source_id::text) THEN RAISE EXCEPTION 'DEMO_PLAN_REMOVED';END IF;
 SELECT * INTO care FROM journey_hub.trip_care WHERE user_id=p_user_id AND source_type=p_source_type AND source_id=p_source_id FOR UPDATE;
 IF FOUND THEN prefs:=care.input;plan:=care.plan;END IF;
 IF jsonb_typeof(plan->'stops') IS DISTINCT FROM 'array' OR jsonb_array_length(plan->'stops') NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'DEMO_SOURCE_NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'stops')s WHERE COALESCE(s->>'id',s->>'sessionId') LIKE 'jh_sample_%') THEN RAISE EXCEPTION 'DEMO_SAMPLE_PLAN';END IF;
 zone:=CASE prefs->>'city' WHEN 'Shanghai' THEN 'Asia/Shanghai' WHEN 'Bangkok' THEN 'Asia/Bangkok' ELSE 'Asia/Singapore' END;
 today:=(clock_timestamp()AT TIME ZONE zone)::date;
 IF (prefs->>'date')::date<today THEN RAISE EXCEPTION 'DEMO_TRIP_PASSED';END IF;
 v_revision:=md5(jsonb_build_object('input',prefs,'plan',plan)::text);
 SELECT q2.* INTO q FROM journey_hub.demo_quotes q2 WHERE q2.user_id=p_user_id AND q2.source_type=p_source_type AND q2.source_id=p_source_id
  AND(q2.status='booked' OR(q2.revision=v_revision AND q2.expires_at>clock_timestamp()))ORDER BY(q2.status='booked')DESC,q2.created_at DESC LIMIT 1;
 IF q.status='quoted' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q.items)item WHERE item->>'kind'<>'unavailable') THEN q:=NULL;END IF;
 RETURN jsonb_build_object('input',prefs,'plan',plan,'revision',v_revision,'sourceType',p_source_type,'sourceId',p_source_id,'quote',CASE WHEN q.id IS NULL THEN NULL ELSE journey_hub.demo_quote_json(q)END);
END $$;

CREATE FUNCTION journey_hub.demo_wallet_topup(p_user_id uuid,p_amount_minor integer,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE balance integer;req journey_hub.demo_requests;receipt uuid;payload jsonb:=jsonb_build_object('amountMinor',p_amount_minor);
BEGIN
 IF p_request_id IS NULL OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 100 AND 1000000 THEN RAISE EXCEPTION 'DEMO_INVALID_TOPUP';END IF;
 balance:=journey_hub.demo_wallet_lock(p_user_id);
 SELECT * INTO req FROM journey_hub.demo_requests WHERE user_id=p_user_id AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'topup' OR req.payload<>payload THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED';END IF;
  RETURN journey_hub.demo_wallet_state(p_user_id)||jsonb_build_object('receiptId',req.resource_id);
 END IF;
 IF balance+p_amount_minor+COALESCE((SELECT sum(amount_minor)FROM journey_hub.demo_bookings WHERE user_id=p_user_id AND status='simulated_confirmed'),0)>100000000 THEN RAISE EXCEPTION 'DEMO_BALANCE_LIMIT';END IF;
 UPDATE journey_hub.demo_wallets SET balance_minor=balance+p_amount_minor,updated_at=now()WHERE user_id=p_user_id;
 INSERT INTO journey_hub.demo_ledger(user_id,kind,amount_minor,balance_after_minor)VALUES(p_user_id,'topup',p_amount_minor,balance+p_amount_minor)RETURNING id INTO receipt;
 INSERT INTO journey_hub.demo_requests(user_id,request_id,operation,payload,resource_id)VALUES(p_user_id,p_request_id,'topup',payload,receipt);
 RETURN journey_hub.demo_wallet_state(p_user_id)||jsonb_build_object('receiptId',receipt);
END $$;

CREATE FUNCTION journey_hub.demo_quote_save(p_user_id uuid,p_source_type text,p_source_id uuid,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb;s jsonb;x jsonb;v_items jsonb:='[]';seen text[]:='{}';sid text;kind text;unit integer;qty integer;daynum integer;dt date;st text;en text;zone text;total bigint:=0;q journey_hub.demo_quotes;
BEGIN
 PERFORM journey_hub.demo_wallet_lock(p_user_id);
 src:=journey_hub.demo_source(p_user_id,p_source_type,p_source_id);
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)<>jsonb_array_length(src->'plan'->'stops') THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
 qty:=COALESCE((src->'input'->>'guests')::int,1);
 IF qty NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
 zone:=CASE src->'input'->>'city' WHEN 'Shanghai' THEN 'Asia/Shanghai' WHEN 'Bangkok' THEN 'Asia/Bangkok' ELSE 'Asia/Singapore' END;
 FOR s IN SELECT value FROM jsonb_array_elements(src->'plan'->'stops') LOOP
  sid:=COALESCE(s->>'id',s->>'sessionId');
  IF sid IS NULL OR sid=ANY(seen) THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;seen:=array_append(seen,sid);
  IF (SELECT count(*) FROM jsonb_array_elements(p_items)item WHERE item->>'stopId'=sid)<>1 THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  SELECT value INTO x FROM jsonb_array_elements(p_items)WHERE value->>'stopId'=sid;
  kind:=x->>'kind';IF kind IS NULL OR kind NOT IN('ticket','restaurant','cafe','free','unavailable') OR COALESCE(x->>'unitMinor','')!~'^\d{1,7}$' THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  unit:=(x->>'unitMinor')::int;
  IF (kind='ticket' AND unit NOT IN(4000,6000)) OR(kind='restaurant' AND unit<>5000) OR(kind='cafe' AND unit<>2000) OR(kind IN('free','unavailable') AND unit<>0) THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  IF p_source_type='run' THEN
   dt:=((s->>'startsAt')::timestamptz AT TIME ZONE zone)::date;daynum:=dt-(src->'input'->>'date')::date+1;
   st:=to_char((s->>'startsAt')::timestamptz AT TIME ZONE zone,'HH24:MI');en:=to_char((s->>'endsAt')::timestamptz AT TIME ZONE zone,'HH24:MI');
  ELSE daynum:=(s->>'dayIndex')::int;dt:=(src->'input'->>'date')::date+daynum-1;st:=s->>'start';en:=s->>'end';END IF;
  IF daynum IS NULL OR st IS NULL OR en IS NULL OR daynum NOT BETWEEN 1 AND COALESCE((src->'input'->>'days')::int,1) OR st!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR en!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' OR st>=en THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  IF ((dt::text||' '||st)::timestamp AT TIME ZONE zone)<=clock_timestamp() THEN RAISE EXCEPTION 'DEMO_TRIP_PASSED';END IF;
  IF (x?'quantity' AND x->>'quantity' IS DISTINCT FROM qty::text) OR (x?'dayIndex' AND x->>'dayIndex' IS DISTINCT FROM daynum::text)
   OR (x?'date' AND x->>'date' IS DISTINCT FROM dt::text) OR (x?'start' AND x->>'start' IS DISTINCT FROM st) OR (x?'end' AND x->>'end' IS DISTINCT FROM en) THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
  total:=total+unit*qty;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('stopId',sid,'kind',kind,'unitMinor',unit,'quantity',qty,'totalMinor',unit*qty,'dayIndex',daynum,'date',dt,'start',st,'end',en,'demo',true));
 END LOOP;
 IF total>100000000 THEN RAISE EXCEPTION 'DEMO_INVALID_ITEMS';END IF;
 -- Once executed, this saved source cannot accidentally buy itself again, even
 -- after refund or re-quote. New trips have new source identities.
 SELECT q2.* INTO q FROM journey_hub.demo_quotes q2 WHERE q2.user_id=p_user_id AND q2.source_type=p_source_type AND q2.source_id=p_source_id AND q2.status='booked' ORDER BY q2.created_at DESC LIMIT 1;
 IF FOUND THEN RETURN journey_hub.demo_quote_json(q);END IF;
 SELECT q2.* INTO q FROM journey_hub.demo_quotes q2 WHERE q2.user_id=p_user_id AND q2.source_type=p_source_type AND q2.source_id=p_source_id AND q2.revision=src->>'revision' AND q2.items=v_items AND q2.status='quoted' ORDER BY q2.created_at DESC LIMIT 1;
 IF FOUND THEN
  IF q.expires_at<=clock_timestamp() THEN UPDATE journey_hub.demo_quotes SET expires_at=clock_timestamp()+interval '30 minutes'WHERE id=q.id RETURNING * INTO q;END IF;
 ELSE
  INSERT INTO journey_hub.demo_quotes(user_id,source_type,source_id,revision,items,total_minor)VALUES(p_user_id,p_source_type,p_source_id,src->>'revision',v_items,total::int)RETURNING * INTO q;
 END IF;
 RETURN journey_hub.demo_quote_json(q);
END $$;

CREATE FUNCTION journey_hub.demo_book(p_user_id uuid,p_quote_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE balance integer;req journey_hub.demo_requests;q journey_hub.demo_quotes;src jsonb;x jsonb;bid uuid;newbalance integer;payload jsonb:=jsonb_build_object('quoteId',p_quote_id);bookings jsonb;
BEGIN
 IF p_request_id IS NULL OR p_quote_id IS NULL THEN RAISE EXCEPTION 'DEMO_INVALID_REQUEST';END IF;
 balance:=journey_hub.demo_wallet_lock(p_user_id);
 SELECT * INTO req FROM journey_hub.demo_requests WHERE user_id=p_user_id AND request_id=p_request_id;
 IF FOUND AND (req.operation<>'book' OR req.payload<>payload) THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED';END IF;
 SELECT * INTO q FROM journey_hub.demo_quotes WHERE user_id=p_user_id AND id=p_quote_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEMO_QUOTE_NOT_FOUND';END IF;
 -- Completed request retries are read-only, including after removal or expiry.
 IF q.status<>'booked' THEN
  src:=journey_hub.demo_source(p_user_id,q.source_type,q.source_id);
  SELECT * INTO q FROM journey_hub.demo_quotes WHERE id=q.id AND user_id=p_user_id FOR UPDATE;
  IF q.revision<>src->>'revision' THEN RAISE EXCEPTION 'DEMO_QUOTE_STALE';END IF;
  IF q.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'DEMO_QUOTE_EXPIRED';END IF;
  IF EXISTS(SELECT 1 FROM journey_hub.demo_bookings WHERE user_id=p_user_id AND source_type=q.source_type AND source_id=q.source_id) THEN RAISE EXCEPTION 'DEMO_ALREADY_BOOKED';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(q.items)item WHERE ((item->>'date')||' '||(item->>'start'))::timestamp AT TIME ZONE CASE src->'input'->>'city' WHEN 'Shanghai' THEN 'Asia/Shanghai' WHEN 'Bangkok' THEN 'Asia/Bangkok' ELSE 'Asia/Singapore' END<=clock_timestamp()) THEN RAISE EXCEPTION 'DEMO_TRIP_PASSED';END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q.items)item WHERE item->>'kind'<>'unavailable') THEN RAISE EXCEPTION 'DEMO_NOT_READY';END IF;
  IF balance<q.total_minor THEN RAISE EXCEPTION 'DEMO_INSUFFICIENT_FUNDS';END IF;
  -- Enroll owned free-form itinerary support atomically. No venue API is called.
  IF q.source_type='history' THEN PERFORM public.journeyhub_care_confirm(p_user_id,'history',q.source_id);END IF;
  newbalance:=balance-q.total_minor;
  UPDATE journey_hub.demo_wallets SET balance_minor=newbalance,updated_at=now()WHERE user_id=p_user_id;
  FOR x IN SELECT value FROM jsonb_array_elements(q.items) LOOP
   bid:=gen_random_uuid();
   INSERT INTO journey_hub.demo_bookings(id,user_id,quote_id,source_type,source_id,stop_id,kind,visit_date,starts,ends,day_index,unit_minor,quantity,amount_minor,status,reference)
   VALUES(bid,p_user_id,q.id,q.source_type,q.source_id,x->>'stopId',x->>'kind',(x->>'date')::date,x->>'start',x->>'end',(x->>'dayIndex')::int,(x->>'unitMinor')::int,(x->>'quantity')::int,(x->>'totalMinor')::int,
    CASE x->>'kind' WHEN 'free' THEN 'not_required' WHEN 'unavailable' THEN 'unavailable' ELSE 'simulated_confirmed' END,'DEMO-'||upper(replace(bid::text,'-','')));
  END LOOP;
  INSERT INTO journey_hub.demo_ledger(user_id,kind,amount_minor,balance_after_minor,quote_id)VALUES(p_user_id,'payment',-q.total_minor,newbalance,q.id);
  UPDATE journey_hub.demo_quotes SET status='booked',booked_at=now()WHERE id=q.id RETURNING * INTO q;
 END IF;
 INSERT INTO journey_hub.demo_requests(user_id,request_id,operation,payload,resource_id)VALUES(p_user_id,p_request_id,'book',payload,q.id)ON CONFLICT DO NOTHING;
 SELECT COALESCE(jsonb_agg(journey_hub.demo_booking_json(b)ORDER BY b.day_index,b.starts),'[]'::jsonb)INTO bookings FROM journey_hub.demo_bookings b WHERE b.user_id=p_user_id AND b.quote_id=q.id;
 RETURN jsonb_build_object('demo',true,'wallet',journey_hub.demo_wallet_state(p_user_id),'quote',journey_hub.demo_quote_json(q),'bookings',bookings);
END $$;

CREATE FUNCTION journey_hub.demo_cancel(p_user_id uuid,p_booking_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE balance integer;req journey_hub.demo_requests;b journey_hub.demo_bookings;payload jsonb:=jsonb_build_object('bookingId',p_booking_id);
BEGIN
 IF p_request_id IS NULL OR p_booking_id IS NULL THEN RAISE EXCEPTION 'DEMO_INVALID_REQUEST';END IF;
 balance:=journey_hub.demo_wallet_lock(p_user_id);
 SELECT * INTO req FROM journey_hub.demo_requests WHERE user_id=p_user_id AND request_id=p_request_id;
 IF FOUND AND (req.operation<>'cancel' OR req.payload<>payload) THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED';END IF;
 SELECT * INTO b FROM journey_hub.demo_bookings WHERE id=p_booking_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEMO_BOOKING_NOT_FOUND';END IF;
 IF b.status NOT IN('simulated_confirmed','cancelled') THEN RAISE EXCEPTION 'DEMO_NOT_RESERVATION';END IF;
 IF b.status='simulated_confirmed' THEN
  IF balance+b.amount_minor>100000000 THEN RAISE EXCEPTION 'DEMO_BALANCE_LIMIT';END IF;
  UPDATE journey_hub.demo_wallets SET balance_minor=balance+b.amount_minor,updated_at=now()WHERE user_id=p_user_id;
  UPDATE journey_hub.demo_bookings SET status='cancelled',cancelled_at=now()WHERE id=b.id RETURNING * INTO b;
  INSERT INTO journey_hub.demo_ledger(user_id,kind,amount_minor,balance_after_minor,quote_id,booking_id)VALUES(p_user_id,'refund',b.amount_minor,balance+b.amount_minor,b.quote_id,b.id);
 END IF;
 INSERT INTO journey_hub.demo_requests(user_id,request_id,operation,payload,resource_id)VALUES(p_user_id,p_request_id,'cancel',payload,b.id)ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('demo',true,'wallet',journey_hub.demo_wallet_state(p_user_id),'booking',journey_hub.demo_booking_json(b));
END $$;

CREATE FUNCTION public.journeyhub_demo_wallet_state(p_user_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.demo_wallet_state(p_user_id)$$;
CREATE FUNCTION public.journeyhub_demo_wallet_topup(p_user_id uuid,p_amount_minor integer,p_request_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.demo_wallet_topup(p_user_id,p_amount_minor,p_request_id)$$;
CREATE FUNCTION public.journeyhub_demo_source(p_user_id uuid,p_source_type text,p_source_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.demo_source(p_user_id,p_source_type,p_source_id)$$;
CREATE FUNCTION public.journeyhub_demo_quote_save(p_user_id uuid,p_source_type text,p_source_id uuid,p_items jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.demo_quote_save(p_user_id,p_source_type,p_source_id,p_items)$$;
CREATE FUNCTION public.journeyhub_demo_book(p_user_id uuid,p_quote_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.demo_book(p_user_id,p_quote_id,p_request_id)$$;
CREATE FUNCTION public.journeyhub_demo_cancel(p_user_id uuid,p_booking_id uuid,p_request_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.demo_cancel(p_user_id,p_booking_id,p_request_id)$$;

REVOKE ALL ON FUNCTION journey_hub.demo_ledger_immutable(),journey_hub.demo_booking_json(journey_hub.demo_bookings),journey_hub.demo_quote_json(journey_hub.demo_quotes),journey_hub.demo_wallet_state(uuid),journey_hub.demo_wallet_lock(uuid),journey_hub.demo_source(uuid,text,uuid),journey_hub.demo_wallet_topup(uuid,integer,uuid),journey_hub.demo_quote_save(uuid,text,uuid,jsonb),journey_hub.demo_book(uuid,uuid,uuid),journey_hub.demo_cancel(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.journeyhub_demo_wallet_state(uuid),public.journeyhub_demo_wallet_topup(uuid,integer,uuid),public.journeyhub_demo_source(uuid,text,uuid),public.journeyhub_demo_quote_save(uuid,text,uuid,jsonb),public.journeyhub_demo_book(uuid,uuid,uuid),public.journeyhub_demo_cancel(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.demo_wallet_state(uuid),journey_hub.demo_source(uuid,text,uuid),journey_hub.demo_wallet_topup(uuid,integer,uuid),journey_hub.demo_quote_save(uuid,text,uuid,jsonb),journey_hub.demo_book(uuid,uuid,uuid),journey_hub.demo_cancel(uuid,uuid,uuid),public.journeyhub_demo_wallet_state(uuid),public.journeyhub_demo_wallet_topup(uuid,integer,uuid),public.journeyhub_demo_source(uuid,text,uuid),public.journeyhub_demo_quote_save(uuid,text,uuid,jsonb),public.journeyhub_demo_book(uuid,uuid,uuid),public.journeyhub_demo_cancel(uuid,uuid,uuid) TO service_role;
COMMIT;
