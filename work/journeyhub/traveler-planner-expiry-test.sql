-- Run after the expiry migration inside BEGIN/ROLLBACK; fixture only.
INSERT INTO auth.users(id,email,email_confirmed_at)VALUES('f8000000-0000-4000-8000-000000000001','planner-expiry@example.invalid',now());
DO $$
DECLARE owner uuid:='f8000000-0000-4000-8000-000000000001';finished uuid:=gen_random_uuid();active uuid:=gen_random_uuid();
BEGIN
 INSERT INTO journey_hub.planner_tasks(id,user_id,request_id,kind,payload,input,status,result,expires_at)
 VALUES(finished,owner,gen_random_uuid(),'discover','{}','{}','completed','{"places":[]}',now()+interval '1 hour');
 IF public.journeyhub_planner_status(owner,finished)IS NULL THEN RAISE EXCEPTION 'Fresh task missing';END IF;
 UPDATE journey_hub.planner_tasks SET expires_at=now()-interval '1 second'WHERE id=finished;
 IF public.journeyhub_planner_status(owner,finished)IS NOT NULL THEN RAISE EXCEPTION 'Expired explicit task leaked before cleanup';END IF;
 IF public.journeyhub_planner_status(owner,NULL)IS NOT NULL THEN RAISE EXCEPTION 'Expired latest task leaked before cleanup';END IF;
 PERFORM journey_hub.planner_task_cleanup();
 IF public.journeyhub_planner_status(owner,finished)IS NOT NULL THEN RAISE EXCEPTION 'Expired empty result restored after cleanup';END IF;
 INSERT INTO journey_hub.planner_tasks(id,user_id,request_id,kind,payload,input,status,expires_at)
 VALUES(active,owner,gen_random_uuid(),'discover','{}','{}','running',now()+interval '1 hour');
 IF public.journeyhub_planner_status(owner,NULL)->>'id'<>active::text THEN RAISE EXCEPTION 'Fresh current task cannot replace expired bookmark';END IF;
 IF public.journeyhub_planner_status('f8000000-0000-4000-8000-000000000002',active)IS NOT NULL THEN RAISE EXCEPTION 'Owner isolation changed';END IF;
 IF has_function_privilege('authenticated','public.journeyhub_planner_status(uuid,uuid)','EXECUTE')OR has_function_privilege('anon','public.journeyhub_planner_status(uuid,uuid)','EXECUTE')THEN RAISE EXCEPTION 'Expiry patch broadened access';END IF;
END $$;
SELECT 'PASS task expiry: fresh explicit result available; expired explicit and latest hidden before/after cleanup; fresh latest recovery and owner isolation retained' AS result;
