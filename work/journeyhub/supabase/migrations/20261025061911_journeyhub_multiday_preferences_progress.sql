-- Multi-day planning and real workflow progress. All booking/approval semantics stay unchanged.
BEGIN;
ALTER TABLE journey_hub.venues
 ADD COLUMN lat double precision CHECK(lat BETWEEN -90 AND 90),
 ADD COLUMN lng double precision CHECK(lng BETWEEN -180 AND 180),
 ADD COLUMN coordinate_accuracy text CHECK(coordinate_accuracy IN ('area','meeting_point')),
 ADD COLUMN coordinate_source text,
 ADD CONSTRAINT venue_coordinate_pair CHECK((lat IS NULL)=(lng IS NULL));

-- Public landmark/area references, not confirmed meeting points for the sample offers.
UPDATE journey_hub.venues v SET lat=p.lat,lng=p.lng,coordinate_accuracy='area',coordinate_source=p.source
FROM (VALUES
 ('sh-bund-venue',31.238028,121.486139,'https://www.wikidata.org/wiki/Q125474'),
 ('sh-oldtown-venue',31.229167,121.487500,'https://www.wikidata.org/wiki/Q1328025'),
 ('sh-tea-venue',31.229167,121.487500,'https://www.wikidata.org/wiki/Q1328025'),
 ('sg-marina-venue',1.284444,103.855833,'https://www.wikidata.org/wiki/Q40129'),
 ('sg-chinatown-venue',1.283611,103.844167,'https://www.wikidata.org/wiki/Q1318670'),
 ('sg-kampong-venue',1.301972,103.860944,'https://www.wikidata.org/wiki/Q4251481'),
 ('riverside-hub',13.747139,100.498166,'https://www.wikidata.org/wiki/Q983708'),
 ('old-town-pier',13.749167,100.491667,'https://www.wikidata.org/wiki/Q2132910'),
 ('silom-hub',13.724836,100.524003,'https://www.wikidata.org/wiki/Q1521617')
) p(id,lat,lng,source) WHERE v.venue_id=p.id;

CREATE OR REPLACE FUNCTION journey_hub.agent_view(p_run_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=journey_hub,pg_catalog AS $$
 SELECT jsonb_build_object('id',r.id,'requestId',r.request_id,'status',r.status,'version',r.version,'planHash',r.plan_hash,'input',r.input,'plan',r.plan,
 'createdAt',r.created_at,'updatedAt',r.updated_at,'expiresAt',r.expires_at,'confirmedAt',r.confirmed_at,'errorCode',r.error_code,
 'progress',COALESCE((SELECT jsonb_agg(jsonb_build_object('stage',detail->>'stage','at',at) ORDER BY id) FROM agent_events WHERE run_id=r.id AND type='planning_progress' AND detail->>'attempt'=r.planning_attempts::text),'[]'),
 'jobs',COALESCE((SELECT jsonb_agg(x ORDER BY x->>'id') FROM (
  SELECT jsonb_build_object('id',j.id,'kind','booking','status',j.status,'attempts',j.attempts,'maxAttempts',j.max_attempts,'runAt',j.run_at,'lastError',j.last_error) x FROM agent_booking_jobs j WHERE j.run_id=r.id
  UNION ALL SELECT jsonb_build_object('id',m.id,'kind',m.template,'status',m.status,'attempts',m.attempts,'maxAttempts',m.max_attempts,'runAt',m.run_at,'lastError',m.last_error) FROM agent_mail_jobs m WHERE m.run_id=r.id) q),'[]'),
 'bookings',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.booking_id,'sessionId',b.session_id,'checkinCode',b.checkin_code,'guests',b.guests,'status',b.status)) FROM agent_reservations a JOIN bookings b USING(booking_id) WHERE a.run_id=r.id),'[]'),
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('type',type,'at',at,'detail',detail) ORDER BY id) FROM (SELECT * FROM agent_events WHERE run_id=r.id ORDER BY id DESC LIMIT 50) ev),'[]'))
 FROM agent_runs r WHERE r.id=p_run_id
$$;

-- Shared, bounded normalization for the service-only entry points. It is not exposed.
CREATE FUNCTION journey_hub.agent_trip_input(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=journey_hub,pg_catalog AS $$
DECLARE dt date;qty int;budget int;days int;day_start text;day_end text;mode text;wanted jsonb;skipped jsonb;ids jsonb;id text;zone text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>8192 OR COALESCE(p_input->>'city','') NOT IN ('Bangkok','Shanghai','Singapore')
 OR COALESCE(p_input->>'guests','')!~'^[1-6]$' OR COALESCE(p_input->>'date','')!~'^\d{4}-\d{2}-\d{2}$' OR COALESCE(p_input->>'days','1')!~'^[1-4]$' THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 qty:=(p_input->>'guests')::int;dt:=(p_input->>'date')::date;days:=COALESCE((p_input->>'days')::int,1);
 zone:=CASE p_input->>'city' WHEN 'Bangkok' THEN 'Asia/Bangkok' WHEN 'Shanghai' THEN 'Asia/Shanghai' ELSE 'Asia/Singapore' END;
 budget:=COALESCE((p_input->>'budgetThb')::int,1000000);
 day_start:=COALESCE(p_input->>'dayStart','09:00');day_end:=COALESCE(p_input->>'dayEnd','21:00');mode:=COALESCE(p_input->>'transport','drive');
 IF budget NOT BETWEEN 1 AND 1000000 OR dt<(now() AT TIME ZONE zone)::date OR dt+days-1>(now() AT TIME ZONE zone)::date+366
 OR day_start!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR day_end!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR day_start>=day_end OR mode NOT IN ('walk','drive')
 OR length(COALESCE(p_input->>'prompt',''))>2000 THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 wanted:=COALESCE(NULLIF(p_input->'preferredExperienceIds','null'),'[]');skipped:=COALESCE(NULLIF(p_input->'excludedExperienceIds','null'),'[]');
 FOREACH ids IN ARRAY ARRAY[wanted,skipped] LOOP
  IF jsonb_typeof(ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PREFERENCES';END IF;
  IF jsonb_array_length(ids)>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(ids) WHERE jsonb_typeof(value)<>'string') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(ids))<>jsonb_array_length(ids) THEN RAISE EXCEPTION 'INVALID_PREFERENCES';END IF;
  FOR id IN SELECT value#>>'{}' FROM jsonb_array_elements(ids) LOOP
   IF COALESCE(id,'')!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' OR NOT EXISTS(SELECT 1 FROM experiences e JOIN venues v USING(venue_id) WHERE e.experience_id=id AND v.city=p_input->>'city') THEN RAISE EXCEPTION 'INVALID_PREFERENCES';END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(wanted) w WHERE skipped ? w.value) THEN RAISE EXCEPTION 'INVALID_PREFERENCES';END IF;
 SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]') INTO wanted FROM jsonb_array_elements_text(wanted);
 SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]') INTO skipped FROM jsonb_array_elements_text(skipped);
 RETURN jsonb_build_object('city',p_input->>'city','date',dt,'guests',qty,'budgetThb',budget,'prompt',COALESCE(p_input->>'prompt',''),'days',days,'dayStart',day_start,'dayEnd',day_end,'transport',mode,'preferredExperienceIds',wanted,'excludedExperienceIds',skipped);
END $$;

CREATE FUNCTION journey_hub.agent_transfer(p_from_lat double precision,p_from_lng double precision,p_to_lat double precision,p_to_lng double precision,p_mode text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a double precision;km double precision;mins int;
BEGIN
 IF p_mode NOT IN ('walk','drive') THEN RAISE EXCEPTION 'INVALID_TRAVEL_MODE';END IF;
 IF p_from_lat IS NULL OR p_from_lng IS NULL OR p_to_lat IS NULL OR p_to_lng IS NULL THEN RETURN jsonb_build_object('mode',p_mode,'distanceKm',NULL,'durationMinutes',30,'estimated',true,'basis','fallback');END IF;
 a:=power(sin(radians(p_to_lat-p_from_lat)/2),2)+cos(radians(p_from_lat))*cos(radians(p_to_lat))*power(sin(radians(p_to_lng-p_from_lng)/2),2);
 km:=6371*2*atan2(sqrt(least(1,greatest(0,a))),sqrt(greatest(0,1-a)))*1.3;
 mins:=greatest(15,ceil((km/(CASE WHEN p_mode='walk' THEN 4.5 ELSE 25 END)*60+10)/5)::int*5);
 RETURN jsonb_build_object('mode',p_mode,'distanceKm',round(km::numeric,1),'durationMinutes',mins,'estimated',true,'basis','coordinates');
END $$;

CREATE FUNCTION journey_hub.agent_catalog_trip(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE inp jsonb:=agent_trip_input(p_input);result jsonb;
BEGIN
 SELECT COALESCE(jsonb_agg(row_data ORDER BY preferred DESC,starts_at,session_id),'[]') INTO result FROM (
  SELECT s.starts_at,s.session_id,(inp->'preferredExperienceIds' ? e.experience_id) preferred,
  jsonb_build_object('sessionId',s.session_id,'experienceId',e.experience_id,'title',e.name,'kind',e.kind,'city',v.city,'venue',v.name,
  'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',v.time_zone,'unitPriceThb',COALESCE(s.price_thb,e.price_thb),'seatsLeft',s.capacity-s.seats_held_other_channels-COALESCE(b.taken,0),
  'date',(s.starts_at AT TIME ZONE v.time_zone)::date,'dayIndex',(s.starts_at AT TIME ZONE v.time_zone)::date-(inp->>'date')::date+1,
  'lat',v.lat,'lng',v.lng,'coordinateAccuracy',v.coordinate_accuracy,'coordinateSource',v.coordinate_source) row_data
  FROM sessions s JOIN experiences e USING(experience_id) JOIN venues v USING(venue_id)
  LEFT JOIN LATERAL(SELECT sum(guests) taken FROM bookings WHERE session_id=s.session_id AND status='confirmed') b ON true
  WHERE v.city=inp->>'city' AND (s.starts_at AT TIME ZONE v.time_zone)::date BETWEEN (inp->>'date')::date AND (inp->>'date')::date+(inp->>'days')::int-1
  AND (s.ends_at AT TIME ZONE v.time_zone)::date=(s.starts_at AT TIME ZONE v.time_zone)::date
  AND (s.starts_at AT TIME ZONE v.time_zone)::time>=(inp->>'dayStart')::time AND (s.ends_at AT TIME ZONE v.time_zone)::time<=(inp->>'dayEnd')::time
  AND NOT (inp->'excludedExperienceIds' ? e.experience_id) AND s.status='open' AND s.starts_at>now()
  AND s.capacity-s.seats_held_other_channels-COALESCE(b.taken,0)>=(inp->>'guests')::int
  ORDER BY preferred DESC,s.starts_at,s.session_id LIMIT 160
 ) q;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION journey_hub.agent_begin(p_user_id uuid,p_request_id uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE r agent_runs; normalized jsonb; claimed boolean:=false;old_normalized jsonb;
BEGIN
 IF p_user_id IS NULL OR p_request_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'VERIFIED_ACCOUNT_REQUIRED' USING ERRCODE='42501';END IF;
 normalized:=agent_trip_input(p_input);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':agent-begin',0));
 SELECT * INTO r FROM agent_runs WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  -- Fill missing new settings for legacy request replay without modifying its immutable input.
  old_normalized:=jsonb_build_object('days',1,'dayStart','09:00','dayEnd','21:00','transport','drive','preferredExperienceIds','[]'::jsonb,'excludedExperienceIds','[]'::jsonb)||r.input;
  IF old_normalized<>normalized THEN RAISE EXCEPTION 'REQUEST_ID_REUSED';END IF;
  IF r.status='planning' AND r.planning_until<now() AND r.planning_attempts<3 THEN
   UPDATE agent_runs SET planning_token=gen_random_uuid(),planning_until=now()+interval '2 minutes',planning_attempts=planning_attempts+1,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;claimed:=true;
  ELSIF r.status='planning' AND r.planning_until<now() THEN UPDATE agent_runs SET status='failed',error_code='PLANNER_TIMEOUT',updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  END IF;
 ELSE
  IF (SELECT count(*) FROM agent_runs WHERE user_id=p_user_id AND created_at>now()-interval '1 hour')>=6 OR
     (SELECT count(*) FROM agent_runs WHERE user_id=p_user_id AND created_at>now()-interval '24 hours')>=20 THEN RAISE EXCEPTION 'PLANNER_RATE_LIMIT';END IF;
  INSERT INTO agent_runs(user_id,request_id,input) VALUES(p_user_id,p_request_id,normalized) RETURNING * INTO r;claimed:=true;
  INSERT INTO agent_events(run_id,type) VALUES(r.id,'planning_started');
 END IF;
 IF claimed THEN INSERT INTO agent_events(run_id,type,detail) VALUES(r.id,'planning_progress',jsonb_build_object('stage','receiving','attempt',r.planning_attempts));END IF;
 RETURN jsonb_build_object('id',r.id,'status',r.status,'planning_token',CASE WHEN claimed THEN r.planning_token END,'cached',NOT claimed,'run',agent_view(r.id));
END $$;

CREATE FUNCTION journey_hub.agent_progress(p_run_id uuid,p_planning_token uuid,p_stage text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE r agent_runs;previous text;stages text[]:=ARRAY['receiving','checking_catalog','planning','validating'];
BEGIN
 SELECT * INTO r FROM agent_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR r.planning_token IS DISTINCT FROM p_planning_token THEN RAISE EXCEPTION 'INVALID_PLANNER_LEASE' USING ERRCODE='42501';END IF;
 IF r.status<>'planning' OR r.planning_until<clock_timestamp() THEN RAISE EXCEPTION 'PLANNER_LEASE_EXPIRED';END IF;
 IF p_stage IS NULL OR NOT (p_stage=ANY(stages)) THEN RAISE EXCEPTION 'INVALID_PROGRESS_STAGE';END IF;
 SELECT detail->>'stage' INTO previous FROM agent_events WHERE run_id=r.id AND type='planning_progress' AND detail->>'attempt'=r.planning_attempts::text ORDER BY id DESC LIMIT 1;
 IF previous IS NOT DISTINCT FROM p_stage THEN RETURN agent_view(r.id);END IF;
 IF array_position(stages,p_stage)<>COALESCE(array_position(stages,previous),0)+1 THEN RAISE EXCEPTION 'INVALID_PROGRESS_ORDER';END IF;
 UPDATE agent_runs SET updated_at=clock_timestamp() WHERE id=r.id;
 INSERT INTO agent_events(run_id,type,detail,at) VALUES(r.id,'planning_progress',jsonb_build_object('stage',p_stage,'attempt',r.planning_attempts),clock_timestamp());
 RETURN agent_view(r.id);
END $$;

CREATE OR REPLACE FUNCTION journey_hub.agent_finalize(p_run_id uuid,p_planning_token uuid,p_plan jsonb,p_model text,p_response_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE r agent_runs; item jsonb; s record; stops jsonb:='[]';tips jsonb:='[]';canonical jsonb;ids text[]:='{}';total int:=0;qty int;prev_end timestamptz;first_start timestamptz;
 dt date;days int;day_start time;day_end time;mode text;local_date date;prev_date date;prev_lat double precision;prev_lng double precision;prev_id text;leg jsonb;legs jsonb:='[]';
BEGIN
 SELECT * INTO r FROM agent_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR r.planning_token IS DISTINCT FROM p_planning_token THEN RAISE EXCEPTION 'INVALID_PLANNER_LEASE' USING ERRCODE='42501';END IF;
 IF r.model_result=p_plan AND r.status<>'planning' THEN RETURN agent_view(r.id);END IF;
 IF r.status<>'planning' OR r.planning_until<now() THEN RAISE EXCEPTION 'PLANNER_LEASE_EXPIRED';END IF;
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR octet_length(p_plan::text)>20000 OR jsonb_typeof(p_plan->'stops') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_PLAN';END IF;
 IF jsonb_array_length(p_plan->'stops') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'PLAN_NEEDS_ONE_TO_TWELVE_SESSIONS';END IF;
 qty:=(r.input->>'guests')::int;dt:=(r.input->>'date')::date;days:=COALESCE((r.input->>'days')::int,1);day_start:=COALESCE(r.input->>'dayStart','09:00')::time;day_end:=COALESCE(r.input->>'dayEnd','21:00')::time;mode:=COALESCE(r.input->>'transport','drive');
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'stops') LOOP
  IF COALESCE(item->>'sessionId','')=ANY(ids) THEN RAISE EXCEPTION 'DUPLICATE_SESSION';END IF;ids:=array_append(ids,item->>'sessionId');
  SELECT ss.*,e.name,e.experience_id AS exp_id,e.venue_id,COALESCE(ss.price_thb,e.price_thb) AS unit_price,v.city,v.name AS venue,v.time_zone,v.lat,v.lng,v.coordinate_accuracy,v.coordinate_source,
  ss.capacity-ss.seats_held_other_channels-COALESCE((SELECT sum(guests) FROM bookings b WHERE b.session_id=ss.session_id AND b.status='confirmed'),0) AS available
  INTO s FROM sessions ss JOIN experiences e USING(experience_id) JOIN venues v USING(venue_id) WHERE ss.session_id=item->>'sessionId';
  IF NOT FOUND OR s.city<>r.input->>'city' OR s.status<>'open' OR s.starts_at<=now() THEN RAISE EXCEPTION 'INVALID_SESSION';END IF;
  local_date:=(s.starts_at AT TIME ZONE s.time_zone)::date;
  IF local_date NOT BETWEEN dt AND dt+days-1 OR (s.ends_at AT TIME ZONE s.time_zone)::date<>local_date
  OR (s.starts_at AT TIME ZONE s.time_zone)::time<day_start OR (s.ends_at AT TIME ZONE s.time_zone)::time>day_end THEN RAISE EXCEPTION 'SESSION_OUTSIDE_ACTIVITY_HOURS';END IF;
  IF COALESCE(r.input->'excludedExperienceIds','[]') ? s.exp_id THEN RAISE EXCEPTION 'EXCLUDED_EXPERIENCE';END IF;
  IF s.available<qty THEN RAISE EXCEPTION 'CAPACITY_CHANGED';END IF;
  IF prev_end IS NOT NULL AND s.starts_at<prev_end THEN RAISE EXCEPTION 'OVERLAPPING_SESSIONS';END IF;
  IF prev_date=local_date THEN
   leg:=agent_transfer(prev_lat,prev_lng,s.lat,s.lng,mode);
   IF s.starts_at<prev_end+make_interval(mins=>(leg->>'durationMinutes')::int) THEN RAISE EXCEPTION 'OVERLAPPING_SESSIONS_TRAVEL_TIME';END IF;
   legs:=legs||jsonb_build_array(leg||jsonb_build_object('fromSessionId',prev_id,'toSessionId',s.session_id,'dayIndex',local_date-dt+1));
  END IF;
  prev_end:=s.ends_at;prev_date:=local_date;prev_lat:=s.lat;prev_lng:=s.lng;prev_id:=s.session_id;first_start:=COALESCE(first_start,s.starts_at);total:=total+s.unit_price*qty;
  stops:=stops||jsonb_build_array(jsonb_build_object('sessionId',s.session_id,'experienceId',s.exp_id,'title',s.name,'city',s.city,'venueId',s.venue_id,'venue',s.venue,'startsAt',s.starts_at,'endsAt',s.ends_at,'timeZone',s.time_zone,'unitPriceThb',s.unit_price,'guests',qty,'totalThb',s.unit_price*qty,'reason',left(COALESCE(item->>'reason',''),600),'date',local_date,'dayIndex',local_date-dt+1,'lat',s.lat,'lng',s.lng,'coordinateAccuracy',s.coordinate_accuracy,'coordinateSource',s.coordinate_source));
 END LOOP;
 IF total>(r.input->>'budgetThb')::int THEN RAISE EXCEPTION 'PLAN_EXCEEDS_BUDGET';END IF;
 IF jsonb_typeof(p_plan->'tips')='array' THEN SELECT COALESCE(jsonb_agg(left(value#>>'{}',300)),'[]') INTO tips FROM (SELECT value FROM jsonb_array_elements(p_plan->'tips') WHERE jsonb_typeof(value)='string' LIMIT 6) q;END IF;
 canonical:=jsonb_build_object('city',r.input->>'city','date',dt,'days',days,'endDate',dt+days-1,'dayStart',to_char(day_start,'HH24:MI'),'dayEnd',to_char(day_end,'HH24:MI'),'transport',mode,'guests',qty,'currency','THB','sampleCatalog',true,'totalThb',total,'summary',left(COALESCE(p_plan->>'summary',''),1200),'tips',tips,'stops',stops,'legs',legs);
 UPDATE agent_runs SET plan=canonical,plan_hash=encode(extensions.digest(canonical::text,'sha256'),'hex'),model_result=p_plan,model=left(p_model,120),response_id=left(p_response_id,200),status='awaiting_confirmation',expires_at=least(now()+interval '30 minutes',first_start),updated_at=clock_timestamp() WHERE id=r.id;
 INSERT INTO agent_events(run_id,type) VALUES(r.id,'plan_ready');RETURN agent_view(r.id);
END $$;

-- New APIs remain service-only; existing authenticated approval/list/get grants are untouched.
CREATE OR REPLACE FUNCTION journey_hub.agent_validate(p_plan jsonb,p_user_id uuid) RETURNS void LANGUAGE plpgsql SET search_path=journey_hub,pg_catalog AS $$
DECLARE item jsonb;s record;qty int:=(p_plan->>'guests')::int;tid uuid;dt date:=(p_plan->>'date')::date;days int:=COALESCE((p_plan->>'days')::int,1);
 day_start time:=COALESCE(p_plan->>'dayStart','00:00')::time;day_end time:=COALESCE(p_plan->>'dayEnd','23:59')::time;mode text:=COALESCE(p_plan->>'transport','drive');
 local_date date;prev_date date;prev_end timestamptz;prev_lat double precision;prev_lng double precision;prev_id text;leg jsonb;legs jsonb:='[]';
BEGIN
 SELECT traveler_id INTO tid FROM travelers WHERE auth_user_id=p_user_id;
 IF tid IS NULL THEN RAISE EXCEPTION 'PROFILE_REQUIRED';END IF;
 PERFORM ss.session_id FROM sessions ss WHERE ss.session_id IN (SELECT value->>'sessionId' FROM jsonb_array_elements(p_plan->'stops')) ORDER BY ss.session_id FOR UPDATE;
 PERFORM e.experience_id FROM experiences e WHERE e.experience_id IN (SELECT ss.experience_id FROM sessions ss WHERE ss.session_id IN (SELECT value->>'sessionId' FROM jsonb_array_elements(p_plan->'stops'))) ORDER BY e.experience_id FOR SHARE;
 PERFORM v.venue_id FROM venues v WHERE v.venue_id IN (SELECT e.venue_id FROM experiences e JOIN sessions ss USING(experience_id) WHERE ss.session_id IN (SELECT value->>'sessionId' FROM jsonb_array_elements(p_plan->'stops'))) ORDER BY v.venue_id FOR SHARE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'stops') LOOP
  SELECT ss.*,COALESCE(ss.price_thb,e.price_thb) unit_price,e.name AS title,e.venue_id,v.city,v.name AS venue,v.time_zone,v.lat,v.lng,v.coordinate_accuracy INTO s FROM sessions ss JOIN experiences e USING(experience_id) JOIN venues v USING(venue_id) WHERE ss.session_id=item->>'sessionId';
  IF NOT FOUND OR s.status<>'open' OR s.starts_at<=now() OR s.starts_at<>(item->>'startsAt')::timestamptz OR s.ends_at<>(item->>'endsAt')::timestamptz OR s.experience_id<>item->>'experienceId' THEN RAISE EXCEPTION 'SESSION_CHANGED';END IF;
  IF s.venue_id IS DISTINCT FROM item->>'venueId' OR s.title IS DISTINCT FROM item->>'title' OR s.city IS DISTINCT FROM item->>'city' OR s.city IS DISTINCT FROM p_plan->>'city' OR s.venue IS DISTINCT FROM item->>'venue' OR s.time_zone IS DISTINCT FROM item->>'timeZone' THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
  -- New plans snapshot the geographic inputs too. Old approvals without coordinates still work.
  IF item ? 'lat' AND (s.lat IS DISTINCT FROM (item->>'lat')::double precision OR s.lng IS DISTINCT FROM (item->>'lng')::double precision OR s.coordinate_accuracy IS DISTINCT FROM item->>'coordinateAccuracy') THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
  local_date:=(s.starts_at AT TIME ZONE s.time_zone)::date;
  IF p_plan ? 'days' THEN
   IF local_date NOT BETWEEN dt AND dt+days-1 OR (s.ends_at AT TIME ZONE s.time_zone)::date<>local_date OR (s.starts_at AT TIME ZONE s.time_zone)::time<day_start OR (s.ends_at AT TIME ZONE s.time_zone)::time>day_end THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
   IF item->>'date' IS DISTINCT FROM local_date::text OR (item->>'dayIndex')::int IS DISTINCT FROM local_date-dt+1 THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
   IF prev_end IS NOT NULL AND s.starts_at<prev_end THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
   IF prev_date=local_date THEN
    leg:=agent_transfer(prev_lat,prev_lng,s.lat,s.lng,mode);
    IF s.starts_at<prev_end+make_interval(mins=>(leg->>'durationMinutes')::int) THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
    legs:=legs||jsonb_build_array(leg||jsonb_build_object('fromSessionId',prev_id,'toSessionId',s.session_id,'dayIndex',local_date-dt+1));
   END IF;
  END IF;
  prev_end:=s.ends_at;prev_date:=local_date;prev_lat:=s.lat;prev_lng:=s.lng;prev_id:=s.session_id;
  IF s.unit_price<>(item->>'unitPriceThb')::int THEN RAISE EXCEPTION 'PRICE_CHANGED';END IF;
  IF s.capacity-s.seats_held_other_channels-COALESCE((SELECT sum(guests) FROM bookings WHERE session_id=s.session_id AND status='confirmed'),0)<qty THEN RAISE EXCEPTION 'CAPACITY_CHANGED';END IF;
  IF EXISTS(SELECT 1 FROM bookings WHERE traveler_id=tid AND session_id=s.session_id AND status='confirmed') THEN RAISE EXCEPTION 'ALREADY_BOOKED';END IF;
 END LOOP;
 IF p_plan ? 'legs' AND p_plan->'legs' IS DISTINCT FROM legs THEN RAISE EXCEPTION 'ITINERARY_CHANGED';END IF;
END $$;

CREATE FUNCTION public.journeyhub_agent_catalog_trip(p_input jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_catalog_trip(p_input)$$;
CREATE FUNCTION public.journeyhub_agent_progress(p_run_id uuid,p_planning_token uuid,p_stage text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.agent_progress(p_run_id,p_planning_token,p_stage)$$;
REVOKE ALL ON FUNCTION journey_hub.agent_trip_input(jsonb),journey_hub.agent_transfer(double precision,double precision,double precision,double precision,text),journey_hub.agent_catalog_trip(jsonb),journey_hub.agent_progress(uuid,uuid,text),public.journeyhub_agent_catalog_trip(jsonb),public.journeyhub_agent_progress(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION journey_hub.agent_catalog_trip(jsonb),journey_hub.agent_progress(uuid,uuid,text),public.journeyhub_agent_catalog_trip(jsonb),public.journeyhub_agent_progress(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
