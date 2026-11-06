-- Durable traveler chat and explicit, fenced application of saved-place changes.
-- No staff, payment, booking or supplier mutation is introduced here.
BEGIN;

CREATE TABLE journey_hub.care_chat_requests (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 care_id uuid NOT NULL REFERENCES journey_hub.trip_care(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 day_index integer CHECK(day_index BETWEEN 1 AND 4),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','completed','failed')),
 response text CHECK(length(response)<=8000),
 events jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(events)='array' AND octet_length(events::text)<=12000),
 failure text,
 claimed_revision integer,
 lease uuid,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,request_id)
);
CREATE INDEX care_chat_requests_conversation ON journey_hub.care_chat_requests(care_id,created_at DESC);
CREATE UNIQUE INDEX care_chat_one_pending ON journey_hub.care_chat_requests(care_id) WHERE status IN('pending','running');
CREATE TABLE journey_hub.care_chat_applies (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 care_id uuid NOT NULL REFERENCES journey_hub.trip_care(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 proposal_id uuid NOT NULL,
 revision integer NOT NULL,
 day_index integer,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,request_id), UNIQUE(care_id,proposal_id)
);
ALTER TABLE journey_hub.care_chat_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_hub.care_chat_applies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.care_chat_requests,journey_hub.care_chat_applies FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE journey_hub.care_chat_place_cache (
 care_id uuid PRIMARY KEY REFERENCES journey_hub.trip_care(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 proposal_id uuid NOT NULL,
 revision integer NOT NULL,
 accepted boolean NOT NULL DEFAULT false,
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=250000),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour'
);
ALTER TABLE journey_hub.care_chat_place_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.care_chat_place_cache FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE journey_hub.care_chat_labels (
 care_id uuid PRIMARY KEY REFERENCES journey_hub.trip_care(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 payload jsonb NOT NULL CHECK(journey_hub.trip_display_snapshot_valid(payload))
);
ALTER TABLE journey_hub.care_chat_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.care_chat_labels FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION journey_hub.care_chat_schedule(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('summary',p->'summary','stops',(SELECT jsonb_agg(jsonb_build_object('id',s->'id','dayIndex',s->'dayIndex','start',s->'start','end',s->'end','reason',s->'reason') ORDER BY n) FROM jsonb_array_elements(p->'stops')WITH ORDINALITY q(s,n)))
$$;

CREATE FUNCTION journey_hub.care_chat_cached_plan(c journey_hub.trip_care) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT p.payload->'plan' FROM journey_hub.care_chat_place_cache p WHERE p.care_id=c.id AND p.user_id=c.user_id AND p.accepted AND p.revision=c.revision AND p.expires_at>now()),c.plan)
$$;

CREATE FUNCTION journey_hub.care_chat_conversation(p_user_id uuid,p_care_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH recent AS (SELECT * FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id ORDER BY created_at DESC LIMIT 40),
 messages AS (
  SELECT created_at AS stamp,0 AS ordinal,jsonb_build_object('id',request_id||':user','role','user','text',message,'dayIndex',day_index,'createdAt',created_at) AS item FROM recent
  UNION ALL SELECT updated_at,1,jsonb_build_object('id',request_id||':assistant','role','assistant','text',response,'dayIndex',day_index,'createdAt',updated_at,'events',events) FROM recent WHERE status='completed'
  UNION ALL SELECT created_at,2,jsonb_build_object('id',request_id||':applied','role','assistant','text','Your approved changes are saved. Existing reservations have not been changed.','dayIndex',day_index,'createdAt',created_at)
    FROM journey_hub.care_chat_applies WHERE user_id=p_user_id AND care_id=p_care_id
 ) SELECT jsonb_build_object('messages',COALESCE((SELECT jsonb_agg(item ORDER BY stamp,ordinal) FROM messages),'[]'::jsonb),
 'pending',(SELECT CASE WHEN status='completed' THEN NULL ELSE jsonb_build_object('requestId',request_id,'status',status,'dayIndex',day_index,'message',failure,'canRetry',attempts<3) END
   FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id ORDER BY created_at DESC LIMIT 1))
$$;

-- Candidates must be from this account's original saved search or itinerary.
-- Labels remain durable; optional provider fields reuse the existing expiring task result.
CREATE FUNCTION journey_hub.care_chat_candidates(c journey_hub.trip_care) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(z.place),'[]'::jsonb) FROM (
 SELECT DISTINCT ON(label->>'id') COALESCE(fresh.place,'{}'::jsonb)||label AS place
 FROM journey_hub.trip_history h
 JOIN journey_hub.trip_history src ON src.user_id=h.user_id AND src.id IN(h.id,h.parent_id)
 JOIN journey_hub.trip_display_snapshots ds ON ds.user_id=src.user_id AND ds.history_id=src.id AND ds.source_updated_at=src.updated_at
 CROSS JOIN LATERAL jsonb_array_elements(ds.payload->'places') label
 LEFT JOIN LATERAL (SELECT p AS place FROM jsonb_array_elements(COALESCE(public.journeyhub_planner_search_result(c.user_id,h.parent_id)->'places','[]'::jsonb))p WHERE p->>'id'=label->>'id' LIMIT 1)fresh ON true
 WHERE c.source_type='history' AND h.id=c.source_id AND h.user_id=c.user_id AND label->>'id'=ANY(src.place_ids)
  AND NOT EXISTS(SELECT FROM journey_hub.calendar_removed_items d WHERE d.user_id=c.user_id AND d.kind='history' AND d.item_id=src.id::text)
 ORDER BY label->>'id',CASE WHEN ds.history_id=h.id THEN 0 ELSE 1 END
 )z
$$;

CREATE FUNCTION public.journeyhub_care_chat_read(p_user_id uuid,p_care_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('care',journey_hub.care_json(c),'conversation',journey_hub.care_chat_conversation(p_user_id,p_care_id))
 FROM journey_hub.trip_care c WHERE c.id=p_care_id AND c.user_id=p_user_id
 AND NOT EXISTS(SELECT FROM journey_hub.calendar_removed_items d WHERE d.user_id=p_user_id AND d.kind=c.source_type AND d.item_id=c.source_id::text)
$$;

CREATE FUNCTION journey_hub.care_chat_adjustment_valid(c journey_hub.trip_care,p_proposal jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h journey_hub.trip_history;selected text[];original text[];allowed text[];candidate_ids text[];replacements jsonb;proposed jsonb;added text[];removed text[];
BEGIN
 SELECT * INTO h FROM journey_hub.trip_history WHERE user_id=c.user_id AND id=c.source_id AND c.source_type='history';
 IF h.id IS NULL THEN RETURN false;END IF;
 proposed:=journey_hub.care_chat_schedule(p_proposal->'plan');replacements:=COALESCE(p_proposal->'replacements','[]'::jsonb);
 SELECT COALESCE(array_agg(s->>'id'),'{}'::text[]) INTO selected FROM jsonb_array_elements(proposed->'stops')s;
 SELECT COALESCE(array_agg(s->>'id'),'{}'::text[]) INTO original FROM jsonb_array_elements(c.plan->'stops')s;
 SELECT COALESCE(array_agg(s->>'id'),'{}'::text[]) INTO candidate_ids FROM jsonb_array_elements(journey_hub.care_chat_candidates(c))s;
 SELECT array_agg(DISTINCT x) INTO allowed FROM unnest(h.place_ids||candidate_ids||original)x;
 IF journey_hub.trip_history_payload_valid(c.input,allowed,selected,'{}'::text[],proposed) IS DISTINCT FROM true
  OR cardinality(selected)<>cardinality(original)
  OR (SELECT count(DISTINCT s->>'dayIndex') FROM jsonb_array_elements(proposed->'stops')s)<>(c.input->>'days')::int
  OR EXISTS(SELECT FROM (SELECT s,lag(s->>'end')OVER(PARTITION BY s->>'dayIndex' ORDER BY s->>'start')prev FROM jsonb_array_elements(proposed->'stops')s)z WHERE z.prev>z.s->>'start') THEN RETURN false;END IF;
 SELECT COALESCE(array_agg(x),'{}'::text[]) INTO added FROM unnest(selected)x WHERE NOT x=ANY(original);
 SELECT COALESCE(array_agg(x),'{}'::text[]) INTO removed FROM unnest(original)x WHERE NOT x=ANY(selected);
 IF jsonb_typeof(replacements) IS DISTINCT FROM 'array' OR jsonb_array_length(replacements)<>cardinality(added) OR cardinality(added)<>cardinality(removed) THEN RETURN false;END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(replacements)r WHERE jsonb_typeof(r)<>'object' OR NOT(r ?& ARRAY['fromId','toId'])
  OR NOT(r->>'fromId'=ANY(removed)) OR NOT(r->>'toId'=ANY(added)) OR NOT(r->>'toId'=ANY(candidate_ids)))
  OR (SELECT count(DISTINCT r->>'fromId') FROM jsonb_array_elements(replacements)r)<>cardinality(removed)
  OR (SELECT count(DISTINCT r->>'toId') FROM jsonb_array_elements(replacements)r)<>cardinality(added) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION public.journeyhub_care_chat_start(p_user_id uuid,p_care_id uuid,p_request_id uuid,p_message text,p_day_index integer DEFAULT NULL) RETURNS jsonb
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
  INSERT INTO journey_hub.care_chat_requests(user_id,care_id,request_id,message,day_index)VALUES(p_user_id,p_care_id,p_request_id,btrim(p_message),p_day_index);
  -- A new question supersedes the previous unapplied suggestion.
  UPDATE journey_hub.trip_care SET proposal=NULL,updated_at=clock_timestamp() WHERE id=p_care_id;
 END IF;
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

CREATE FUNCTION public.journeyhub_care_chat_claim(p_user_id uuid,p_care_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;r journey_hub.care_chat_requests;
BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id FOR UPDATE;
 IF c.id IS NULL OR c.status<>'active' OR public.journeyhub_care_chat_read(p_user_id,p_care_id) IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO r FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id AND request_id=p_request_id FOR UPDATE;
 IF r.request_id IS NULL OR r.status NOT IN('pending','running') OR (r.lease_until IS NOT NULL AND r.lease_until>now()) THEN RETURN NULL;END IF;
 IF r.attempts>=3 THEN
  UPDATE journey_hub.care_chat_requests SET status='failed',failure='This request could not finish. Please send a new message.',lease=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id AND request_id=p_request_id;RETURN NULL;
 END IF;
 UPDATE journey_hub.care_chat_requests SET status='running',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',claimed_revision=c.revision,updated_at=clock_timestamp()
 WHERE user_id=p_user_id AND request_id=p_request_id RETURNING * INTO r;
 RETURN jsonb_build_object('lease',r.lease,'care',journey_hub.care_json(c),'conversation',journey_hub.care_chat_conversation(p_user_id,p_care_id),'alternatives',journey_hub.care_chat_candidates(c),
 'request',jsonb_build_object('requestId',r.request_id,'message',r.message,'dayIndex',r.day_index,'revision',r.claimed_revision));
END $$;

CREATE FUNCTION public.journeyhub_care_chat_complete(p_user_id uuid,p_care_id uuid,p_request_id uuid,p_lease uuid,p_response text,p_proposal jsonb DEFAULT NULL,p_events jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;r journey_hub.care_chat_requests;labels jsonb;enriched jsonb;
BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id FOR UPDATE;
 SELECT * INTO r FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id AND request_id=p_request_id FOR UPDATE;
 IF c.id IS NULL OR r.request_id IS NULL OR r.status<>'running' OR r.lease IS DISTINCT FROM p_lease OR r.lease_until<=now() THEN RETURN NULL;END IF;
 IF c.status<>'active' OR c.revision<>r.claimed_revision OR public.journeyhub_care_chat_read(p_user_id,p_care_id) IS NULL THEN
  UPDATE journey_hub.care_chat_requests SET status='failed',failure='The trip changed while I was checking. Retry with the latest schedule.',lease=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id AND request_id=p_request_id;
  RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
 END IF;
 IF p_response IS NULL OR length(btrim(p_response)) NOT BETWEEN 1 AND 8000 OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events)>12 OR octet_length(p_events::text)>12000 THEN RAISE EXCEPTION 'CARE_CHAT_INVALID';END IF;
 IF p_proposal IS NOT NULL THEN
  IF jsonb_typeof(p_proposal) IS DISTINCT FROM 'object' OR octet_length(p_proposal::text)>120000 OR (p_proposal->>'revision')::int IS DISTINCT FROM c.revision OR p_proposal->>'id' IS NULL OR (p_proposal->>'expiresAt')::timestamptz<=now() OR (p_proposal->>'expiresAt')::timestamptz>now()+interval '2 hours' THEN RAISE EXCEPTION 'CARE_CHAT_INVALID';END IF;
  IF p_proposal->>'canApply'='true' AND NOT journey_hub.care_chat_adjustment_valid(c,p_proposal) THEN RAISE EXCEPTION 'CARE_UNSAFE_ADJUSTMENT';END IF;
  enriched:=p_proposal->'plan';
  -- Persist canonical labels only, sourced from saved candidate snapshots.
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',p->>'id','name',p->>'name','kind',p->>'kind','category',p->>'category','reason',p->>'reason'))),'[]'::jsonb)
   INTO labels FROM jsonb_array_elements(journey_hub.care_chat_candidates(c))p WHERE EXISTS(SELECT FROM jsonb_array_elements(COALESCE(p_proposal#>'{plan,stops}','[]'::jsonb))s WHERE s->>'id'=p->>'id');
  p_proposal:=jsonb_set(p_proposal,'{places}',labels);
  IF p_proposal->>'canApply'='true' THEN
   INSERT INTO journey_hub.care_chat_place_cache(care_id,user_id,proposal_id,revision,payload)
    VALUES(c.id,p_user_id,(p_proposal->>'id')::uuid,c.revision,jsonb_build_object('plan',enriched))
    ON CONFLICT(care_id)DO UPDATE SET user_id=EXCLUDED.user_id,proposal_id=EXCLUDED.proposal_id,revision=EXCLUDED.revision,accepted=false,payload=EXCLUDED.payload,expires_at=now()+interval '1 hour';
  END IF;
  IF jsonb_typeof(enriched->'stops')='array' THEN p_proposal:=jsonb_set(p_proposal,'{plan}',journey_hub.care_chat_schedule(enriched));END IF;
  PERFORM public.journeyhub_care_update(p_user_id,p_care_id,c.revision,NULL,p_proposal);
 ELSE
  UPDATE journey_hub.trip_care SET proposal=NULL,updated_at=clock_timestamp() WHERE id=c.id;
 END IF;
 UPDATE journey_hub.care_chat_requests SET status='completed',response=btrim(p_response),events=p_events,lease=NULL,lease_until=NULL,failure=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id AND request_id=p_request_id;
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

CREATE FUNCTION public.journeyhub_care_chat_fail(p_user_id uuid,p_care_id uuid,p_request_id uuid,p_lease uuid,p_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE journey_hub.care_chat_requests SET status='failed',failure=left(COALESCE(p_message,'The request did not finish. Please retry.'),500),lease=NULL,lease_until=NULL,updated_at=clock_timestamp()
 WHERE user_id=p_user_id AND care_id=p_care_id AND request_id=p_request_id AND status='running' AND lease=p_lease AND lease_until>now();
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

CREATE OR REPLACE FUNCTION public.journeyhub_care_accept(p_user_id uuid,p_id uuid,p_proposal_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care; h journey_hub.trip_history; proposed jsonb; selected text[]; blocked boolean;accepted_labels jsonb;
BEGIN
 -- Same lock order as quote approval. A booking created while a proposal was
 -- being reviewed is rechecked here, not trusted from the earlier preview.
 PERFORM journey_hub.demo_wallet_lock(p_user_id);
 SELECT h2.* INTO h FROM journey_hub.trip_history h2 JOIN journey_hub.trip_care x ON x.source_type='history' AND x.source_id=h2.id AND x.user_id=h2.user_id
  WHERE x.id=p_id AND x.user_id=p_user_id FOR UPDATE OF h2;
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF h.id IS NULL OR c.id IS NULL OR c.status<>'active' OR c.proposal IS NULL OR c.proposal->>'id'<>p_proposal_id::text
  OR (c.proposal->>'canApply') IS DISTINCT FROM 'true' OR (c.proposal->>'revision')::int IS DISTINCT FROM c.revision OR COALESCE((c.proposal->>'expiresAt')::timestamptz,'-infinity'::timestamptz)<=now()
  OR EXISTS(SELECT FROM journey_hub.calendar_removed_items d WHERE d.user_id=p_user_id AND d.kind='history' AND d.item_id=h.id::text) THEN RAISE EXCEPTION 'CARE_PROPOSAL_STALE';END IF;
 proposed:=journey_hub.care_chat_schedule(c.proposal->'plan');
 IF NOT journey_hub.care_chat_adjustment_valid(c,c.proposal) THEN RAISE EXCEPTION 'CARE_UNSAFE_ADJUSTMENT';END IF;
 SELECT EXISTS(SELECT FROM journey_hub.bookings b JOIN journey_hub.travelers t ON t.traveler_id=b.traveler_id
  CROSS JOIN LATERAL jsonb_array_elements(c.plan->'stops')old_stop
  LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(proposed->'stops')p WHERE p->>'id'=old_stop->>'id')new_stop ON true
  WHERE t.auth_user_id=p_user_id AND b.source_type=c.source_type AND b.source_id=c.source_id AND b.stop_id=old_stop->>'id' AND b.status IN('confirmed','checked_in')
   AND (old_stop->>'dayIndex',old_stop->>'start',old_stop->>'end') IS DISTINCT FROM (new_stop.value->>'dayIndex',new_stop.value->>'start',new_stop.value->>'end')) INTO blocked;
 IF blocked THEN RAISE EXCEPTION 'CARE_RESERVATION_PROTECTED';END IF;
 SELECT jsonb_build_object('schemaVersion',1,'places',jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',p->>'id','name',p->>'name','kind',p->>'kind','category',p->>'category','reason',p->>'reason'))))
 INTO accepted_labels FROM jsonb_array_elements(journey_hub.care_chat_candidates(c))p WHERE EXISTS(SELECT FROM jsonb_array_elements(proposed->'stops')s WHERE s->>'id'=p->>'id');
 IF journey_hub.trip_display_snapshot_valid(accepted_labels) THEN
  INSERT INTO journey_hub.care_chat_labels(care_id,user_id,payload)VALUES(c.id,c.user_id,accepted_labels)
  ON CONFLICT(care_id)DO UPDATE SET payload=EXCLUDED.payload;
 END IF;
 UPDATE journey_hub.trip_care SET plan=proposed,revision=revision+1,proposal=NULL,checked_at=NULL,check_claimed_at=NULL,worker_claimed_at=NULL,updated_at=now()WHERE id=c.id RETURNING * INTO c;
 UPDATE journey_hub.care_chat_place_cache SET accepted=true,revision=c.revision WHERE care_id=c.id AND user_id=c.user_id AND proposal_id=p_proposal_id AND expires_at>now();
 INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind)VALUES(c.id,'adjustment:'||c.revision,'adjustment_accepted');
 RETURN journey_hub.care_json(c);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb),public.journeyhub_care_accept(uuid,uuid,uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb),public.journeyhub_care_accept(uuid,uuid,uuid)TO service_role;


CREATE OR REPLACE FUNCTION journey_hub.care_json(c journey_hub.trip_care) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',c.id,'sourceId',c.source_id,'sourceType',c.source_type,'input',c.input,'plan',journey_hub.care_chat_cached_plan(c),'revision',c.revision,
 'status',c.status,'confirmedAt',c.confirmed_at,'checkedAt',c.checked_at,'checks',c.checks,'proposal',c.proposal,
 'run',CASE WHEN c.source_type='run' THEN journey_hub.agent_view(c.source_id) ELSE NULL END,
 'places',COALESCE((SELECT jsonb_agg(z.label) FROM (
  SELECT DISTINCT ON (labels.label->>'id') labels.label FROM (
  SELECT label,CASE WHEN ds.history_id=h.id THEN 1 ELSE 2 END AS priority FROM journey_hub.trip_history h
  JOIN journey_hub.trip_display_snapshots ds ON ds.user_id=h.user_id AND ds.history_id IN(h.id,h.parent_id)
  CROSS JOIN LATERAL jsonb_array_elements(ds.payload->'places') label
  WHERE c.source_type='history' AND h.id=c.source_id AND h.user_id=c.user_id
   AND (label->>'id'=ANY(h.place_ids) OR EXISTS(SELECT FROM jsonb_array_elements(c.plan->'stops')p WHERE p->>'id'=label->>'id'))
  UNION ALL SELECT label,0 FROM journey_hub.care_chat_labels cl CROSS JOIN LATERAL jsonb_array_elements(cl.payload->'places')label WHERE cl.care_id=c.id AND cl.user_id=c.user_id
  )labels ORDER BY labels.label->>'id',labels.priority)z),'[]'::jsonb),
 'visitFacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.stop_id,'date',v.visit_date,'state',v.state,'fields',v.facts,'checkedAt',v.checked_at))
  FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id),'[]'::jsonb),
 'canonicalBookings',COALESCE((SELECT jsonb_agg(jsonb_build_object('stopId',COALESCE(b.stop_id,b.session_id),'bookingId',b.booking_id,
  'status',CASE WHEN b.status='confirmed' AND b.checked_in_at IS NOT NULL THEN 'checked_in' ELSE b.status END,
  'paymentStatus',b.payment_status,'simulated',b.demo,'guests',b.guests,'amountMinor',b.amount_cny_minor) ORDER BY b.created_at DESC)
  FROM journey_hub.bookings b JOIN journey_hub.travelers t ON t.traveler_id=b.traveler_id AND t.auth_user_id=c.user_id
  WHERE (b.source_type=c.source_type AND b.source_id=c.source_id) OR (c.source_type='run' AND b.session_id IN(SELECT s->>'sessionId' FROM jsonb_array_elements(c.plan->'stops')s))),'[]'::jsonb),
 'quote',(SELECT journey_hub.demo_quote_json(q) FROM journey_hub.demo_quotes q WHERE q.user_id=c.user_id AND q.source_type=c.source_type AND q.source_id=c.source_id
  AND q.status='quoted' AND q.expires_at>now() AND q.revision=md5(jsonb_build_object('input',c.input,'plan',c.plan)::text) ORDER BY q.created_at DESC LIMIT 1),
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'stopId',e.stop_id,'createdAt',e.created_at) ORDER BY e.id DESC)
  FROM(SELECT * FROM journey_hub.trip_care_events WHERE care_id=c.id ORDER BY id DESC LIMIT 12)e),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION journey_hub.care_json(journey_hub.trip_care) FROM PUBLIC,anon,authenticated,service_role;



CREATE FUNCTION public.journeyhub_care_chat_apply(p_user_id uuid,p_care_id uuid,p_proposal_id uuid,p_request_id uuid) RETURNS jsonb
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
 SELECT day_index INTO day_number FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id AND status='completed' ORDER BY updated_at DESC LIMIT 1;
 PERFORM public.journeyhub_care_accept(p_user_id,p_care_id,p_proposal_id);
 INSERT INTO journey_hub.care_chat_applies(user_id,care_id,request_id,proposal_id,revision,day_index)VALUES(p_user_id,p_care_id,p_request_id,p_proposal_id,c.revision+1,day_number);
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

REVOKE ALL ON FUNCTION journey_hub.care_chat_conversation(uuid,uuid),journey_hub.care_chat_candidates(journey_hub.trip_care),journey_hub.care_chat_adjustment_valid(journey_hub.trip_care,jsonb),journey_hub.care_chat_schedule(jsonb),journey_hub.care_chat_cached_plan(journey_hub.trip_care) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.journeyhub_care_chat_read(uuid,uuid),public.journeyhub_care_chat_start(uuid,uuid,uuid,text,int),public.journeyhub_care_chat_claim(uuid,uuid,uuid),public.journeyhub_care_chat_complete(uuid,uuid,uuid,uuid,text,jsonb,jsonb),public.journeyhub_care_chat_fail(uuid,uuid,uuid,uuid,text),public.journeyhub_care_chat_apply(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_chat_read(uuid,uuid),public.journeyhub_care_chat_start(uuid,uuid,uuid,text,int),public.journeyhub_care_chat_claim(uuid,uuid,uuid),public.journeyhub_care_chat_complete(uuid,uuid,uuid,uuid,text,jsonb,jsonb),public.journeyhub_care_chat_fail(uuid,uuid,uuid,uuid,text),public.journeyhub_care_chat_apply(uuid,uuid,uuid,uuid) TO service_role;
-- Reuse the existing minute cleanup worker; no extra scheduled job.
CREATE OR REPLACE FUNCTION journey_hub.planner_task_cleanup() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 DELETE FROM journey_hub.care_chat_place_cache WHERE expires_at<=now();
 UPDATE journey_hub.planner_tasks SET state='{}',payload='{}',result=NULL,lease_token=NULL,lease_until=NULL,
  status=CASE WHEN status='running'THEN 'failed'ELSE status END,
  error=CASE WHEN status='running'THEN '{"code":"PLANNER_EXPIRED","message":"This planning task expired. Start a new request."}'::jsonb ELSE error END
 WHERE expires_at<=now()AND(state<>'{}'OR payload<>'{}'OR result IS NOT NULL OR status='running');GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
COMMIT;
