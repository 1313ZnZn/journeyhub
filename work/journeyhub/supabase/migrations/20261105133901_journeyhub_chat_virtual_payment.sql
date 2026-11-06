BEGIN;
ALTER TABLE journey_hub.care_chat_requests ADD COLUMN result jsonb;
ALTER TABLE journey_hub.care_chat_applies ADD COLUMN itineraries jsonb;
CREATE TABLE journey_hub.care_chat_payments (
 user_id uuid NOT NULL REFERENCES auth.users(id)ON DELETE CASCADE,
 care_id uuid NOT NULL REFERENCES journey_hub.trip_care(id)ON DELETE CASCADE,
 request_id uuid NOT NULL,quote_id uuid NOT NULL REFERENCES journey_hub.demo_quotes(id),
 receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,request_id),UNIQUE(care_id,quote_id)
);
ALTER TABLE journey_hub.care_chat_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.care_chat_payments FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION journey_hub.care_chat_payment_receipt(p_user_id uuid,p_quote_id uuid,p_balance integer DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('quoteId',q.id,'currency','CNY','simulated',true,
 'totalMinor',COALESCE((SELECT -sum(l.amount_minor)FROM journey_hub.demo_ledger l WHERE l.user_id=p_user_id AND l.quote_id=q.id AND l.kind='payment'),0),
 'balanceMinor',COALESCE(p_balance,(SELECT l.balance_after_minor FROM journey_hub.demo_ledger l WHERE l.user_id=p_user_id AND l.quote_id=q.id AND l.kind='payment' ORDER BY l.created_at DESC,l.id DESC LIMIT 1),(SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=p_user_id),0),
 'bookingIds',COALESCE((SELECT jsonb_agg(DISTINCT b.booking_id) FROM journey_hub.demo_bookings b WHERE b.user_id=p_user_id AND b.booking_id IS NOT NULL AND (b.quote_id=q.id OR b.booking_id IN(SELECT x->>'bookingId' FROM jsonb_array_elements(q.items)x))),'[]'::jsonb))
 FROM journey_hub.demo_quotes q WHERE q.id=p_quote_id AND q.user_id=p_user_id AND q.status='booked'
$$;

CREATE OR REPLACE FUNCTION journey_hub.care_chat_payment_action(p_user_id uuid,p_care_id uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;q journey_hub.demo_quotes;balance integer;state text;items jsonb;
BEGIN
 IF p_result#>>'{payment,quoteId}' IS NULL THEN RETURN NULL;END IF;
 SELECT *INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id;
 SELECT *INTO q FROM journey_hub.demo_quotes WHERE id=(p_result#>>'{payment,quoteId}')::uuid AND user_id=p_user_id AND source_type=c.source_type AND source_id=c.source_id;
 IF q.id IS NULL THEN RETURN NULL;END IF;
 SELECT COALESCE((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=p_user_id),0)INTO balance;
 state:=CASE WHEN q.status='booked'AND q.total_minor>0 THEN 'paid' WHEN q.status='booked'THEN 'no_payment_needed'
 WHEN q.expires_at<=now()THEN 'expired'
 WHEN q.revision<>md5(jsonb_build_object('input',c.input,'plan',c.plan)::text)THEN 'stale'
 WHEN EXISTS(SELECT FROM jsonb_array_elements(q.items)x WHERE x->>'kind'='unavailable' OR ((x->>'date')||' '||(x->>'start'))::timestamp AT TIME ZONE CASE c.input->>'city'WHEN 'Shanghai'THEN 'Asia/Shanghai'WHEN 'Bangkok'THEN 'Asia/Bangkok'ELSE 'Asia/Singapore'END<=now())THEN 'not_eligible'
 WHEN q.total_minor=0 THEN 'no_payment_needed'
 WHEN balance<q.total_minor THEN 'insufficient_funds' ELSE 'ready' END;
 SELECT jsonb_agg(jsonb_build_object('stopId',x->>'stopId','title',COALESCE(journey_hub.care_chat_snapshot_label(COALESCE(x->>'title',x->>'displayTitle'),160),'Planned visit'),'quantity',x->'quantity','totalMinor',x->'totalMinor',
 'status',CASE WHEN x->>'kind'='unavailable'THEN 'unavailable'WHEN x->>'kind'='free'THEN 'free'
 WHEN EXISTS(SELECT FROM journey_hub.bookings b JOIN journey_hub.travelers t ON t.traveler_id=b.traveler_id AND t.auth_user_id=p_user_id WHERE (b.booking_id=x->>'bookingId' OR (b.source_type=q.source_type AND b.source_id=q.source_id AND b.stop_id=x->>'stopId')) AND b.status='cancelled' AND NOT EXISTS(SELECT FROM journey_hub.bookings active WHERE active.traveler_id=b.traveler_id AND active.source_type=q.source_type AND active.source_id=q.source_id AND active.stop_id=x->>'stopId'AND active.status='confirmed'))THEN 'cancelled'
 WHEN q.status='booked'THEN 'paid'WHEN x->>'bookingId'IS NOT NULL THEN 'already_reserved'ELSE 'ready'END))INTO items FROM jsonb_array_elements(q.items)x;
 RETURN jsonb_build_object('quoteId',q.id,'currency','CNY','totalMinor',q.total_minor,'balanceMinor',balance,'shortfallMinor',greatest(0,q.total_minor-balance),'status',state,'expiresAt',q.expires_at,'items',items,'simulated',true);
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION journey_hub.care_chat_payment_receipt(uuid,uuid,int),journey_hub.care_chat_payment_action(uuid,uuid,jsonb)FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.journeyhub_care_chat_payment(p_user_id uuid,p_care_id uuid,p_request_id uuid,p_quote_id uuid)RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;r journey_hub.care_chat_payments;q journey_hub.demo_quotes;paid jsonb;receipt jsonb;
BEGIN
 IF p_request_id IS NULL OR p_quote_id IS NULL THEN RAISE EXCEPTION 'CARE_CHAT_INVALID';END IF;
 PERFORM journey_hub.demo_wallet_lock(p_user_id);
 PERFORM h.id FROM journey_hub.trip_history h JOIN journey_hub.trip_care x ON x.source_type='history' AND x.source_id=h.id AND x.user_id=h.user_id WHERE x.id=p_care_id AND x.user_id=p_user_id FOR UPDATE OF h;
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id FOR UPDATE;
 IF c.id IS NULL OR public.journeyhub_care_chat_read(p_user_id,p_care_id)IS NULL THEN RAISE EXCEPTION 'CARE_CHAT_NOT_FOUND';END IF;
 SELECT *INTO r FROM journey_hub.care_chat_payments WHERE user_id=p_user_id AND request_id=p_request_id;
 IF r.request_id IS NOT NULL THEN
  IF r.care_id<>p_care_id OR r.quote_id<>p_quote_id THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED';END IF;
  RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
 END IF;
 IF EXISTS(SELECT FROM journey_hub.care_chat_payments WHERE care_id=p_care_id AND quote_id=p_quote_id)THEN RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);END IF;
 SELECT *INTO q FROM journey_hub.demo_quotes WHERE user_id=p_user_id AND id=p_quote_id AND source_type=c.source_type AND source_id=c.source_id;
 IF q.id IS NULL OR NOT EXISTS(SELECT FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id AND status='completed'AND result#>>'{payment,quoteId}'=q.id::text) THEN RAISE EXCEPTION 'DEMO_QUOTE_NOT_FOUND';END IF;
 IF q.total_minor=0 THEN RAISE EXCEPTION 'DEMO_NOT_READY';END IF;
 -- Existing canonical booking RPC owns all final price, funds, expiry, seat and
 -- reservation checks. Any exception rolls back both payment and chat receipt.
 paid:=public.journeyhub_demo_book(p_user_id,p_quote_id,p_request_id);
 receipt:=journey_hub.care_chat_payment_receipt(p_user_id,p_quote_id,(paid#>>'{wallet,balanceMinor}')::int);
 IF receipt IS NULL THEN RAISE EXCEPTION 'DEMO_NOT_READY';END IF;
 INSERT INTO journey_hub.care_chat_payments(user_id,care_id,request_id,quote_id,receipt)VALUES(p_user_id,p_care_id,p_request_id,p_quote_id,receipt);
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_chat_payment(uuid,uuid,uuid,uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_chat_payment(uuid,uuid,uuid,uuid)TO service_role;

CREATE OR REPLACE FUNCTION journey_hub.care_chat_conversation(p_user_id uuid,p_care_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH recent AS (SELECT * FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id ORDER BY created_at DESC LIMIT 40),
 messages AS (
  SELECT created_at AS stamp,0 AS ordinal,jsonb_build_object('id',request_id||':user','role','user','text',message,'dayIndex',day_index,'createdAt',created_at) AS item FROM recent
  UNION ALL SELECT updated_at,1,jsonb_build_object('id',request_id||':assistant','role','assistant','text',response,'dayIndex',day_index,'createdAt',updated_at,'events',events,'paymentAction',journey_hub.care_chat_payment_action(p_user_id,p_care_id,result),'paymentReceipt',result->'receipt') FROM recent WHERE status='completed'
  UNION ALL SELECT created_at,2,jsonb_build_object('id',request_id||':applied','role','assistant','text','Your approved changes are saved. Existing reservations have not been changed.','dayIndex',day_index,'createdAt',created_at,'itinerary',itinerary,'itineraries',itineraries)
    FROM journey_hub.care_chat_applies WHERE user_id=p_user_id AND care_id=p_care_id
  UNION ALL SELECT created_at,3,jsonb_build_object('id',request_id||':payment','role','assistant','text','Virtual payment recorded. Your reservations are saved.','createdAt',created_at,'paymentReceipt',receipt) FROM journey_hub.care_chat_payments WHERE user_id=p_user_id AND care_id=p_care_id
 ) SELECT jsonb_build_object('messages',COALESCE((SELECT jsonb_agg(item ORDER BY stamp,ordinal) FROM messages),'[]'::jsonb),
 'pending',(SELECT CASE WHEN status='completed' THEN NULL ELSE jsonb_build_object('requestId',request_id,'status',status,'dayIndex',day_index,'message',failure,'canRetry',attempts<3) END
   FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id ORDER BY created_at DESC LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION journey_hub.care_chat_adjustment_valid(c journey_hub.trip_care,p_proposal jsonb) RETURNS boolean
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
  OR EXISTS(SELECT FROM jsonb_array_elements(c.plan->'stops')old_day WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(proposed->'stops')new_day WHERE new_day->>'dayIndex'=old_day->>'dayIndex'))
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

DROP FUNCTION public.journeyhub_care_chat_complete(uuid,uuid,uuid,uuid,text,jsonb,jsonb);
CREATE OR REPLACE FUNCTION public.journeyhub_care_chat_complete(p_user_id uuid,p_care_id uuid,p_request_id uuid,p_lease uuid,p_response text,p_proposal jsonb DEFAULT NULL,p_events jsonb DEFAULT '[]',p_result jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;r journey_hub.care_chat_requests;labels jsonb;enriched jsonb;stored_result jsonb;payment_action jsonb;
BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id FOR UPDATE;
 SELECT * INTO r FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id AND request_id=p_request_id FOR UPDATE;
 IF c.id IS NULL OR r.request_id IS NULL OR r.status<>'running' OR r.lease IS DISTINCT FROM p_lease OR r.lease_until<=now() THEN RETURN NULL;END IF;
 IF c.status<>'active' OR c.revision<>r.claimed_revision OR public.journeyhub_care_chat_read(p_user_id,p_care_id) IS NULL THEN
  UPDATE journey_hub.care_chat_requests SET status='failed',failure='The trip changed while I was checking. Retry with the latest schedule.',lease=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id AND request_id=p_request_id;
  RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
 END IF;
 IF p_response IS NULL OR length(btrim(p_response)) NOT BETWEEN 1 AND 8000 OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events)>12 OR octet_length(p_events::text)>12000 THEN RAISE EXCEPTION 'CARE_CHAT_INVALID';END IF;
 IF p_result IS NOT NULL THEN
  IF jsonb_typeof(p_result)IS DISTINCT FROM 'object' OR octet_length(p_result::text)>1000 THEN RAISE EXCEPTION 'CARE_CHAT_INVALID';END IF;
  payment_action:=journey_hub.care_chat_payment_action(p_user_id,p_care_id,p_result);
  IF payment_action IS NULL THEN RAISE EXCEPTION 'DEMO_QUOTE_NOT_FOUND';END IF;
  stored_result:=jsonb_build_object('payment',jsonb_build_object('quoteId',payment_action->>'quoteId'));
  IF payment_action->>'status'='paid' THEN stored_result:=stored_result||jsonb_build_object('receipt',journey_hub.care_chat_payment_receipt(p_user_id,(payment_action->>'quoteId')::uuid));END IF;
 END IF;
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
 UPDATE journey_hub.care_chat_requests SET status='completed',response=btrim(p_response),events=p_events,result=stored_result,lease=NULL,lease_until=NULL,failure=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id AND request_id=p_request_id;
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

REVOKE ALL ON FUNCTION public.journeyhub_care_chat_complete(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_chat_complete(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb)TO service_role;
DROP TRIGGER care_chat_applied_immutable ON journey_hub.care_chat_applies;
CREATE OR REPLACE FUNCTION journey_hub.care_chat_applied_immutable()RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (OLD.itinerary IS NOT NULL AND NEW.itinerary IS DISTINCT FROM OLD.itinerary) OR (OLD.itineraries IS NOT NULL AND NEW.itineraries IS DISTINCT FROM OLD.itineraries) THEN RAISE EXCEPTION 'CARE_CHAT_SNAPSHOT_IMMUTABLE';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION journey_hub.care_chat_applied_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER care_chat_applied_immutable BEFORE UPDATE OF itinerary,itineraries ON journey_hub.care_chat_applies FOR EACH ROW EXECUTE FUNCTION journey_hub.care_chat_applied_immutable();

CREATE OR REPLACE FUNCTION public.journeyhub_care_chat_apply(p_user_id uuid,p_care_id uuid,p_proposal_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;a journey_hub.care_chat_applies;day_number int;day_numbers int[];snapshots jsonb;
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
 SELECT array_agg(DISTINCT day_no ORDER BY day_no) INTO day_numbers FROM (
  SELECT (x->>'dayIndex')::int day_no FROM jsonb_array_elements(c.proposal#>'{plan,stops}')x WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(c.plan->'stops')o WHERE o->>'id'=x->>'id' AND (o->>'dayIndex',o->>'start',o->>'end')=(x->>'dayIndex',x->>'start',x->>'end'))
  UNION SELECT (x->>'dayIndex')::int FROM jsonb_array_elements(c.plan->'stops')x WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(c.proposal#>'{plan,stops}')o WHERE o->>'id'=x->>'id' AND (o->>'dayIndex',o->>'start',o->>'end')=(x->>'dayIndex',x->>'start',x->>'end'))
 )changed_days;
 IF cardinality(day_numbers)=1 THEN day_number:=day_numbers[1];END IF;
 IF day_numbers IS NULL THEN
  IF c.proposal->>'dayIndex'~'^[1-7]$' AND (c.proposal->>'dayIndex')::int<=(c.input->>'days')::int THEN day_number:=(c.proposal->>'dayIndex')::int;ELSE
   SELECT day_index INTO day_number FROM journey_hub.care_chat_requests WHERE user_id=p_user_id AND care_id=p_care_id AND status='completed'ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF day_number IS NOT NULL THEN day_numbers:=ARRAY[day_number];END IF;
 END IF;
 PERFORM public.journeyhub_care_accept(p_user_id,p_care_id,p_proposal_id);
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_care_id AND user_id=p_user_id;
 SELECT jsonb_agg(journey_hub.care_chat_applied_itinerary(c,d)ORDER BY d)INTO snapshots FROM unnest(day_numbers)d;
 INSERT INTO journey_hub.care_chat_applies(user_id,care_id,request_id,proposal_id,revision,day_index,itinerary,itineraries)
 VALUES(p_user_id,p_care_id,p_request_id,p_proposal_id,c.revision,day_number,CASE WHEN jsonb_array_length(snapshots)=1 THEN snapshots->0 END,snapshots);
 RETURN public.journeyhub_care_chat_read(p_user_id,p_care_id);
END $$;

UPDATE journey_hub.care_chat_applies SET itineraries=jsonb_build_array(itinerary)WHERE itineraries IS NULL AND itinerary IS NOT NULL;
COMMIT;
