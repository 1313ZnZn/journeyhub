-- Saved evidence + a durable observe/propose/approve/verify loop.
-- Uses existing account-owned care, booking, quote, research and label tables.
BEGIN;
CREATE OR REPLACE FUNCTION journey_hub.care_json(c journey_hub.trip_care) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',c.id,'sourceId',c.source_id,'sourceType',c.source_type,'input',c.input,'plan',c.plan,'revision',c.revision,
 'status',c.status,'confirmedAt',c.confirmed_at,'checkedAt',c.checked_at,'checks',c.checks,'proposal',c.proposal,
 'run',CASE WHEN c.source_type='run' THEN journey_hub.agent_view(c.source_id) ELSE NULL END,
 'places',COALESCE((SELECT jsonb_agg(z.label) FROM (
  SELECT DISTINCT ON (label->>'id') label FROM journey_hub.trip_history h
  JOIN journey_hub.trip_display_snapshots ds ON ds.user_id=h.user_id AND ds.history_id IN(h.id,h.parent_id)
  CROSS JOIN LATERAL jsonb_array_elements(ds.payload->'places') label
  WHERE c.source_type='history' AND h.id=c.source_id AND h.user_id=c.user_id
   AND label->>'id'=ANY(h.place_ids)
  ORDER BY label->>'id',CASE WHEN ds.history_id=h.id THEN 0 ELSE 1 END)z),'[]'::jsonb),
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

CREATE OR REPLACE FUNCTION public.journeyhub_care_confirm(p_user_id uuid,p_source_type text,p_source_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;i jsonb;p jsonb;
BEGIN
 IF p_source_type NOT IN('history','run') OR EXISTS(SELECT FROM journey_hub.calendar_removed_items d WHERE d.user_id=p_user_id AND d.kind=p_source_type AND d.item_id=p_source_id::text) THEN RAISE EXCEPTION 'Confirmed trip not found';END IF;
 IF p_source_type='history' THEN
  SELECT input,plan INTO i,p FROM journey_hub.trip_history WHERE id=p_source_id AND user_id=p_user_id AND parent_id IS NOT NULL AND plan IS NOT NULL AND NOT EXISTS(SELECT FROM unnest(place_ids)x WHERE x LIKE 'jh_sample_%');
 ELSE
  SELECT r.input,a.snapshot INTO i,p FROM journey_hub.agent_runs r JOIN journey_hub.agent_approvals a ON a.run_id=r.id AND a.user_id=r.user_id WHERE r.id=p_source_id AND r.user_id=p_user_id AND r.confirmed_at IS NOT NULL;
 END IF;
 IF i IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Confirmed trip not found';END IF;
 IF ((i->>'date')::date+COALESCE((i->>'days')::int,1)) <= (now() AT TIME ZONE CASE i->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date THEN RAISE EXCEPTION 'Trip date has passed';END IF;
 INSERT INTO journey_hub.trip_care(user_id,source_type,source_id,input,plan) VALUES(p_user_id,p_source_type,p_source_id,i,p) ON CONFLICT(user_id,source_type,source_id)DO NOTHING;
 SELECT * INTO c FROM journey_hub.trip_care WHERE user_id=p_user_id AND source_type=p_source_type AND source_id=p_source_id FOR UPDATE;
 IF c.status='paused' THEN
  UPDATE journey_hub.trip_care SET status='active',checked_at=NULL,check_claimed_at=NULL,worker_claimed_at=NULL,updated_at=now()WHERE id=c.id RETURNING * INTO c;
  INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind)VALUES(c.id,'resume:'||clock_timestamp()::text,'monitoring_resumed');
 END IF;
 RETURN journey_hub.care_json(c);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_confirm(uuid,text,uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_confirm(uuid,text,uuid)TO service_role;

CREATE OR REPLACE FUNCTION public.journeyhub_care_update(p_user_id uuid,p_id uuid,p_revision int,p_checks jsonb,p_proposal jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care; next_proposal jsonb;
BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR c.revision<>p_revision OR c.status<>'active' THEN RAISE EXCEPTION 'Care request conflict';END IF;
 next_proposal:=CASE WHEN p_checks IS NOT NULL AND c.proposal IS NOT NULL AND (c.proposal->>'expiresAt')::timestamptz>now() THEN c.proposal ELSE p_proposal END;
 UPDATE journey_hub.trip_care SET checks=COALESCE(p_checks,checks),checked_at=CASE WHEN p_checks IS NOT NULL THEN now()ELSE checked_at END,
  proposal=next_proposal,updated_at=now()WHERE id=c.id RETURNING * INTO c;
 IF p_checks IS NOT NULL THEN
  INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind) VALUES(c.id,'check:'||c.revision||':'||floor(extract(epoch FROM now())/300)::text,'readiness_checked') ON CONFLICT DO NOTHING;
 END IF;
 IF next_proposal IS NOT NULL THEN
  INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind) VALUES(c.id,'proposal:'||(next_proposal->>'id'),'proposal_prepared') ON CONFLICT DO NOTHING;
 END IF;
 RETURN journey_hub.care_json(c);
END $$;

CREATE OR REPLACE FUNCTION public.journeyhub_care_accept(p_user_id uuid,p_id uuid,p_proposal_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care; h journey_hub.trip_history; proposed jsonb; selected text[]; blocked boolean;
BEGIN
 -- Same lock order as quote approval. A booking created while a proposal was
 -- being reviewed is rechecked here, not trusted from the earlier preview.
 PERFORM journey_hub.demo_wallet_lock(p_user_id);
 SELECT h2.* INTO h FROM journey_hub.trip_history h2 JOIN journey_hub.trip_care x ON x.source_type='history' AND x.source_id=h2.id AND x.user_id=h2.user_id
  WHERE x.id=p_id AND x.user_id=p_user_id FOR UPDATE OF h2;
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF h.id IS NULL OR c.id IS NULL OR c.status<>'active' OR c.proposal IS NULL OR c.proposal->>'id'<>p_proposal_id::text
  OR c.proposal->>'canApply'<>'true' OR (c.proposal->>'revision')::int<>c.revision OR (c.proposal->>'expiresAt')::timestamptz<=now()
  OR EXISTS(SELECT FROM journey_hub.calendar_removed_items d WHERE d.user_id=p_user_id AND d.kind='history' AND d.item_id=h.id::text) THEN RAISE EXCEPTION 'CARE_PROPOSAL_STALE';END IF;
 proposed:=c.proposal->'plan';
 SELECT array_agg(s->>'id') INTO selected FROM jsonb_array_elements(proposed->'stops')s;
 IF NOT journey_hub.trip_history_payload_valid(c.input,h.place_ids,selected,'{}'::text[],proposed)
  OR (SELECT count(DISTINCT s->>'dayIndex') FROM jsonb_array_elements(proposed->'stops')s)<>(c.input->>'days')::int
  OR (SELECT count(*) FROM jsonb_array_elements(proposed->'stops'))<>(SELECT count(*) FROM jsonb_array_elements(c.plan->'stops'))
  OR EXISTS(SELECT FROM jsonb_array_elements(c.plan->'stops')s WHERE NOT(s->>'id'=ANY(selected)))
  OR EXISTS(SELECT FROM (SELECT s,lag(s->>'end')OVER(PARTITION BY s->>'dayIndex' ORDER BY s->>'start')prev FROM jsonb_array_elements(proposed->'stops')s)z WHERE z.prev>z.s->>'start')
 THEN RAISE EXCEPTION 'CARE_UNSAFE_ADJUSTMENT';END IF;
 SELECT EXISTS(SELECT FROM journey_hub.bookings b JOIN journey_hub.travelers t ON t.traveler_id=b.traveler_id
  CROSS JOIN LATERAL jsonb_array_elements(c.plan->'stops')old_stop
  LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(proposed->'stops')p WHERE p->>'id'=old_stop->>'id')new_stop ON true
  WHERE t.auth_user_id=p_user_id AND b.source_type=c.source_type AND b.source_id=c.source_id AND b.stop_id=old_stop->>'id' AND b.status='confirmed'
   AND (old_stop->>'dayIndex',old_stop->>'start',old_stop->>'end') IS DISTINCT FROM (new_stop.value->>'dayIndex',new_stop.value->>'start',new_stop.value->>'end')) INTO blocked;
 IF blocked THEN RAISE EXCEPTION 'CARE_RESERVATION_PROTECTED';END IF;
 UPDATE journey_hub.trip_care SET plan=proposed,revision=revision+1,proposal=NULL,checked_at=NULL,check_claimed_at=NULL,worker_claimed_at=NULL,updated_at=now()WHERE id=c.id RETURNING * INTO c;
 INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind)VALUES(c.id,'adjustment:'||c.revision,'adjustment_accepted');
 RETURN journey_hub.care_json(c);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb),public.journeyhub_care_accept(uuid,uuid,uuid)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb),public.journeyhub_care_accept(uuid,uuid,uuid)TO service_role;

-- Enroll the initial check immediately, then monitor near-travel trips every
-- six hours. Status screens only read saved results and never invoke providers.
CREATE OR REPLACE FUNCTION journey_hub.care_weather_due(c journey_hub.trip_care) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT c.status='active'
 AND (c.input->>'date')::date<=(now()AT TIME ZONE CASE c.input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date+1
 AND EXISTS(SELECT FROM jsonb_array_elements(c.checks)x WHERE x->>'id'='__weather__'
  AND jsonb_typeof(x#>'{forecast,days}')='array' AND jsonb_array_length(x#>'{forecast,days}')>0
  AND CASE WHEN x#>>'{forecast,expiresAt}' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   THEN (x#>>'{forecast,expiresAt}')::timestamptz<=now() ELSE false END)
$$;
REVOKE ALL ON FUNCTION journey_hub.care_weather_due(journey_hub.trip_care) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.journeyhub_care_due(p_limit integer DEFAULT 2) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 WITH due AS(SELECT c.id FROM journey_hub.trip_care c WHERE status='active'
  AND (checked_at IS NULL OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at) OR (input->>'date')::date<=(now()AT TIME ZONE CASE input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date+1)
  AND (input->>'date')::date+COALESCE((input->>'days')::int,1)>(now()AT TIME ZONE CASE input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours' OR journey_hub.care_weather_due(c) OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes')
  ORDER BY checked_at NULLS FIRST,id LIMIT greatest(1,least(COALESCE(p_limit,2),2))FOR UPDATE SKIP LOCKED),claimed AS(
  UPDATE journey_hub.trip_care c SET worker_claimed_at=now()FROM due WHERE c.id=due.id RETURNING c.id,c.user_id)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'userId',user_id)),'[]'::jsonb)INTO result FROM claimed;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_due(integer)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_due(integer)TO service_role;
SELECT cron.schedule('journeyhub-trip-place-check','* * * * *',$schedule$
 SELECT net.http_post(url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/journeyhub-care',body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||w.decrypted_secret),timeout_milliseconds:=60000)
 FROM(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret'ORDER BY created_at DESC LIMIT 1)w
 WHERE length(w.decrypted_secret)>=32 AND EXISTS(SELECT FROM journey_hub.trip_care c WHERE status='active'
  AND(checked_at IS NULL OR(input->>'date')::date<=current_date+1 OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))
  AND(input->>'date')::date+COALESCE((input->>'days')::int,1)>=current_date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours' OR journey_hub.care_weather_due(c) OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes'));
 $schedule$);
COMMIT;

