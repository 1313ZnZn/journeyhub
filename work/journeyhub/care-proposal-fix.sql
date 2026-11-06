-- Keep a fresh traveler-requested adjustment when a slower provider check completes.
BEGIN;
CREATE OR REPLACE FUNCTION public.journeyhub_care_update(p_user_id uuid,p_id uuid,p_revision int,p_checks jsonb,p_proposal jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR c.revision<>p_revision OR c.status<>'active' THEN RAISE EXCEPTION 'Care request conflict';END IF;
 UPDATE journey_hub.trip_care SET checks=COALESCE(p_checks,checks),checked_at=CASE WHEN p_checks IS NOT NULL THEN now()ELSE checked_at END,
  proposal=CASE WHEN p_checks IS NOT NULL AND c.proposal IS NOT NULL AND (c.proposal->>'expiresAt')::timestamptz>now() THEN c.proposal ELSE p_proposal END,
  updated_at=now()WHERE id=c.id RETURNING * INTO c;
 RETURN journey_hub.care_json(c);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb)TO service_role;
COMMIT;
