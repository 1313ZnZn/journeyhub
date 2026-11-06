-- Rollback-only fixtures. Apply calendar-date-conflicts.sql first, or combine its
-- statements and these statements inside one outer BEGIN/ROLLBACK for preflight.
BEGIN;
CREATE FUNCTION pg_temp.cd_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END $$;
CREATE FUNCTION pg_temp.cd_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN;END IF;RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM;END;
 RAISE EXCEPTION 'Expected %, command succeeded',expected;
END $$;
CREATE FUNCTION pg_temp.cd_input(dt date,n integer DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('city','Shanghai','date',dt,'guests',1,'prompt','Rollback calendar fixture','days',n,'dayStart','09:00','dayEnd','18:00','transport','walk')
$$;
CREATE FUNCTION pg_temp.cd_history(uid uuid,dt date,n integer DEFAULT 1) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE root uuid:=gen_random_uuid();id uuid:=gen_random_uuid();ids text[];plan jsonb;prefs jsonb:=pg_temp.cd_input(dt,n);
BEGIN
 SELECT array_agg('fixture_'||i ORDER BY i),jsonb_build_object('summary','Fixture','stops',jsonb_agg(jsonb_build_object('id','fixture_'||i,'dayIndex',i,'start','09:00','end','10:00','reason','Fixture') ORDER BY i)) INTO ids,plan FROM generate_series(1,n)i;
 PERFORM public.journeyhub_trip_history_save(uid,root,prefs,ids,'{}','{}',NULL,NULL);
 PERFORM public.journeyhub_trip_history_save(uid,id,prefs,ids,ids,'{}',plan,root);
 RETURN id;
END $$;
DO $$
DECLARE u uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();h uuid;h2 uuid;rid uuid;failed_id uuid;stale_id uuid;retry uuid:=gen_random_uuid();r jsonb;again jsonb;row journey_hub.trip_history;dt date:=current_date+20;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)VALUES
 (u,'dates-fixture-'||u||'@example.invalid',now(),'{}'),(other_user,'dates-fixture-'||other_user||'@example.invalid',now(),'{}');
 PERFORM pg_temp.cd_assert(NOT has_function_privilege('authenticated','public.journeyhub_plan_dates_check(uuid,jsonb,text,uuid)','execute'),'caller cannot check another account');
 PERFORM pg_temp.cd_assert(NOT has_function_privilege('anon','public.journeyhub_plan_dates_check(uuid,jsonb,text,uuid)','execute'),'anonymous cannot check account');
 PERFORM pg_temp.cd_assert(has_function_privilege('service_role','public.journeyhub_plan_dates_check(uuid,jsonb,text,uuid)','execute'),'trusted backend may preflight');
 PERFORM public.journeyhub_plan_dates_check(u,pg_temp.cd_input(dt,3));
 h:=pg_temp.cd_history(u,dt,3);
 PERFORM pg_temp.cd_error(format('SELECT public.journeyhub_plan_dates_check(%L,%L)',u,pg_temp.cd_input(dt+2)),'PLAN_DATE_CONFLICT:'||(dt+2)::text);
 PERFORM pg_temp.cd_error(format('SELECT pg_temp.cd_history(%L,%L,1)',u,dt+1),'PLAN_DATE_CONFLICT');
 PERFORM pg_temp.cd_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',u,gen_random_uuid(),pg_temp.cd_input(dt+2)),'PLAN_DATE_CONFLICT');
 PERFORM public.journeyhub_plan_dates_check(u,pg_temp.cd_input(dt+3));
 PERFORM public.journeyhub_plan_dates_check(u,pg_temp.cd_input(dt-1));
 PERFORM public.journeyhub_plan_dates_check(other_user,pg_temp.cd_input(dt,3));
 -- Exact immutable retry may reread its own record without creating a second plan.
 SELECT * INTO row FROM journey_hub.trip_history WHERE id=h;
 PERFORM public.journeyhub_plan_dates_check(u,row.input,'history',h);
 again:=public.journeyhub_trip_history_save(u,h,row.input,row.place_ids,row.wanted,row.skipped,row.plan,row.parent_id);
 PERFORM pg_temp.cd_assert(again->>'id'=h::text,'same-id save retry succeeds');
 -- Search-only records do not occupy travel dates.
 PERFORM public.journeyhub_trip_history_save(u,gen_random_uuid(),pg_temp.cd_input(dt,3),ARRAY['fixture_1'],'{}','{}',NULL,NULL);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 PERFORM public.journeyhub_calendar_manage('history',h::text,'remove',gen_random_uuid());
 PERFORM public.journeyhub_plan_dates_check(u,pg_temp.cd_input(dt,3));
 h2:=pg_temp.cd_history(u,dt+1);
 PERFORM pg_temp.cd_error(format('SELECT public.journeyhub_calendar_manage(''history'',%L,''restore'',%L)',h,gen_random_uuid()),'PLAN_DATE_CONFLICT');
 PERFORM public.journeyhub_calendar_manage('history',h2::text,'remove',gen_random_uuid());
 PERFORM public.journeyhub_calendar_manage('history',h::text,'restore',gen_random_uuid());
 PERFORM pg_temp.cd_assert(NOT EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items WHERE user_id=u AND item_id=h::text),'nonconflicting restore succeeds');
 -- A newly started catalog planning run reserves its full requested span.
 r:=public.journeyhub_agent_begin(u,retry,pg_temp.cd_input(dt+5,2));rid:=(r->>'id')::uuid;
 again:=public.journeyhub_agent_begin(u,retry,pg_temp.cd_input(dt+5,2));
 PERFORM pg_temp.cd_assert(again->>'id'=rid::text,'catalog network retry uses existing run');
 PERFORM pg_temp.cd_error(format('SELECT pg_temp.cd_history(%L,%L)',u,dt+6),'PLAN_DATE_CONFLICT');
 PERFORM pg_temp.cd_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',u,gen_random_uuid(),pg_temp.cd_input(dt+6)),'PLAN_DATE_CONFLICT');
 -- No-plan failures release occupancy; stale planning cannot reactivate over a new plan.
 UPDATE journey_hub.agent_runs SET status='failed' WHERE id=rid;
 PERFORM public.journeyhub_plan_dates_check(u,pg_temp.cd_input(dt+5,2));
 h2:=pg_temp.cd_history(u,dt+6);
 PERFORM pg_temp.cd_error(format('UPDATE journey_hub.agent_runs SET status=''planning'',planning_until=clock_timestamp()+interval ''2 minutes'' WHERE id=%L',rid),'PLAN_DATE_CONFLICT');
 INSERT INTO journey_hub.agent_runs(user_id,request_id,input,status,planning_until)VALUES(u,gen_random_uuid(),pg_temp.cd_input(dt+10),'planning',clock_timestamp()-interval '1 minute')RETURNING id INTO stale_id;
 h2:=pg_temp.cd_history(u,dt+10);
 PERFORM pg_temp.cd_error(format('UPDATE journey_hub.agent_runs SET planning_until=clock_timestamp()+interval ''2 minutes'' WHERE id=%L',stale_id),'PLAN_DATE_CONFLICT');
 -- Failed booking work still has a real saved plan, so that day remains occupied.
 INSERT INTO journey_hub.agent_runs(user_id,request_id,input,status,plan)VALUES(u,gen_random_uuid(),pg_temp.cd_input(dt+13),'failed','{"stops":[]}')RETURNING id INTO failed_id;
 PERFORM pg_temp.cd_error(format('SELECT pg_temp.cd_history(%L,%L)',u,dt+13),'PLAN_DATE_CONFLICT');
 PERFORM public.journeyhub_calendar_manage('run',failed_id::text,'remove',gen_random_uuid());
 h2:=pg_temp.cd_history(u,dt+13);
 PERFORM pg_temp.cd_error(format('SELECT public.journeyhub_calendar_manage(''run'',%L,''restore'',%L)',failed_id,gen_random_uuid()),'PLAN_DATE_CONFLICT');
 PERFORM pg_temp.cd_assert((SELECT count(*) FROM journey_hub.trip_history WHERE user_id=u AND plan IS NOT NULL)>=4,'existing versions retained');
END $$;
SELECT 'PASS: inclusive date overlap, cross-type conflicts, account isolation, same-id retries, search/failed/stale release, remove and restore guards. Fixtures rolled back.' AS result;
ROLLBACK;
