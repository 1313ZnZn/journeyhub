-- JourneyHub API. Business data stays in the non-exposed journey_hub schema.
ALTER TABLE journey_hub.travelers ADD COLUMN auth_user_id uuid UNIQUE REFERENCES auth.users(id);
ALTER TABLE journey_hub.staff ADD COLUMN auth_user_id uuid UNIQUE REFERENCES auth.users(id);
CREATE TABLE journey_hub.user_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  body jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE journey_hub.requests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL, operation text NOT NULL, payload jsonb NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, request_id)
);
CREATE INDEX ON journey_hub.staff(venue_id);
CREATE INDEX ON journey_hub.experiences(venue_id);
CREATE INDEX ON journey_hub.orders(hub_id);
CREATE INDEX ON journey_hub.order_items(product_id);
CREATE INDEX ON journey_hub.cart_items(product_id);
CREATE INDEX ON journey_hub.vat_refund_forms(store_id);
CREATE INDEX ON journey_hub.session_plans(experience_id);
CREATE INDEX ON journey_hub.session_plans(submitted_by);
CREATE INDEX ON journey_hub.session_plans(approved_by);
CREATE INDEX ON journey_hub.session_plans(created_session_id);
CREATE INDEX ON journey_hub.plan_events(plan_id, at);
CREATE INDEX ON journey_hub.plan_events(staff_id);

-- The snapshot exposes only catalog data to guests and only owned rows to travelers.
-- Privileged functions deliberately live outside the Data API schema. Every user
-- mutation checks auth.uid(); clients have no direct table privileges.
CREATE FUNCTION journey_hub.snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = journey_hub, pg_catalog AS $$
DECLARE
  uid uuid := auth.uid(); tid uuid; sid text; staff_role text; ops boolean;
  profile jsonb; employee jsonb; result jsonb;
BEGIN
  SELECT traveler_id, jsonb_build_object('id',traveler_id,'email',email,'name',display_name,'country',home_country)
    INTO tid, profile FROM travelers WHERE auth_user_id=uid;
  SELECT staff_id, role, jsonb_build_object('id',staff_id,'name',display_name,'role',role,'title',role)
    INTO sid, staff_role, employee FROM staff WHERE auth_user_id=uid;
  ops := COALESCE(staff_role IN ('coordinator','duty_manager','host'),false);
  result := jsonb_build_object('profile',profile,'staff',employee,'serverTime',now(),
    'personal',COALESCE((SELECT body FROM user_state WHERE user_id=uid),'{}'::jsonb),
    'stores',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM stores t),'[]'::jsonb),
    'products',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM products t),'[]'::jsonb),
    'venues',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM venues t),'[]'::jsonb),
    'experiences',COALESCE((SELECT jsonb_agg(to_jsonb(t)-'material_cost_thb'-'host_payout_rate') FROM experiences t),'[]'::jsonb),
    'inventory',COALESCE((SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'stock',stock)) FROM inventory),'[]'::jsonb),
    'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('seats_taken',s.seats_held_other_channels+
       COALESCE((SELECT sum(b.guests) FROM bookings b WHERE b.session_id=s.session_id AND b.status='confirmed'),0))) FROM sessions s),'[]'::jsonb),
    'bookings',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM bookings b WHERE ops OR b.traveler_id=tid),'[]'::jsonb),
    'orders',COALESCE((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object(
       'items',COALESCE((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('name',p.name,'made_to_order',p.made_to_order)) FROM order_items i JOIN products p USING(product_id) WHERE i.order_id=o.order_id),'[]'::jsonb),
       'events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.at DESC,e.event_id DESC) FROM order_events e WHERE e.order_id=o.order_id),'[]'::jsonb)))
       FROM orders o WHERE COALESCE(staff_role IN ('coordinator','duty_manager'),false) OR o.traveler_id=tid),'[]'::jsonb),
    'sessionPlans',CASE WHEN COALESCE(staff_role IN ('coordinator','duty_manager'),false) THEN
       COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.at DESC,e.event_id DESC) FROM plan_events e WHERE e.plan_id=p.plan_id),'[]'::jsonb))) FROM session_plans p),'[]'::jsonb) ELSE '[]'::jsonb END,
    'metrics',CASE WHEN COALESCE(staff_role IN ('coordinator','duty_manager'),false) THEN
       COALESCE((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('cost',e.material_cost_thb,'price',e.price_thb)) FROM activity_weekly_stats s JOIN experiences e USING(experience_id)),'[]'::jsonb) ELSE '[]'::jsonb END);
  RETURN result;
END $$;

CREATE FUNCTION journey_hub.command(p_operation text, p_payload jsonb, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = journey_hub, pg_catalog AS $$
DECLARE
  uid uuid := auth.uid(); tid uuid; sid text; sr text; actor_name text;
  req requests%ROWTYPE; ss sessions%ROWTYPE; ord orders%ROWTYPE; plan session_plans%ROWTYPE;
  prod products%ROWTYPE; item jsonb; addr jsonb; personal jsonb; pair record;
  ident text; booking_code text; qty integer; total integer; fee integer; left_seats integer;
  delivery text; choice text; action text; msg text; destination text; recipient text;
  new_start timestamptz; duration integer; result jsonb := '{}'::jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in first' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>65536 THEN
    RAISE EXCEPTION 'Invalid request'; END IF;
  -- Same request can safely be retried after a lost network response.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
  SELECT * INTO req FROM requests WHERE user_id=uid AND request_id=p_request_id;
  IF FOUND THEN
    IF req.operation<>p_operation OR req.payload<>p_payload THEN RAISE EXCEPTION 'Request ID already used'; END IF;
    RETURN req.result;
  END IF;
  SELECT staff_id, role, display_name INTO sid,sr,actor_name FROM staff WHERE auth_user_id=uid;
  SELECT traveler_id INTO tid FROM travelers WHERE auth_user_id=uid;

  IF p_operation='profile' THEN
    IF tid IS NULL THEN
      INSERT INTO travelers(auth_user_id,email,display_name,home_country)
        SELECT id,lower(email),left(COALESCE(NULLIF(raw_user_meta_data->>'display_name',''),split_part(email,'@',1),'Traveler'),60),
          left(raw_user_meta_data->>'home_country',80) FROM auth.users WHERE id=uid
        ON CONFLICT(auth_user_id) DO NOTHING;
    END IF;
  ELSIF p_operation='personal' THEN
    IF tid IS NULL THEN RAISE EXCEPTION 'Profile is missing'; END IF;
    personal := p_payload->'body';
    IF jsonb_typeof(personal)<>'object' OR personal IS NULL THEN RAISE EXCEPTION 'Invalid personal data'; END IF;
    -- Whitelist preferences; never persist passwords, roles, or auth claims.
    SELECT COALESCE(jsonb_object_agg(key,value),'{}') INTO personal FROM jsonb_each(personal)
      WHERE key IN ('cart','saved','planner','plan','address','passport','vatManual','expSel','method');
    IF personal ? 'cart' AND jsonb_typeof(personal->'cart')<>'object' THEN RAISE EXCEPTION 'Invalid cart'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':personal',0));
    DELETE FROM cart_items WHERE traveler_id=tid;
    FOR pair IN SELECT * FROM jsonb_each_text(COALESCE(personal->'cart','{}')) LOOP
      INSERT INTO cart_items(traveler_id,product_id,qty) VALUES(tid,pair.key,pair.value::smallint);
    END LOOP;
    INSERT INTO user_state(user_id,body) VALUES(uid,personal)
      ON CONFLICT(user_id) DO UPDATE SET body=excluded.body,updated_at=now();
    UPDATE travelers SET passport_nationality=left(personal#>>'{passport,nat}',80),
      passport_last4=NULLIF(left(personal#>>'{passport,last4}',4),'') WHERE traveler_id=tid;
  ELSIF p_operation='book' THEN
    IF tid IS NULL THEN RAISE EXCEPTION 'Profile is missing'; END IF;
    qty := (p_payload->>'guests')::integer;
    IF qty IS NULL OR qty NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'Book between 1 and 6 guests'; END IF;
    SELECT * INTO ss FROM sessions WHERE session_id=p_payload->>'sessionId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session no longer exists'; END IF;
    IF ss.status<>'open' OR ss.starts_at<=now() THEN RAISE EXCEPTION 'This session is closed'; END IF;
    SELECT ss.capacity-ss.seats_held_other_channels-COALESCE(sum(guests),0) INTO left_seats FROM bookings WHERE session_id=ss.session_id AND status='confirmed';
    IF qty>left_seats THEN RAISE EXCEPTION 'Only % seats left',left_seats; END IF;
    ident := 'B-'||upper(replace(gen_random_uuid()::text,'-',''));
    LOOP
      booking_code := '';
      FOR total IN 1..6 LOOP booking_code := booking_code||substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',1+floor(random()*length('ABCDEFGHJKMNPQRSTUVWXYZ23456789'))::integer,1); END LOOP;
      EXIT WHEN NOT EXISTS(SELECT 1 FROM bookings WHERE checkin_code=booking_code);
    END LOOP;
    INSERT INTO bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code)
      SELECT ident,ss.session_id,tid,t.display_name,qty,'app',COALESCE(ss.price_thb,e.price_thb),booking_code
      FROM travelers t CROSS JOIN experiences e WHERE t.traveler_id=tid AND e.experience_id=ss.experience_id;
    result := jsonb_build_object('id',ident);
  ELSIF p_operation='order' THEN
    IF tid IS NULL THEN RAISE EXCEPTION 'Profile is missing'; END IF;
    IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid items'; END IF;
    IF jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid cart size'; END IF;
    IF (SELECT count(*)<>count(DISTINCT x->>'pid') FROM jsonb_array_elements(p_payload->'items') x) THEN RAISE EXCEPTION 'Duplicate product'; END IF;
    delivery := p_payload->>'method'; addr := p_payload->'address';
    IF delivery IS NULL OR delivery NOT IN ('hotel','intl') OR jsonb_typeof(addr) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid delivery details'; END IF;
    recipient := trim(CASE WHEN delivery='hotel' THEN addr->>'guest' ELSE addr->>'name' END);
    IF recipient IS NULL OR length(recipient) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Enter recipient name'; END IF;
    IF delivery='hotel' AND COALESCE(addr->>'room','')!~'^[A-Za-z0-9-]{1,6}$' THEN RAISE EXCEPTION 'Enter hotel room'; END IF;
    IF delivery='intl' AND (length(trim(COALESCE(addr->>'line1','')))<3 OR length(trim(COALESCE(addr->>'city','')))<2 OR
       length(trim(COALESCE(addr->>'country','')))<2 OR COALESCE(addr->>'postcode','')!~'^[A-Za-z0-9 -]{3,10}$' OR COALESCE(addr->>'phone','')!~'^\+?[0-9 ()-]{7,20}$') THEN RAISE EXCEPTION 'Complete the delivery address'; END IF;
    total := 0;
    -- Stable lock order prevents deadlocks when carts contain the same products.
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'pid' LOOP
      qty := (item->>'qty')::integer;
      IF qty IS NULL OR qty NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'Limit 2 per product'; END IF;
      SELECT * INTO prod FROM products WHERE product_id=item->>'pid' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Product no longer exists'; END IF;
      PERFORM 1 FROM inventory WHERE product_id=prod.product_id AND stock>=qty FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION '% has insufficient stock',prod.name; END IF;
      total := total+prod.price_thb*qty;
    END LOOP;
    ident := 'JH-'||upper(replace(gen_random_uuid()::text,'-',''));
    fee := CASE WHEN delivery='hotel' THEN 120 ELSE 480 END;
    destination := CASE WHEN delivery='hotel' THEN 'Riverside Sample Hotel' ELSE trim(addr->>'country') END;
    INSERT INTO orders(order_id,traveler_id,guest_name,hub_id,delivery_method,destination,import_check,hotel_room,recipient_name,address_line1,city,postcode,country,phone,items_thb,delivery_fee_thb)
      VALUES(ident,tid,recipient,'silom-hub',CASE WHEN delivery='intl' THEN 'international' ELSE 'hotel' END,destination,
      CASE WHEN delivery='intl' THEN 'pending' ELSE 'not_needed' END,CASE WHEN delivery='hotel' THEN addr->>'room' END,recipient,
      addr->>'line1',addr->>'city',addr->>'postcode',addr->>'country',addr->>'phone',total,fee);
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'pid' LOOP
      SELECT * INTO prod FROM products WHERE product_id=item->>'pid';
      INSERT INTO order_items(order_id,product_id,qty,unit_price_thb,ready_by)
        VALUES(ident,prod.product_id,(item->>'qty')::smallint,prod.price_thb,CASE WHEN prod.made_to_order THEN now()+make_interval(days=>prod.ready_days) END);
    END LOOP;
    INSERT INTO order_events(order_id,actor,message) VALUES(ident,'system','Order placed; inventory reserved. Payment is not collected by this app.');
    INSERT INTO vat_refund_forms(order_id,store_id) SELECT DISTINCT ident,p.store_id FROM order_items i JOIN products p USING(product_id) JOIN stores s USING(store_id) WHERE i.order_id=ident AND s.issues_vat_forms;
    DELETE FROM cart_items WHERE traveler_id=tid;
    UPDATE user_state SET body=jsonb_set(body,'{cart}','{}'),updated_at=now() WHERE user_id=uid;
    result := jsonb_build_object('id',ident);
  ELSIF p_operation IN ('cancelOrder','orderChoice','orderStep') THEN
    SELECT * INTO ord FROM orders WHERE order_id=p_payload->>'id' FOR UPDATE;
    IF NOT FOUND OR (ord.traveler_id IS DISTINCT FROM tid AND NOT COALESCE(sr IN ('coordinator','duty_manager'),false)) THEN RAISE EXCEPTION 'Order not found or access denied' USING ERRCODE='42501'; END IF;
    ident := ord.order_id;
    IF p_operation='cancelOrder' THEN
      IF ord.status<>'preparing' THEN RAISE EXCEPTION 'Only preparing orders can be cancelled'; END IF;
      UPDATE orders SET status='cancelled' WHERE order_id=ident;
      msg := 'Order cancelled; reserved stock returned. No payment refund was processed.';
    ELSIF p_operation='orderChoice' THEN
      IF ord.traveler_id IS DISTINCT FROM tid OR ord.status<>'preparing' OR ord.delivery_method<>'hotel' THEN RAISE EXCEPTION 'Delivery choice cannot be changed'; END IF;
      choice := NULLIF(p_payload->>'choice','');
      IF choice IS NOT NULL AND choice NOT IN ('together','split') THEN RAISE EXCEPTION 'Invalid delivery choice'; END IF;
      IF NOT EXISTS(SELECT 1 FROM order_items i JOIN products p USING(product_id) WHERE i.order_id=ident AND p.made_to_order AND i.received_at_hub_at IS NULL) THEN RAISE EXCEPTION 'No delayed made-to-order item'; END IF;
      UPDATE orders SET split_choice=choice,choice_at=now(),split_fee_thb=CASE WHEN choice='split' THEN 120 ELSE 0 END WHERE order_id=ident;
      msg := 'Delivery choice: '||COALESCE(choice,'reopened');
    ELSE
      IF NOT COALESCE(sr IN ('coordinator','duty_manager'),false) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
      action := p_payload->>'step';
      IF action='importOk' AND ord.status='preparing' AND ord.delivery_method='international' THEN
        UPDATE orders SET import_check='cleared' WHERE order_id=ident; msg := 'Import check cleared';
      ELSIF action='scarfIn' AND ord.status='preparing' THEN
        UPDATE order_items SET received_at_hub_at=now() WHERE order_id=ident AND received_at_hub_at IS NULL;
        msg := 'Items received at hub';
      ELSIF action='pack' AND ord.status='preparing' THEN
        IF ord.import_check='pending' THEN RAISE EXCEPTION 'Clear import check first'; END IF;
        IF EXISTS(SELECT 1 FROM order_items i JOIN products p USING(product_id) WHERE i.order_id=ident AND p.made_to_order AND i.received_at_hub_at IS NULL) THEN RAISE EXCEPTION 'Receive made-to-order items first'; END IF;
        UPDATE order_items SET received_at_hub_at=COALESCE(received_at_hub_at,now()) WHERE order_id=ident;
        UPDATE orders SET status='combined' WHERE order_id=ident; msg := 'Parcel packed at hub';
      ELSIF action='dispatch' AND ord.status='combined' THEN
        UPDATE orders SET status='out_for_delivery' WHERE order_id=ident; msg := 'Handed to courier';
      ELSIF action='deliver' AND ord.status='out_for_delivery' THEN
        UPDATE orders SET status='delivered',delivered_at=now() WHERE order_id=ident; msg := 'Delivery confirmed by staff';
      ELSE RAISE EXCEPTION 'Invalid order action for its current status'; END IF;
    END IF;
    INSERT INTO order_events(order_id,actor,message) VALUES(ident,CASE WHEN p_operation='orderStep' THEN 'hub' ELSE 'guest' END,msg);
    result := jsonb_build_object('id',ident);
  ELSIF p_operation='checkin' THEN
    IF NOT COALESCE(sr IN ('coordinator','duty_manager','host'),false) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
    IF jsonb_typeof(p_payload->'checked') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid check-in'; END IF;
    UPDATE bookings SET checked_in_at=CASE WHEN (p_payload->>'checked')::boolean THEN now() END
      WHERE booking_id=p_payload->>'id' AND status='confirmed';
    IF NOT FOUND THEN RAISE EXCEPTION 'Active booking not found'; END IF;
  ELSIF p_operation='plan' THEN
    IF NOT COALESCE(sr IN ('coordinator','duty_manager'),false) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
    SELECT * INTO plan FROM session_plans WHERE plan_id=p_payload->>'id' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session plan not found'; END IF;
    ident := plan.plan_id; action := p_payload->>'action';
    IF action='save' THEN
      IF plan.status<>'draft' THEN RAISE EXCEPTION 'Only drafts can be edited'; END IF;
      UPDATE session_plans SET start_time=CASE WHEN p_payload->>'time'='pm' THEN '14:00'::time ELSE '10:00'::time END,
        capacity=(p_payload->>'cap')::integer,price_thb=(p_payload->>'price')::integer,
        promo_budget_thb=(p_payload->>'promo')::integer,reason=trim(p_payload->>'reason') WHERE plan_id=ident;
      IF (p_payload->>'promo')::integer NOT BETWEEN 0 AND 50000 OR (p_payload->>'price')::integer NOT BETWEEN 1000 AND 2000 THEN RAISE EXCEPTION 'Invalid plan budget or price'; END IF;
      msg := 'Draft saved by '||actor_name;
    ELSIF action='submit' AND plan.status='draft' THEN
      IF plan.session_date<(now() AT TIME ZONE 'Asia/Bangkok')::date THEN RAISE EXCEPTION 'Session date has passed'; END IF;
      UPDATE session_plans SET status='submitted',submitted_by=sid,approved_by=NULL WHERE plan_id=ident;
      msg := 'Submitted by '||actor_name;
    ELSIF action='withdraw' AND plan.status='submitted' THEN
      IF plan.submitted_by IS DISTINCT FROM sid AND sr<>'duty_manager' THEN RAISE EXCEPTION 'Only submitter or manager can return this draft'; END IF;
      UPDATE session_plans SET status='draft',submitted_by=NULL WHERE plan_id=ident; msg := 'Returned to draft by '||actor_name;
    ELSIF action='approve' AND plan.status='submitted' THEN
      IF sr<>'duty_manager' OR plan.submitted_by=sid THEN RAISE EXCEPTION 'Another duty manager must approve this plan' USING ERRCODE='42501'; END IF;
      new_start := (plan.session_date+plan.start_time) AT TIME ZONE 'Asia/Bangkok';
      IF new_start<=now() THEN RAISE EXCEPTION 'Session start has passed'; END IF;
      SELECT duration_min INTO duration FROM experiences WHERE experience_id=plan.experience_id;
      destination := 'S-'||upper(replace(gen_random_uuid()::text,'-',''));
      INSERT INTO sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb)
        VALUES(destination,plan.experience_id,new_start,new_start+make_interval(mins=>duration),plan.capacity,plan.price_thb);
      UPDATE session_plans SET status='approved',approved_by=sid,created_session_id=destination WHERE plan_id=ident;
      msg := 'Approved by '||actor_name;
    ELSIF action='new' AND plan.status='approved' THEN
      UPDATE session_plans SET status='draft',submitted_by=NULL,approved_by=NULL,created_session_id=NULL,
        session_date=(now() AT TIME ZONE 'Asia/Bangkok')::date+6 WHERE plan_id=ident;
      msg := 'New draft started by '||actor_name;
    ELSE RAISE EXCEPTION 'Invalid plan action for current status'; END IF;
    INSERT INTO plan_events(plan_id,staff_id,message) VALUES(ident,sid,msg);
  ELSE RAISE EXCEPTION 'Unsupported operation'; END IF;
  INSERT INTO requests(user_id,request_id,operation,payload,result) VALUES(uid,p_request_id,p_operation,p_payload,result);
  RETURN result;
END $$;

-- Defense in depth: no browser role can read/write private tables or call trigger helpers.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='journey_hub' LOOP
    EXECUTE format('ALTER TABLE journey_hub.%I ENABLE ROW LEVEL SECURITY',r.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA journey_hub FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA journey_hub FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA journey_hub FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA journey_hub TO anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.snapshot() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.command(text,jsonb,uuid) TO authenticated;
CREATE FUNCTION public.journeyhub_snapshot() RETURNS jsonb LANGUAGE sql SECURITY INVOKER
  SET search_path='' AS $$ SELECT journey_hub.snapshot() $$;
CREATE FUNCTION public.journeyhub_command(p_operation text,p_payload jsonb,p_request_id uuid) RETURNS jsonb
  LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT journey_hub.command(p_operation,p_payload,p_request_id) $$;
REVOKE ALL ON FUNCTION public.journeyhub_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.journeyhub_command(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.journeyhub_snapshot() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_command(text,jsonb,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
