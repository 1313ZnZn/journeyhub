-- Private traveler history. Only Place IDs, traveler input and AI-authored structure persist.
-- Google place details/photos/coordinates/opening hours/routes are fetched again on open.
BEGIN;
CREATE FUNCTION journey_hub.trip_history_payload_valid(p_input jsonb,p_ids text[],p_wanted text[],p_skipped text[],p_plan jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
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
 IF jsonb_array_length(p_plan->'stops') NOT BETWEEN 1 AND 12 THEN RETURN false;END IF;
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
END $$;

CREATE TABLE journey_hub.trip_history (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 parent_id uuid REFERENCES journey_hub.trip_history(id) ON DELETE CASCADE,
 input jsonb NOT NULL,place_ids text[] NOT NULL,wanted text[] NOT NULL DEFAULT '{}',skipped text[] NOT NULL DEFAULT '{}',plan jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((parent_id IS NULL)=(plan IS NULL)),CHECK(parent_id IS DISTINCT FROM id),
 CHECK(journey_hub.trip_history_payload_valid(input,place_ids,wanted,skipped,plan))
);
CREATE INDEX trip_history_owner_created ON journey_hub.trip_history(user_id,created_at DESC,id DESC);
CREATE INDEX trip_history_parent ON journey_hub.trip_history(parent_id) WHERE parent_id IS NOT NULL;
ALTER TABLE journey_hub.trip_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.trip_history FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA journey_hub TO service_role;
GRANT SELECT,INSERT,UPDATE ON journey_hub.trip_history TO service_role;
CREATE POLICY trip_history_owner ON journey_hub.trip_history FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

CREATE FUNCTION journey_hub.trip_history_json(r journey_hub.trip_history) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'parentId',r.parent_id,'input',r.input,'placeIds',r.place_ids,'wanted',r.wanted,'skipped',r.skipped,'plan',r.plan,'status',CASE WHEN r.plan IS NULL THEN 'search' ELSE 'itinerary' END,'placeCount',cardinality(r.place_ids),'stopCount',coalesce(jsonb_array_length(r.plan->'stops'),0),'createdAt',r.created_at,'updatedAt',r.updated_at)
$$;

-- The caller is the authenticated Edge Function, using service_role after /auth/v1/user.
-- Neither anonymous clients nor authenticated browser clients can supply p_user_id to these RPCs.
CREATE FUNCTION public.journeyhub_trip_history_get(p_user_id uuid,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT journey_hub.trip_history_json(r) FROM journey_hub.trip_history r WHERE r.id=p_id AND r.user_id=p_user_id
$$;
CREATE FUNCTION public.journeyhub_trip_history_save(p_user_id uuid,p_id uuid,p_input jsonb,p_place_ids text[],p_wanted text[],p_skipped text[],p_plan jsonb,p_parent_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r journey_hub.trip_history;parent journey_hub.trip_history;
BEGIN
 IF p_user_id IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Invalid history request';END IF;
 IF p_parent_id IS NOT NULL THEN
  SELECT * INTO parent FROM journey_hub.trip_history WHERE id=p_parent_id AND user_id=p_user_id AND parent_id IS NULL;
  IF NOT FOUND OR parent.input IS DISTINCT FROM p_input OR parent.place_ids IS DISTINCT FROM p_place_ids THEN RAISE EXCEPTION 'History request conflict';END IF;
 END IF;
 INSERT INTO journey_hub.trip_history(id,user_id,input,place_ids,wanted,skipped,plan,parent_id)
 VALUES(p_id,p_user_id,p_input,p_place_ids,p_wanted,p_skipped,p_plan,p_parent_id) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO r FROM journey_hub.trip_history WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR r.input IS DISTINCT FROM p_input OR r.place_ids IS DISTINCT FROM p_place_ids OR r.parent_id IS DISTINCT FROM p_parent_id OR r.plan IS DISTINCT FROM p_plan
 OR (p_plan IS NOT NULL AND (r.wanted IS DISTINCT FROM p_wanted OR r.skipped IS DISTINCT FROM p_skipped)) THEN RAISE EXCEPTION 'History request conflict';END IF;
 RETURN journey_hub.trip_history_json(r);
END $$;
CREATE FUNCTION public.journeyhub_trip_history_choices(p_user_id uuid,p_id uuid,p_wanted text[],p_skipped text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r journey_hub.trip_history;
BEGIN
 SELECT * INTO r FROM journey_hub.trip_history WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF r.parent_id IS NOT NULL THEN
  SELECT * INTO r FROM journey_hub.trip_history WHERE id=r.parent_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL;END IF;
 END IF;
 UPDATE journey_hub.trip_history SET wanted=p_wanted,skipped=p_skipped,updated_at=now() WHERE id=r.id AND user_id=p_user_id RETURNING * INTO r;
 RETURN journey_hub.trip_history_json(r);
END $$;
CREATE FUNCTION public.journeyhub_trip_history_list(p_user_id uuid,p_limit integer DEFAULT 20,p_cursor_at timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE records jsonb;items jsonb;last_item jsonb;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 40 OR p_limit IS NULL OR (p_cursor_at IS NULL)<>(p_cursor_id IS NULL) THEN RAISE EXCEPTION 'Invalid history page';END IF;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.created_at DESC,x.id DESC),'[]'::jsonb) INTO records FROM (
  SELECT r.created_at,r.id,jsonb_build_object('id',r.id,'input',r.input,'status',CASE WHEN r.plan IS NULL THEN 'search' ELSE 'itinerary' END,'placeCount',cardinality(r.place_ids),'stopCount',coalesce(jsonb_array_length(r.plan->'stops'),0),'createdAt',r.created_at,'updatedAt',r.updated_at) AS item
  FROM journey_hub.trip_history r WHERE r.user_id=p_user_id AND (p_cursor_at IS NULL OR (r.created_at,r.id)<(p_cursor_at,p_cursor_id)) ORDER BY r.created_at DESC,r.id DESC LIMIT p_limit+1
 ) x;
 SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb) INTO items FROM jsonb_array_elements(records) WITH ORDINALITY e WHERE e.ordinality<=p_limit;
 last_item=items->(jsonb_array_length(items)-1);
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN jsonb_array_length(records)>p_limit THEN jsonb_build_object('createdAt',last_item->'createdAt','id',last_item->'id') ELSE NULL END);
END $$;

REVOKE ALL ON FUNCTION journey_hub.trip_history_payload_valid(jsonb,text[],text[],text[],jsonb),journey_hub.trip_history_json(journey_hub.trip_history) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.trip_history_payload_valid(jsonb,text[],text[],text[],jsonb),journey_hub.trip_history_json(journey_hub.trip_history) TO service_role;
REVOKE ALL ON FUNCTION public.journeyhub_trip_history_get(uuid,uuid),public.journeyhub_trip_history_save(uuid,uuid,jsonb,text[],text[],text[],jsonb,uuid),public.journeyhub_trip_history_choices(uuid,uuid,text[],text[]),public.journeyhub_trip_history_list(uuid,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_trip_history_get(uuid,uuid),public.journeyhub_trip_history_save(uuid,uuid,jsonb,text[],text[],text[],jsonb,uuid),public.journeyhub_trip_history_choices(uuid,uuid,text[],text[]),public.journeyhub_trip_history_list(uuid,integer,timestamptz,uuid) TO service_role;
COMMIT;
