BEGIN;
ALTER TABLE journey_hub.trip_care ADD COLUMN chat_cleared_at timestamptz;
ALTER FUNCTION journey_hub.care_chat_conversation(uuid,uuid) RENAME TO care_chat_conversation_before_clear;
CREATE FUNCTION journey_hub.care_chat_conversation(p_user_id uuid,p_care_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_set(conversation,'{messages}',COALESCE((SELECT jsonb_agg(m ORDER BY ordinal)
 FROM jsonb_array_elements(conversation->'messages') WITH ORDINALITY AS items(m,ordinal)
 WHERE cutoff IS NULL OR (m->>'createdAt')::timestamptz>cutoff),'[]'::jsonb))
 FROM (SELECT journey_hub.care_chat_conversation_before_clear(p_user_id,p_care_id) conversation,
 (SELECT chat_cleared_at FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id) cutoff) data
$$;
REVOKE ALL ON FUNCTION journey_hub.care_chat_conversation(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.journeyhub_clear_trip_chat(p_care_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); c journey_hub.trip_care;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to clear this conversation' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT FROM journey_hub.care_chat_requests WHERE care_id=c.id AND user_id=uid AND status IN('pending','running')) THEN
 RAISE EXCEPTION 'Wait for the agent to finish before clearing this conversation';END IF;
 -- Keep request IDs to prevent old network retries from replaying actions.
 -- Remove conversational content, not booking/payment/application audit records.
 UPDATE journey_hub.care_chat_requests SET message='[Deleted]',response=NULL,result=NULL,
 events='[]',failure=NULL,status='completed' WHERE care_id=c.id AND user_id=uid;
 DELETE FROM journey_hub.care_chat_place_cache WHERE care_id=c.id AND user_id=uid AND NOT accepted;
 UPDATE journey_hub.trip_care SET chat_cleared_at=clock_timestamp(),proposal=NULL WHERE id=c.id;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_clear_trip_chat(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.journeyhub_clear_trip_chat(uuid) TO authenticated;
COMMIT;
