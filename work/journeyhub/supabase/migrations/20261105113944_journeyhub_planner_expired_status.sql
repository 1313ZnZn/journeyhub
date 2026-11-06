-- Explicit task bookmarks must follow the same retention boundary as latest.
BEGIN;
CREATE OR REPLACE FUNCTION public.journeyhub_planner_status(p_user_id uuid,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t journey_hub.planner_tasks;
BEGIN
 IF p_user_id IS NULL THEN RETURN NULL;END IF;
 IF p_id IS NULL THEN
  SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND expires_at>now() ORDER BY (status='running')DESC,created_at DESC LIMIT 1;
 ELSE SELECT * INTO t FROM journey_hub.planner_tasks WHERE user_id=p_user_id AND id=p_id AND expires_at>now();END IF;
 IF t.id IS NULL THEN RETURN NULL;END IF;
 RETURN journey_hub.planner_task_public(t);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_planner_status(uuid,uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_planner_status(uuid,uuid)TO service_role;
COMMIT;
