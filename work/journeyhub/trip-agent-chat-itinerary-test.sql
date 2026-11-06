-- Rollback fixtures only; tests applied snapshots independently of provider data.
BEGIN;
CREATE FUNCTION pg_temp.chat_itinerary_assert(ok boolean,label text)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END$$;
DO $$
DECLARE u uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();root_id uuid:=gen_random_uuid();hid uuid:=gen_random_uuid();cid uuid;
 req uuid:=gen_random_uuid();req2 uuid:=gen_random_uuid();pid uuid:=gen_random_uuid();pid2 uuid:=gen_random_uuid();legacy uuid:=gen_random_uuid();older uuid:=gen_random_uuid();unknown_day uuid:=gen_random_uuid();
 inp jsonb;trip_plan jsonb;first_plan jsonb;second_plan jsonb;outcome jsonb;first_snapshot jsonb;second_snapshot jsonb;dt date:=current_date+80;stamp timestamptz;denied boolean;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)VALUES(u,'chat-itinerary-'||u||'@example.invalid',now(),'{}'),(other_user,'chat-itinerary-'||other_user||'@example.invalid',now(),'{}');
 inp:=jsonb_build_object('city','Shanghai','date',dt,'guests',1,'prompt','Museum and local food','days',2,'dayStart','09:00','dayEnd','20:00','transport','walk');
 trip_plan:='{"summary":"Two complete days","stops":[{"id":"amap_chatmuseum","dayIndex":1,"start":"09:00","end":"10:00","reason":"Museum visit"},{"id":"amap_chatlunch","dayIndex":1,"start":"12:00","end":"13:00","reason":"Local lunch"},{"id":"amap_chatgallery","dayIndex":2,"start":"09:00","end":"10:00","reason":"Gallery visit"}]}';
 INSERT INTO journey_hub.trip_history(id,user_id,input,place_ids)VALUES(root_id,u,inp,ARRAY['amap_chatmuseum','amap_chatlunch','amap_chatgallery']) RETURNING updated_at INTO stamp;
 PERFORM public.journeyhub_trip_snapshot_put(u,root_id,stamp,'{"schemaVersion":1,"places":[{"id":"amap_chatmuseum","name":"Shanghai Museum","kind":"museum","category":"Culture"},{"id":"amap_chatlunch","name":"Shanghai Local Lunch","kind":"restaurant","category":"Local food"},{"id":"amap_chatgallery","name":"Art Gallery","kind":"museum"}]}');
 INSERT INTO journey_hub.trip_history(id,user_id,parent_id,input,place_ids,plan)VALUES(hid,u,root_id,inp,ARRAY['amap_chatmuseum','amap_chatlunch','amap_chatgallery'],trip_plan);
 outcome:=public.journeyhub_care_confirm(u,'history',hid);cid:=(outcome->>'id')::uuid;
 first_plan:=jsonb_set(jsonb_set(trip_plan,'{stops,0,start}','"09:30"'),'{stops,0,end}','"10:30"');
 PERFORM public.journeyhub_care_update(u,cid,1,NULL,jsonb_build_object('id',pid,'revision',1,'dayIndex',1,'canApply',true,'expiresAt',now()+interval '30 minutes','plan',first_plan));
 outcome:=public.journeyhub_care_chat_apply(u,cid,pid,req);
 SELECT m->'itinerary' INTO first_snapshot FROM jsonb_array_elements(outcome#>'{conversation,messages}')m WHERE m->>'id'=req||':applied';
 PERFORM pg_temp.chat_itinerary_assert(first_snapshot->>'revision'='2' AND first_snapshot->>'dayIndex'='1' AND first_snapshot->>'date'=dt::text AND first_snapshot->>'city'='Shanghai','snapshot stores actual accepted revision and day');
 PERFORM pg_temp.chat_itinerary_assert(jsonb_array_length(first_snapshot->'stops')=2 AND first_snapshot#>>'{stops,0,start}'='09:30' AND first_snapshot#>>'{stops,1,start}'='12:00','full affected day includes unchanged lunch');
 PERFORM pg_temp.chat_itinerary_assert(first_snapshot#>>'{stops,0,name}'='Shanghai Museum' AND first_snapshot#>>'{stops,0,category}'='Culture','owned English labels retained');
 PERFORM pg_temp.chat_itinerary_assert(NOT EXISTS(SELECT FROM jsonb_array_elements(first_snapshot->'stops')s CROSS JOIN LATERAL jsonb_object_keys(s)k WHERE k NOT IN('id','name','kind','category','dayIndex','start','end','reason')),'snapshot excludes supplier photos coordinates and prices');
 -- A later apply changes current care, never the previous message snapshot.
 second_plan:=jsonb_set(jsonb_set(first_plan,'{stops,0,start}','"10:00"'),'{stops,0,end}','"11:00"');
 second_plan:=jsonb_set(second_plan,'{stops,0,reason}','"参观博物馆"');
 PERFORM public.journeyhub_care_update(u,cid,2,NULL,jsonb_build_object('id',pid2,'revision',2,'dayIndex',1,'canApply',true,'expiresAt',now()+interval '30 minutes','plan',second_plan));
 outcome:=public.journeyhub_care_chat_apply(u,cid,pid2,req2);
 SELECT m->'itinerary' INTO second_snapshot FROM jsonb_array_elements(outcome#>'{conversation,messages}')m WHERE m->>'id'=req2||':applied';
 PERFORM pg_temp.chat_itinerary_assert(second_snapshot->>'revision'='3' AND second_snapshot#>>'{stops,0,start}'='10:00','second apply has its own snapshot');
 PERFORM pg_temp.chat_itinerary_assert(second_snapshot#>>'{stops,0,reason}' IS NULL AND second_snapshot#>>'{stops,0,name}'='Shanghai Museum','non-English optional reason omitted without losing itinerary');
 PERFORM pg_temp.chat_itinerary_assert(journey_hub.care_chat_snapshot_label('上海',160) IS NULL AND journey_hub.care_chat_snapshot_label('กรุงเทพ',160) IS NULL AND journey_hub.care_chat_snapshot_label('<unsafe>',80) IS NULL AND length(journey_hub.care_chat_snapshot_label(repeat('English ',30),80))=80,'label projection matches serializer language safety and length bounds');
 PERFORM pg_temp.chat_itinerary_assert((SELECT itinerary=first_snapshot FROM journey_hub.care_chat_applies WHERE user_id=u AND request_id=req),'later changes preserve earlier version');
 PERFORM public.journeyhub_care_chat_apply(u,cid,pid,req);
 PERFORM public.journeyhub_care_chat_apply(u,cid,pid,gen_random_uuid());
 PERFORM pg_temp.chat_itinerary_assert((SELECT count(*)=2 FROM journey_hub.care_chat_applies WHERE care_id=cid),'apply replays neither duplicate nor rewrite snapshots');
 DELETE FROM journey_hub.care_chat_place_cache WHERE care_id=cid;
 DELETE FROM journey_hub.care_chat_labels WHERE care_id=cid;
 DELETE FROM journey_hub.trip_display_snapshots WHERE history_id=root_id;
 outcome:=public.journeyhub_care_chat_read(u,cid);
 PERFORM pg_temp.chat_itinerary_assert(EXISTS(SELECT FROM jsonb_array_elements(outcome#>'{conversation,messages}')m WHERE m->>'id'=req||':applied' AND m->'itinerary'=first_snapshot),'refresh survives all provider and label cache removal');
 denied:=false;BEGIN UPDATE journey_hub.care_chat_applies SET itinerary=second_snapshot WHERE user_id=u AND request_id=req;EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='CARE_CHAT_SNAPSHOT_IMMUTABLE';END;
 PERFORM pg_temp.chat_itinerary_assert(denied,'stored applied itinerary cannot be rewritten');
 PERFORM pg_temp.chat_itinerary_assert(public.journeyhub_care_chat_read(other_user,cid)IS NULL,'foreign account cannot read itinerary history');
 denied:=false;BEGIN PERFORM public.journeyhub_care_chat_apply(other_user,cid,pid,gen_random_uuid());EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='CARE_CHAT_NOT_FOUND';END;
 PERFORM pg_temp.chat_itinerary_assert(denied,'foreign account cannot apply');
 -- Model the migration's conservative legacy backfill on isolated fixture rows.
 INSERT INTO journey_hub.care_chat_applies(user_id,care_id,request_id,proposal_id,revision,day_index)VALUES
 (u,cid,legacy,gen_random_uuid(),3,2),(u,cid,older,gen_random_uuid(),2,1),(u,cid,unknown_day,gen_random_uuid(),3,NULL);
 UPDATE journey_hub.care_chat_applies a SET itinerary=journey_hub.care_chat_applied_itinerary(c,a.day_index)
 FROM journey_hub.trip_care c WHERE a.itinerary IS NULL AND a.care_id=c.id AND a.user_id=c.user_id AND a.revision=c.revision;
 PERFORM pg_temp.chat_itinerary_assert((SELECT itinerary->>'date'=(dt+1)::text AND itinerary->>'dayIndex'='2' AND jsonb_array_length(itinerary->'stops')=1 FROM journey_hub.care_chat_applies WHERE user_id=u AND request_id=legacy),'current legacy revision safely backfills actual selected date');
 PERFORM pg_temp.chat_itinerary_assert((SELECT itinerary IS NULL FROM journey_hub.care_chat_applies WHERE user_id=u AND request_id=older),'older revision never reconstructed from newest plan');
 PERFORM pg_temp.chat_itinerary_assert((SELECT itinerary IS NULL FROM journey_hub.care_chat_applies WHERE user_id=u AND request_id=unknown_day),'unknown legacy day is not fabricated');
 denied:=false;BEGIN PERFORM public.journeyhub_care_chat_apply(u,cid,gen_random_uuid(),gen_random_uuid());EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='CARE_PROPOSAL_STALE';END;
 PERFORM pg_temp.chat_itinerary_assert(denied AND (SELECT count(*)=5 FROM journey_hub.care_chat_applies WHERE care_id=cid),'failed apply creates no completion snapshot');
 PERFORM pg_temp.chat_itinerary_assert(NOT has_table_privilege('authenticated','journey_hub.care_chat_applies','SELECT') AND NOT has_function_privilege('authenticated','journey_hub.care_chat_applied_itinerary(journey_hub.trip_care,integer)','EXECUTE'),'private snapshot table and helper remain inaccessible to browser');
 RAISE NOTICE 'PASS applied itineraries: full day, atomic accepted revision, immutable refresh history, idempotence, safe backfill and owner isolation';
END$$;
ROLLBACK;
