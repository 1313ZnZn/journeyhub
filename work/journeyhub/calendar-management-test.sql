-- Run after calendar-management.sql, or combine its DDL inside this BEGIN/ROLLBACK.
-- All fixtures are new random identities and catalog rows, never existing user data.
-- No worker, email provider, place search, payment or supplier API is called.
BEGIN;
CREATE FUNCTION pg_temp.calendar_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.calendar_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF position(expected IN SQLERRM)>0 THEN RETURN; END IF;
  RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM;
 END;
 RAISE EXCEPTION 'Expected error %, but command succeeded',expected;
END $$;
DO $$
DECLARE u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid();
 parent_id uuid:=gen_random_uuid(); hid uuid:=gen_random_uuid(); hid2 uuid:=gen_random_uuid(); cid uuid;
 rid uuid:=gen_random_uuid(); busy_run uuid:=gen_random_uuid(); booked_run uuid:=gen_random_uuid();
 venue text:='cm-venue-'||gen_random_uuid(); expid text:='cm-exp-'||gen_random_uuid();
 session1 text:='cm-future-'||gen_random_uuid(); session2 text:='cm-past-'||gen_random_uuid();
 session3 text:='cm-checkin-'||gen_random_uuid(); staffid text;
 booking1 text; booking2 text; booking3 text; past_booking text:='CM-PAST-'||gen_random_uuid(); checked_booking text:='CM-CHECKED-'||gen_random_uuid();
 tid uuid; req uuid; mailid uuid; inp jsonb; fixture_plan jsonb; result jsonb; again jsonb; snap jsonb; live jsonb;
 started jsonb; finalized jsonb; canonical jsonb; history_hash text; history_after text;
 dt date:=(now()AT TIME ZONE 'Asia/Singapore')::date+10;
BEGIN
 SELECT md5(COALESCE(jsonb_agg(to_jsonb(s)ORDER BY experience_id,month,week)::text,''))INTO history_hash FROM journey_hub.activity_weekly_stats s;
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)VALUES
  (u,'calendar-test-'||u||'@example.invalid',now(),'{"display_name":"Calendar fixture"}'),
  (other_user,'calendar-test-'||other_user||'@example.invalid',now(),'{}'),
  (manager,'calendar-test-'||manager||'@example.invalid',now(),'{}');
 INSERT INTO journey_hub.venues(venue_id,name,kind,area,city,country,time_zone)
  VALUES(venue,'Calendar test venue','workshop_venue','Test','Singapore','Singapore','Asia/Singapore');
 INSERT INTO journey_hub.experiences(experience_id,venue_id,name,kind,price_thb,duration_min)
  VALUES(expid,venue,'Calendar test activity','Workshop',1000,60);
 SELECT 'CM-'||lpad(n::text,4,'0') INTO staffid FROM generate_series(0,9999)n
  WHERE NOT EXISTS(SELECT 1 FROM journey_hub.staff s WHERE s.staff_id='CM-'||lpad(n::text,4,'0')) LIMIT 1;
 INSERT INTO journey_hub.staff(staff_id,display_name,role,venue_id,pin_hash,auth_user_id)
  VALUES(staffid,'Calendar test manager','duty_manager',venue,'disabled',manager);
 INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb)VALUES
  (session1,expid,(dt+time '10:00')AT TIME ZONE 'Asia/Singapore',(dt+time '11:00')AT TIME ZONE 'Asia/Singapore',3,1000),
  (session2,expid,now()-interval '2 days',now()-interval '2 days'+interval '1 hour',3,1000),
  (session3,expid,(dt+time '12:00')AT TIME ZONE 'Asia/Singapore',(dt+time '13:00')AT TIME ZONE 'Asia/Singapore',3,1000);
 inp:=jsonb_build_object('city','Singapore','date',dt,'guests',1,'prompt','Calendar test','days',1,'dayStart','09:00','dayEnd','18:00','transport','walk');
 fixture_plan:='{"summary":"Calendar fixture","stops":[{"id":"calendar_test_place","dayIndex":1,"start":"09:00","end":"10:00","reason":"fixture"}]}';
 INSERT INTO journey_hub.trip_history(id,user_id,input,place_ids)VALUES(parent_id,u,inp,ARRAY['calendar_test_place']);
 INSERT INTO journey_hub.trip_history(id,user_id,parent_id,input,place_ids,plan)VALUES
  (hid,u,parent_id,inp,ARRAY['calendar_test_place'],fixture_plan),(hid2,u,parent_id,inp,ARRAY['calendar_test_place'],fixture_plan);
 result:=public.journeyhub_care_confirm(u,'history',hid);cid:=(result->>'id')::uuid;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 PERFORM public.journeyhub_command('profile','{}',gen_random_uuid());
 SELECT traveler_id INTO tid FROM journey_hub.travelers WHERE auth_user_id=u;
 PERFORM pg_temp.calendar_assert(public.journeyhub_calendar_state()='{"removed":[]}'::jsonb,'new owner has no removals');

 -- Removal persists, preserves the full plan, pauses care and fences stale requests.
 req:=gen_random_uuid(); result:=public.journeyhub_calendar_manage('history',hid::text,'remove',req);
 PERFORM pg_temp.calendar_assert(result->>'carePaused'='true' AND result#>>'{removed,0,id}'=hid::text,'history removal returns canonical state');
 PERFORM pg_temp.calendar_assert((SELECT h.plan=fixture_plan FROM journey_hub.trip_history h WHERE h.id=hid),'original plan data retained');
 PERFORM pg_temp.calendar_assert((SELECT status='paused' AND revision=2 AND proposal IS NULL FROM journey_hub.trip_care WHERE id=cid),'care paused with revision fence');
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_care_update(%L,%L,1,NULL,NULL)',u,cid),'Care request conflict');
 PERFORM pg_temp.calendar_error(format('UPDATE journey_hub.trip_care SET status=''active'' WHERE id=%L',cid),'PLAN_REMOVED');
 again:=public.journeyhub_calendar_manage('history',hid::text,'remove',req);
 PERFORM pg_temp.calendar_assert(again=result AND(SELECT revision=2 FROM journey_hub.trip_care WHERE id=cid),'request retry performs removal once');
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''history'',%L,''restore'',%L)',hid,req),'REQUEST_ID_REUSED');
 PERFORM public.journeyhub_calendar_manage('history',hid2::text,'remove',gen_random_uuid());
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_care_confirm(%L,''history'',%L)',u,hid2),'PLAN_REMOVED');

 -- Other user / anonymous cannot read, restore, remove or cancel this owner's records.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user)::text,true);
 PERFORM pg_temp.calendar_assert(public.journeyhub_calendar_state()='{"removed":[]}'::jsonb,'removed list isolated by account');
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''history'',%L,''restore'',%L)',hid,gen_random_uuid()),'CALENDAR_ITEM_NOT_FOUND');
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM pg_temp.calendar_error('SELECT public.journeyhub_calendar_state()','SIGN_IN_REQUIRED');
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''history'',%L,''remove'',%L)',hid,gen_random_uuid()),'SIGN_IN_REQUIRED');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 PERFORM public.journeyhub_calendar_manage('history',hid::text,'restore',gen_random_uuid());
 PERFORM pg_temp.calendar_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.journeyhub_calendar_state()->'removed')x WHERE x->>'id'=hid::text),'restore removes only chosen tombstone');
 PERFORM pg_temp.calendar_assert((SELECT status='paused' FROM journey_hub.trip_care WHERE id=cid),'restore does not silently restart support');
 again:=public.journeyhub_calendar_manage('history',hid::text,'remove',req);
 PERFORM pg_temp.calendar_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(again->'removed')x WHERE x->>'id'=hid::text),'old retry cannot undo later restore');

 -- Real catalog planning RPCs: removed awaiting-confirmation run cannot queue via old tab.
 started:=public.journeyhub_agent_begin(u,gen_random_uuid(),inp||'{"budgetThb":20000}');rid:=(started->>'id')::uuid;
 finalized:=public.journeyhub_agent_finalize(rid,(started->>'planning_token')::uuid,
  jsonb_build_object('summary','Fixture','stops',jsonb_build_array(jsonb_build_object('sessionId',session1,'reason','Fixture')),'tips','[]'::jsonb),'test','calendar-test');
 PERFORM public.journeyhub_calendar_manage('run',rid::text,'remove',gen_random_uuid());
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,false)',rid,finalized->>'planHash'),'PLAN_REMOVED');
 PERFORM pg_temp.calendar_assert(NOT EXISTS(SELECT 1 FROM journey_hub.agent_booking_jobs WHERE run_id=rid),'failed stale confirmation creates no booking jobs');
 PERFORM public.journeyhub_calendar_manage('run',rid::text,'restore',gen_random_uuid());
 PERFORM public.journeyhub_agent_confirm(rid,1,finalized->>'planHash',false);
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''run'',%L,''remove'',%L)',rid,gen_random_uuid()),'PLAN_BUSY');
 INSERT INTO journey_hub.agent_runs(id,user_id,request_id,input,status)VALUES(busy_run,u,gen_random_uuid(),inp,'planning');
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''run'',%L,''remove'',%L)',busy_run,gen_random_uuid()),'PLAN_BUSY');

 -- Fill an isolated session through the traveler command, then cancel via the new API.
 result:=public.journeyhub_command('book',jsonb_build_object('sessionId',session1,'guests',3),gen_random_uuid());booking1:=result->>'id';
 PERFORM pg_temp.calendar_assert((SELECT sum(guests)=3 FROM journey_hub.bookings WHERE session_id=session1 AND status='confirmed'),'fixture capacity initially taken');
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''booking'',%L,''remove'',%L)',booking1,gen_random_uuid()),'ACTIVE_RESERVATION_REQUIRES_CANCELLATION');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user)::text,true);
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''booking'',%L,''cancel'',%L)',booking1,gen_random_uuid()),'CALENDAR_ITEM_NOT_FOUND');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);

 -- Link the fixture reservation to a completed catalog run and queued mail, without a worker.
 canonical:=finalized->'plan';
 INSERT INTO journey_hub.agent_runs(id,user_id,request_id,input,plan,status,confirmed_at)
  VALUES(booked_run,u,gen_random_uuid(),inp,canonical,'booked',now());
 INSERT INTO journey_hub.agent_reservations(run_id,session_id,booking_id)VALUES(booked_run,session1,booking1);
 INSERT INTO journey_hub.trip_care(user_id,source_type,source_id,input,plan)VALUES(u,'run',booked_run,inp,canonical);
 INSERT INTO journey_hub.agent_mail_jobs(run_id,session_id,booking_id,template,to_email,snapshot)
  VALUES(booked_run,session1,booking1,'booking_reminder','fixture@example.invalid','{}') RETURNING id INTO mailid;
 UPDATE journey_hub.agent_mail_jobs SET status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' WHERE id=mailid;
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''booking'',%L,''cancel'',%L)',booking1,gen_random_uuid()),'REMINDER_IN_PROGRESS');
 PERFORM pg_temp.calendar_assert((SELECT status='confirmed' FROM journey_hub.bookings WHERE booking_id=booking1),'leased message rejection rolls back cancellation');
 UPDATE journey_hub.agent_mail_jobs SET status='pending',lease_token=NULL,lease_until=NULL WHERE id=mailid;
 req:=gen_random_uuid();result:=public.journeyhub_calendar_manage('booking',booking1,'cancel',req);
 PERFORM pg_temp.calendar_assert(result->>'bookingStatus'='cancelled'AND result->>'carePaused'='true','reservation cancellation reports truthful status');
 PERFORM pg_temp.calendar_assert((SELECT status='cancelled'AND guests=3 FROM journey_hub.bookings WHERE booking_id=booking1),'reservation retained for audit');
 PERFORM pg_temp.calendar_assert((SELECT status='failed' AND last_error='BOOKING_CANCELLED' FROM journey_hub.agent_mail_jobs WHERE id=mailid),'cancelled booking cannot send queued reminder');
 PERFORM pg_temp.calendar_assert((SELECT status='paused' AND revision=2 FROM journey_hub.trip_care WHERE source_id=booked_run),'cancelled trip support paused');
 PERFORM pg_temp.calendar_assert((SELECT journey_hub.care_json(c)#>>'{run,bookings,0,status}'='cancelled'FROM journey_hub.trip_care c WHERE c.source_id=booked_run),'care reads live cancellation status');
 PERFORM pg_temp.calendar_assert(result=public.journeyhub_calendar_manage('booking',booking1,'cancel',req),'cancellation network retry idempotent');
 PERFORM pg_temp.calendar_assert((SELECT count(*)=1 FROM journey_hub.agent_events WHERE run_id=booked_run AND type='reservation_cancelled_by_traveler'),'one cancellation audit event');
 snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.calendar_assert((SELECT(x->>'seats_taken')::int=0 FROM jsonb_array_elements(snap->'sessions')x WHERE x->>'session_id'=session1),'traveler refresh sees seats released');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager)::text,true);
 snap:=public.journeyhub_snapshot();SELECT x INTO live FROM jsonb_array_elements(snap->'liveMetrics')x WHERE x->>'experience_id'=expid AND(x->>'month')::date=date_trunc('month',dt)::date;
 PERFORM pg_temp.calendar_assert((live->>'confirmed')::int=0 AND(live->>'cancelled')::int=3 AND(live->>'booked_value_thb')::int=0,'Staff Insights live confirmed/cancelled/value updated');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 result:=public.journeyhub_command('book',jsonb_build_object('sessionId',session1,'guests',3),gen_random_uuid());booking2:=result->>'id';
 PERFORM pg_temp.calendar_assert(booking2<>booking1 AND(SELECT sum(guests)=3 FROM journey_hub.bookings WHERE session_id=session1 AND status='confirmed'),'released seats can be reserved again');

 -- Removing a booked plan must never cancel its separate reservations.
 result:=public.journeyhub_command('book',jsonb_build_object('sessionId',session3,'guests',1),gen_random_uuid());booking3:=result->>'id';
 INSERT INTO journey_hub.agent_reservations(run_id,session_id,booking_id)VALUES(booked_run,session3,booking3);
 PERFORM public.journeyhub_calendar_manage('run',booked_run::text,'remove',gen_random_uuid());
 PERFORM pg_temp.calendar_assert((SELECT status='confirmed' FROM journey_hub.bookings WHERE booking_id=booking3),'plan removal preserves linked reservations');
 PERFORM public.journeyhub_calendar_manage('booking',booking1,'remove',gen_random_uuid());
 PERFORM public.journeyhub_calendar_manage('booking',booking1,'restore',gen_random_uuid());
 PERFORM pg_temp.calendar_assert((SELECT status='cancelled' FROM journey_hub.bookings WHERE booking_id=booking1),'restoring cancelled record never rebooks');

 -- Past and checked-in reservations are history only; hiding does not falsify attendance.
 INSERT INTO journey_hub.bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code)VALUES
  (past_booking,session2,tid,'Fixture',1,'app',1000,'CMTEST');
 INSERT INTO journey_hub.bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code,checked_in_at)VALUES
  (checked_booking,session3,tid,'Fixture',1,'app',1000,'CMTESU',now());
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''booking'',%L,''cancel'',%L)',past_booking,gen_random_uuid()),'RESERVATION_CANNOT_BE_CANCELLED');
 PERFORM pg_temp.calendar_error(format('SELECT public.journeyhub_calendar_manage(''booking'',%L,''cancel'',%L)',checked_booking,gen_random_uuid()),'RESERVATION_CANNOT_BE_CANCELLED');
 PERFORM public.journeyhub_calendar_manage('booking',past_booking,'remove',gen_random_uuid());
 PERFORM public.journeyhub_calendar_manage('booking',checked_booking,'remove',gen_random_uuid());
 PERFORM pg_temp.calendar_assert((SELECT checked_in_at IS NOT NULL AND status='confirmed'FROM journey_hub.bookings WHERE booking_id=checked_booking),'hide preserves attendance and reservation');
 SELECT md5(COALESCE(jsonb_agg(to_jsonb(s)ORDER BY experience_id,month,week)::text,''))INTO history_after FROM journey_hub.activity_weekly_stats s;
 PERFORM pg_temp.calendar_assert(history_hash=history_after,'historical results and forecast inputs unchanged');

 -- Privilege checks cover the actual browser roles, not only postgres test calls.
 PERFORM pg_temp.calendar_assert(NOT has_function_privilege('anon','public.journeyhub_calendar_manage(text,text,text,uuid)','EXECUTE')AND NOT has_function_privilege('anon','public.journeyhub_calendar_state()','EXECUTE'),'anonymous RPC privileges denied');
 PERFORM pg_temp.calendar_assert(has_function_privilege('authenticated','public.journeyhub_calendar_manage(text,text,text,uuid)','EXECUTE'),'authenticated wrapper available');
 PERFORM pg_temp.calendar_assert(NOT has_table_privilege('authenticated','journey_hub.calendar_removed_items','INSERT')AND NOT has_table_privilege('authenticated','journey_hub.calendar_removed_items','DELETE'),'browser cannot bypass owner-checked RPC');
 PERFORM set_config('test.calendar.owner',u::text,true);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.calendar.owner'))::text,true);
SELECT public.journeyhub_calendar_state() IS NOT NULL AS authenticated_rpc_works;
RESET ROLE;
SELECT 'PASS: account isolation, recoverable removal, care and mail fences, idempotency, booking capacity, Staff Insights, attendance and audit retention'AS result;
ROLLBACK;
