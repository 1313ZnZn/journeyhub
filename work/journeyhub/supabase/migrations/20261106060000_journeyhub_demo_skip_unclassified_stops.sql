-- A plan with some unclassified stops can now be booked. Those stops are recorded as
-- status unavailable with no charge or seat. A plan with no bookable stop is still refused.
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
