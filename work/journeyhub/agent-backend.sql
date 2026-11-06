-- JourneyHub agent workflow. Additive; requires the existing JourneyHub migrations.
-- No provider credentials, extensions or schedules are created by this migration.
BEGIN;
CREATE TABLE journey_hub.agent_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, input jsonb NOT NULL, status text NOT NULL DEFAULT 'planning'
 CHECK(status IN ('planning','awaiting_confirmation','queued','booked','failed')),
 version integer NOT NULL DEFAULT 1 CHECK(version=1), plan jsonb, plan_hash text,
 planning_token uuid NOT NULL DEFAULT gen_random_uuid(), planning_until timestamptz NOT NULL DEFAULT now()+interval '2 minutes',
 planning_attempts integer NOT NULL DEFAULT 1, model_result jsonb, model text, response_id text,
 expires_at timestamptz, confirmed_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_id), CHECK(octet_length(input::text)<=8192), CHECK(plan IS NULL OR octet_length(plan::text)<=32768)
);
CREATE INDEX agent_runs_owner_time ON journey_hub.agent_runs(user_id,created_at DESC);
CREATE INDEX agent_runs_planning_due ON journey_hub.agent_runs(planning_until,id) WHERE status='planning';
CREATE TABLE journey_hub.agent_approvals (
 run_id uuid PRIMARY KEY REFERENCES journey_hub.agent_runs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, version integer NOT NULL, plan_hash text NOT NULL,
 snapshot jsonb NOT NULL, email_opt_in boolean NOT NULL, to_email text, confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_approvals_owner ON journey_hub.agent_approvals(user_id);
CREATE TABLE journey_hub.agent_booking_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL UNIQUE REFERENCES journey_hub.agent_runs(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 5,
 run_at timestamptz NOT NULL DEFAULT now(),last_error text,finished_at timestamptz
);
CREATE INDEX agent_booking_jobs_due ON journey_hub.agent_booking_jobs(run_at,id) WHERE status='pending';
CREATE TABLE journey_hub.agent_reservations (
 run_id uuid NOT NULL REFERENCES journey_hub.agent_runs(id) ON DELETE CASCADE,
 session_id text NOT NULL REFERENCES journey_hub.sessions(session_id),
 booking_id text NOT NULL UNIQUE REFERENCES journey_hub.bookings(booking_id),PRIMARY KEY(run_id,session_id)
);
CREATE INDEX agent_reservations_session ON journey_hub.agent_reservations(session_id);
CREATE TABLE journey_hub.agent_mail_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES journey_hub.agent_runs(id) ON DELETE CASCADE,
 session_id text NOT NULL REFERENCES journey_hub.sessions(session_id),booking_id text NOT NULL REFERENCES journey_hub.bookings(booking_id),
 template text NOT NULL CHECK(template IN ('booking_confirmation','booking_reminder')),
 to_email text NOT NULL,snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','accepted','failed')),
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 5,run_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,lease_until timestamptz,first_lease_at timestamptz,send_window_expires_at timestamptz,
 provider text CHECK(provider IN ('resend','smtp')),provider_id text,last_error text,accepted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,session_id,template)
);
CREATE INDEX agent_mail_jobs_due ON journey_hub.agent_mail_jobs(run_at,id) WHERE status IN ('pending','leased');
CREATE INDEX agent_mail_jobs_booking ON journey_hub.agent_mail_jobs(booking_id);
CREATE INDEX agent_mail_jobs_session ON journey_hub.agent_mail_jobs(session_id);
CREATE TABLE journey_hub.agent_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,run_id uuid NOT NULL REFERENCES journey_hub.agent_runs(id) ON DELETE CASCADE,
 type text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_events_run ON journey_hub.agent_events(run_id,id DESC);

CREATE FUNCTION journey_hub.agent_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='agent_approvals' THEN RAISE EXCEPTION 'Approval snapshots are immutable'; END IF;
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.input IS DISTINCT FROM OLD.input
 OR (OLD.plan IS NOT NULL AND (NEW.plan IS DISTINCT FROM OLD.plan OR NEW.plan_hash IS DISTINCT FROM OLD.plan_hash OR NEW.version IS DISTINCT FROM OLD.version))
 THEN RAISE EXCEPTION 'Agent input and finalized plans are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_runs_immutable BEFORE UPDATE ON journey_hub.agent_runs FOR EACH ROW EXECUTE FUNCTION journey_hub.agent_immutable();
CREATE TRIGGER agent_approvals_immutable BEFORE UPDATE ON journey_hub.agent_approvals FOR EACH ROW EXECUTE FUNCTION journey_hub.agent_immutable();

-- Tables remain private. Ownership RLS is defense in depth; clients use checked RPCs.
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['agent_runs','agent_approvals','agent_booking_jobs','agent_reservations','agent_mail_jobs','agent_events'] LOOP
  EXECUTE format('ALTER TABLE journey_hub.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON journey_hub.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
CREATE POLICY agent_runs_owner ON journey_hub.agent_runs FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY agent_approvals_owner ON journey_hub.agent_approvals FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY agent_booking_jobs_owner ON journey_hub.agent_booking_jobs FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM journey_hub.agent_runs r WHERE r.id=run_id AND r.user_id=(SELECT auth.uid())));
CREATE POLICY agent_reservations_owner ON journey_hub.agent_reservations FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM journey_hub.agent_runs r WHERE r.id=run_id AND r.user_id=(SELECT auth.uid())));
CREATE POLICY agent_mail_jobs_owner ON journey_hub.agent_mail_jobs FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM journey_hub.agent_runs r WHERE r.id=run_id AND r.user_id=(SELECT auth.uid())));
CREATE POLICY agent_events_owner ON journey_hub.agent_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM journey_hub.agent_runs r WHERE r.id=run_id AND r.user_id=(SELECT auth.uid())));

CREATE FUNCTION journey_hub.agent_view(p_run_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=journey_hub,pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'status',r.status,'version',r.version,'planHash',r.plan_hash,'input',r.input,'plan',r.plan,
 'createdAt',r.created_at,'updatedAt',r.updated_at,'expiresAt',r.expires_at,'confirmedAt',r.confirmed_at,'errorCode',r.error_code,
 'jobs',COALESCE((SELECT jsonb_agg(x ORDER BY x->>'id') FROM (
  SELECT jsonb_build_object('id',j.id,'kind','booking','status',j.status,'attempts',j.attempts,'maxAttempts',j.max_attempts,'runAt',j.run_at,'lastError',j.last_error) x FROM agent_booking_jobs j WHERE j.run_id=r.id
  UNION ALL SELECT jsonb_build_object('id',m.id,'kind',m.template,'status',m.status,'attempts',m.attempts,'maxAttempts',m.max_attempts,'runAt',m.run_at,'lastError',m.last_error) FROM agent_mail_jobs m WHERE m.run_id=r.id) q),'[]'),
 'bookings',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.booking_id,'sessionId',b.session_id,'checkinCode',b.checkin_code,'guests',b.guests,'status',b.status)) FROM agent_reservations a JOIN bookings b USING(booking_id) WHERE a.run_id=r.id),'[]'),
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('type',type,'at',at,'detail',detail) ORDER BY id) FROM (SELECT * FROM agent_events WHERE run_id=r.id ORDER BY id DESC LIMIT 50) ev),'[]'))
 FROM agent_runs r WHERE r.id=p_run_id
$$;
CREATE FUNCTION journey_hub.agent_catalog(p_city text,p_date date,p_guests integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF COALESCE(p_city,'') NOT IN ('Bangkok','Shanghai','Singapore') OR p_date IS NULL OR p_guests IS NULL OR p_guests NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sessionId',s.session_id,'experienceId',e.experience_id,'title',e.name,'kind',e.kind,
 'city',v.city,'venue',v.name,'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',v.time_zone,'unitPriceThb',COALESCE(s.price_thb,e.price_thb),
 'seatsLeft',s.capacity-s.seats_held_other_channels-COALESCE(b.taken,0)) ORDER BY s.starts_at,s.session_id),'[]') INTO result
 FROM sessions s JOIN experiences e USING(experience_id) JOIN venues v USING(venue_id)
 LEFT JOIN LATERAL(SELECT sum(guests) taken FROM bookings WHERE session_id=s.session_id AND status='confirmed') b ON true
 WHERE v.city=p_city AND (s.starts_at AT TIME ZONE v.time_zone)::date=p_date AND s.status='open' AND s.starts_at>now()
 AND s.capacity-s.seats_held_other_channels-COALESCE(b.taken,0)>=p_guests;
 RETURN result;
END $$;

CREATE FUNCTION journey_hub.agent_begin(p_user_id uuid,p_request_id uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE r agent_runs; normalized jsonb; qty int; budget int; dt date; claimed boolean:=false;
BEGIN
 IF p_user_id IS NULL OR p_request_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'VERIFIED_ACCOUNT_REQUIRED' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>8192 OR COALESCE(p_input->>'city','') NOT IN ('Bangkok','Shanghai','Singapore')
 OR COALESCE(p_input->>'guests','')!~'^[1-6]$' OR COALESCE(p_input->>'date','')!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 qty:=(p_input->>'guests')::int;dt:=(p_input->>'date')::date;
 budget:=COALESCE((p_input->>'budgetThb')::int,1000000);IF budget NOT BETWEEN 1 AND 1000000 OR dt<current_date-1 OR dt>current_date+366 THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 normalized:=jsonb_build_object('city',p_input->>'city','date',dt,'guests',qty,'budgetThb',budget,'prompt',left(COALESCE(p_input->>'prompt',''),2000));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':agent-begin',0));
 SELECT * INTO r FROM agent_runs WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF r.input<>normalized THEN RAISE EXCEPTION 'REQUEST_ID_REUSED';END IF;
  IF r.status='planning' AND r.planning_until<now() AND r.planning_attempts<3 THEN
   UPDATE agent_runs SET planning_token=gen_random_uuid(),planning_until=now()+interval '2 minutes',planning_attempts=planning_attempts+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;claimed:=true;
  ELSIF r.status='planning' AND r.planning_until<now() THEN UPDATE agent_runs SET status='failed',error_code='PLANNER_TIMEOUT',updated_at=now() WHERE id=r.id RETURNING * INTO r;
  END IF;
 ELSE
  IF (SELECT count(*) FROM agent_runs WHERE user_id=p_user_id AND created_at>now()-interval '1 hour')>=6 OR
     (SELECT count(*) FROM agent_runs WHERE user_id=p_user_id AND created_at>now()-interval '24 hours')>=20 THEN RAISE EXCEPTION 'PLANNER_RATE_LIMIT';END IF;
  INSERT INTO agent_runs(user_id,request_id,input) VALUES(p_user_id,p_request_id,normalized) RETURNING * INTO r;claimed:=true;
  INSERT INTO agent_events(run_id,type) VALUES(r.id,'planning_started');
 END IF;
 RETURN jsonb_build_object('id',r.id,'status',r.status,'planning_token',CASE WHEN claimed THEN r.planning_token END,'cached',NOT claimed,'run',agent_view(r.id));
END $$;

CREATE FUNCTION journey_hub.agent_finalize(p_run_id uuid,p_planning_token uuid,p_plan jsonb,p_model text,p_response_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE r agent_runs; item jsonb; s record; stops jsonb:='[]'; tips jsonb:='[]'; canonical jsonb; ids text[]:='{}';total int:=0;qty int;prev_end timestamptz;first_start timestamptz;
BEGIN
 SELECT * INTO r FROM agent_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR r.planning_token IS DISTINCT FROM p_planning_token THEN RAISE EXCEPTION 'INVALID_PLANNER_LEASE' USING ERRCODE='42501';END IF;
 IF r.model_result=p_plan AND r.status<>'planning' THEN RETURN agent_view(r.id);END IF;
 IF r.status<>'planning' OR r.planning_until<now() THEN RAISE EXCEPTION 'PLANNER_LEASE_EXPIRED';END IF;
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>20000 OR jsonb_typeof(p_plan->'stops') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PLAN';END IF;
 IF jsonb_array_length(p_plan->'stops') NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'PLAN_NEEDS_ONE_TO_SIX_SESSIONS';END IF;
 qty:=(r.input->>'guests')::int;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'stops') LOOP
  IF COALESCE(item->>'sessionId','')=ANY(ids) THEN RAISE EXCEPTION 'DUPLICATE_SESSION';END IF;ids:=array_append(ids,item->>'sessionId');
  SELECT ss.*,e.name,e.experience_id AS exp_id,e.venue_id,COALESCE(ss.price_thb,e.price_thb) AS unit_price,v.city,v.name AS venue,v.time_zone,
  ss.capacity-ss.seats_held_other_channels-COALESCE((SELECT sum(guests) FROM bookings b WHERE b.session_id=ss.session_id AND b.status='confirmed'),0) AS available
  INTO s FROM sessions ss JOIN experiences e USING(experience_id) JOIN venues v USING(venue_id) WHERE ss.session_id=item->>'sessionId';
  IF NOT FOUND OR s.city<>r.input->>'city' OR (s.starts_at AT TIME ZONE s.time_zone)::date<>(r.input->>'date')::date OR s.status<>'open' OR s.starts_at<=now() THEN RAISE EXCEPTION 'INVALID_SESSION';END IF;
  IF s.available<qty THEN RAISE EXCEPTION 'CAPACITY_CHANGED';END IF;
  IF prev_end IS NOT NULL AND s.starts_at<prev_end+interval '30 minutes' THEN RAISE EXCEPTION 'OVERLAPPING_SESSIONS';END IF;
  prev_end:=s.ends_at;first_start:=COALESCE(first_start,s.starts_at);total:=total+s.unit_price*qty;
  stops:=stops||jsonb_build_array(jsonb_build_object('sessionId',s.session_id,'experienceId',s.exp_id,'title',s.name,'city',s.city,'venueId',s.venue_id,'venue',s.venue,'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',s.time_zone,'unitPriceThb',s.unit_price,'guests',qty,'totalThb',s.unit_price*qty,'reason',left(COALESCE(item->>'reason',''),600)));
 END LOOP;
 IF total>(r.input->>'budgetThb')::int THEN RAISE EXCEPTION 'PLAN_EXCEEDS_BUDGET';END IF;
 IF jsonb_typeof(p_plan->'tips')='array' THEN SELECT COALESCE(jsonb_agg(left(value#>>'{}',300)),'[]') INTO tips FROM (SELECT value FROM jsonb_array_elements(p_plan->'tips') WHERE jsonb_typeof(value)='string' LIMIT 6) q;END IF;
 canonical:=jsonb_build_object('city',r.input->>'city','date',r.input->>'date','guests',qty,'currency','THB','sampleCatalog',true,'totalThb',total,'summary',left(COALESCE(p_plan->>'summary',''),1200),'tips',tips,'stops',stops);
 UPDATE agent_runs SET plan=canonical,plan_hash=encode(extensions.digest(canonical::text,'sha256'),'hex'),model_result=p_plan,model=left(p_model,120),response_id=left(p_response_id,200),status='awaiting_confirmation',expires_at=least(now()+interval '30 minutes',first_start),updated_at=now() WHERE id=r.id;
 INSERT INTO agent_events(run_id,type) VALUES(r.id,'plan_ready');RETURN agent_view(r.id);
END $$;
CREATE FUNCTION journey_hub.agent_fail(p_run_id uuid,p_planning_token uuid,p_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
BEGIN
 UPDATE agent_runs SET status='failed',error_code=left(regexp_replace(COALESCE(p_code,'PLANNER_FAILED'),'[^a-zA-Z0-9_ -]','','g'),100),updated_at=now()
 WHERE id=p_run_id AND planning_token=p_planning_token AND status='planning';
 IF FOUND THEN INSERT INTO agent_events(run_id,type) VALUES(p_run_id,'planning_failed');END IF;
 RETURN agent_view(p_run_id);
END $$;

-- All session locks use the same order. Session and fallback experience prices
-- are locked against concurrent edits until validation/reservation completes.
CREATE FUNCTION journey_hub.agent_validate(p_plan jsonb,p_user_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=journey_hub,pg_catalog AS $$
DECLARE item jsonb;s record;qty int:=(p_plan->>'guests')::int;tid uuid;
BEGIN
 SELECT traveler_id INTO tid FROM travelers WHERE auth_user_id=p_user_id;
 IF tid IS NULL THEN RAISE EXCEPTION 'PROFILE_REQUIRED';END IF;
 PERFORM ss.session_id FROM sessions ss WHERE ss.session_id IN (SELECT value->>'sessionId' FROM jsonb_array_elements(p_plan->'stops')) ORDER BY ss.session_id FOR UPDATE;
 PERFORM e.experience_id FROM experiences e WHERE e.experience_id IN (SELECT ss.experience_id FROM sessions ss WHERE ss.session_id IN (SELECT value->>'sessionId' FROM jsonb_array_elements(p_plan->'stops'))) ORDER BY e.experience_id FOR SHARE;
 PERFORM v.venue_id FROM venues v WHERE v.venue_id IN (SELECT e.venue_id FROM experiences e JOIN sessions ss USING(experience_id) WHERE ss.session_id IN (SELECT value->>'sessionId' FROM jsonb_array_elements(p_plan->'stops'))) ORDER BY v.venue_id FOR SHARE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'stops') LOOP
  SELECT ss.*,COALESCE(ss.price_thb,e.price_thb) unit_price,e.name AS title,e.venue_id,v.city,v.name AS venue,v.time_zone INTO s FROM sessions ss JOIN experiences e USING(experience_id) JOIN venues v USING(venue_id) WHERE ss.session_id=item->>'sessionId';
  IF NOT FOUND OR s.status<>'open' OR s.starts_at<=now() OR s.starts_at<>(item->>'startsAt')::timestamptz OR s.ends_at<>(item->>'endsAt')::timestamptz OR s.experience_id<>item->>'experienceId' THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
  IF s.venue_id IS DISTINCT FROM item->>'venueId' OR s.title IS DISTINCT FROM item->>'title' OR s.city IS DISTINCT FROM item->>'city' OR s.city IS DISTINCT FROM p_plan->>'city' OR s.venue IS DISTINCT FROM item->>'venue' OR s.time_zone IS DISTINCT FROM item->>'timeZone' THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
  IF s.unit_price<>(item->>'unitPriceThb')::int THEN RAISE EXCEPTION 'PRICE_CHANGED';END IF;
  IF s.capacity-s.seats_held_other_channels-COALESCE((SELECT sum(guests) FROM bookings WHERE session_id=s.session_id AND status='confirmed'),0)<qty THEN RAISE EXCEPTION 'CAPACITY_CHANGED';END IF;
  IF EXISTS(SELECT 1 FROM bookings WHERE traveler_id=tid AND session_id=s.session_id AND status='confirmed') THEN RAISE EXCEPTION 'ALREADY_BOOKED';END IF;
 END LOOP;
END $$;
CREATE FUNCTION journey_hub.agent_confirm(p_run_id uuid,p_version integer,p_hash text,p_email_reminders boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE uid uuid:=auth.uid();r agent_runs;a agent_approvals;email text;tid uuid;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM agent_runs WHERE id=p_run_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RUN_NOT_FOUND' USING ERRCODE='42501';END IF;
 IF p_version IS DISTINCT FROM r.version OR p_hash IS DISTINCT FROM r.plan_hash OR p_email_reminders IS NULL THEN RAISE EXCEPTION 'APPROVAL_MISMATCH';END IF;
 SELECT * INTO a FROM agent_approvals WHERE run_id=r.id;
 IF FOUND THEN IF a.email_opt_in<>p_email_reminders THEN RAISE EXCEPTION 'APPROVAL_MISMATCH';END IF;RETURN agent_view(r.id);END IF;
 IF r.status<>'awaiting_confirmation' OR r.expires_at<=now() OR r.plan IS NULL THEN RAISE EXCEPTION 'PLAN_EXPIRED_OR_NOT_READY';END IF;
 SELECT u.email INTO email FROM auth.users u WHERE u.id=uid AND u.email_confirmed_at IS NOT NULL;
 IF email IS NULL THEN RAISE EXCEPTION 'VERIFIED_ACCOUNT_REQUIRED' USING ERRCODE='42501';END IF;
 -- A valid auth user may not yet have opened the traveler profile UI.
 INSERT INTO travelers(auth_user_id,email,display_name,home_country)
 SELECT id,lower(u.email),left(COALESCE(NULLIF(raw_user_meta_data->>'display_name',''),split_part(u.email,'@',1),'Traveler'),60),left(raw_user_meta_data->>'home_country',80) FROM auth.users u WHERE id=uid ON CONFLICT(auth_user_id) DO NOTHING;
 PERFORM agent_validate(r.plan,uid);
 INSERT INTO agent_approvals(run_id,user_id,version,plan_hash,snapshot,email_opt_in,to_email)
 VALUES(r.id,uid,r.version,r.plan_hash,r.plan,p_email_reminders,CASE WHEN p_email_reminders THEN email END);
 INSERT INTO agent_booking_jobs(run_id) VALUES(r.id);
 UPDATE agent_runs SET status='queued',confirmed_at=now(),updated_at=now() WHERE id=r.id;
 INSERT INTO agent_events(run_id,type,detail) VALUES(r.id,'approved',jsonb_build_object('version',r.version,'planHash',r.plan_hash,'emailOptIn',p_email_reminders));
 RETURN agent_view(r.id);
END $$;
CREATE FUNCTION journey_hub.agent_get(p_run_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM agent_runs WHERE id=p_run_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'RUN_NOT_FOUND' USING ERRCODE='42501';END IF;
 RETURN agent_view(p_run_id);
END $$;
CREATE FUNCTION journey_hub.agent_list(p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT COALESCE(jsonb_agg(agent_view(id) ORDER BY created_at DESC),'[]') INTO result FROM (SELECT id,created_at FROM agent_runs WHERE user_id=auth.uid() ORDER BY created_at DESC LIMIT greatest(1,least(COALESCE(p_limit,20),50))) r;
 RETURN result;
END $$;

CREATE FUNCTION journey_hub.agent_process_bookings(p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE job agent_booking_jobs;r agent_runs;a agent_approvals;t travelers;item jsonb;bid text;code text;snapshot jsonb;trycode int;codeok boolean;done int:=0;bad int:=0;err text;retryable boolean;
BEGIN
 -- A stopped Edge request cannot leave an orphaned planning run forever.
 -- One minute of grace avoids racing the request's normal failure callback;
 -- row locks fence concurrent finalize/reclaim calls without blocking them.
 WITH stale AS (
  SELECT id FROM agent_runs WHERE status='planning' AND planning_until<now()-interval '1 minute'
  ORDER BY planning_until,id LIMIT 100 FOR UPDATE SKIP LOCKED
 ),expired AS (
  UPDATE agent_runs target_run SET status='failed',error_code='PLANNER_TIMEOUT',updated_at=now()
  FROM stale s WHERE target_run.id=s.id AND target_run.status='planning' RETURNING target_run.id
 ) INSERT INTO agent_events(run_id,type,detail)
 SELECT id,'planning_failed',jsonb_build_object('code','PLANNER_TIMEOUT','source','watchdog') FROM expired;
 FOR job IN SELECT * FROM agent_booking_jobs WHERE status='pending' AND run_at<=now() ORDER BY run_at,id LIMIT greatest(1,least(COALESCE(p_limit,10),50)) FOR UPDATE SKIP LOCKED LOOP
  UPDATE agent_booking_jobs SET status='processing',attempts=attempts+1 WHERE id=job.id;
  BEGIN
   SELECT * INTO r FROM agent_runs WHERE id=job.run_id FOR UPDATE;
   SELECT * INTO a FROM agent_approvals WHERE run_id=r.id;
   IF NOT FOUND OR r.status<>'queued' OR a.plan_hash<>r.plan_hash OR a.snapshot<>r.plan THEN RAISE EXCEPTION 'APPROVAL_MISSING';END IF;
   IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=r.user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE';END IF;
   PERFORM agent_validate(a.snapshot,r.user_id);
   SELECT * INTO t FROM travelers WHERE auth_user_id=r.user_id;
   FOR item IN SELECT value FROM jsonb_array_elements(a.snapshot->'stops') ORDER BY value->>'sessionId' LOOP
    bid:='B-AG-'||replace(r.id::text,'-','')||'-'||substr(md5(item->>'sessionId'),1,12);codeok:=false;
    FOR trycode IN 1..8 LOOP
     SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',1+floor(random()*length('ABCDEFGHJKMNPQRSTUVWXYZ23456789'))::integer,1),'') INTO code FROM generate_series(1,6);
     BEGIN
      INSERT INTO bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code)
      VALUES(bid,item->>'sessionId',t.traveler_id,t.display_name,(a.snapshot->>'guests')::int,'app',(item->>'unitPriceThb')::int,code);
      codeok:=true;EXIT;
     EXCEPTION WHEN unique_violation THEN IF EXISTS(SELECT 1 FROM bookings WHERE booking_id=bid) THEN RAISE;END IF;
     END;
    END LOOP;
    IF NOT codeok THEN RAISE EXCEPTION 'CODE_ALLOCATION_FAILED' USING ERRCODE='40001';END IF;
    INSERT INTO agent_reservations(run_id,session_id,booking_id) VALUES(r.id,item->>'sessionId',bid);
    IF a.email_opt_in THEN
     snapshot:=jsonb_build_object('booking_id',bid,'session_id',item->>'sessionId','experience_title',item->>'title','starts_at',item->>'startsAt','time_zone',item->>'timeZone','venue_name',item->>'venue','address',item->>'venue','party_size',(a.snapshot->>'guests')::int,'traveler_name',t.display_name,'booking_reference',code);
     INSERT INTO agent_mail_jobs(run_id,session_id,booking_id,template,to_email,snapshot)
     VALUES(r.id,item->>'sessionId',bid,'booking_confirmation',a.to_email,snapshot);
     IF (item->>'startsAt')::timestamptz>now()+interval '15 minutes' THEN
      INSERT INTO agent_mail_jobs(run_id,session_id,booking_id,template,to_email,snapshot,run_at)
      VALUES(r.id,item->>'sessionId',bid,'booking_reminder',a.to_email,snapshot,greatest(now()+interval '5 minutes',(item->>'startsAt')::timestamptz-interval '2 hours'));
     END IF;
    END IF;
   END LOOP;
   UPDATE agent_runs SET status='booked',updated_at=now(),error_code=NULL WHERE id=r.id;
   UPDATE agent_booking_jobs SET status='succeeded',finished_at=now(),last_error=NULL WHERE id=job.id;
   INSERT INTO agent_events(run_id,type,detail) VALUES(r.id,'reservations_created',jsonb_build_object('count',jsonb_array_length(a.snapshot->'stops')));done:=done+1;
  EXCEPTION WHEN OTHERS THEN
   err:=CASE WHEN SQLERRM IN ('APPROVAL_MISSING','ACCOUNT_UNAVAILABLE','PROFILE_REQUIRED','SESSION_CHANGED','ITINERARY_CHANGED','PRICE_CHANGED','CAPACITY_CHANGED','ALREADY_BOOKED') THEN SQLERRM ELSE 'BOOKING_FAILED' END;retryable:=SQLSTATE IN ('40001','40P01','55P03');
   UPDATE agent_booking_jobs SET status=CASE WHEN retryable AND attempts<max_attempts THEN 'pending' ELSE 'failed' END,
    last_error=CASE WHEN retryable THEN 'TEMPORARY_DATABASE_ERROR' ELSE err END,run_at=now()+make_interval(secs=>least(900,30*(2^least(attempts,5))::int)),finished_at=CASE WHEN retryable AND attempts<max_attempts THEN NULL ELSE now() END WHERE id=job.id;
   IF NOT retryable OR job.attempts+1>=job.max_attempts THEN UPDATE agent_runs SET status='failed',error_code=CASE WHEN retryable THEN 'BOOKING_RETRIES_EXHAUSTED' ELSE err END,updated_at=now() WHERE id=job.run_id;END IF;
   INSERT INTO agent_events(run_id,type,detail) VALUES(job.run_id,'booking_attempt_failed',jsonb_build_object('code',CASE WHEN retryable THEN 'TEMPORARY_DATABASE_ERROR' ELSE err END));bad:=bad+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('booked',done,'failedAttempts',bad);
END $$;

CREATE FUNCTION journey_hub.agent_claim_mail(p_limit integer DEFAULT 10,p_provider text DEFAULT 'resend') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE j agent_mail_jobs;result jsonb:='[]';verified text;bk text;user_id uuid;
BEGIN
 IF COALESCE(p_provider,'') NOT IN ('resend','smtp') THEN RAISE EXCEPTION 'INVALID_MAIL_PROVIDER';END IF;
 FOR j IN SELECT * FROM agent_mail_jobs WHERE (status='pending' AND run_at<=now()) OR (status='leased' AND lease_until<now()) ORDER BY run_at,id LIMIT greatest(1,least(COALESCE(p_limit,10),50)) FOR UPDATE SKIP LOCKED LOOP
  IF j.status='leased' AND j.provider='smtp' THEN
   UPDATE agent_mail_jobs SET status='failed',attempts=attempts+1,last_error='smtp_delivery_unknown',lease_token=NULL,lease_until=NULL WHERE id=j.id;CONTINUE;
  END IF;
  IF j.provider IS NOT NULL AND j.provider<>p_provider THEN
   UPDATE agent_mail_jobs SET status='failed',last_error='MAIL_PROVIDER_CHANGED',lease_token=NULL,lease_until=NULL WHERE id=j.id;CONTINUE;
  END IF;
  IF j.status='leased' THEN j.attempts:=j.attempts+1;END IF;
  SELECT r.user_id,b.status INTO user_id,bk FROM agent_runs r JOIN bookings b ON b.booking_id=j.booking_id WHERE r.id=j.run_id AND r.status='booked';
  SELECT email INTO verified FROM auth.users u WHERE u.id=user_id AND u.email_confirmed_at IS NOT NULL;
  IF verified IS DISTINCT FROM j.to_email OR bk IS DISTINCT FROM 'confirmed' OR NOT EXISTS(SELECT 1 FROM agent_approvals WHERE run_id=j.run_id AND email_opt_in) THEN
   UPDATE agent_mail_jobs SET status='failed',last_error='RECIPIENT_OR_BOOKING_CHANGED',lease_token=NULL,lease_until=NULL WHERE id=j.id;CONTINUE;
  END IF;
  IF j.attempts>=j.max_attempts OR (j.send_window_expires_at IS NOT NULL AND j.send_window_expires_at<=now()) OR (j.template='booking_reminder' AND (j.snapshot->>'starts_at')::timestamptz<=now()) THEN
   UPDATE agent_mail_jobs SET status='failed',attempts=j.attempts,last_error='DELIVERY_WINDOW_OR_RETRIES_EXHAUSTED',lease_token=NULL,lease_until=NULL WHERE id=j.id;CONTINUE;
  END IF;
  UPDATE agent_mail_jobs SET status='leased',provider=COALESCE(provider,p_provider),attempts=j.attempts,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',first_lease_at=COALESCE(first_lease_at,now()),send_window_expires_at=COALESCE(send_window_expires_at,now()+interval '23 hours') WHERE id=j.id RETURNING * INTO j;
  result:=result||jsonb_build_array(jsonb_build_object('id',j.id,'lease_token',j.lease_token,'to_email',j.to_email,'verified_email',true,'booking_status','confirmed','template',j.template,'snapshot',j.snapshot,'send_window_expires_at',j.send_window_expires_at));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION journey_hub.agent_finish_mail(p_job_id uuid,p_lease_token uuid,p_outcome text,p_provider_id text,p_error text,p_retry_after_seconds integer DEFAULT 60) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE j agent_mail_jobs;nextstatus text;attempt int;delayseconds int;
BEGIN
 IF COALESCE(p_outcome,'') NOT IN ('sent','retry','failed','config_missing') THEN RAISE EXCEPTION 'INVALID_MAIL_OUTCOME';END IF;
 SELECT * INTO j FROM agent_mail_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR j.lease_token IS DISTINCT FROM p_lease_token OR j.status<>'leased' OR j.lease_until<now() THEN RAISE EXCEPTION 'STALE_MAIL_LEASE' USING ERRCODE='42501';END IF;
 attempt:=j.attempts+CASE WHEN p_outcome='config_missing' THEN 0 ELSE 1 END;
 delayseconds:=CASE WHEN p_outcome='config_missing' THEN 900 ELSE greatest(30,least(COALESCE(p_retry_after_seconds,60),3600)) END;
 nextstatus:=CASE WHEN p_outcome='sent' THEN 'accepted' WHEN p_outcome='failed' OR attempt>=j.max_attempts OR now()+make_interval(secs=>delayseconds)>=j.send_window_expires_at THEN 'failed' ELSE 'pending' END;
 UPDATE agent_mail_jobs SET status=nextstatus,attempts=attempt,provider_id=CASE WHEN p_outcome='sent' THEN left(p_provider_id,200) ELSE provider_id END,
 last_error=CASE WHEN p_outcome='sent' THEN NULL WHEN p_outcome='config_missing' THEN 'MAIL_CONFIGURATION_REQUIRED' ELSE left(COALESCE(p_error,'MAIL_DELIVERY_FAILED'),200) END,
 run_at=now()+make_interval(secs=>delayseconds),accepted_at=CASE WHEN p_outcome='sent' THEN now() ELSE accepted_at END,lease_until=NULL,lease_token=NULL WHERE id=j.id;
 INSERT INTO agent_events(run_id,type,detail) VALUES(j.run_id,CASE WHEN nextstatus='accepted' THEN 'email_provider_accepted' WHEN nextstatus='failed' THEN 'email_failed' ELSE 'email_retry_scheduled' END,jsonb_build_object('jobId',j.id,'template',j.template));
 RETURN jsonb_build_object('ok',true,'status',nextstatus,'attempts',attempt);
END $$;
CREATE FUNCTION journey_hub.agent_worker_config() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE secret text;scheduled boolean:=false;
BEGIN
 IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1 ORDER BY created_at DESC LIMIT 1' INTO secret USING 'journeyhub_agent_worker_secret';END IF;
 IF to_regclass('cron.job') IS NOT NULL THEN EXECUTE 'SELECT count(*)=2 FROM cron.job WHERE jobname IN ($1,$2) AND active' INTO scheduled USING 'journeyhub-agent-bookings','journeyhub-agent-mail';END IF;
 RETURN jsonb_build_object('worker_secret',secret,'scheduled',scheduled);
END $$;

-- Exposed invoker wrappers carry explicit least-privilege grants. Helpers are private.
CREATE FUNCTION public.journeyhub_agent_catalog(p_city text,p_date date,p_guests integer) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_catalog(p_city,p_date,p_guests)$$;
CREATE FUNCTION public.journeyhub_agent_begin(p_user_id uuid,p_request_id uuid,p_input jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_begin(p_user_id,p_request_id,p_input)$$;
CREATE FUNCTION public.journeyhub_agent_finalize(p_run_id uuid,p_planning_token uuid,p_plan jsonb,p_model text,p_response_id text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_finalize(p_run_id,p_planning_token,p_plan,p_model,p_response_id)$$;
CREATE FUNCTION public.journeyhub_agent_fail(p_run_id uuid,p_planning_token uuid,p_code text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_fail(p_run_id,p_planning_token,p_code)$$;
CREATE FUNCTION public.journeyhub_agent_list(p_limit integer DEFAULT 20) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_list(p_limit)$$;
CREATE FUNCTION public.journeyhub_agent_get(p_run_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_get(p_run_id)$$;
CREATE FUNCTION public.journeyhub_agent_confirm(p_run_id uuid,p_version integer,p_hash text,p_email_reminders boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_confirm(p_run_id,p_version,p_hash,p_email_reminders)$$;
CREATE FUNCTION public.journeyhub_agent_process_bookings(p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_process_bookings(p_limit)$$;
CREATE FUNCTION public.journeyhub_agent_claim_mail(p_limit integer DEFAULT 10,p_provider text DEFAULT 'resend') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_claim_mail(p_limit,p_provider)$$;
CREATE FUNCTION public.journeyhub_agent_finish_mail(p_job_id uuid,p_lease_token uuid,p_outcome text,p_provider_id text,p_error text,p_retry_after_seconds integer DEFAULT 60) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_finish_mail(p_job_id,p_lease_token,p_outcome,p_provider_id,p_error,p_retry_after_seconds)$$;
CREATE FUNCTION public.journeyhub_agent_worker_config() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_worker_config()$$;
DO $$ DECLARE f record;role_name text;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature,p.proname,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='journey_hub' AND p.proname LIKE 'agent_%') OR (n.nspname='public' AND p.proname LIKE 'journeyhub_agent_%') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.proname IN ('agent_list','agent_get','agent_confirm','journeyhub_agent_list','journeyhub_agent_get','journeyhub_agent_confirm') THEN role_name:='authenticated';
  ELSIF f.proname IN ('agent_catalog','agent_begin','agent_finalize','agent_fail','agent_process_bookings','agent_claim_mail','agent_finish_mail','agent_worker_config') OR (f.nspname='public' AND f.proname LIKE 'journeyhub_agent_%') THEN role_name:='service_role';
  ELSE CONTINUE;END IF;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f.signature,role_name);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA journey_hub TO service_role;
REVOKE ALL ON SEQUENCE journey_hub.agent_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
