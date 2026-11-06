-- Follow-up: prioritize operational signals and suppress synthesized-inventory low-fill alerts.
BEGIN;
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
 -- Synthetic per-traveler inventory is not a business demand signal.
 UPDATE journey_hub.staff_agent_tasks a SET status='resolved',checked_at=now()
 FROM journey_hub.sessions s WHERE a.session_id=s.session_id AND s.is_demo
  AND a.kind='session_attention' AND a.evidence->>'reason'='low_fill' AND a.status<>'resolved';
 FOR r IN SELECT s.*,e.name,e.venue_id,q.confirmed,q.cancelled,q.checked FROM journey_hub.sessions s JOIN journey_hub.experiences e USING(experience_id)
  LEFT JOIN LATERAL(SELECT COALESCE(sum(b.guests)FILTER(WHERE b.status='confirmed'),0)::int confirmed,
   COALESCE(sum(b.guests)FILTER(WHERE b.status='cancelled'),0)::int cancelled,
   COALESCE(sum(b.guests)FILTER(WHERE b.status='confirmed'AND b.checked_in_at IS NOT NULL),0)::int checked FROM journey_hub.bookings b WHERE b.session_id=s.session_id)q ON true
  WHERE s.ends_at>now() AND s.starts_at<now()+interval '7 days' ORDER BY s.starts_at LIMIT 200
 LOOP
  reason_text:=CASE WHEN r.confirmed+r.seats_held_other_channels>r.capacity THEN 'capacity_conflict'
   WHEN r.status<>'open'AND r.confirmed>0 THEN 'closed_with_bookings'
   WHEN r.status='open'AND NOT COALESCE(r.is_demo,false)AND r.starts_at<=now()+interval '72 hours'AND r.confirmed::numeric/r.capacity<0.35 THEN 'low_fill'
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
CREATE OR REPLACE FUNCTION journey_hub.staff_agent(p_action text,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid();sid text;sr text;venue text;t journey_hub.staff_agent_tasks;result jsonb;prepared text;candidate jsonb;dt date;tm time;tz text;counts jsonb;
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
  'events',COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC)FROM(SELECT kind,detail,created_at FROM journey_hub.staff_agent_events WHERE task_id=a.id ORDER BY created_at DESC LIMIT 8)e),'[]'))ORDER BY a.priority,a.updated_at DESC),'[]')INTO result
 FROM (SELECT q.*,CASE WHEN q.status='completed'THEN 3 WHEN q.kind='session_attention'AND q.evidence->>'reason'IN('capacity_conflict','closed_with_bookings')THEN 0 WHEN q.kind='opportunity'THEN 1 ELSE 2 END priority
  FROM journey_hub.staff_agent_tasks q WHERE q.status<>'resolved'AND(sr<>'host'OR(q.kind='session_attention'AND q.venue_id=venue))
  ORDER BY COALESCE(q.acknowledged_until>now(),false),priority,q.updated_at DESC LIMIT 50)a;
 SELECT jsonb_build_object('total',count(*),'opportunities',count(*)FILTER(WHERE kind='opportunity'AND status IN('suggested','draft','approval','attention')AND(acknowledged_until IS NULL OR acknowledged_until<=now())),
  'sessionChecks',count(*)FILTER(WHERE kind='session_attention'AND(acknowledged_until IS NULL OR acknowledged_until<=now())),
  'tracking',count(*)FILTER(WHERE status='tracking'AND(acknowledged_until IS NULL OR acknowledged_until<=now())),
  'acknowledged',count(*)FILTER(WHERE acknowledged_until>now()))INTO counts
 FROM journey_hub.staff_agent_tasks a WHERE a.status<>'resolved'AND(sr<>'host'OR(a.kind='session_attention'AND a.venue_id=venue));
 RETURN jsonb_build_object('tasks',result,'planId',prepared,'checkedAt',now(),'totalCount',(counts->>'total')::int,'returnedCount',jsonb_array_length(result),'counts',counts,'monitoring','Every 5 minutes; also checked when staff open the workspace');
END $$;
SELECT journey_hub.staff_agent_scan();
COMMIT;
