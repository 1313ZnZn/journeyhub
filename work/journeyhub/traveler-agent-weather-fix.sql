-- Refresh expired near-travel forecasts through the existing bounded queue.
BEGIN;
CREATE OR REPLACE FUNCTION journey_hub.care_weather_due(c journey_hub.trip_care) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT c.status='active'
 AND (c.input->>'date')::date<=(now()AT TIME ZONE CASE c.input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date+1
 AND EXISTS(SELECT FROM jsonb_array_elements(c.checks)x WHERE x->>'id'='__weather__'
  AND jsonb_typeof(x#>'{forecast,days}')='array' AND jsonb_array_length(x#>'{forecast,days}')>0
  AND CASE WHEN x#>>'{forecast,expiresAt}' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   THEN (x#>>'{forecast,expiresAt}')::timestamptz<=now() ELSE false END)
$$;
REVOKE ALL ON FUNCTION journey_hub.care_weather_due(journey_hub.trip_care) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.journeyhub_care_due(p_limit integer DEFAULT 2) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 WITH due AS(SELECT c.id FROM journey_hub.trip_care c WHERE status='active'
  AND (checked_at IS NULL OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at) OR (input->>'date')::date<=(now()AT TIME ZONE CASE input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date+1)
  AND (input->>'date')::date+COALESCE((input->>'days')::int,1)>(now()AT TIME ZONE CASE input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours' OR journey_hub.care_weather_due(c) OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes')
  ORDER BY checked_at NULLS FIRST,id LIMIT greatest(1,least(COALESCE(p_limit,2),2))FOR UPDATE SKIP LOCKED),claimed AS(
  UPDATE journey_hub.trip_care c SET worker_claimed_at=now()FROM due WHERE c.id=due.id RETURNING c.id,c.user_id)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'userId',user_id)),'[]'::jsonb)INTO result FROM claimed;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_due(integer)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_due(integer)TO service_role;
SELECT cron.schedule('journeyhub-trip-place-check','* * * * *',$schedule$
 SELECT net.http_post(url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/journeyhub-care',body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||w.decrypted_secret),timeout_milliseconds:=60000)
 FROM(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret'ORDER BY created_at DESC LIMIT 1)w
 WHERE length(w.decrypted_secret)>=32 AND EXISTS(SELECT FROM journey_hub.trip_care c WHERE status='active'
  AND(checked_at IS NULL OR(input->>'date')::date<=current_date+1 OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))
  AND(input->>'date')::date+COALESCE((input->>'days')::int,1)>=current_date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours' OR journey_hub.care_weather_due(c) OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes'));
 $schedule$);
COMMIT;

