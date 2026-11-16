-- Additive workflow migration. No orders, sessions, historical samples or sold seats change.
BEGIN;
ALTER TABLE journey_hub.session_plans
 ADD COLUMN created_by text REFERENCES journey_hub.staff(staff_id),
 ADD COLUMN submitted_at timestamptz,
 ADD COLUMN return_reason text,
 ADD COLUMN assumptions jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE journey_hub.session_plans DROP CONSTRAINT session_plans_capacity_check;
ALTER TABLE journey_hub.session_plans ADD CONSTRAINT session_plans_capacity_check CHECK(capacity BETWEEN 1 AND 40);

-- Existing coordinators/managers operate the catalogue; hosts operate their assigned venue.
CREATE FUNCTION journey_hub.staff_can_plan(expid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM journey_hub.staff s JOIN journey_hub.experiences e ON e.experience_id=expid
 WHERE s.auth_user_id=auth.uid() AND s.role IN ('coordinator','duty_manager','host')
 AND (s.role<>'host' OR s.venue_id=e.venue_id) AND e.demo_owner_id IS NULL
 AND NOT COALESCE((e.details->>'browseOnly')::boolean,false));
$$;
REVOKE ALL ON FUNCTION journey_hub.staff_can_plan(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION journey_hub.plan_settings(expid text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object('currency','THB','duration',e.duration_min,'timeZone',v.time_zone,
 'price',e.price_thb,'maxCapacity',LEAST(40,COALESCE((e.details->>'maxCapacity')::int,
 (SELECT max(capacity) FROM journey_hub.sessions WHERE experience_id=expid),40)),
 'capacitySource',CASE WHEN e.details ? 'maxCapacity' THEN 'Activity capacity setting' ELSE 'Existing session ceiling (maximum 40); manager must verify suitability' END,
 'hostRate',e.host_payout_rate,'materialCost',e.material_cost_thb,
 'history', (SELECT jsonb_build_object('source','Historical sample: September 2026','bookingRate',sum(booked)::numeric/nullif(sum(seats_offered),0),
 'cancellationRate',sum(cancelled)::numeric/nullif(sum(booked),0),'attendanceRate',sum(attended)::numeric/nullif(sum(booked-cancelled),0))
 FROM journey_hub.activity_weekly_stats WHERE experience_id=expid AND month='2026-09-01'))
 FROM journey_hub.experiences e JOIN journey_hub.venues v USING(venue_id) WHERE e.experience_id=expid;
$$;
REVOKE ALL ON FUNCTION journey_hub.plan_settings(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION journey_hub.plan_command(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = journey_hub, pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); actor staff; p session_plans; src session_plans; act text:=p_payload->>'action';
 expid text; cfg jsonb; dt date; tm time; starts timestamptz; ident text; destination text; msg text;
 cap int; price int; promo int; why text; assumptions_value jsonb; k text; n numeric;
BEGIN
 SELECT * INTO actor FROM staff WHERE auth_user_id=uid;
 IF uid IS NULL OR actor.staff_id IS NULL OR actor.role NOT IN('coordinator','duty_manager','host') THEN
 RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 IF act IS NULL OR act NOT IN('create','new','duplicate','save','submit','withdraw','return','revise','approve') THEN RAISE EXCEPTION 'Invalid session plan action'; END IF;
 IF act<>'create' THEN
 SELECT * INTO p FROM session_plans WHERE plan_id=p_payload->>'id' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session plan not found or unavailable'; END IF;
 IF NOT staff_can_plan(p.experience_id) OR (actor.role<>'duty_manager' AND COALESCE(p.created_by,p.submitted_by) IS DISTINCT FROM actor.staff_id) THEN
 RAISE EXCEPTION 'This plan is outside your authorized scope' USING ERRCODE='42501'; END IF;
 src:=p;
 END IF;
 expid:=CASE WHEN act='create' THEN p_payload->>'exp' ELSE p.experience_id END;
 IF NOT COALESCE(staff_can_plan(expid),false) THEN RAISE EXCEPTION 'Choose a bookable activity within your authorized scope' USING ERRCODE='42501'; END IF;
 cfg:=plan_settings(expid);
 -- Retry of a completed publication returns its real session, never creates another one.
 IF act='approve' THEN
 IF actor.role<>'duty_manager' OR p.submitted_by=actor.staff_id OR p.created_by=actor.staff_id THEN
 RAISE EXCEPTION 'A different authorized Duty Manager must approve this plan' USING ERRCODE='42501'; END IF;
 IF p.status='approved' AND EXISTS(SELECT 1 FROM sessions WHERE session_id=p.created_session_id AND experience_id=p.experience_id) THEN
 RETURN jsonb_build_object('id',p.plan_id,'status',p.status,'createdSessionId',p.created_session_id,'version',p.version); END IF;
 END IF;
 IF act NOT IN('create','new','duplicate') AND (p_payload->>'version')::int IS DISTINCT FROM p.version THEN RAISE EXCEPTION 'Plan changed. Refresh before continuing'; END IF;
 IF act IN('save','submit','withdraw','revise') AND COALESCE(p.created_by,p.submitted_by) IS DISTINCT FROM actor.staff_id THEN
 RAISE EXCEPTION 'Only the owner can edit or submit this plan' USING ERRCODE='42501'; END IF;
 IF act IN('create','new','duplicate') THEN
 -- Serialize new-draft requests and reuse only an untouched, empty draft for this owner/activity.
 PERFORM pg_advisory_xact_lock(hashtextextended('new-plan:'||actor.staff_id||':'||expid,0));
 IF act<>'duplicate' AND NOT (p_payload ? 'date') THEN
 SELECT * INTO p FROM session_plans WHERE created_by=actor.staff_id AND experience_id=expid AND status='draft'
 AND reason='' AND version=1 AND return_reason IS NULL ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('id',p.plan_id,'version',p.version,'status',p.status); END IF;
 END IF;
 dt:=((now() AT TIME ZONE (cfg->>'timeZone'))::date+1); tm:='10:00';
 cap:=LEAST(25,(cfg->>'maxCapacity')::int);price:=(cfg->>'price')::int;promo:=0;why:='';assumptions_value:='{}';
 -- Existing Staff assistant proposals carry explicit dates/parameters. Preserve them.
 IF act='create' AND p_payload ? 'date' THEN
 dt:=(p_payload->>'date')::date;tm:=COALESCE((p_payload->>'startTime')::time,tm);
 cap:=COALESCE((p_payload->>'cap')::int,cap);price:=COALESCE((p_payload->>'price')::int,price);promo:=COALESCE((p_payload->>'promo')::int,0);why:=COALESCE(p_payload->>'reason','');
 END IF;
 IF act='duplicate' THEN cap:=src.capacity;price:=src.price_thb;promo:=src.promo_budget_thb;why:=src.reason;assumptions_value:=src.assumptions;tm:=src.start_time; END IF;
 IF (dt+tm) AT TIME ZONE (cfg->>'timeZone')<=now() OR dt>(now() AT TIME ZONE (cfg->>'timeZone'))::date+365 OR cap NOT BETWEEN 1 AND (cfg->>'maxCapacity')::int OR price NOT BETWEEN 1 AND 1000000 OR promo NOT BETWEEN 0 AND 10000000 OR length(why)>250 THEN RAISE EXCEPTION 'Check draft date, capacity, price and budget';END IF;
 ident:='PLAN-'||upper(replace(gen_random_uuid()::text,'-',''));
 INSERT INTO session_plans(plan_id,experience_id,session_date,start_time,capacity,price_thb,promo_budget_thb,reason,created_by,assumptions)
 VALUES(ident,expid,dt,tm,cap,price,promo,why,actor.staff_id,assumptions_value) RETURNING * INTO p;
 msg:=CASE WHEN act='duplicate' THEN 'Duplicated from '||src.plan_id||'; fresh approval required' ELSE 'New blank draft' END;
 ELSE
 ident:=p.plan_id;
 IF act='save' THEN
 IF p.status<>'draft' THEN RAISE EXCEPTION 'Only drafts can be edited; revise or withdraw first'; END IF;
 dt:=(p_payload->>'date')::date;tm:=(p_payload->>'startTime')::time;
 cap:=(p_payload->>'cap')::int;price:=(p_payload->>'price')::int;promo:=(p_payload->>'promo')::int;why:=btrim(p_payload->>'reason');
 assumptions_value:=COALESCE(p_payload->'assumptions','{}');
 ELSE dt:=p.session_date;tm:=p.start_time;cap:=p.capacity;price:=p.price_thb;promo:=p.promo_budget_thb;why:=p.reason;assumptions_value:=p.assumptions; END IF;
 starts:=(dt+tm) AT TIME ZONE (cfg->>'timeZone');
 IF act IN('save','submit','approve') THEN
 IF starts IS NULL OR starts<=now() OR dt>(now() AT TIME ZONE (cfg->>'timeZone'))::date+365 THEN RAISE EXCEPTION 'Needs rescheduling: choose a future local start within one year'; END IF;
 IF cap IS NULL OR cap<1 OR cap>(cfg->>'maxCapacity')::int OR price IS NULL OR price NOT BETWEEN 1 AND 1000000 OR promo IS NULL OR promo NOT BETWEEN 0 AND 10000000 OR why IS NULL OR length(why)>250 THEN RAISE EXCEPTION 'Check capacity, positive price, budget and reason'; END IF;
 IF act IN('submit','approve') THEN
 IF length(why)<5 THEN RAISE EXCEPTION 'Add a planning reason (5–250 characters)'; END IF;
 FOREACH k IN ARRAY ARRAY['bookingRate','cancellationRate','attendanceRate','hostRate','materialCost'] LOOP
 n:=(assumptions_value->>k)::numeric;
 IF n IS NULL OR n<0 OR n::text IN('NaN','Infinity','-Infinity') OR (k<>'materialCost' AND n>1) OR (k='materialCost' AND n>1000000) THEN RAISE EXCEPTION 'Complete valid forecast assumptions: %',k; END IF;
 END LOOP;
 IF length(btrim(COALESCE(assumptions_value->>'basis','')))<5 THEN RAISE EXCEPTION 'Explain the source of the forecast assumptions'; END IF;
 END IF;
 END IF;
 IF act='save' THEN
 UPDATE session_plans SET session_date=dt,start_time=tm,capacity=cap,price_thb=price,promo_budget_thb=promo,reason=why,assumptions=assumptions_value,version=version+1,updated_at=now() WHERE plan_id=ident RETURNING * INTO p;msg:='Draft saved';
 ELSIF act='submit' AND p.status='draft' THEN
 UPDATE session_plans SET status='submitted',submitted_by=actor.staff_id,submitted_at=now(),approved_by=NULL,version=version+1,updated_at=now() WHERE plan_id=ident RETURNING * INTO p;msg:='Submitted for approval';
 ELSIF act='return' AND p.status='submitted' THEN
 IF actor.role<>'duty_manager' OR p.submitted_by=actor.staff_id THEN RAISE EXCEPTION 'A different authorized Duty Manager must review this plan' USING ERRCODE='42501'; END IF;
 why:=btrim(p_payload->>'returnReason');IF why IS NULL OR length(why) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Explain why the plan is being returned (5–500 characters)'; END IF;
 UPDATE session_plans SET status='withdrawn',return_reason=why,approved_by=NULL,version=version+1,updated_at=now() WHERE plan_id=ident RETURNING * INTO p;msg:='Returned: '||why;
 ELSIF (act='withdraw' AND p.status='submitted') OR (act='revise' AND p.status='withdrawn') THEN
 UPDATE session_plans SET status='draft',approved_by=NULL,version=version+1,updated_at=now() WHERE plan_id=ident RETURNING * INTO p;msg:='Returned to draft; fresh approval required';
 ELSIF act='approve' AND p.status='submitted' THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('session-publish:'||expid||':'||extract(epoch FROM starts)::text,0));
 IF EXISTS(SELECT 1 FROM sessions WHERE experience_id=expid AND starts_at=starts AND status<>'cancelled') THEN RAISE EXCEPTION 'A session already exists for this activity and start'; END IF;
 destination:='S-'||upper(replace(gen_random_uuid()::text,'-',''));
 INSERT INTO sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb,status,seats_held_other_channels)
 VALUES(destination,expid,starts,starts+make_interval(mins=>(cfg->>'duration')::int),cap,price,'open',0);
 UPDATE session_plans SET status='approved',approved_by=actor.staff_id,created_session_id=destination,version=version+1,updated_at=now() WHERE plan_id=ident RETURNING * INTO p;msg:='Approved and published';
 ELSE RAISE EXCEPTION 'Plan status changed; refresh before continuing'; END IF;
 END IF;
 INSERT INTO plan_events(plan_id,staff_id,message) VALUES(p.plan_id,actor.staff_id,msg||' by '||actor.display_name);
 RETURN jsonb_build_object('id',p.plan_id,'status',p.status,'createdSessionId',p.created_session_id,'version',p.version);
END; $$;
REVOKE ALL ON FUNCTION journey_hub.plan_command(jsonb) FROM PUBLIC,anon,authenticated;

ALTER FUNCTION journey_hub.snapshot() RENAME TO snapshot_before_staff_workflow;
REVOKE ALL ON FUNCTION journey_hub.snapshot_before_staff_workflow() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION journey_hub.snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; actor journey_hub.staff; plans jsonb; settings jsonb;
BEGIN
 r:=journey_hub.snapshot_before_staff_workflow();SELECT * INTO actor FROM journey_hub.staff WHERE auth_user_id=auth.uid();
 IF actor.role IN('coordinator','duty_manager','host') THEN
 SELECT COALESCE(jsonb_agg(to_jsonb(p)||jsonb_build_object('submittedName',s.display_name,'startsAt',(p.session_date+p.start_time) AT TIME ZONE v.time_zone,
 'events',COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.at DESC,ev.event_id DESC) FROM journey_hub.plan_events ev WHERE ev.plan_id=p.plan_id),'[]')) ORDER BY p.updated_at DESC),'[]') INTO plans
 FROM journey_hub.session_plans p JOIN journey_hub.experiences e USING(experience_id) JOIN journey_hub.venues v USING(venue_id)
 LEFT JOIN journey_hub.staff s ON s.staff_id=p.submitted_by
 WHERE journey_hub.staff_can_plan(p.experience_id) AND (actor.role='duty_manager' OR COALESCE(p.created_by,p.submitted_by)=actor.staff_id);
 SELECT COALESCE(jsonb_object_agg(e.experience_id,journey_hub.plan_settings(e.experience_id)),'{}') INTO settings FROM journey_hub.experiences e WHERE journey_hub.staff_can_plan(e.experience_id);
 r:=r||jsonb_build_object('sessionPlans',plans,'planningSettings',settings,'staffWorkflowVersion',1);
 IF actor.role='host' THEN
 r:=r||jsonb_build_object('metrics',COALESCE((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('cost',e.material_cost_thb,'price',e.price_thb)) FROM journey_hub.activity_weekly_stats s JOIN journey_hub.experiences e USING(experience_id) WHERE e.venue_id=actor.venue_id),'[]'),
 'liveMetrics',COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(journey_hub.live_metrics()) x WHERE journey_hub.staff_can_plan(x->>'experience_id')),'[]'));
 END IF;
 ELSE r:=r||jsonb_build_object('sessionPlans','[]'::jsonb); END IF;
 RETURN r;
END; $$;
REVOKE ALL ON FUNCTION journey_hub.snapshot() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.snapshot() TO anon,authenticated;
-- Public RPC wrappers are invokers; snapshot itself filters staff-only fields by auth.uid().
COMMIT;
