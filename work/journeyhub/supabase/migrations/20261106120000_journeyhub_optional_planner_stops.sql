-- An itinerary may include unreviewed recommendations alongside liked places.
-- The planner enforces must-visit inclusion; skipped and foreign IDs remain forbidden.
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
  OR s->>'id'=ANY(p_skipped) THEN RETURN false;END IF;
  IF NOT(s->>'id'=ANY(p_ids)) OR s->>'id'=ANY(seen) OR (s->>'dayIndex')::numeric<>trunc((s->>'dayIndex')::numeric) OR (s->>'dayIndex')::integer NOT BETWEEN 1 AND (p_input->>'days')::integer
  OR s->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR s->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  OR s->>'start'>=s->>'end' OR s->>'start'<p_input->>'dayStart' OR s->>'end'>p_input->>'dayEnd'
  OR jsonb_typeof(s->'reason')<>'string' OR length(s->>'reason')>300 THEN RETURN false;END IF;
  seen=array_append(seen,s->>'id');
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
