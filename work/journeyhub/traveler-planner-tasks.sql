-- Durable traveler-only planning tasks. No reservation, payment or staff writes.
BEGIN;
CREATE TABLE journey_hub.planner_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN('discover','discover_plan')),
 payload jsonb NOT NULL, input jsonb NOT NULL, state jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'running' CHECK(status IN('running','completed','needs_input','failed')),
 stage text NOT NULL DEFAULT 'queued', message text NOT NULL DEFAULT 'Your planning task is queued.',
 events jsonb NOT NULL DEFAULT '[]', result jsonb, error jsonb,
 step_count integer NOT NULL DEFAULT 0 CHECK(step_count BETWEEN 0 AND 60), retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 3),
 lease_token uuid, lease_until timestamptz, crash_count integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '2 hours',
 UNIQUE(user_id,request_id),
 CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=24000),
 CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=12000),
 CHECK(jsonb_typeof(state)='object' AND octet_length(state::text)<=1500000),
 CHECK(jsonb_typeof(events)='array' AND jsonb_array_length(events)<=80),
 CHECK(result IS NULL OR octet_length(result::text)<=500000)
);
CREATE INDEX planner_tasks_due ON journey_hub.planner_tasks(updated_at) WHERE status='running';
CREATE INDEX planner_tasks_owner ON journey_hub.planner_tasks(user_id,created_at DESC);
ALTER TABLE journey_hub.planner_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.planner_tasks FROM PUBLIC,anon,authenticated,service_role;
-- All access is through owner-filtered service endpoints; no client table grants.
CREATE POLICY planner_tasks_owner ON journey_hub.planner_tasks FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

CREATE FUNCTION journey_hub.planner_task_public(t journey_hub.planner_tasks) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',t.id,'kind',t.kind,'status',t.status,'stage',t.stage,'message',t.message,
  'events',t.events,'result',t.result,'error',t.error,'input',t.input,'createdAt',t.created_at,'updatedAt',t.updated_at,
  'stepCount',t.step_count,'retryCount',t.retry_count,'canRetry',t.status='failed' AND t.retry_count<3 AND t.step_count<60 AND t.expires_at>now())
$$;
REVOKE ALL ON FUNCTION journey_hub.planner_task_public(journey_hub.planner_tasks) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.journeyhub_planner_start(p_user_id uuid,p_request_id uuid,p_kind text,p_payload jsonb,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t journey_hub.planner_tasks;
BEGIN
 IF p_user_id IS NULL OR p_request_id IS NULL OR p_kind NOT IN('discover','discover_plan') OR p_kind IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'PLANNER_INVALID';END IF;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN RAISE EXCEPTION 'verified account required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('journeyhub-planner:'||p_user_id::text,0));
 SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF t.kind<>p_kind OR t.payload<>p_payload OR t.input<>p_input THEN RAISE EXCEPTION 'PLANNER_REQUEST_CONFLICT';END IF;
  RETURN journey_hub.planner_task_public(t);
 END IF;
 -- Old stalled work cannot silently keep an account locked forever.
 UPDATE journey_hub.planner_tasks SET status='failed',stage='paused',message='This planning task expired. Start a new request.',error='{"code":"PLANNER_EXPIRED","message":"This planning task expired. Start a new request."}',lease_token=NULL,lease_until=NULL,updated_at=now()
 WHERE user_id=p_user_id AND status='running' AND expires_at<=now();
 IF EXISTS(SELECT FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND status='running')THEN RAISE EXCEPTION 'PLANNER_ALREADY_RUNNING';END IF;
 PERFORM public.journeyhub_discovery_quota(p_user_id);
 INSERT INTO journey_hub.planner_tasks(user_id,request_id,kind,payload,input)VALUES(p_user_id,p_request_id,p_kind,p_payload,p_input)RETURNING * INTO t;
 RETURN journey_hub.planner_task_public(t);
END $$;

CREATE FUNCTION public.journeyhub_planner_status(p_user_id uuid,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t journey_hub.planner_tasks;
BEGIN
 IF p_user_id IS NULL THEN RETURN NULL;END IF;
 IF p_id IS NULL THEN
  SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND expires_at>now() ORDER BY (status='running')DESC,created_at DESC LIMIT 1;
 ELSE SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND id=p_id AND expires_at>now();END IF;
 IF t.id IS NULL THEN RETURN NULL;END IF;
 RETURN journey_hub.planner_task_public(t);
END $$;

CREATE FUNCTION public.journeyhub_planner_retry(p_user_id uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t journey_hub.planner_tasks;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('journeyhub-planner:'||p_user_id::text,0));
 SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND id=p_id FOR UPDATE;
 IF t.id IS NULL THEN RETURN NULL;END IF;
 IF t.status='running' OR t.status='completed' THEN RETURN journey_hub.planner_task_public(t);END IF;
 IF t.status='needs_input' OR t.expires_at<=now() OR t.retry_count>=3 OR t.step_count>=60 THEN RAISE EXCEPTION 'PLANNER_RETRY_LIMIT';END IF;
 IF EXISTS(SELECT FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND status='running'AND id<>p_id)THEN RAISE EXCEPTION 'PLANNER_ALREADY_RUNNING';END IF;
 UPDATE journey_hub.planner_tasks SET status='running',stage='resuming',message='Resuming from saved progress.',error=NULL,
  retry_count=retry_count+1,lease_token=NULL,lease_until=NULL,crash_count=0,updated_at=now() WHERE id=p_id RETURNING * INTO t;
 RETURN journey_hub.planner_task_public(t);
END $$;

CREATE FUNCTION public.journeyhub_planner_claim(p_user_id uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t journey_hub.planner_tasks;token uuid;
BEGIN
 SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND id=p_id FOR UPDATE;
 IF t.id IS NULL OR t.status<>'running' OR t.lease_until>now() THEN RETURN NULL;END IF;
 IF t.expires_at<=now() OR t.step_count>=60 OR (t.crash_count>=3 AND t.lease_token IS NOT NULL) THEN
  UPDATE journey_hub.planner_tasks SET status='failed',stage='paused',message='The planning task stopped at its execution limit. Review the saved progress.',error='{"code":"PLANNER_LIMIT","message":"The planning task stopped at its execution limit. Review the saved progress."}',lease_token=NULL,lease_until=NULL,updated_at=now()WHERE id=t.id;
  RETURN NULL;
 END IF;
 token:=gen_random_uuid();
 UPDATE journey_hub.planner_tasks SET lease_token=token,lease_until=now()+interval '3 minutes',crash_count=CASE WHEN lease_token IS NULL THEN crash_count ELSE crash_count+1 END WHERE id=t.id RETURNING * INTO t;
 RETURN jsonb_build_object('id',t.id,'userId',t.user_id,'kind',t.kind,'payload',t.payload,'input',t.input,'state',t.state,'stepCount',t.step_count,'leaseToken',token);
END $$;

CREATE FUNCTION public.journeyhub_planner_checkpoint(p_user_id uuid,p_id uuid,p_lease uuid,p_state jsonb,p_status text,p_stage text,p_message text,p_events jsonb DEFAULT '[]',p_result jsonb DEFAULT NULL,p_error jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t journey_hub.planner_tasks;task_events jsonb;
BEGIN
 SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND id=p_id FOR UPDATE;
 IF t.id IS NULL OR t.status<>'running' OR t.lease_token IS DISTINCT FROM p_lease OR t.lease_until<=now() THEN RETURN NULL;END IF;
 IF p_status NOT IN('running','completed','needs_input','failed')OR p_status IS NULL OR jsonb_typeof(p_state)IS DISTINCT FROM 'object' OR jsonb_typeof(p_events)IS DISTINCT FROM 'array' OR jsonb_array_length(p_events)>8 OR length(p_stage)>80 OR length(p_message)>500 OR p_stage IS NULL OR p_message IS NULL THEN RAISE EXCEPTION 'PLANNER_INVALID';END IF;
 IF p_status='completed'AND (p_result IS NULL OR jsonb_typeof(p_result)<>'object')THEN RAISE EXCEPTION 'PLANNER_RESULT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY n),'[]') INTO task_events FROM(
  SELECT x,n FROM jsonb_array_elements(t.events||coalesce((SELECT jsonb_agg(jsonb_build_object('kind',left(coalesce(x->>'kind','tool'),40),'tool',left(coalesce(x->>'tool',''),80),'summary',left(coalesce(x->>'summary',''),300),'at',now()))FROM jsonb_array_elements(p_events)x),'[]')) WITH ORDINALITY e(x,n)
  ORDER BY n DESC LIMIT 80
 ) q;
 UPDATE journey_hub.planner_tasks SET state=p_state,status=p_status,stage=p_stage,message=p_message,events=task_events,result=p_result,error=p_error,
  step_count=step_count+1,crash_count=0,updated_at=now(),expires_at=CASE WHEN p_status='completed'THEN least(expires_at,now()+interval '1 hour')ELSE expires_at END,lease_token=CASE WHEN p_status='running'THEN p_lease ELSE NULL END,
  lease_until=CASE WHEN p_status='running'THEN now()+interval '3 minutes'ELSE NULL END WHERE id=t.id RETURNING * INTO t;
 RETURN journey_hub.planner_task_public(t);
END $$;

CREATE FUNCTION public.journeyhub_planner_release(p_user_id uuid,p_id uuid,p_lease uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 WITH changed AS(UPDATE journey_hub.planner_tasks SET lease_token=NULL,lease_until=NULL WHERE user_id=p_user_id AND id=p_id AND status='running'AND lease_token=p_lease RETURNING id)SELECT EXISTS(SELECT FROM changed)
$$;

CREATE FUNCTION public.journeyhub_planner_due(p_limit integer DEFAULT 2)RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'userId',user_id)),'[]')FROM(SELECT id,user_id FROM journey_hub.planner_tasks WHERE status='running'AND(lease_until IS NULL OR lease_until<=now())ORDER BY updated_at LIMIT least(2,greatest(0,p_limit)))q
$$;

CREATE FUNCTION public.journeyhub_planner_visit_facts(p_user_id uuid,p_place_ids text[],p_dates date[])RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',stop_id,'date',visit_date,'state',state,'fields',facts,'checkedAt',checked_at)),'[]')FROM(
  SELECT DISTINCT ON(stop_id,visit_date)stop_id,visit_date,state,facts,checked_at FROM journey_hub.visit_research
  WHERE owner_id=p_user_id AND stop_id=ANY(p_place_ids[1:16])AND visit_date=ANY(p_dates[1:4])AND checked_at>now()-interval '1 day'
  ORDER BY stop_id,visit_date,checked_at DESC
 )q
$$;

CREATE FUNCTION public.journeyhub_planner_search_result(p_user_id uuid,p_history_id uuid)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT result FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND kind='discover'AND status='completed'AND expires_at>now() AND result->>'historyId'=p_history_id::text ORDER BY updated_at DESC LIMIT 1
$$;

CREATE FUNCTION public.journeyhub_planner_save_facts(p_user_id uuid,p_trip_id uuid,p_facts jsonb)RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb;n integer:=0;changed integer;
BEGIN
 IF jsonb_typeof(p_facts)IS DISTINCT FROM 'array'OR jsonb_array_length(p_facts)>16 OR octet_length(p_facts::text)>400000 THEN RAISE EXCEPTION 'PLANNER_INVALID';END IF;
 IF NOT EXISTS(SELECT FROM journey_hub.trip_history WHERE id=p_trip_id AND user_id=p_user_id AND plan IS NOT NULL)THEN RETURN 0;END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(p_facts)x LOOP
  IF item->>'state'NOT IN('verified','partial','unconfirmed','not_applicable') OR jsonb_typeof(item->'fields')IS DISTINCT FROM 'object'OR octet_length((item->'fields')::text)>24000 OR coalesce(item->>'date','')!~'^\d{4}-\d{2}-\d{2}$'THEN CONTINUE;END IF;
  UPDATE journey_hub.visit_research q SET facts=item->'fields',state=item->>'state',checked_at=now(),attempts=0,
   due_at=CASE WHEN item->>'state'='not_applicable'THEN NULL WHEN item->>'state'IN('verified','partial')THEN now()+interval '1 day'ELSE now()+interval '5 minutes'END
  WHERE q.owner_id=p_user_id AND q.source_type='history'AND q.trip_id=p_trip_id AND q.stop_id=item->>'id'AND q.visit_date=(item->>'date')::date AND q.lease IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;n:=n+changed;
 END LOOP;RETURN n;
END $$;

-- Short-lived provider material is only retained while the task can be resumed.
CREATE FUNCTION journey_hub.planner_task_cleanup()RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 UPDATE journey_hub.planner_tasks SET state='{}',payload='{}',result=NULL,lease_token=NULL,lease_until=NULL,
  status=CASE WHEN status='running'THEN 'failed'ELSE status END,
  error=CASE WHEN status='running'THEN '{"code":"PLANNER_EXPIRED","message":"This planning task expired. Start a new request."}'::jsonb ELSE error END
 WHERE expires_at<=now()AND(state<>'{}'OR payload<>'{}'OR result IS NOT NULL OR status='running');GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
REVOKE ALL ON FUNCTION journey_hub.planner_task_cleanup()FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE r record;BEGIN
 FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'AND p.proname LIKE 'journeyhub_planner_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig);
 END LOOP;
END $$;
SELECT cron.schedule('journeyhub-traveler-planner','* * * * *',$schedule$
 SELECT journey_hub.planner_task_cleanup();
 SELECT net.http_post(url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/journeyhub-planner',body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||w.decrypted_secret),timeout_milliseconds:=100000)
 FROM(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret'ORDER BY created_at DESC LIMIT 1)w
 WHERE length(w.decrypted_secret)>=32 AND EXISTS(SELECT FROM journey_hub.planner_tasks WHERE status='running'AND(lease_until IS NULL OR lease_until<=now()));
$schedule$);
COMMIT;
