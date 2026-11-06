-- Run after 20261104115722_journeyhub_trip_display_snapshots.sql.
-- Isolated fixtures only. Every write is rolled back; no provider or payment calls.
BEGIN;
CREATE FUNCTION pg_temp.snapshot_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label; END IF; END $$;
DO $$
#variable_conflict use_variable
DECLARE owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); root_id uuid:=gen_random_uuid();
 history_id uuid:=gen_random_uuid(); input_doc jsonb; plan_doc jsonb; payload_doc jsonb; changed_doc jsonb;
 result jsonb; first_result jsonb; source_time timestamptz; removed_time timestamptz; restored_time timestamptz;
 source_plan jsonb; failed boolean:=false;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
  (owner_id,'snapshot-test-'||owner_id||'@example.invalid',now(),'{}'),
  (other_id,'snapshot-test-'||other_id||'@example.invalid',now(),'{}');
 input_doc:=jsonb_build_object('city','Shanghai','date',current_date+30,'guests',1,'prompt','Snapshot fixture',
  'days',1,'dayStart','09:00','dayEnd','18:00','transport','walk');
 plan_doc:='{"summary":"Snapshot fixture","stops":[{"id":"snapshot_fixture","dayIndex":1,"start":"09:00","end":"10:00","reason":"A selected museum"}]}';
 payload_doc:='{"schemaVersion":1,"places":[{"id":"snapshot_fixture","name":"Selected museum","kind":"museum","category":"culture","reason":"A selected museum"}]}';
 INSERT INTO journey_hub.trip_history(id,user_id,input,place_ids) VALUES(root_id,owner_id,input_doc,ARRAY['snapshot_fixture']);
 INSERT INTO journey_hub.trip_history(id,user_id,parent_id,input,place_ids,plan)
  VALUES(history_id,owner_id,root_id,input_doc,ARRAY['snapshot_fixture'],plan_doc) RETURNING updated_at INTO source_time;

 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_get(owner_id,history_id) IS NULL,'new history has no snapshot');
 first_result:=public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,payload_doc);
 PERFORM pg_temp.snapshot_assert(first_result->>'ok'='true','current owner can persist snapshot');
 result:=public.journeyhub_trip_snapshot_get(owner_id,history_id);
 PERFORM pg_temp.snapshot_assert(result->'payload'=payload_doc AND (result->>'sourceUpdatedAt')::timestamptz=source_time,'snapshot round trip retains payload and exact source revision');
 PERFORM pg_temp.snapshot_assert((SELECT updated_at=source_time AND plan=plan_doc FROM journey_hub.trip_history WHERE id=history_id),'snapshot save does not mutate authoritative itinerary');
 PERFORM pg_temp.snapshot_assert(first_result=public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,payload_doc),'identical retry preserves savedAt');

 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_get(other_id,history_id) IS NULL,'cross-account read hidden');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(other_id,history_id,source_time,payload_doc)->>'reason'='not_found','cross-account write rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time-interval '1 microsecond',payload_doc)->>'reason'='revision_changed','old revision rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,NULL,payload_doc)->>'reason'='revision_changed','missing revision rejected');
 BEGIN
  UPDATE journey_hub.trip_display_snapshots SET user_id=other_id WHERE trip_display_snapshots.history_id=history_id;
 EXCEPTION WHEN foreign_key_violation THEN failed:=true;
 END;
 PERFORM pg_temp.snapshot_assert(failed,'composite FK prevents owner reassignment');

 -- Strict durable whitelist: no provider content, payment status, credentials, nested extras or arbitrary IDs.
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,jsonb_set(payload_doc,'{places,0,id}','"unrelated_place"'))->>'reason'='invalid_payload','foreign place ID rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,jsonb_set(payload_doc,'{places}',jsonb_build_array(payload_doc#>'{places,0}',payload_doc#>'{places,0}')))->>'reason'='invalid_payload','duplicate IDs rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,payload_doc||'{"token":"secret"}')->>'reason'='invalid_payload','unknown root fields rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,jsonb_set(payload_doc,'{places,0,photo}','{"url":"https://example.invalid/photo.jpg"}'))->>'reason'='invalid_payload','provider photo rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,jsonb_set(payload_doc,'{places,0,address}','"Street address"'))->>'reason'='invalid_payload','provider address rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,jsonb_set(payload_doc,'{places,0,name}',to_jsonb(repeat('x',161))))->>'reason'='invalid_payload','overlong label rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,jsonb_set(payload_doc,'{schemaVersion}','2'))->>'reason'='invalid_payload','unknown schema version rejected');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_get(owner_id,history_id)->'payload'=payload_doc,'invalid writes leave prior snapshot intact');

 -- Swiping keeps the existing labels while fencing stale writes for old choices.
 UPDATE journey_hub.trip_history SET wanted=ARRAY['snapshot_fixture'] WHERE id=history_id;
 result:=public.journeyhub_trip_snapshot_get(owner_id,history_id);
 PERFORM pg_temp.snapshot_assert(result->'payload'=payload_doc AND (result->>'sourceUpdatedAt')::timestamptz>source_time,'choices-only edit carries labels to new revision');
 PERFORM pg_temp.snapshot_assert(result->>'savedAt'=first_result->>'savedAt','selection change retains original label freshness');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,payload_doc)->>'reason'='revision_changed','pre-swipe write rejected by new CAS');
 SELECT updated_at INTO source_time FROM journey_hub.trip_history WHERE id=history_id;

 -- A schedule change with a forgotten timestamp still invalidates the old display.
 UPDATE journey_hub.trip_history SET plan=jsonb_set(plan,'{summary}','"Revised fixture"') WHERE id=history_id;
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_get(owner_id,history_id) IS NULL,'source edit invalidates display');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,payload_doc)->>'reason'='revision_changed','in-flight pre-edit write rejected');
 SELECT updated_at,plan INTO source_time,source_plan FROM journey_hub.trip_history WHERE id=history_id;
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,payload_doc)->>'ok'='true','new revision can save');

 INSERT INTO journey_hub.calendar_removed_items(user_id,kind,item_id) VALUES(owner_id,'history',history_id::text);
 SELECT updated_at INTO removed_time FROM journey_hub.trip_history WHERE id=history_id;
 PERFORM pg_temp.snapshot_assert(removed_time>source_time,'remove increments source revision');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_get(owner_id,history_id) IS NULL,'removed itinerary has no visible snapshot');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,removed_time,payload_doc)->>'reason'='removed','removed itinerary rejects current revision write');
 PERFORM pg_temp.snapshot_assert(NOT EXISTS(SELECT 1 FROM journey_hub.trip_display_snapshots s WHERE s.history_id=history_id),'remove purges display snapshot only');
 DELETE FROM journey_hub.calendar_removed_items WHERE user_id=owner_id AND kind='history' AND item_id=history_id::text;
 SELECT updated_at INTO restored_time FROM journey_hub.trip_history WHERE id=history_id;
 PERFORM pg_temp.snapshot_assert(restored_time>removed_time,'restore increments source revision');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_get(owner_id,history_id) IS NULL,'restore does not revive old snapshot');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,source_time,payload_doc)->>'reason'='revision_changed','pre-removal request cannot write after restore');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,removed_time,payload_doc)->>'reason'='revision_changed','removed-version request cannot write after restore');
 PERFORM pg_temp.snapshot_assert((SELECT plan=source_plan FROM journey_hub.trip_history WHERE id=history_id),'removal and restore preserve authoritative plan');
 PERFORM pg_temp.snapshot_assert(public.journeyhub_trip_snapshot_put(owner_id,history_id,restored_time,payload_doc)->>'ok'='true','restored current revision can save');

 -- Save fixture handles for a real invoker-role smoke check below.
 PERFORM set_config('test.snapshot_owner',owner_id::text,true);
 PERFORM set_config('test.snapshot_history',history_id::text,true);
 PERFORM set_config('test.snapshot_revision',restored_time::text,true);
 PERFORM set_config('test.snapshot_payload',payload_doc::text,true);
 PERFORM pg_temp.snapshot_assert(NOT has_table_privilege('authenticated','journey_hub.trip_display_snapshots','SELECT'),'browser has no direct snapshot read');
 PERFORM pg_temp.snapshot_assert(NOT has_table_privilege('authenticated','journey_hub.trip_display_snapshots','INSERT,UPDATE,DELETE'),'browser has no direct snapshot writes');
 PERFORM pg_temp.snapshot_assert(NOT has_table_privilege('anon','journey_hub.trip_display_snapshots','SELECT,INSERT,UPDATE,DELETE'),'anonymous has no direct snapshot access');
 PERFORM pg_temp.snapshot_assert(NOT has_function_privilege('authenticated','public.journeyhub_trip_snapshot_get(uuid,uuid)','EXECUTE'),'browser cannot supply owner to getter');
 PERFORM pg_temp.snapshot_assert(NOT has_function_privilege('authenticated','public.journeyhub_trip_snapshot_put(uuid,uuid,timestamptz,jsonb)','EXECUTE'),'browser cannot supply owner to setter');
 PERFORM pg_temp.snapshot_assert(NOT has_function_privilege('anon','public.journeyhub_trip_snapshot_get(uuid,uuid)','EXECUTE'),'anonymous cannot call getter');
 PERFORM pg_temp.snapshot_assert(NOT has_function_privilege('anon','public.journeyhub_trip_snapshot_put(uuid,uuid,timestamptz,jsonb)','EXECUTE'),'anonymous cannot call setter');
 PERFORM pg_temp.snapshot_assert((SELECT relrowsecurity FROM pg_class WHERE oid='journey_hub.trip_display_snapshots'::regclass),'snapshot table has RLS enabled');
 PERFORM pg_temp.snapshot_assert((SELECT NOT prosecdef FROM pg_proc WHERE oid='public.journeyhub_trip_snapshot_get(uuid,uuid)'::regprocedure),'getter remains invoker');
 PERFORM pg_temp.snapshot_assert((SELECT NOT prosecdef FROM pg_proc WHERE oid='public.journeyhub_trip_snapshot_put(uuid,uuid,timestamptz,jsonb)'::regprocedure),'setter remains invoker');
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE result jsonb;
BEGIN
 result:=public.journeyhub_trip_snapshot_put(current_setting('test.snapshot_owner')::uuid,
  current_setting('test.snapshot_history')::uuid,current_setting('test.snapshot_revision')::timestamptz,
  current_setting('test.snapshot_payload')::jsonb);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Service-role snapshot put failed'; END IF;
 result:=public.journeyhub_trip_snapshot_get(current_setting('test.snapshot_owner')::uuid,current_setting('test.snapshot_history')::uuid);
 IF result->'payload' IS DISTINCT FROM current_setting('test.snapshot_payload')::jsonb THEN RAISE EXCEPTION 'Service-role snapshot get failed'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE target uuid:=current_setting('test.snapshot_history')::uuid;
BEGIN
 DELETE FROM journey_hub.trip_history WHERE id=target;
 PERFORM pg_temp.snapshot_assert(NOT EXISTS(SELECT 1 FROM journey_hub.trip_display_snapshots WHERE history_id=target),'physical history deletion cascades snapshot');
END $$;
SELECT 'trip display snapshot regression checks passed; all fixtures rolled back' AS result;
ROLLBACK;
