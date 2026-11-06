-- Reversible personal calendar removal and cancellation of owned JourneyHub bookings.
-- Apply after history, agent and care migrations. No supplier cancellation API is invoked.
BEGIN;

CREATE TABLE journey_hub.calendar_removed_items (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('history','run','booking')),
 item_id text NOT NULL CHECK(length(item_id) BETWEEN 1 AND 200),
 removed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,kind,item_id)
);
ALTER TABLE journey_hub.calendar_removed_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.calendar_removed_items FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY calendar_removed_owner ON journey_hub.calendar_removed_items
 FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

CREATE FUNCTION journey_hub.calendar_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='42501'; END IF;
 -- Only structural trip input and JourneyHub's existing catalog are used as labels.
 -- Provider place descriptions, coordinates and images are never copied here.
 SELECT jsonb_build_object('removed',COALESCE(jsonb_agg(x.item ORDER BY x.removed_at DESC),'[]'::jsonb)) INTO result
 FROM (
  SELECT d.removed_at,jsonb_build_object('kind',d.kind,'id',d.item_id,'removedAt',d.removed_at,
   'title',COALESCE(NULLIF(h.input->>'city',''),'Saved')||' trip','date',h.input->>'date','city',h.input->>'city') item
  FROM journey_hub.calendar_removed_items d JOIN journey_hub.trip_history h ON h.id::text=d.item_id AND h.user_id=d.user_id
  WHERE d.user_id=uid AND d.kind='history'
  UNION ALL
  SELECT d.removed_at,jsonb_build_object('kind',d.kind,'id',d.item_id,'removedAt',d.removed_at,
   'title',COALESCE(NULLIF(r.input->>'city',''),'Saved')||' trip','date',r.input->>'date','city',r.input->>'city')
  FROM journey_hub.calendar_removed_items d JOIN journey_hub.agent_runs r ON r.id::text=d.item_id AND r.user_id=d.user_id
  WHERE d.user_id=uid AND d.kind='run'
  UNION ALL
  SELECT d.removed_at,jsonb_build_object('kind',d.kind,'id',d.item_id,'removedAt',d.removed_at,
   'title',e.name,'date',(s.starts_at AT TIME ZONE v.time_zone)::date,'city',v.city,'bookingStatus',b.status)
  FROM journey_hub.calendar_removed_items d JOIN journey_hub.bookings b ON b.booking_id=d.item_id
  JOIN journey_hub.travelers t ON t.traveler_id=b.traveler_id AND t.auth_user_id=d.user_id
  JOIN journey_hub.sessions s ON s.session_id=b.session_id
  JOIN journey_hub.experiences e ON e.experience_id=s.experience_id
  JOIN journey_hub.venues v ON v.venue_id=e.venue_id
  WHERE d.user_id=uid AND d.kind='booking'
 )x;
 RETURN result;
END $$;

-- Old tabs must not confirm a plan after another device has removed it.
CREATE FUNCTION journey_hub.calendar_guard_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='queued' AND EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d
  WHERE d.user_id=NEW.user_id AND d.kind='run' AND d.item_id=NEW.id::text) THEN
  RAISE EXCEPTION 'PLAN_REMOVED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER calendar_guard_run BEFORE UPDATE OF status ON journey_hub.agent_runs
 FOR EACH ROW EXECUTE FUNCTION journey_hub.calendar_guard_run();

-- Serialize first-time care enrollment against removal using the source row.
-- Existing active care updates do not take source locks, avoiding lock inversion.
CREATE FUNCTION journey_hub.calendar_guard_care() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'active' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='active' THEN RETURN NEW; END IF;
 IF NEW.source_type='history' THEN
  PERFORM h.id FROM journey_hub.trip_history h WHERE h.id=NEW.source_id AND h.user_id=NEW.user_id FOR UPDATE NOWAIT;
 ELSE
  PERFORM r.id FROM journey_hub.agent_runs r WHERE r.id=NEW.source_id AND r.user_id=NEW.user_id FOR UPDATE NOWAIT;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_ITEM_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d WHERE d.user_id=NEW.user_id
  AND d.kind=NEW.source_type AND d.item_id=NEW.source_id::text) THEN RAISE EXCEPTION 'PLAN_REMOVED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER calendar_guard_care BEFORE INSERT OR UPDATE OF status ON journey_hub.trip_care
 FOR EACH ROW EXECUTE FUNCTION journey_hub.calendar_guard_care();

CREATE FUNCTION journey_hub.calendar_manage(p_kind text,p_id text,p_action text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); ident text:=p_id; source_uuid uuid; req journey_hub.requests;
 payload jsonb; result jsonb; r journey_hub.agent_runs; b journey_hub.bookings; ss journey_hub.sessions;
 tid uuid; c journey_hub.trip_care; mail journey_hub.agent_mail_jobs; linked_run uuid; paused boolean:=false;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('history','run','booking') OR p_action IS NULL OR p_action NOT IN ('remove','restore','cancel')
  OR p_request_id IS NULL OR p_id IS NULL OR length(p_id) NOT BETWEEN 1 AND 200 OR (p_action='cancel' AND p_kind<>'booking') THEN
  RAISE EXCEPTION 'INVALID_CALENDAR_REQUEST';
 END IF;
 IF p_kind IN ('history','run') THEN
  BEGIN source_uuid:=p_id::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_CALENDAR_REQUEST'; END;
  ident:=source_uuid::text;
 END IF;
 payload:=jsonb_build_object('kind',p_kind,'id',ident,'action',p_action);
 -- Same lock convention as the existing command API: one user/request cannot be reused.
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 SELECT * INTO req FROM journey_hub.requests WHERE user_id=uid AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'calendar_manage' OR req.payload<>payload THEN RAISE EXCEPTION 'REQUEST_ID_REUSED'; END IF;
  RETURN req.result||journey_hub.calendar_state();
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('calendar:'||uid::text||':'||p_kind||':'||ident,0));

 IF p_kind='history' THEN
  PERFORM h.id FROM journey_hub.trip_history h WHERE h.id=source_uuid AND h.user_id=uid FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_ITEM_NOT_FOUND' USING ERRCODE='42501'; END IF;
 ELSIF p_kind='run' THEN
  SELECT * INTO r FROM journey_hub.agent_runs WHERE id=source_uuid AND user_id=uid FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_ITEM_NOT_FOUND' USING ERRCODE='42501'; END IF;
  -- Booking worker locks job then run. Reject busy runs without locking their jobs.
  IF p_action='remove' AND (r.status IN ('planning','queued') OR EXISTS(
   SELECT 1 FROM journey_hub.agent_booking_jobs j WHERE j.run_id=r.id AND j.status IN ('pending','processing'))) THEN
   RAISE EXCEPTION 'PLAN_BUSY';
  END IF;
 ELSE
  SELECT t.traveler_id INTO tid FROM journey_hub.travelers t WHERE t.auth_user_id=uid;
  SELECT * INTO b FROM journey_hub.bookings WHERE booking_id=ident AND traveler_id=tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_ITEM_NOT_FOUND' USING ERRCODE='42501'; END IF;
  -- Match booking creation: session first, booking second. This serializes seat reuse.
  SELECT * INTO ss FROM journey_hub.sessions WHERE session_id=b.session_id FOR UPDATE NOWAIT;
  SELECT * INTO b FROM journey_hub.bookings WHERE booking_id=ident AND traveler_id=tid FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_ITEM_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF p_action='remove' AND b.status='confirmed' AND b.checked_in_at IS NULL AND ss.starts_at>now() THEN
   RAISE EXCEPTION 'ACTIVE_RESERVATION_REQUIRES_CANCELLATION';
  END IF;
  IF p_action='cancel' AND b.status<>'cancelled' AND (b.status<>'confirmed' OR b.checked_in_at IS NOT NULL OR ss.starts_at<=now()) THEN
   RAISE EXCEPTION 'RESERVATION_CANNOT_BE_CANCELLED';
  END IF;
 END IF;

 IF (p_action='remove' AND p_kind='run') OR p_action='cancel' THEN
  -- Never claim that an already leased outbound message was unsent. Retrying is safe.
  FOR mail IN SELECT * FROM journey_hub.agent_mail_jobs m
   WHERE ((p_kind='run' AND m.run_id=source_uuid) OR (p_kind='booking' AND m.booking_id=ident))
   AND m.status IN ('pending','leased') ORDER BY m.id FOR UPDATE NOWAIT LOOP
   IF mail.status='leased' THEN RAISE EXCEPTION 'REMINDER_IN_PROGRESS'; END IF;
   UPDATE journey_hub.agent_mail_jobs SET status='failed',last_error=CASE WHEN p_action='cancel' THEN 'BOOKING_CANCELLED' ELSE 'PLAN_REMOVED' END,
    lease_token=NULL,lease_until=NULL WHERE id=mail.id;
  END LOOP;
 END IF;

 result:=jsonb_build_object('ok',true,'kind',p_kind,'id',ident,'action',p_action);
 IF p_action='remove' THEN
  INSERT INTO journey_hub.calendar_removed_items(user_id,kind,item_id) VALUES(uid,p_kind,ident) ON CONFLICT DO NOTHING;
  IF p_kind IN ('history','run') THEN
   FOR c IN SELECT * FROM journey_hub.trip_care WHERE user_id=uid AND source_type=p_kind AND source_id=source_uuid FOR UPDATE NOWAIT LOOP
    UPDATE journey_hub.trip_care SET status=CASE WHEN status='active' THEN 'paused' ELSE status END,
     revision=revision+1,proposal=NULL,check_claimed_at=NULL,worker_claimed_at=NULL,updated_at=now() WHERE id=c.id;
    INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind) VALUES(c.id,'calendar-removed:'||p_request_id::text,'plan_removed');
    paused:=true;
   END LOOP;
   result:=result||jsonb_build_object('carePaused',paused);
  END IF;
 ELSIF p_action='restore' THEN
  DELETE FROM journey_hub.calendar_removed_items WHERE user_id=uid AND kind=p_kind AND item_id=ident;
  -- Restore visibility only; do not silently resume agents, revive expired mail or buy tickets.
 ELSE
  UPDATE journey_hub.bookings SET status='cancelled' WHERE booking_id=ident AND traveler_id=tid AND status='confirmed';
  -- No payment/refund fields are changed; this is the JourneyHub inventory reservation only.
  SELECT a.run_id INTO linked_run FROM journey_hub.agent_reservations a WHERE a.booking_id=ident;
  IF linked_run IS NOT NULL AND b.status<>'cancelled' THEN
   INSERT INTO journey_hub.agent_events(run_id,type,detail) VALUES(linked_run,'reservation_cancelled_by_traveler',jsonb_build_object('bookingId',ident,'requestId',p_request_id));
   -- The current care renderer takes its next stop from the immutable approved plan.
   -- Pause this trip until it is reviewed, instead of reminding the traveler to attend
   -- a cancelled reservation. Other booking rows and their reminder jobs are untouched.
   FOR c IN SELECT * FROM journey_hub.trip_care WHERE user_id=uid AND source_type='run' AND source_id=linked_run FOR UPDATE NOWAIT LOOP
    UPDATE journey_hub.trip_care SET status=CASE WHEN status='active' THEN 'paused' ELSE status END,
     revision=revision+1,proposal=NULL,check_claimed_at=NULL,worker_claimed_at=NULL,updated_at=now() WHERE id=c.id;
    INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind,stop_id)
     VALUES(c.id,'reservation:'||ident||':cancelled','reservation_cancelled',b.session_id) ON CONFLICT DO NOTHING;
    paused:=true;
   END LOOP;
  END IF;
  result:=result||jsonb_build_object('bookingStatus','cancelled','carePaused',paused);
 END IF;
 -- Persistent audit + request idempotency. Raw history, booking and approvals remain intact.
 INSERT INTO journey_hub.requests(user_id,request_id,operation,payload,result) VALUES(uid,p_request_id,'calendar_manage',payload,result);
 RETURN result||journey_hub.calendar_state();
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'PLAN_BUSY' USING ERRCODE='55P03';
END $$;

CREATE FUNCTION public.journeyhub_calendar_state() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
 AS $$SELECT journey_hub.calendar_state()$$;
CREATE FUNCTION public.journeyhub_calendar_manage(p_kind text,p_id text,p_action text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
 AS $$SELECT journey_hub.calendar_manage(p_kind,p_id,p_action,p_request_id)$$;
REVOKE ALL ON FUNCTION journey_hub.calendar_state(),journey_hub.calendar_manage(text,text,text,uuid),
 journey_hub.calendar_guard_run(),journey_hub.calendar_guard_care(),public.journeyhub_calendar_state(),public.journeyhub_calendar_manage(text,text,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA journey_hub TO authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.calendar_state(),journey_hub.calendar_manage(text,text,text,uuid),
 public.journeyhub_calendar_state(),public.journeyhub_calendar_manage(text,text,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
