-- Explicit edits preserve a stable Calendar identity and every prior revision.
-- No supplier content or payment is stored/changed here.
BEGIN;
CREATE OR REPLACE FUNCTION journey_hub.trip_history_payload_valid(p_input jsonb,p_ids text[],p_wanted text[],p_skipped text[],p_plan jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE k text;s jsonb;seen text[]='{}';amount numeric;rate numeric;total bigint;
BEGIN
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>8192
 OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR p_wanted IS NULL OR p_skipped IS NULL
 OR cardinality(p_wanted)>20 OR cardinality(p_skipped)>20 OR NOT p_wanted<@p_ids OR NOT p_skipped<@p_ids OR p_wanted&&p_skipped THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_ids||p_wanted||p_skipped) id WHERE id IS NULL OR id!~'^[A-Za-z0-9_-]{1,200}$')
 OR cardinality(p_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_ids) id)
 OR cardinality(p_wanted)<>(SELECT count(DISTINCT id) FROM unnest(p_wanted) id)
 OR cardinality(p_skipped)<>(SELECT count(DISTINCT id) FROM unnest(p_skipped) id) THEN RETURN false;END IF;
 FOR k IN SELECT jsonb_object_keys(p_input) LOOP
  IF k NOT IN ('city','date','guests','prompt','budgetThb','days','dayStart','dayEnd','transport','preferredExperienceIds','excludedExperienceIds','budgetAmount','budgetCurrency','budgetScope','budgetCnyMinor') THEN RETURN false;END IF;
 END LOOP;
 IF NOT(p_input ?& ARRAY['city','date','guests','prompt','days','dayStart','dayEnd','transport'])
 OR p_input->>'city' NOT IN ('Bangkok','Shanghai','Singapore') OR length(p_input->>'prompt')>2000
 OR p_input->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false;END IF;
 IF jsonb_typeof(p_input->'city')<>'string' OR jsonb_typeof(p_input->'date')<>'string' OR jsonb_typeof(p_input->'prompt')<>'string'
 OR jsonb_typeof(p_input->'guests')<>'number' OR (p_input->>'guests')::numeric<>trunc((p_input->>'guests')::numeric) OR (p_input->>'guests')::integer NOT BETWEEN 1 AND 6
 OR jsonb_typeof(p_input->'days')<>'number' OR (p_input->>'days')::numeric<>trunc((p_input->>'days')::numeric) OR (p_input->>'days')::integer NOT BETWEEN 1 AND 4
 OR jsonb_typeof(p_input->'dayStart')<>'string' OR jsonb_typeof(p_input->'dayEnd')<>'string'
 OR p_input->>'dayStart' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR p_input->>'dayEnd' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 OR p_input->>'dayStart'>=p_input->>'dayEnd' OR jsonb_typeof(p_input->'transport')<>'string' OR p_input->>'transport' NOT IN ('walk','drive')
 OR (p_input ? 'preferredExperienceIds' AND p_input->'preferredExperienceIds'<>'[]'::jsonb)
 OR (p_input ? 'excludedExperienceIds' AND p_input->'excludedExperienceIds'<>'[]'::jsonb) THEN RETURN false;END IF;
 IF p_input->>'budgetAmount' IS NOT NULL THEN
  IF p_input->>'budgetCurrency' NOT IN('CNY','THB','USD','SGD') OR p_input->>'budgetScope' NOT IN('person','group') OR NOT(p_input ?& ARRAY['budgetCurrency','budgetScope','budgetCnyMinor','budgetThb']) THEN RETURN false;END IF;
  amount:=(p_input->>'budgetAmount')::numeric;rate:=CASE p_input->>'budgetCurrency' WHEN 'CNY' THEN 1 WHEN 'THB' THEN 0.2 WHEN 'USD' THEN 7 WHEN 'SGD' THEN 5 END;
  IF jsonb_typeof(p_input->'budgetAmount')<>'number' OR amount<=0 OR amount>1000000 OR amount*100<>trunc(amount*100) THEN RETURN false;END IF;
  total:=round(amount*100*rate*CASE p_input->>'budgetScope' WHEN 'person' THEN (p_input->>'guests')::int ELSE 1 END);
  IF total NOT BETWEEN 20 AND 20000000 OR (p_input->>'budgetCnyMinor')::bigint IS DISTINCT FROM total OR (p_input->>'budgetThb')::bigint IS DISTINCT FROM total/20 THEN RETURN false;END IF;
 ELSIF p_input->>'budgetThb' IS NOT NULL AND ((p_input->>'budgetThb')::numeric<>trunc((p_input->>'budgetThb')::numeric) OR (p_input->>'budgetThb')::bigint NOT BETWEEN 1 AND 1000000) THEN RETURN false;
 END IF;
 IF p_plan IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p_plan)<>'object' OR octet_length(p_plan::text)>12000 OR NOT(p_plan ?& ARRAY['summary','stops']) THEN RETURN false;END IF;
 FOR k IN SELECT jsonb_object_keys(p_plan) LOOP IF k NOT IN ('summary','stops') THEN RETURN false;END IF;END LOOP;
 IF jsonb_typeof(p_plan->'summary')<>'string' OR length(p_plan->>'summary')>600 OR jsonb_typeof(p_plan->'stops')<>'array' OR jsonb_array_length(p_plan->'stops') NOT BETWEEN 1 AND 16 THEN RETURN false;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_plan->'stops') LOOP
  IF jsonb_typeof(s)<>'object' OR NOT(s ?& ARRAY['id','dayIndex','start','end','reason']) THEN RETURN false;END IF;
  FOR k IN SELECT jsonb_object_keys(s) LOOP IF k NOT IN ('id','dayIndex','start','end','reason') THEN RETURN false;END IF;END LOOP;
  IF jsonb_typeof(s->'id')<>'string' OR jsonb_typeof(s->'dayIndex')<>'number' OR jsonb_typeof(s->'start')<>'string' OR jsonb_typeof(s->'end')<>'string'
  OR s->>'id'=ANY(p_skipped) OR (cardinality(p_wanted)>0 AND NOT(s->>'id'=ANY(p_wanted))) THEN RETURN false;END IF;
  IF NOT(s->>'id'=ANY(p_ids)) OR s->>'id'=ANY(seen) OR (s->>'dayIndex')::numeric<>trunc((s->>'dayIndex')::numeric) OR (s->>'dayIndex')::integer NOT BETWEEN 1 AND (p_input->>'days')::integer
  OR s->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR s->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  OR s->>'start'>=s->>'end' OR s->>'start'<p_input->>'dayStart' OR s->>'end'>p_input->>'dayEnd'
  OR jsonb_typeof(s->'reason')<>'string' OR length(s->>'reason')>300 THEN RETURN false;END IF;
  seen=array_append(seen,s->>'id');
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
-- Keep historical run normalization unchanged. New raw budget preferences are
-- computed on the server and retained for display/reopen, never trusted as totals.
ALTER FUNCTION journey_hub.agent_trip_input(jsonb) RENAME TO agent_trip_input_before_budget;
CREATE FUNCTION journey_hub.agent_trip_input(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n jsonb;currency text;scope text;amount numeric;rate numeric;total bigint;raw jsonb;
BEGIN
 IF NOT(p_input ? 'budgetAmount') THEN RETURN journey_hub.agent_trip_input_before_budget(p_input);END IF;
 currency:=COALESCE(p_input->>'budgetCurrency','CNY');scope:=COALESCE(p_input->>'budgetScope','group');
 IF currency NOT IN('CNY','THB','USD','SGD') OR scope NOT IN('person','group') THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 IF p_input->>'budgetAmount' IS NOT NULL THEN
  amount:=(p_input->>'budgetAmount')::numeric;rate:=CASE currency WHEN 'CNY' THEN 1 WHEN 'THB' THEN .2 WHEN 'USD' THEN 7 WHEN 'SGD' THEN 5 END;
  IF jsonb_typeof(p_input->'budgetAmount')<>'number' OR amount<=0 OR amount>1000000 OR amount*100<>trunc(amount*100) THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
  total:=round(amount*100*rate*CASE scope WHEN 'person' THEN (p_input->>'guests')::int ELSE 1 END);
  IF total NOT BETWEEN 20 AND 20000000 THEN RAISE EXCEPTION 'INVALID_TRIP_INPUT';END IF;
 END IF;
 n:=journey_hub.agent_trip_input_before_budget(p_input||jsonb_build_object('budgetThb',CASE WHEN total IS NOT NULL THEN total/20 ELSE NULL END));
 RETURN n||jsonb_build_object('budgetCurrency',currency,'budgetScope',scope,'budgetAmount',amount,'budgetCnyMinor',total);
END $$;
REVOKE ALL ON FUNCTION journey_hub.agent_trip_input_before_budget(jsonb),journey_hub.agent_trip_input(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION journey_hub.agent_trip_input_before_budget(jsonb),journey_hub.agent_trip_input(jsonb) TO service_role;
CREATE TABLE journey_hub.trip_history_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 history_id uuid NOT NULL REFERENCES journey_hub.trip_history(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,request_payload jsonb NOT NULL,before_input jsonb NOT NULL,before_plan jsonb NOT NULL,
 after_input jsonb NOT NULL,after_plan jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,request_id)
);
CREATE INDEX trip_history_revisions_source ON journey_hub.trip_history_revisions(history_id,created_at DESC);
ALTER TABLE journey_hub.trip_history_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.trip_history_revisions FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY trip_history_revisions_owner ON journey_hub.trip_history_revisions FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE FUNCTION journey_hub.trip_history_revise(p_user_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_input jsonb,p_plan jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r journey_hub.trip_history;prior journey_hub.trip_history_revisions;payload jsonb;v_wanted text[];v_skipped text[];care_id uuid;
BEGIN
 IF p_user_id IS NULL OR p_id IS NULL OR p_request_id IS NULL OR p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'EDIT_INVALID';END IF;
 payload:=jsonb_build_object('historyId',p_id,'baseVersion',p_expected_updated_at,'input',p_input,'plan',p_plan);
 PERFORM pg_advisory_xact_lock(hashtextextended('itinerary-edit:'||p_user_id::text||':'||p_request_id::text,0));
 SELECT * INTO r FROM journey_hub.trip_history WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR r.plan IS NULL OR EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d WHERE d.user_id=p_user_id AND d.kind='history' AND d.item_id=p_id::text) THEN RAISE EXCEPTION 'EDIT_NOT_FOUND';END IF;
 SELECT * INTO prior FROM journey_hub.trip_history_revisions WHERE user_id=p_user_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'EDIT_REQUEST_REUSED';END IF;
  RETURN journey_hub.trip_history_json(r);
 END IF;
 IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'EDIT_STALE';END IF;
 IF r.input->>'city' IS DISTINCT FROM p_input->>'city' OR r.input->>'date' IS DISTINCT FROM p_input->>'date' OR r.input->>'days' IS DISTINCT FROM p_input->>'days'
 OR p_plan IS NULL OR jsonb_typeof(p_plan->'stops') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'EDIT_INVALID';END IF;
 SELECT array_agg(s->>'id' ORDER BY s->>'id') INTO v_wanted FROM jsonb_array_elements(p_plan->'stops')s;
 SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO v_skipped FROM unnest(r.place_ids)x WHERE NOT(x=ANY(v_wanted));
 IF NOT journey_hub.trip_history_payload_valid(p_input,r.place_ids,v_wanted,v_skipped,p_plan)
 OR (SELECT count(DISTINCT (s->>'dayIndex')::int) FROM jsonb_array_elements(p_plan->'stops')s)<>(p_input->>'days')::int
 OR EXISTS(SELECT 1 FROM (SELECT s,lag(s->>'end')OVER(PARTITION BY s->>'dayIndex' ORDER BY s->>'start')prev FROM jsonb_array_elements(p_plan->'stops')s)t WHERE t.prev>t.s->>'start') THEN RAISE EXCEPTION 'EDIT_INVALID';END IF;
 INSERT INTO journey_hub.trip_history_revisions(user_id,history_id,request_id,request_payload,before_input,before_plan,after_input,after_plan)
 VALUES(p_user_id,p_id,p_request_id,payload,r.input,r.plan,p_input,p_plan);
 UPDATE journey_hub.trip_history SET input=p_input,plan=p_plan,wanted=v_wanted,skipped=v_skipped,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO r;
 -- Keep the active companion on this plan, discard stale proposals/check results.
 -- Payments and reservations deliberately remain unchanged at their original dates.
 UPDATE journey_hub.trip_care SET input=p_input,plan=p_plan,revision=revision+1,proposal=NULL,checks='[]',checked_at=NULL,check_claimed_at=NULL,worker_claimed_at=NULL,updated_at=clock_timestamp()
 WHERE user_id=p_user_id AND source_type='history' AND source_id=p_id RETURNING id INTO care_id;
 IF care_id IS NOT NULL THEN INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind) VALUES(care_id,'itinerary-edit:'||p_request_id::text,'itinerary_updated') ON CONFLICT DO NOTHING;END IF;
 RETURN journey_hub.trip_history_json(r);
END $$;
CREATE FUNCTION public.journeyhub_trip_history_revise(p_user_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_input jsonb,p_plan jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.trip_history_revise(p_user_id,p_id,p_expected_updated_at,p_input,p_plan,p_request_id)$$;
REVOKE ALL ON FUNCTION journey_hub.trip_history_revise(uuid,uuid,timestamptz,jsonb,jsonb,uuid),public.journeyhub_trip_history_revise(uuid,uuid,timestamptz,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.trip_history_revise(uuid,uuid,timestamptz,jsonb,jsonb,uuid),public.journeyhub_trip_history_revise(uuid,uuid,timestamptz,jsonb,jsonb,uuid) TO service_role;
COMMIT;
