-- Rollback-only integration checks; no external providers, tickets or messages.
BEGIN;
CREATE FUNCTION pg_temp.care_assert(ok boolean,label text)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END$$;
DO $$
DECLARE u uuid:=gen_random_uuid();other uuid:=gen_random_uuid();root uuid:=gen_random_uuid();hid uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();cid uuid;propid uuid:=gen_random_uuid();
 inp jsonb;plan jsonb;out jsonb;again jsonb;candidate jsonb;nowlocal timestamp:=now()AT TIME ZONE 'Asia/Singapore';tm timestamp;skipped boolean;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)VALUES(u,'care-test-'||u||'@example.invalid',now(),'{}'),(other,'care-test-'||other||'@example.invalid',now(),'{}');
 inp:=jsonb_build_object('city','Singapore','date',current_date+1,'guests',1,'prompt','Care test','days',1,'dayStart','00:00','dayEnd','23:59','transport','walk','preferredExperienceIds','[]'::jsonb,'excludedExperienceIds','[]'::jsonb);
 plan:=jsonb_build_object('summary','Test route','stops',jsonb_build_array(jsonb_build_object('id','test_place','dayIndex',1,'start','09:00','end','10:00','reason','test')));
 INSERT INTO journey_hub.trip_history(id,user_id,input,place_ids)VALUES(root,u,inp,ARRAY['test_place']);
 INSERT INTO journey_hub.trip_history(id,user_id,parent_id,input,place_ids,plan)VALUES(hid,u,root,inp,ARRAY['test_place'],plan);
 out:=public.journeyhub_care_confirm(u,'history',hid);cid:=(out->>'id')::uuid;
 again:=public.journeyhub_care_confirm(u,'history',hid);
 PERFORM pg_temp.care_assert(again->>'id'=out->>'id','duplicate confirm idempotent');
 PERFORM pg_temp.care_assert(public.journeyhub_care_get(other,cid)IS NULL,'other owner cannot get');
 PERFORM pg_temp.care_assert(public.journeyhub_care_list(other)='[]'::jsonb,'other owner cannot list');
 skipped:=false;BEGIN PERFORM public.journeyhub_care_confirm(other,'history',hid);EXCEPTION WHEN OTHERS THEN skipped:=true;END;PERFORM pg_temp.care_assert(skipped,'other owner cannot confirm');
 PERFORM pg_temp.care_assert(NOT has_function_privilege('anon','public.journeyhub_care_confirm(uuid,text,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.journeyhub_care_confirm(uuid,text,uuid)','EXECUTE'),'public cannot spoof owner RPC');
 candidate:=jsonb_set(plan,'{stops,0,start}','"09:30"');
 out:=public.journeyhub_care_update(u,cid,1,NULL,jsonb_build_object('id',propid,'canApply',true,'revision',1,'expiresAt',now()+interval'30 minutes','plan',candidate));
 -- Simulate an older in-flight provider check completing after the manual event.
 out:=public.journeyhub_care_update(u,cid,1,'[]'::jsonb,jsonb_build_object('id',gen_random_uuid(),'canApply',true,'revision',1,'expiresAt',now()+interval'30 minutes','plan',plan));
 PERFORM pg_temp.care_assert(out#>>'{proposal,id}'=propid::text,'late provider check preserves newer manual proposal');
 out:=public.journeyhub_care_update(u,cid,1,'[]'::jsonb,NULL);
 PERFORM pg_temp.care_assert(out#>>'{proposal,id}'=propid::text,'late provider all-clear cannot erase manual proposal');
 out:=public.journeyhub_care_accept(u,cid,propid);PERFORM pg_temp.care_assert(out->>'revision'='2'AND out#>>'{plan,stops,0,start}'='09:30','proposal applied');
 PERFORM pg_temp.care_assert((SELECT h.plan#>>'{stops,0,start}'FROM journey_hub.trip_history h WHERE h.id=hid)='09:00','original history immutable');
 skipped:=false;BEGIN PERFORM public.journeyhub_care_accept(u,cid,propid);EXCEPTION WHEN OTHERS THEN skipped:=true;END;PERFORM pg_temp.care_assert(skipped,'replayed proposal rejected');
 skipped:=false;BEGIN PERFORM public.journeyhub_care_update(u,cid,1,NULL,NULL);EXCEPTION WHEN OTHERS THEN skipped:=true;END;PERFORM pg_temp.care_assert(skipped,'stale revision rejected');
 out:=public.journeyhub_care_update(u,cid,2,NULL,jsonb_build_object('id',gen_random_uuid(),'canApply',true,'revision',2,'expiresAt',now()-interval'1 minute','plan',candidate));
 out:=public.journeyhub_care_update(u,cid,2,'[]'::jsonb,jsonb_build_object('id',propid,'canApply',true,'revision',2,'expiresAt',now()+interval'30 minutes','plan',candidate));
 PERFORM pg_temp.care_assert(out#>>'{proposal,id}'=propid::text,'fresh provider proposal may replace expired proposal');
 -- Force a local-time upcoming stop without touching any real itinerary.
 tm:=date_trunc('minute',nowlocal)+interval'20 minutes';
 UPDATE journey_hub.trip_care c SET input=jsonb_set(c.input,'{date}',to_jsonb(tm::date::text)),plan=jsonb_set(jsonb_set(c.plan,'{stops,0,start}',to_jsonb(to_char(tm,'HH24:MI'))),'{stops,0,end}',to_jsonb(to_char(tm+interval'20 minutes','HH24:MI'))) WHERE c.id=cid;
 PERFORM journey_hub.care_tick();PERFORM journey_hub.care_tick();
 PERFORM pg_temp.care_assert((SELECT count(*)FROM journey_hub.trip_care_events WHERE care_id=cid AND kind='departure')=1,'timezone reminder and dedup');
 -- Same-transaction catalog auto-enrollment; no booking job is created by this fixture.
 inp:=jsonb_set(inp,'{date}',to_jsonb((current_date+3)::text));
 INSERT INTO journey_hub.agent_runs(id,user_id,request_id,input,plan,status)VALUES(rid,u,gen_random_uuid(),inp,jsonb_build_object('stops','[]'::jsonb),'awaiting_confirmation');
 UPDATE journey_hub.agent_runs SET confirmed_at=now(),status='queued'WHERE id=rid;
 PERFORM pg_temp.care_assert((SELECT count(*)FROM journey_hub.trip_care WHERE source_type='run'AND source_id=rid)=1,'catalog automatic enrollment');
 PERFORM public.journeyhub_care_stop(u,cid);PERFORM pg_temp.care_assert((public.journeyhub_care_get(u,cid)->>'status')='paused','pause persists');
 RAISE NOTICE 'PASS: care ownership, idempotency, proposal CAS, timezone reminders, durable catalog startup';
END$$;
ROLLBACK;
