BEGIN;
-- Saved evidence + a durable observe/propose/approve/verify loop.
-- Uses existing account-owned care, booking, quote, research and label tables.
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
CREATE OR REPLACE FUNCTION public.journeyhub_care_due(p_limit integer DEFAULT 2) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 WITH due AS(SELECT c.id FROM journey_hub.trip_care c WHERE status='active'
  AND (checked_at IS NULL OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at) OR (input->>'date')::date<=(now()AT TIME ZONE CASE input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date+1)
  AND (input->>'date')::date+COALESCE((input->>'days')::int,1)>(now()AT TIME ZONE CASE input->>'city'WHEN 'Bangkok'THEN 'Asia/Bangkok'WHEN 'Shanghai'THEN 'Asia/Shanghai'ELSE 'Asia/Singapore'END)::date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours' OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes')
  ORDER BY checked_at NULLS FIRST,id LIMIT greatest(1,least(COALESCE(p_limit,2),2))FOR UPDATE SKIP LOCKED),claimed AS(
  UPDATE journey_hub.trip_care c SET worker_claimed_at=now()FROM due WHERE c.id=due.id RETURNING c.id,c.user_id)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'userId',user_id)),'[]'::jsonb)INTO result FROM claimed;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_due(integer)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_due(integer)TO service_role;
SELECT cron.schedule('journeyhub-trip-place-check','*/10 * * * *',$schedule$
 SELECT net.http_post(url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/journeyhub-care',body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||w.decrypted_secret),timeout_milliseconds:=60000)
 FROM(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret'ORDER BY created_at DESC LIMIT 1)w
 WHERE length(w.decrypted_secret)>=32 AND EXISTS(SELECT FROM journey_hub.trip_care c WHERE status='active'
  AND(checked_at IS NULL OR(input->>'date')::date<=current_date+1 OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))
  AND(input->>'date')::date+COALESCE((input->>'days')::int,1)>=current_date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours' OR EXISTS(SELECT FROM journey_hub.visit_research v WHERE v.owner_id=c.user_id AND v.source_type=c.source_type AND v.trip_id=c.source_id AND v.checked_at>c.checked_at))AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes'));
 $schedule$);

-- Persisted staff assistant: observe -> prepare draft -> human approval -> verify publication.
-- Existing forecasting constants and plan_command remain authoritative and unchanged.
CREATE TABLE IF NOT EXISTS journey_hub.staff_agent_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN('opportunity','session_attention')),
 status text NOT NULL DEFAULT 'suggested' CHECK(status IN('suggested','draft','approval','tracking','completed','attention','resolved')),
 title text NOT NULL, summary text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}',
 proposal jsonb, plan_id text REFERENCES journey_hub.session_plans(plan_id), session_id text REFERENCES journey_hub.sessions(session_id),
 venue_id text REFERENCES journey_hub.venues(venue_id), acknowledged_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE journey_hub.staff_agent_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.staff_agent_tasks FROM PUBLIC,anon,authenticated;
CREATE POLICY staff_agent_tasks_internal ON journey_hub.staff_agent_tasks TO service_role USING(true) WITH CHECK(true);
CREATE INDEX IF NOT EXISTS staff_agent_tasks_plan_idx ON journey_hub.staff_agent_tasks(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_agent_tasks_session_idx ON journey_hub.staff_agent_tasks(session_id) WHERE session_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS journey_hub.staff_agent_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id uuid NOT NULL REFERENCES journey_hub.staff_agent_tasks ON DELETE CASCADE,
 actor_id text REFERENCES journey_hub.staff(staff_id), kind text NOT NULL, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE journey_hub.staff_agent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.staff_agent_events FROM PUBLIC,anon,authenticated;
CREATE POLICY staff_agent_events_internal ON journey_hub.staff_agent_events TO service_role USING(true) WITH CHECK(true);
CREATE INDEX IF NOT EXISTS staff_agent_events_task_idx ON journey_hub.staff_agent_events(task_id,created_at DESC);

CREATE OR REPLACE FUNCTION journey_hub.staff_agent_forecast(cap integer,price integer,promo integer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH b AS(SELECT round(cap*0.917)::int booked),p AS(SELECT booked,round(booked*(1-0.091))::int paid FROM b),
 a AS(SELECT booked,paid,round(paid*0.92)::int att FROM p),f AS(SELECT *,paid*price rec,paid*price*0.5 pay,att*250 mat FROM a)
 SELECT jsonb_build_object('booked',booked,'paid',paid,'att',att,'rec',rec,'pay',pay,'mat',mat,'con',rec-pay-mat-promo,
 'margin',CASE WHEN rec>0 THEN (rec-pay-mat-promo)/rec*100 ELSE 0 END,'diff',rec-pay-mat-promo-11750) FROM f
$$;
REVOKE ALL ON FUNCTION journey_hub.staff_agent_forecast(integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION journey_hub.staff_agent_scan() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;t journey_hub.staff_agent_tasks;hist jsonb;live jsonb;dt date;tm time;tz text;ven text;price integer;cap integer;target timestamptz;forecast jsonb;candidate jsonb;
 state_text text;summary_text text;reason_text text;confirmed integer;cancelled integer;checked integer;val bigint;seats integer;tracked jsonb;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('journeyhub-staff-agent-scan',0)) THEN RETURN;END IF;
 -- Preserve completed missions, then make room for the next opportunity.
 UPDATE journey_hub.staff_agent_tasks SET task_key='completed:'||id::text
 WHERE task_key='next-craft-session' AND status='completed';
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.contribution_thb DESC),'[]') INTO hist FROM(
  SELECT m.experience_id,m.name,m.month,m.seats_filled_pct,m.contribution_thb,m.receipts_thb,
   round(100.0*m.contribution_thb/NULLIF(m.receipts_thb,0),1) contribution_margin_pct,m.sessions
  FROM journey_hub.v_activity_month m WHERE m.month='2026-09-01' AND m.experience_id IN('craft','silk','herbal')
 ) x;
 SELECT v.time_zone,e.venue_id,greatest(1000,least(2000,e.price_thb)) INTO tz,ven,price
 FROM journey_hub.experiences e JOIN journey_hub.venues v USING(venue_id) WHERE e.experience_id='craft';
 SELECT jsonb_build_object('confirmed',COALESCE(sum(q.confirmed),0),'capacity',COALESCE(sum(s.capacity),0),
  'sessions',count(*),'heldElsewhere',COALESCE(sum(s.seats_held_other_channels),0),'period','Next 14 days') INTO live
 FROM journey_hub.sessions s LEFT JOIN LATERAL(SELECT COALESCE(sum(b.guests),0) confirmed FROM journey_hub.bookings b WHERE b.session_id=s.session_id AND b.status='confirmed')q ON true
 WHERE s.experience_id='craft' AND s.status='open' AND s.starts_at>now() AND s.starts_at<=now()+interval '14 days';
 -- A single active recommendation prevents duplicate drafts across staff members or retries.
 IF tz IS NOT NULL AND EXISTS(SELECT 1 FROM journey_hub.activity_weekly_stats WHERE experience_id='craft') THEN
  SELECT * INTO t FROM journey_hub.staff_agent_tasks WHERE task_key='next-craft-session' FOR UPDATE;
  IF t.id IS NULL OR t.plan_id IS NULL THEN
   cap:=CASE WHEN (live->>'capacity')::int>0 AND (live->>'confirmed')::numeric/(live->>'capacity')::numeric>=0.8 THEN 30 ELSE 25 END;
   SELECT x.d,x.t,(x.d+x.t)AT TIME ZONE tz INTO dt,tm,target FROM(
    SELECT ((now() AT TIME ZONE tz)::date+g)::date d,k.t FROM generate_series(7,365) g CROSS JOIN (VALUES(time '10:00'),(time '14:00'))k(t)
   )x WHERE NOT EXISTS(SELECT 1 FROM journey_hub.sessions s WHERE s.experience_id='craft' AND s.starts_at=(x.d+x.t)AT TIME ZONE tz AND s.status<>'cancelled')
   AND NOT EXISTS(SELECT 1 FROM journey_hub.session_plans p WHERE p.experience_id='craft' AND p.session_date=x.d AND p.start_time=x.t AND p.status IN('draft','submitted')) ORDER BY x.d,x.t LIMIT 1;
   IF dt IS NOT NULL THEN
    forecast:=journey_hub.staff_agent_forecast(cap,price,0);
    summary_text:=CASE WHEN cap=30 THEN 'Upcoming craft sessions are at least 80% booked. Review an extra capacity scenario.'
      WHEN (live->>'sessions')::int=0 THEN 'No craft session is open in the next 14 days. Review a new session using the historical baseline.'
      ELSE 'Compare a future craft scenario with current demand before committing. Live bookings do not yet justify expansion.' END;
    reason_text:=CASE WHEN cap=30 THEN 'Agent review: strong live demand; compare extra capacity against the September historical baseline.' ELSE 'Agent scenario based on September history. Review live demand before publishing; forecast is not guaranteed sales.' END;
    candidate:=jsonb_build_object('exp','craft','date',dt,'startTime',to_char(tm,'HH24:MI'),'cap',cap,'price',price,'promo',0,'reason',reason_text,'forecast',forecast,
      'scenarios',(SELECT jsonb_agg(jsonb_build_object('cap',c,'price',price,'promo',0,'forecast',journey_hub.staff_agent_forecast(c,price,0))ORDER BY c) FROM (VALUES(20),(25),(30))q(c)));
    INSERT INTO journey_hub.staff_agent_tasks(task_key,kind,status,title,summary,evidence,proposal,venue_id)
    VALUES('next-craft-session','opportunity','suggested','Next session opportunity',summary_text,jsonb_build_object('historical',hist,'live',live,'basis','September 2026 sample history; current canonical bookings'),candidate,ven)
    ON CONFLICT(task_key)DO UPDATE SET title=excluded.title,summary=excluded.summary,evidence=excluded.evidence,proposal=excluded.proposal,checked_at=now(),updated_at=CASE WHEN staff_agent_tasks.proposal IS DISTINCT FROM excluded.proposal THEN now() ELSE staff_agent_tasks.updated_at END;
   END IF;
  END IF;
 END IF;
 -- Verify the exact canonical plan and published session, then follow bookings on that session.
 FOR r IN SELECT a.id,a.status old_status,p.*,s.status session_status,s.starts_at,s.ends_at,s.capacity published_capacity,s.price_thb published_price,s.seats_held_other_channels
  FROM journey_hub.staff_agent_tasks a JOIN journey_hub.session_plans p ON p.plan_id=a.plan_id LEFT JOIN journey_hub.sessions s ON s.session_id=p.created_session_id
 LOOP
  SELECT COALESCE(sum(b.guests)FILTER(WHERE b.status='confirmed'),0),COALESCE(sum(b.guests)FILTER(WHERE b.status='cancelled'),0),
   COALESCE(sum(b.guests)FILTER(WHERE b.status='confirmed'AND b.checked_in_at IS NOT NULL),0),COALESCE(sum(b.guests*b.unit_price_thb)FILTER(WHERE b.status='confirmed'),0)
  INTO confirmed,cancelled,checked,val FROM journey_hub.bookings b WHERE b.session_id=r.created_session_id;
  state_text:=CASE WHEN r.status='draft' THEN 'draft' WHEN r.status='submitted' THEN 'approval' WHEN r.status='approved' AND r.session_status='open' THEN CASE WHEN r.ends_at<now() THEN 'completed' ELSE 'tracking' END ELSE 'attention' END;
  summary_text:=CASE state_text WHEN 'draft' THEN 'Draft prepared. Review the date and forecast, then submit it for a different manager to approve.'
   WHEN 'approval' THEN 'Awaiting a different duty manager. Nothing is published until approval.'
   WHEN 'tracking' THEN 'Publication verified in the traveler catalogue. Live bookings and cancellations are being tracked.'
   WHEN 'completed' THEN 'Session ended. Compare the recorded bookings and attendance with the forecast.'
   ELSE 'The published session is unavailable or the plan changed. Staff review is required.' END;
  tracked:=jsonb_build_object('planStatus',r.status,'submittedBy',r.submitted_by,'approvedBy',r.approved_by,'planVersion',r.version,
   'date',r.session_date,'startTime',to_char(r.start_time,'HH24:MI'),'cap',r.capacity,'price',r.price_thb,'promo',r.promo_budget_thb,
   'forecast',journey_hub.staff_agent_forecast(r.capacity,r.price_thb,r.promo_budget_thb),'published',r.status='approved'AND r.session_status='open',
   'sessionStatus',r.session_status,'confirmed',confirmed,'cancelled',cancelled,'checkedIn',checked,'bookedValueThb',val,'seatsLeft',greatest(0,COALESCE(r.published_capacity,0)-COALESCE(r.seats_held_other_channels,0)-confirmed),
   'bookings',COALESCE((SELECT jsonb_agg(to_jsonb(x))FROM(SELECT booking_id AS id,status,guests FROM journey_hub.bookings b WHERE b.session_id=r.created_session_id ORDER BY b.created_at DESC LIMIT 20)x),'[]'));
  UPDATE journey_hub.staff_agent_tasks SET status=state_text,summary=summary_text,session_id=r.created_session_id,
   evidence=jsonb_set(evidence,'{outcome}',tracked),checked_at=now(),updated_at=CASE WHEN status<>state_text THEN now() ELSE updated_at END WHERE id=r.id;
  IF r.old_status<>state_text THEN INSERT INTO journey_hub.staff_agent_events(task_id,kind,detail)VALUES(r.id,state_text,summary_text);END IF;
 END LOOP;
 -- Bounded operational checks; they never cancel, reprice or edit an existing reservation.
 FOR r IN SELECT s.*,e.name,e.venue_id,q.confirmed,q.cancelled,q.checked FROM journey_hub.sessions s JOIN journey_hub.experiences e USING(experience_id)
  LEFT JOIN LATERAL(SELECT COALESCE(sum(b.guests)FILTER(WHERE b.status='confirmed'),0)::int confirmed,
   COALESCE(sum(b.guests)FILTER(WHERE b.status='cancelled'),0)::int cancelled,
   COALESCE(sum(b.guests)FILTER(WHERE b.status='confirmed'AND b.checked_in_at IS NOT NULL),0)::int checked FROM journey_hub.bookings b WHERE b.session_id=s.session_id)q ON true
  WHERE s.ends_at>now() AND s.starts_at<now()+interval '7 days' ORDER BY s.starts_at LIMIT 200
 LOOP
  reason_text:=CASE WHEN r.confirmed+r.seats_held_other_channels>r.capacity THEN 'capacity_conflict'
   WHEN r.status<>'open'AND r.confirmed>0 THEN 'closed_with_bookings'
   WHEN r.status='open'AND r.starts_at<=now()+interval '72 hours'AND r.confirmed::numeric/r.capacity<0.35 THEN 'low_fill'
   WHEN r.status='open'AND r.confirmed+r.seats_held_other_channels>=r.capacity THEN 'full' ELSE NULL END;
  IF reason_text IS NOT NULL THEN
   summary_text:=CASE reason_text WHEN 'capacity_conflict' THEN 'Confirmed guests and other-channel holds exceed capacity. Reconcile availability before accepting more bookings.'
    WHEN 'closed_with_bookings' THEN 'This session is not open but still has confirmed guests. Review the roster and contact the affected guests through your usual channel.'
    WHEN 'low_fill' THEN 'This session starts within 72 hours and is below 35% confirmed fill. Review demand and promotion options; existing bookings remain unchanged.'
    ELSE 'No seats remain. Review the roster or prepare a separate session; current bookings remain unchanged.' END;
   INSERT INTO journey_hub.staff_agent_tasks(task_key,kind,status,title,summary,evidence,session_id,venue_id)
   VALUES('session:'||r.session_id,'session_attention','attention',r.name,summary_text,
    jsonb_build_object('reason',reason_text,'confirmed',r.confirmed,'cancelled',r.cancelled,'checkedIn',r.checked,'cap',r.capacity,'held',r.seats_held_other_channels,'startsAt',r.starts_at,'experienceId',r.experience_id),r.session_id,r.venue_id)
   ON CONFLICT(task_key)DO UPDATE SET status='attention',summary=excluded.summary,evidence=excluded.evidence,checked_at=now(),
    acknowledged_until=CASE WHEN staff_agent_tasks.evidence->>'reason'IS DISTINCT FROM excluded.evidence->>'reason' THEN NULL ELSE staff_agent_tasks.acknowledged_until END;
  ELSE UPDATE journey_hub.staff_agent_tasks SET status='resolved',checked_at=now()WHERE task_key='session:'||r.session_id AND status<>'resolved';END IF;
 END LOOP;
 UPDATE journey_hub.staff_agent_tasks a SET status='resolved',checked_at=now() FROM journey_hub.sessions s WHERE a.session_id=s.session_id AND a.kind='session_attention' AND s.ends_at<=now() AND a.status<>'resolved';
END $$;
REVOKE ALL ON FUNCTION journey_hub.staff_agent_scan() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION journey_hub.staff_agent(p_action text,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid();sid text;sr text;venue text;t journey_hub.staff_agent_tasks;result jsonb;prepared text;candidate jsonb;dt date;tm time;tz text;
BEGIN
 SELECT s.staff_id,s.role,s.venue_id INTO sid,sr,venue FROM journey_hub.staff s WHERE s.auth_user_id=uid;
 IF uid IS NULL OR sr IS NULL THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501';END IF;
 IF p_action NOT IN('list','refresh','prepare','acknowledge') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid staff assistant action';END IF;
 PERFORM journey_hub.staff_agent_scan();
 IF p_action IN('prepare','acknowledge') THEN
  SELECT * INTO t FROM journey_hub.staff_agent_tasks WHERE id=p_id FOR UPDATE;
  IF t.id IS NULL OR(sr='host'AND(t.kind<>'session_attention'OR t.venue_id IS DISTINCT FROM venue))THEN RAISE EXCEPTION 'Task unavailable' USING ERRCODE='42501';END IF;
  IF p_action='prepare' THEN
   IF sr NOT IN('coordinator','duty_manager') OR t.kind<>'opportunity' THEN RAISE EXCEPTION 'Coordinator access required' USING ERRCODE='42501';END IF;
   IF t.plan_id IS NOT NULL THEN prepared:=t.plan_id;
   ELSE
    candidate:=t.proposal;SELECT v.time_zone INTO tz FROM journey_hub.experiences e JOIN journey_hub.venues v USING(venue_id)WHERE e.experience_id=candidate->>'exp';
    dt:=(candidate->>'date')::date;tm:=(candidate->>'startTime')::time;
    PERFORM pg_advisory_xact_lock(hashtextextended('staff-agent-draft:'||(candidate->>'exp')||':'||dt::text||':'||tm::text,0));
    IF (dt+tm)AT TIME ZONE tz<=now() THEN RAISE EXCEPTION 'Proposal expired. Refresh the assistant first.';END IF;
    SELECT p.plan_id INTO prepared FROM journey_hub.session_plans p WHERE p.experience_id=candidate->>'exp'AND p.session_date=dt AND p.start_time=tm AND p.status IN('draft','submitted')ORDER BY p.created_at LIMIT 1;
    IF prepared IS NULL THEN result:=journey_hub.plan_command((candidate-'forecast'-'scenarios')||jsonb_build_object('action','create'));prepared:=result->>'id';END IF;
    UPDATE journey_hub.staff_agent_tasks SET plan_id=prepared,status='draft',acknowledged_until=NULL,updated_at=now()WHERE id=t.id;
    INSERT INTO journey_hub.staff_agent_events(task_id,actor_id,kind,detail)VALUES(t.id,sid,'draft_prepared','An editable session draft was prepared. Approval and publication still require the normal staff workflow.');
   END IF;
  ELSE
   UPDATE journey_hub.staff_agent_tasks SET acknowledged_until=now()+interval '24 hours',updated_at=now()WHERE id=t.id;
   INSERT INTO journey_hub.staff_agent_events(task_id,actor_id,kind,detail)VALUES(t.id,sid,'acknowledged','Staff acknowledged this item for 24 hours. No reservation was changed.');
  END IF;
  PERFORM journey_hub.staff_agent_scan();
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'status',a.status,'title',a.title,'summary',a.summary,'evidence',a.evidence,
  'proposal',a.proposal,'planId',a.plan_id,'sessionId',a.session_id,'checkedAt',a.checked_at,'acknowledgedUntil',a.acknowledged_until,
  'events',COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC)FROM(SELECT kind,detail,created_at FROM journey_hub.staff_agent_events WHERE task_id=a.id ORDER BY created_at DESC LIMIT 8)e),'[]'))ORDER BY CASE WHEN a.kind='opportunity'THEN 0 ELSE 1 END,a.created_at DESC),'[]')INTO result
 FROM (SELECT * FROM journey_hub.staff_agent_tasks q WHERE q.status<>'resolved'AND(sr<>'host'OR(q.kind='session_attention'AND q.venue_id=venue))
  ORDER BY CASE WHEN q.status='completed' THEN 1 ELSE 0 END,q.updated_at DESC LIMIT 50)a;
 RETURN jsonb_build_object('tasks',result,'planId',prepared,'checkedAt',now(),'monitoring','Every 5 minutes; also checked when staff open the workspace');
END $$;
REVOKE ALL ON FUNCTION journey_hub.staff_agent(text,uuid)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION journey_hub.staff_agent(text,uuid)TO authenticated;
CREATE OR REPLACE FUNCTION public.journeyhub_staff_agent(p_action text DEFAULT 'list',p_id uuid DEFAULT NULL)RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''AS $$SELECT journey_hub.staff_agent(p_action,p_id)$$;
REVOKE ALL ON FUNCTION public.journeyhub_staff_agent(text,uuid)FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.journeyhub_staff_agent(text,uuid)TO authenticated;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  PERFORM cron.unschedule(jobid)FROM cron.job WHERE jobname='journeyhub-staff-agent';
  PERFORM cron.schedule('journeyhub-staff-agent','*/5 * * * *','SELECT journey_hub.staff_agent_scan();');
 END IF;
END $$;

COMMIT;

