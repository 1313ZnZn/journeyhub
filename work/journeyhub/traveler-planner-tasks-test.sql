-- Execute after traveler-planner-tasks.sql in a rollback-only transaction.
-- All users and state below are isolated fixtures; no live bookings are touched.
INSERT INTO auth.users(id,email,email_confirmed_at)VALUES
 ('f5000000-0000-4000-8000-000000000001','planner-one@example.invalid',now()),
 ('f5000000-0000-4000-8000-000000000002','planner-two@example.invalid',now());
DO $$
DECLARE u uuid:='f5000000-0000-4000-8000-000000000001';v uuid:='f5000000-0000-4000-8000-000000000002';rid uuid:='f5000000-1000-4000-8000-000000000001';
 t jsonb;t2 jsonb;c jsonb;c2 jsonb;x jsonb;blocked boolean;state jsonb:='{"observations":["search retained"],"turn":1}';
BEGIN
 IF has_table_privilege('authenticated','journey_hub.planner_tasks','SELECT')OR has_table_privilege('anon','journey_hub.planner_tasks','SELECT')THEN RAISE EXCEPTION 'Task table exposed';END IF;
 IF has_function_privilege('authenticated','public.journeyhub_planner_claim(uuid,uuid)','EXECUTE')OR has_function_privilege('anon','public.journeyhub_planner_start(uuid,uuid,text,jsonb,jsonb)','EXECUTE')THEN RAISE EXCEPTION 'Task mutation exposed';END IF;
 IF NOT has_function_privilege('service_role','public.journeyhub_planner_start(uuid,uuid,text,jsonb,jsonb)','EXECUTE')THEN RAISE EXCEPTION 'Service role missing task permission';END IF;
 t:=public.journeyhub_planner_start(u,rid,'discover','{"prompt":"food and museum"}','{"city":"Shanghai","days":2}');
 t2:=public.journeyhub_planner_start(u,rid,'discover','{"prompt":"food and museum"}','{"city":"Shanghai","days":2}');
 IF t->>'id'<>t2->>'id'OR(select uses from journey_hub.discovery_quota where user_id=u)<>1 THEN RAISE EXCEPTION 'Start idempotence or quota failure';END IF;
 IF t?'payload'OR t?'state'OR t?'leaseToken'THEN RAISE EXCEPTION 'Private execution data exposed';END IF;
 IF public.journeyhub_planner_status(v,(t->>'id')::uuid)IS NOT NULL THEN RAISE EXCEPTION 'Cross-account task read';END IF;
 blocked:=false;BEGIN PERFORM public.journeyhub_planner_start(u,rid,'discover','{"prompt":"different"}','{"city":"Shanghai","days":2}');EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PLANNER_REQUEST_CONFLICT%'THEN blocked:=true;ELSE RAISE;END IF;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Reused request changed preferences';END IF;
 blocked:=false;BEGIN PERFORM public.journeyhub_planner_start(u,gen_random_uuid(),'discover','{}','{}');EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PLANNER_ALREADY_RUNNING%'THEN blocked:=true;ELSE RAISE;END IF;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Concurrent same-account task admitted';END IF;
 t2:=public.journeyhub_planner_start(v,rid,'discover','{}','{}');
 IF t2->>'id'=t->>'id'THEN RAISE EXCEPTION 'Request IDs must be account scoped';END IF;
 c:=public.journeyhub_planner_claim(u,(t->>'id')::uuid);
 IF c IS NULL OR public.journeyhub_planner_claim(u,(t->>'id')::uuid)IS NOT NULL THEN RAISE EXCEPTION 'Single active lease failed';END IF;
 IF public.journeyhub_planner_checkpoint(v,(t->>'id')::uuid,(c->>'leaseToken')::uuid,state,'running','search','Searching','[]')IS NOT NULL THEN RAISE EXCEPTION 'Cross-account checkpoint';END IF;
 x:=public.journeyhub_planner_checkpoint(u,(t->>'id')::uuid,(c->>'leaseToken')::uuid,state,'running','search','Found places','[{"kind":"tool","tool":"search_places","summary":"Found verified places."}]');
 IF x->>'stepCount'<>'1'OR jsonb_array_length(x->'events')<>1 THEN RAISE EXCEPTION 'Step checkpoint missing';END IF;
 UPDATE journey_hub.planner_tasks SET lease_until=now()-interval '1 second'WHERE id=(t->>'id')::uuid;
 c2:=public.journeyhub_planner_claim(u,(t->>'id')::uuid);
 IF c2->'state'<>state THEN RAISE EXCEPTION 'Claim did not restore progress';END IF;
 IF public.journeyhub_planner_checkpoint(u,(t->>'id')::uuid,(c->>'leaseToken')::uuid,'{}','completed','done','done','[]','{"places":[]}')IS NOT NULL THEN RAISE EXCEPTION 'Stale worker overwrote state';END IF;
 x:=public.journeyhub_planner_checkpoint(u,(t->>'id')::uuid,(c2->>'leaseToken')::uuid,state,'failed','paused','A service failed','[]',NULL,'{"code":"PLANNER_UNAVAILABLE","message":"Retry."}');
 x:=public.journeyhub_planner_retry(u,(t->>'id')::uuid);
 IF x->>'status'<>'running'OR x->>'retryCount'<>'1'OR(select uses from journey_hub.discovery_quota where user_id=u)<>1 THEN RAISE EXCEPTION 'Retry duplicated quota or failed';END IF;
 c:=public.journeyhub_planner_claim(u,(t->>'id')::uuid);
 IF c->'state'<>state THEN RAISE EXCEPTION 'Retry discarded prior tools';END IF;
 x:=public.journeyhub_planner_checkpoint(u,(t->>'id')::uuid,(c->>'leaseToken')::uuid,state,'completed','done','Saved','[]','{"historyId":"f5000000-2000-4000-8000-000000000001","places":[{"id":"amap_A","photo":{"url":"https://example.invalid/photo.jpg"}}]}');
 IF public.journeyhub_planner_claim(u,(t->>'id')::uuid)IS NOT NULL THEN RAISE EXCEPTION 'Completed task executed again';END IF;
 IF public.journeyhub_planner_search_result(u,'f5000000-2000-4000-8000-000000000001')->'places' IS NULL THEN RAISE EXCEPTION 'Completed search reuse missing';END IF;
 IF public.journeyhub_planner_search_result(v,'f5000000-2000-4000-8000-000000000001')IS NOT NULL THEN RAISE EXCEPTION 'Cross-owner search snapshot exposed';END IF;
 UPDATE journey_hub.planner_tasks SET expires_at=now()-interval '1 second'WHERE id=(t->>'id')::uuid;
 PERFORM journey_hub.planner_task_cleanup();
 IF EXISTS(SELECT FROM journey_hub.planner_tasks q WHERE q.id=(t->>'id')::uuid AND (q.state<>'{}'OR q.payload<>'{}'OR q.result IS NOT NULL))THEN RAISE EXCEPTION 'Expired provider material retained';END IF;
 IF public.journeyhub_planner_status(u,NULL)IS NOT NULL THEN RAISE EXCEPTION 'Expired result restored by latest';END IF;
 IF public.journeyhub_planner_status(u,(t->>'id')::uuid)IS NOT NULL THEN RAISE EXCEPTION 'Expired explicit result restored';END IF;
 IF public.journeyhub_planner_visit_facts(u,ARRAY['amap_A'],ARRAY[current_date])<>'[]'::jsonb THEN RAISE EXCEPTION 'Unowned official facts exposed';END IF;
END $$;
SELECT 'PASS durable planner tasks: account isolation, request idempotence, quota, concurrent claim, crash recovery, stale fencing, retry, saved photo reuse, retention' AS result;
