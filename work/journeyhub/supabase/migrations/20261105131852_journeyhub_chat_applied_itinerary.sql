BEGIN;
ALTER TABLE journey_hub.care_chat_applies ADD COLUMN itinerary jsonb;
CREATE OR REPLACE FUNCTION journey_hub.care_chat_snapshot_label(p_text text,p_limit integer)RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN btrim(p_text)~'[A-Za-z]' AND p_text!~'[[:cntrl:]<>]'
  AND p_text!~U&'[\3400-\4DBF\4E00-\9FFF\F900-\FAFF\0E00-\0E7F\+020000-\+02FFFF\+030000-\+032FFF]'
  THEN left(btrim(p_text),p_limit) ELSE NULL END
$$;
REVOKE ALL ON FUNCTION journey_hub.care_chat_snapshot_label(text,int) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION journey_hub.care_chat_applied_itinerary(c journey_hub.trip_care,p_day_index integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE labels jsonb;items jsonb;
BEGIN
 IF p_day_index IS NULL OR p_day_index NOT BETWEEN 1 AND (c.input->>'days')::int THEN RETURN NULL;END IF;
 labels:=journey_hub.care_json(c)->'places';
 SELECT jsonb_agg(jsonb_build_object('id',s->>'id','name',COALESCE(journey_hub.care_chat_snapshot_label(label->>'name',160),'Planned stop'),
  'kind',COALESCE(journey_hub.care_chat_snapshot_label(label->>'kind',80),'visit'),'category',journey_hub.care_chat_snapshot_label(label->>'category',80),'dayIndex',p_day_index,
  'start',s->>'start','end',s->>'end','reason',journey_hub.care_chat_snapshot_label(s->>'reason',300)) ORDER BY s->>'start',n) INTO items
 FROM jsonb_array_elements(c.plan->'stops')WITH ORDINALITY q(s,n)
 LEFT JOIN LATERAL(SELECT p AS label FROM jsonb_array_elements(COALESCE(labels,'[]'::jsonb))p WHERE p->>'id'=s->>'id' LIMIT 1)l ON true
 WHERE (s->>'dayIndex')::int=p_day_index;
 IF items IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('revision',c.revision,'dayIndex',p_day_index,'city',c.input->>'city',
  'date',to_char((c.input->>'date')::date+p_day_index-1,'YYYY-MM-DD'),'stops',items);
END $$;
REVOKE ALL ON FUNCTION journey_hub.care_chat_applied_itinerary(journey_hub.trip_care,int) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION journey_hub.care_chat_applied_immutable()RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.itinerary IS NOT NULL AND NEW.itinerary IS DISTINCT FROM OLD.itinerary THEN RAISE EXCEPTION 'CARE_CHAT_SNAPSHOT_IMMUTABLE';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION journey_hub.care_chat_applied_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER care_chat_applied_immutable BEFORE UPDATE OF itinerary ON journey_hub.care_chat_applies FOR EACH ROW EXECUTE FUNCTION journey_hub.care_chat_applied_immutable();

CREATE OR REPLACE FUNCTION journey_hub.care_chat_conversation(p_user_id uuid,p_care_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH recent AS (SELECT * FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id ORDER BY created_at DESC LIMIT 40),
 messages AS (
  SELECT created_at AS stamp,0 AS ordinal,jsonb_build_object('id',request_id||':user','role','user','text',message,'dayIndex',day_index,'createdAt',created_at) AS item FROM recent
  UNION ALL SELECT updated_at,1,jsonb_build_object('id',request_id||':assistant','role','assistant','text',response,'dayIndex',day_index,'createdAt',updated_at,'events',events) FROM recent WHERE status='completed'
  UNION ALL SELECT created_at,2,jsonb_build_object('id',request_id||':applied','role','assistant','text','Your approved changes are saved. Existing reservations have not been changed.','dayIndex',day_index,'createdAt',created_at,'itinerary',itinerary)
    FROM journey_hub.care_chat_applies WHERE user_id=p_user_id AND care_id=p_care_id
 ) SELECT jsonb_build_object('messages',COALESCE((SELECT jsonb_agg(item ORDER BY stamp,ordinal) FROM messages),'[]'::jsonb),
 'pending',(SELECT CASE WHEN status='completed' THEN NULL ELSE jsonb_build_object('requestId',request_id,'status',status,'dayIndex',day_index,'message',failure,'canRetry',attempts<3) END
   FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id ORDER BY created_at DESC LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION public.journeyhub_care_chat_apply(p_user_id uuid,p_care_id uuid,p_proposal_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;a journey_hub.care_chat_applies;day_number int;
BEGIN
 IF p_request_id IS NULL OR p_proposal_id IS NULL THEN RAISE EXCEPTION 'CARE_CHAT_INVALID';END IF;
 -- Global per-account wallet lock matches care_accept, then history, then care.
 PERFORM journey_hub.demo_wallet_lock(p_user_id);
 PERFORM h.id FROM journey_hub.trip_history h JOIN journey_hub.trip_care x ON x.source_type='history' AND x.source_id=h.id AND x.user_id=h.user_id WHERE x.id=p_care_id AND x.user_id=p_user_id FOR UPDATE OF h;
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id FOR UPDATE;
 IF c.id IS NULL OR public.journeyhub_care_chat_read(p_user_id,p_care_id) IS NULL THEN RAISE EXCEPTION 'CARE_CHAT_NOT_FOUND';END IF;
 SELECT * INTO a FROM journey_hub.care_chat_applies WHERE user_id=p_user_id AND request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.care_id<>p_care_id OR a.proposal_id<>p_proposal_id THEN RAISE EXCEPTION 'CARE_CHAT_REQUEST_CONFLICT';END IF;
  RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
 END IF;
 IF EXISTS(SELECT FROM journey_hub.care_chat_applies WHERE care_id=p_care_id AND proposal_id=p_proposal_id) THEN RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);END IF;
 IF c.proposal->>'dayIndex' ~ '^[1-7]$' AND (c.proposal->>'dayIndex')::int<=(c.input->>'days')::int THEN day_number:=(c.proposal->>'dayIndex')::int;END IF;
 IF day_number IS NULL THEN
  SELECT CASE WHEN count(DISTINCT s->>'dayIndex')=1 THEN min((s->>'dayIndex')::int) ELSE NULL END INTO day_number
  FROM jsonb_array_elements(c.proposal#>'{plan,stops}')s WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(c.plan->'stops')old WHERE old->>'id'=s->>'id' AND (old->>'start',old->>'end',old->>'dayIndex')=(s->>'start',s->>'end',s->>'dayIndex'));
 END IF;
 IF day_number IS NULL THEN SELECT day_index INTO day_number FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id AND status='completed' ORDER BY updated_at DESC LIMIT 1;END IF;
 PERFORM public.journeyhub_care_accept(p_user_id,p_care_id,p_proposal_id);
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id;
 INSERT INTO journey_hub.care_chat_applies(user_id,care_id,request_id,proposal_id,revision,day_index,itinerary)
 VALUES(p_user_id,p_care_id,p_request_id,p_proposal_id,c.revision,day_number,journey_hub.care_chat_applied_itinerary(c,day_number));
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

-- Only the currently accepted revision can be reconstructed safely. Earlier
-- versions retain their existing confirmation without fabricated stop cards.
UPDATE journey_hub.care_chat_applies a SET itinerary=journey_hub.care_chat_applied_itinerary(c,a.day_index)
FROM journey_hub.trip_care c
WHERE a.itinerary IS NULL AND a.care_id=c.id AND a.user_id=c.user_id AND a.revision=c.revision;
COMMIT;
