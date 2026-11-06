-- Rollback-only integration checks. Run against the local harness after the multi-day migration.
BEGIN;
CREATE FUNCTION pg_temp.trip_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END $$;
CREATE FUNCTION pg_temp.trip_error(command text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE command;EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN;END IF;RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM;END;
 RAISE EXCEPTION 'Expected error %, command succeeded',expected;
END $$;
DO $$
DECLARE uid uuid:=gen_random_uuid();other_uid uuid:=gen_random_uuid();legacy_uid uuid:=gen_random_uuid();dt date:=current_date+3;input jsonb;begun jsonb;r jsonb;rid uuid;lease uuid;reqid uuid:=gen_random_uuid();proposal jsonb;other jsonb;cat jsonb;prior_time timestamptz;legacy jsonb;oldinput jsonb;oldhash text;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 (uid,'trip-test@example.invalid',now(),'{"display_name":"Trip Test"}'),(other_uid,'trip-other@example.invalid',now(),'{}'),(legacy_uid,'trip-legacy@example.invalid',now(),'{}');
 INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb) VALUES
 ('trip-day1-a','sh-bund',(dt+time '09:00') AT TIME ZONE 'Asia/Shanghai',(dt+time '10:00') AT TIME ZONE 'Asia/Shanghai',10,100),
 ('trip-day1-tight','sh-oldtown',(dt+time '10:10') AT TIME ZONE 'Asia/Shanghai',(dt+time '11:00') AT TIME ZONE 'Asia/Shanghai',10,100),
 ('trip-day1-b','sh-oldtown',(dt+time '11:00') AT TIME ZONE 'Asia/Shanghai',(dt+time '12:00') AT TIME ZONE 'Asia/Shanghai',10,100),
 ('trip-day2-a','sh-bund',(dt+1+time '09:00') AT TIME ZONE 'Asia/Shanghai',(dt+1+time '10:00') AT TIME ZONE 'Asia/Shanghai',10,100),
 ('trip-early','sh-bund',(dt+time '07:00') AT TIME ZONE 'Asia/Shanghai',(dt+time '08:00') AT TIME ZONE 'Asia/Shanghai',10,100);
 input:=jsonb_build_object('city','Shanghai','date',dt,'guests',2,'budgetThb',10000,'prompt','Culture','days',2,'dayStart','09:00','dayEnd','21:00','transport','walk','preferredExperienceIds',jsonb_build_array('sh-bund'),'excludedExperienceIds',jsonb_build_array('sh-tea'));
 cat:=public.journeyhub_agent_catalog_trip(input);
 PERFORM pg_temp.trip_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(cat) WHERE value->>'sessionId'='trip-day2-a'),'catalog includes day 2 using venue local date');
 PERFORM pg_temp.trip_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cat) WHERE value->>'sessionId'='trip-early' OR value->>'experienceId'='sh-tea'),'catalog excludes outside hours and skipped experiences');
 PERFORM pg_temp.trip_assert(cat#>>'{0,experienceId}'='sh-bund','wanted experiences prioritized in provider catalog');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',uid,gen_random_uuid(),input||'{"days":5}'),'INVALID_TRIP_INPUT');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',uid,gen_random_uuid(),input||'{"dayStart":"22:00"}'),'INVALID_TRIP_INPUT');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',uid,gen_random_uuid(),input||'{"excludedExperienceIds":["sh-bund"]}'),'INVALID_PREFERENCES');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',uid,gen_random_uuid(),input||'{"excludedExperienceIds":["sg-marina"]}'),'INVALID_PREFERENCES');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',uid,gen_random_uuid(),input||'{"preferredExperienceIds":[12]}'),'INVALID_PREFERENCES');
 begun:=public.journeyhub_agent_begin(uid,reqid,input);rid:=(begun->>'id')::uuid;lease:=(begun->>'planning_token')::uuid;
 PERFORM pg_temp.trip_assert(begun#>>'{run,requestId}'=reqid::text AND begun#>>'{run,progress,0,stage}'='receiving','in-flight run exposes request identity and actual receiving progress');
 PERFORM pg_temp.trip_assert(position(lease::text IN (begun->'run')::text)=0,'public run never exposes lease token');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_progress(%L,%L,''checking_catalog'')',rid,gen_random_uuid()),'INVALID_PLANNER_LEASE');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_progress(%L,%L,''validating'')',rid,lease),'INVALID_PROGRESS_ORDER');
 r:=public.journeyhub_agent_progress(rid,lease,'checking_catalog');prior_time:=(r->>'updatedAt')::timestamptz;
 PERFORM pg_temp.trip_assert(public.journeyhub_agent_progress(rid,lease,'checking_catalog')=r,'duplicate progress is idempotent');
 r:=public.journeyhub_agent_progress(rid,lease,'planning');
 PERFORM pg_temp.trip_assert((r->>'updatedAt')::timestamptz>prior_time AND jsonb_array_length(r->'progress')=3,'progress timestamp strictly advances');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid)::text,true);
 PERFORM pg_temp.trip_assert((public.journeyhub_agent_list()->0->>'requestId')=reqid::text,'owner can poll progress while POST is pending');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_uid)::text,true);
 PERFORM pg_temp.trip_assert(public.journeyhub_agent_list()='[]','other account cannot poll run');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid)::text,true);
 proposal:='{"summary":"Two days of culture","stops":[{"sessionId":"trip-day1-a","reason":"Wanted"},{"sessionId":"trip-day1-b","reason":"Culture"},{"sessionId":"trip-day2-a","reason":"Day two"}],"tips":[]}'::jsonb;
 r:=public.journeyhub_agent_progress(rid,lease,'validating');
 r:=public.journeyhub_agent_finalize(rid,lease,proposal,'test','test');
 PERFORM pg_temp.trip_assert(r#>>'{plan,days}'='2' AND r#>>'{plan,endDate}'=(dt+1)::text AND r#>>'{plan,stops,2,dayIndex}'='2' AND r#>>'{plan,stops,2,date}'=(dt+1)::text,'canonical multi-day metadata comes from server sessions');
 PERFORM pg_temp.trip_assert(r#>>'{plan,totalThb}'='600' AND jsonb_array_length(r#>'{plan,legs}')=1 AND r#>>'{plan,legs,0,estimated}'='true' AND r#>>'{plan,stops,0,coordinateAccuracy}'='area','exact total and one estimated same-day leg; no overnight travel leg');
 PERFORM pg_temp.trip_assert(r#>>'{plan,stops,0,coordinateSource}' LIKE 'https://www.wikidata.org/%','coordinate provenance retained');
 PERFORM pg_temp.trip_assert(NOT EXISTS(SELECT 1 FROM journey_hub.agent_booking_jobs WHERE run_id=rid),'planning has zero booking side effects');
 UPDATE journey_hub.venues SET lat=lat+0.1 WHERE venue_id='sh-bund-venue';
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,false)',rid,r->>'planHash'),'ITINERARY_CHANGED');
 UPDATE journey_hub.venues SET lat=31.238028 WHERE venue_id='sh-bund-venue';
 r:=public.journeyhub_agent_confirm(rid,1,r->>'planHash',false);
 UPDATE journey_hub.sessions SET capacity=1 WHERE session_id='trip-day2-a';
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.trip_assert(public.journeyhub_agent_get(rid)->>'status'='failed' AND NOT EXISTS(SELECT 1 FROM journey_hub.agent_reservations WHERE run_id=rid),'a day 2 inventory change rolls back every day');
 UPDATE journey_hub.sessions SET capacity=10 WHERE session_id='trip-day2-a';
 begun:=public.journeyhub_agent_begin(uid,gen_random_uuid(),input);rid:=(begun->>'id')::uuid;lease:=(begun->>'planning_token')::uuid;
 r:=public.journeyhub_agent_finalize(rid,lease,proposal,'test','test');
 legacy:=r->'plan';
 r:=public.journeyhub_agent_confirm(rid,1,r->>'planHash',false);
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.trip_assert((SELECT count(*)=3 FROM journey_hub.agent_reservations WHERE run_id=rid) AND NOT EXISTS(SELECT 1 FROM journey_hub.agent_mail_jobs WHERE run_id=rid),'confirmed multi-day plan books all sessions, respects no mail opt-in');
 begun:=public.journeyhub_agent_begin(uid,gen_random_uuid(),input||'{"excludedExperienceIds":["sh-oldtown"]}');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_finalize(%L,%L,%L,''test'',''test'')',begun->>'id',begun->>'planning_token',proposal),'EXCLUDED_EXPERIENCE');
 begun:=public.journeyhub_agent_begin(uid,gen_random_uuid(),input||'{"dayEnd":"10:00"}');
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_finalize(%L,%L,%L,''test'',''test'')',begun->>'id',begun->>'planning_token',proposal),'SESSION_OUTSIDE_ACTIVITY_HOURS');
 begun:=public.journeyhub_agent_begin(uid,gen_random_uuid(),input);
 PERFORM pg_temp.trip_error(format('SELECT public.journeyhub_agent_finalize(%L,%L,%L,''test'',''test'')',begun->>'id',begun->>'planning_token','{"stops":[{"sessionId":"trip-day1-a"},{"sessionId":"trip-day1-tight"}]}'),'OVERLAPPING_SESSIONS_TRAVEL_TIME');
 -- A pre-migration one-day immutable plan can still be approved and booked.
 oldinput:=jsonb_build_object('city','Shanghai','date',dt,'guests',2,'budgetThb',10000,'prompt','Legacy');
 legacy:=legacy-ARRAY['days','endDate','dayStart','dayEnd','transport','legs'];
 legacy:=jsonb_set(legacy,'{stops}',jsonb_build_array((legacy#>'{stops,0}')-ARRAY['date','dayIndex','lat','lng','coordinateAccuracy','coordinateSource']));
 legacy:=jsonb_set(legacy,'{totalThb}','200');oldhash:=encode(extensions.digest(legacy::text,'sha256'),'hex');
 INSERT INTO journey_hub.agent_runs(user_id,request_id,input,status,plan,plan_hash,expires_at) VALUES(legacy_uid,gen_random_uuid(),oldinput,'awaiting_confirmation',legacy,oldhash,now()+interval '20 minutes') RETURNING id,request_id INTO rid,reqid;
 PERFORM pg_temp.trip_assert((public.journeyhub_agent_begin(legacy_uid,reqid,oldinput)->>'cached')::boolean,'legacy input replay keeps its immutable run');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',legacy_uid)::text,true);
 PERFORM public.journeyhub_agent_confirm(rid,1,oldhash,false);PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.trip_assert(public.journeyhub_agent_get(rid)->>'status'='booked','legacy one-day approval remains compatible');
 PERFORM pg_temp.trip_assert(NOT has_function_privilege('authenticated','public.journeyhub_agent_progress(uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','public.journeyhub_agent_catalog_trip(jsonb)','EXECUTE') AND has_function_privilege('service_role','public.journeyhub_agent_progress(uuid,uuid,text)','EXECUTE'),'new RPCs remain service-only');
END $$;
SELECT 'PASS: multi-day local dates, activity hours, exclusion, wanted ranking, travel buffers, real leased progress/ownership, immutable coordinates, atomic cross-day bookings and legacy compatibility; all fixtures rolled back' AS result;
ROLLBACK;
