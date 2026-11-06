-- Share the existing account quota; idempotent retries and status reads stay free.
BEGIN;
CREATE OR REPLACE FUNCTION public.journeyhub_care_chat_start(p_user_id uuid,p_care_id uuid,p_request_id uuid,p_message text,p_day_index integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;r journey_hub.care_chat_requests;
BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id FOR UPDATE;
 IF c.id IS NULL OR c.status<>'active' OR public.journeyhub_care_chat_read(p_user_id,p_care_id) IS NULL THEN RAISE EXCEPTION 'CARE_CHAT_NOT_FOUND';END IF;
 IF p_request_id IS NULL OR p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 2000 OR (p_day_index IS NOT NULL AND p_day_index NOT BETWEEN 1 AND (c.input->>'days')::int) THEN RAISE EXCEPTION 'CARE_CHAT_INVALID';END IF;
 SELECT * INTO r FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND request_id=p_request_id FOR UPDATE;
 IF r.request_id IS NOT NULL THEN
  IF (r.care_id,r.message,r.day_index) IS DISTINCT FROM (p_care_id,btrim(p_message),p_day_index) THEN RAISE EXCEPTION 'CARE_CHAT_REQUEST_CONFLICT';END IF;
  IF r.status='failed' THEN
   IF r.attempts>=3 THEN RAISE EXCEPTION 'CARE_CHAT_RETRY_LIMIT';END IF;
   IF EXISTS(SELECT FROM journey_hub.care_chat_requests WHERE care_id=p_care_id AND status IN('pending','running') AND request_id<>p_request_id) THEN RAISE EXCEPTION 'CARE_CHAT_BUSY';END IF;
   UPDATE journey_hub.care_chat_requests SET status='pending',failure=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id AND request_id=p_request_id;
  END IF;
 ELSE
  IF EXISTS(SELECT FROM journey_hub.care_chat_requests WHERE care_id=p_care_id AND status IN('pending','running')) THEN RAISE EXCEPTION 'CARE_CHAT_BUSY';END IF;
  -- Charge once for a validated new message; existing requests and reads are free.
  PERFORM public.journeyhub_discovery_quota(p_user_id);
  INSERT INTO journey_hub.care_chat_requests(user_id,care_id,request_id,message,day_index)VALUES(p_user_id,p_care_id,p_request_id,btrim(p_message),p_day_index);
  -- A new question supersedes the previous unapplied suggestion.
  UPDATE journey_hub.trip_care SET proposal=NULL,updated_at=clock_timestamp() WHERE id=p_care_id;
 END IF;
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

REVOKE ALL ON FUNCTION public.journeyhub_care_chat_start(uuid,uuid,uuid,text,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_chat_start(uuid,uuid,uuid,text,int) TO service_role;
COMMIT;
