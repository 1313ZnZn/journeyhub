-- Rollback-only fixtures. No supplier calls, messages or real payment.
BEGIN;
CREATE FUNCTION pg_temp.ta_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END$$;
DO $$
DECLARE u uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();root uuid:=gen_random_uuid();hid uuid:=gen_random_uuid();cid uuid;pid uuid:=gen_random_uuid();qid uuid;
 inp jsonb;plan jsonb;candidate jsonb;result jsonb;q jsonb;dt date:=current_date+80;failed boolean;source_time timestamptz;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)VALUES(u,'readiness-'||u||'@example.invalid',now(),'{}'),(outsider,'readiness-'||outsider||'@example.invalid',now(),'{}');
 inp:=jsonb_build_object('city','Shanghai','date',dt,'guests',1,'prompt','Museum and lunch','days',1,'dayStart','09:00','dayEnd','20:00','transport','walk');
 plan:='{"summary":"Two saved visits","stops":[{"id":"amap_Breadymuseum","dayIndex":1,"start":"09:00","end":"10:00","reason":"Museum"},{"id":"amap_Breadylunch","dayIndex":1,"start":"12:00","end":"13:00","reason":"Lunch"}]}';
 INSERT INTO journey_hub.trip_history(id,user_id,input,place_ids)VALUES(root,u,inp,ARRAY['amap_Breadymuseum','amap_Breadylunch']);
 INSERT INTO journey_hub.trip_history(id,user_id,parent_id,input,place_ids,plan)VALUES(hid,u,root,inp,ARRAY['amap_Breadymuseum','amap_Breadylunch'],plan) RETURNING updated_at INTO source_time;
 PERFORM public.journeyhub_trip_snapshot_put(u,hid,source_time,'{"schemaVersion":1,"places":[{"id":"amap_Breadymuseum","name":"Fixture Museum","kind":"museum"},{"id":"amap_Breadylunch","name":"Fixture Lunch","kind":"restaurant"}]}');
 UPDATE journey_hub.visit_research SET facts='{"hours":{"text":"09:00–17:00","url":"https://www.shanghai.gov.cn/fixture","basis":"regular"}}',state='partial',checked_at=now(),due_at=NULL WHERE owner_id=u AND trip_id=hid;
 result:=public.journeyhub_care_confirm(u,'history',hid);cid:=(result->>'id')::uuid;
 PERFORM pg_temp.ta_assert(result->'places'->0->>'name' IS NOT NULL,'saved labels hydrated without provider');
 PERFORM pg_temp.ta_assert(jsonb_array_length(result->'visitFacts')=1,'date-specific official facts hydrated');
 PERFORM pg_temp.ta_assert(public.journeyhub_care_get(outsider,cid)IS NULL,'outsider cannot read evidence');
 PERFORM pg_temp.ta_assert(NOT has_function_privilege('authenticated','public.journeyhub_care_accept(uuid,uuid,uuid)','EXECUTE'),'browser cannot spoof user id');
 PERFORM public.journeyhub_care_stop(u,cid);
 result:=public.journeyhub_care_confirm(u,'history',hid);
 PERFORM pg_temp.ta_assert(result->>'status'='active' AND result->>'checkedAt' IS NULL,'resume preserves plan and queues checks');
 candidate:=jsonb_set(jsonb_set(plan,'{stops,0,start}','"09:30"'),'{stops,0,end}','"10:30"');
 PERFORM public.journeyhub_care_update(u,cid,1,NULL,jsonb_build_object('id',pid,'revision',1,'canApply',true,'expiresAt',now()+interval '30 minutes','plan',candidate));
 -- A payment after proposal preparation must be seen at acceptance.
 PERFORM public.journeyhub_demo_wallet_topup(u,100000,gen_random_uuid());
 q:=public.journeyhub_demo_quote_save(u,'history',hid,'[{"stopId":"amap_Breadymuseum","kind":"ticket","unitMinor":4000,"displayTitle":"Fixture Museum"},{"stopId":"amap_Breadylunch","kind":"restaurant","unitMinor":5000,"displayTitle":"Fixture Lunch"}]');
 qid:=(q->>'id')::uuid;PERFORM public.journeyhub_demo_book(u,qid,gen_random_uuid());
 result:=public.journeyhub_care_get(u,cid);
 PERFORM pg_temp.ta_assert(jsonb_array_length(result->'canonicalBookings')=2,'canonical booking outcome visible');
 PERFORM pg_temp.ta_assert(result->'canonicalBookings'->0->>'paymentStatus'='simulated_paid','payment evidence is virtual and canonical');
 failed:=false;BEGIN PERFORM public.journeyhub_care_accept(u,cid,pid);EXCEPTION WHEN OTHERS THEN failed:=SQLERRM='CARE_RESERVATION_PROTECTED';END;
 PERFORM pg_temp.ta_assert(failed,'late confirmed reservation protects arrival time');
 PERFORM pg_temp.ta_assert((public.journeyhub_care_get(u,cid)#>>'{plan,stops,0,start}')='09:00','rejected adjustment has no side effect');
 PERFORM public.journeyhub_care_update(u,cid,1,'[]',NULL);
 PERFORM pg_temp.ta_assert(EXISTS(SELECT FROM journey_hub.trip_care_events WHERE care_id=cid AND kind='readiness_checked'),'check audit persisted');
 -- No user-facing replan may silently discard an existing visit.
 pid:=gen_random_uuid();candidate:=jsonb_set(plan,'{stops}',jsonb_build_array(plan->'stops'->0));
 PERFORM public.journeyhub_care_update(u,cid,1,NULL,jsonb_build_object('id',pid,'revision',1,'canApply',true,'expiresAt',now()+interval '30 minutes','plan',candidate));
 failed:=false;BEGIN PERFORM public.journeyhub_care_accept(u,cid,pid);EXCEPTION WHEN OTHERS THEN failed:=SQLERRM='CARE_UNSAFE_ADJUSTMENT';END;
 PERFORM pg_temp.ta_assert(failed,'acceptance validates complete itinerary server-side');
 RAISE NOTICE 'PASS traveler agent: saved evidence, owner isolation, resume, canonical outcomes, payment race protection and no silent lost visits';
END$$;
DO $$
DECLARE c journey_hub.trip_care;
BEGIN
 c.status:='active';c.input:=jsonb_build_object('city','Shanghai','date',current_date+1);
 c.checks:=jsonb_build_array(jsonb_build_object('id','__weather__','forecast',jsonb_build_object('days',jsonb_build_array(jsonb_build_object('date',current_date+1,'icon','rain')),'expiresAt',to_char(now()-interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
 PERFORM pg_temp.ta_assert(journey_hub.care_weather_due(c),'expired near-travel forecast requeues');
 c.input:=jsonb_set(c.input,'{date}',to_jsonb((current_date+5)::text));
 PERFORM pg_temp.ta_assert(NOT journey_hub.care_weather_due(c),'far-future forecast does not refresh repeatedly');
 c.input:=jsonb_set(c.input,'{date}',to_jsonb((current_date+1)::text));
 c.checks:=jsonb_set(c.checks,'{0,forecast,days}','[]'::jsonb);
 PERFORM pg_temp.ta_assert(NOT journey_hub.care_weather_due(c),'unavailable forecast does not cause tight retries');
END$$;
ROLLBACK;
