-- Allow the full four-day shortlist to persist. Ownership and payload rules unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION journey_hub.trip_history_payload_valid(p_input jsonb, p_ids text[], p_wanted text[], p_skipped text[], p_plan jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE k text;s jsonb;seen text[]='{}';
BEGIN
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>8192
 OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 20 OR p_wanted IS NULL OR p_skipped IS NULL
 OR cardinality(p_wanted)>20 OR cardinality(p_skipped)>20 OR NOT p_wanted<@p_ids OR NOT p_skipped<@p_ids OR p_wanted&&p_skipped THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_ids||p_wanted||p_skipped) id WHERE id IS NULL OR id!~'^[A-Za-z0-9_-]{1,200}$')
 OR cardinality(p_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_ids) id)
 OR cardinality(p_wanted)<>(SELECT count(DISTINCT id) FROM unnest(p_wanted) id)
 OR cardinality(p_skipped)<>(SELECT count(DISTINCT id) FROM unnest(p_skipped) id) THEN RETURN false;END IF;
 FOR k IN SELECT jsonb_object_keys(p_input) LOOP
  IF k NOT IN ('city','date','guests','prompt','budgetThb','days','dayStart','dayEnd','transport','preferredExperienceIds','excludedExperienceIds') THEN RETURN false;END IF;
 END LOOP;
 IF NOT(p_input ?& ARRAY['city','date','guests','prompt','days','dayStart','dayEnd','transport'])
 OR p_input->>'city' NOT IN ('Bangkok','Shanghai','Singapore') OR length(p_input->>'prompt')>2000
 OR p_input->>'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false;END IF;
 IF jsonb_typeof(p_input->'city')<>'string' OR jsonb_typeof(p_input->'date')<>'string' OR jsonb_typeof(p_input->'prompt')<>'string'
 OR jsonb_typeof(p_input->'guests')<>'number' OR (p_input->>'guests')::integer NOT BETWEEN 1 AND 6
 OR jsonb_typeof(p_input->'days')<>'number' OR (p_input->>'days')::integer NOT BETWEEN 1 AND 4
 OR jsonb_typeof(p_input->'dayStart')<>'string' OR jsonb_typeof(p_input->'dayEnd')<>'string'
 OR p_input->>'dayStart' !~ '^([01]\d|2[0-3]):[0-5]\d$' OR p_input->>'dayEnd' !~ '^([01]\d|2[0-3]):[0-5]\d$'
 OR p_input->>'dayStart'>=p_input->>'dayEnd' OR jsonb_typeof(p_input->'transport')<>'string' OR p_input->>'transport' NOT IN ('walk','drive')
 OR (p_input ? 'preferredExperienceIds' AND p_input->'preferredExperienceIds'<>'[]'::jsonb)
 OR (p_input ? 'excludedExperienceIds' AND p_input->'excludedExperienceIds'<>'[]'::jsonb) THEN RETURN false;END IF;
 IF p_plan IS NULL THEN RETURN true;END IF;
 IF jsonb_typeof(p_plan)<>'object' OR octet_length(p_plan::text)>12000 OR NOT(p_plan ?& ARRAY['summary','stops']) THEN RETURN false;END IF;
 FOR k IN SELECT jsonb_object_keys(p_plan) LOOP IF k NOT IN ('summary','stops') THEN RETURN false;END IF;END LOOP;
 IF jsonb_typeof(p_plan->'summary')<>'string' OR length(p_plan->>'summary')>600 OR jsonb_typeof(p_plan->'stops')<>'array' THEN RETURN false;END IF;
 IF jsonb_array_length(p_plan->'stops') NOT BETWEEN 1 AND 16 THEN RETURN false;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_plan->'stops') LOOP
  IF jsonb_typeof(s)<>'object' OR NOT(s ?& ARRAY['id','dayIndex','start','end','reason']) THEN RETURN false;END IF;
  FOR k IN SELECT jsonb_object_keys(s) LOOP IF k NOT IN ('id','dayIndex','start','end','reason') THEN RETURN false;END IF;END LOOP;
  IF jsonb_typeof(s->'id')<>'string' OR jsonb_typeof(s->'dayIndex')<>'number' OR jsonb_typeof(s->'start')<>'string' OR jsonb_typeof(s->'end')<>'string'
  OR s->>'id'=ANY(p_skipped) OR (cardinality(p_wanted)>0 AND NOT(s->>'id'=ANY(p_wanted))) THEN RETURN false;END IF;
  IF NOT (s->>'id'=ANY(p_ids)) OR s->>'id'=ANY(seen) OR (s->>'dayIndex')::integer NOT BETWEEN 1 AND (p_input->>'days')::integer
  OR s->>'start' !~ '^([01]\d|2[0-3]):[0-5]\d$' OR s->>'end' !~ '^([01]\d|2[0-3]):[0-5]\d$'
  OR s->>'start'>=s->>'end' OR s->>'start'<p_input->>'dayStart' OR s->>'end'>p_input->>'dayEnd'
  OR jsonb_typeof(s->'reason')<>'string' OR length(s->>'reason')>300 THEN RETURN false;END IF;
  seen=array_append(seen,s->>'id');
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;
COMMIT;

