-- Direct publication; all Staff identities already normalize to the canonical role.
BEGIN;
ALTER TABLE journey_hub.session_plans
 ADD COLUMN published_by text REFERENCES journey_hub.staff(staff_id),
 ADD COLUMN published_at timestamptz;
ALTER TABLE journey_hub.session_plans DROP CONSTRAINT session_plans_check;
ALTER TABLE journey_hub.session_plans ADD CONSTRAINT session_plans_check
 CHECK (status <> 'approved' OR approved_by IS NOT NULL);
-- Preserve original publisher and known event time for historical publications.
UPDATE journey_hub.session_plans p SET published_by=p.approved_by,
 published_at=(SELECT max(e.at) FROM journey_hub.plan_events e
 WHERE e.plan_id=p.plan_id AND e.message LIKE 'Approved%')
 WHERE p.status='approved';
INSERT INTO journey_hub.plan_events(plan_id,staff_id,message)
 SELECT plan_id,COALESCE(submitted_by,created_by),
 'Converted from '||status||' to editable draft for direct Staff publication'
 FROM journey_hub.session_plans WHERE status IN ('submitted','withdrawn');
UPDATE journey_hub.session_plans SET status='draft',version=version+1,updated_at=now()
 WHERE status IN ('submitted','withdrawn');
CREATE OR REPLACE FUNCTION journey_hub.plan_command(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = journey_hub, pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); actor staff; p session_plans; src session_plans; act text:=p_payload->>'action';
 expid text; cfg jsonb; dt date; tm time; starts timestamptz; ident text; destination text; msg text;
 cap int; price int; promo int; why text; assumptions_value jsonb; k text; n numeric;
BEGIN
 SELECT * INTO actor FROM staff WHERE auth_user_id=uid;
 IF uid IS NULL OR actor.staff_id IS NULL OR actor.role NOT IN('coordinator','duty_manager','host') THEN
 RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
 IF act IS NULL OR act NOT IN('create','new','duplicate','save','publish') THEN RAISE EXCEPTION 'Invalid session plan action'; END IF;
 IF act<>'create' THEN
 SELECT * INTO p FROM session_plans WHERE plan_id=p_payload->>'id' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session plan not found or unavailable'; END IF;
 IF NOT staff_can_plan(p.experience_id) THEN
 RAISE EXCEPTION 'This plan is outside your authorized scope' USING ERRCODE='42501'; END IF;
 src:=p;
 END IF;
 expid:=CASE WHEN act='create' THEN p_payload->>'exp' ELSE p.experience_id END;
 IF NOT COALESCE(staff_can_plan(expid),false) THEN RAISE EXCEPTION 'Choose a bookable activity within your authorized scope' USING ERRCODE='42501'; END IF;
 cfg:=plan_settings(expid);
 -- Retry of a completed publication returns its real session, never creates another one.
 IF act='publish' THEN
 -- Every authenticated Staff member may publish, including the creator.
 IF p.status='approved' AND EXISTS(SELECT 1 FROM sessions WHERE session_id=p.created_session_id AND experience_id=p.experience_id) THEN
 RETURN jsonb_build_object('id',p.plan_id,'status',p.status,'createdSessionId',p.created_session_id,'version',p.version); END IF;
 END IF;
 IF act NOT IN('create','new','duplicate') AND (p_payload->>'version')::int IS DISTINCT FROM p.version THEN RAISE EXCEPTION 'Plan changed. Refresh before continuing'; END IF;
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
 msg:=CASE WHEN act='duplicate' THEN 'Duplicated from '||src.plan_id||'; new draft, not published' ELSE 'New blank draft' END;
 ELSE
 ident:=p.plan_id;
 IF act='save' THEN
 IF p.status<>'draft' THEN RAISE EXCEPTION 'Only drafts can be edited; duplicate a published plan to make a new draft'; END IF;
 dt:=(p_payload->>'date')::date;tm:=(p_payload->>'startTime')::time;
 cap:=(p_payload->>'cap')::int;price:=(p_payload->>'price')::int;promo:=(p_payload->>'promo')::int;why:=btrim(p_payload->>'reason');
 assumptions_value:=COALESCE(p_payload->'assumptions','{}');
 ELSE dt:=p.session_date;tm:=p.start_time;cap:=p.capacity;price:=p.price_thb;promo:=p.promo_budget_thb;why:=p.reason;assumptions_value:=p.assumptions; END IF;
 starts:=(dt+tm) AT TIME ZONE (cfg->>'timeZone');
 IF act IN('save','publish') THEN
 IF starts IS NULL OR starts<=now() OR dt>(now() AT TIME ZONE (cfg->>'timeZone'))::date+365 THEN RAISE EXCEPTION 'Needs rescheduling: choose a future local start within one year'; END IF;
 IF cap IS NULL OR cap<1 OR cap>(cfg->>'maxCapacity')::int OR price IS NULL OR price NOT BETWEEN 1 AND 1000000 OR promo IS NULL OR promo NOT BETWEEN 0 AND 10000000 OR why IS NULL OR length(why)>250 THEN RAISE EXCEPTION 'Check capacity, positive price, budget and reason'; END IF;
 IF act='publish' THEN
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
 ELSIF act='publish' AND p.status='draft' THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('session-publish:'||expid||':'||extract(epoch FROM starts)::text,0));
 IF EXISTS(SELECT 1 FROM sessions WHERE experience_id=expid AND starts_at=starts AND status<>'cancelled') THEN RAISE EXCEPTION 'A session already exists for this activity and start'; END IF;
 destination:='S-'||upper(replace(gen_random_uuid()::text,'-',''));
 INSERT INTO sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb,status,seats_held_other_channels)
 VALUES(destination,expid,starts,starts+make_interval(mins=>(cfg->>'duration')::int),cap,price,'open',0);
 UPDATE session_plans SET status='approved',approved_by=actor.staff_id,published_by=actor.staff_id,published_at=now(),created_session_id=destination,version=version+1,updated_at=now() WHERE plan_id=ident RETURNING * INTO p;msg:='Session published';
 ELSE RAISE EXCEPTION 'Plan status changed; refresh before continuing'; END IF;
 END IF;
 INSERT INTO plan_events(plan_id,staff_id,message) VALUES(p.plan_id,actor.staff_id,msg||' by '||actor.display_name);
 RETURN jsonb_build_object('id',p.plan_id,'status',p.status,'createdSessionId',p.created_session_id,'version',p.version);
END; $$;
REVOKE ALL ON FUNCTION journey_hub.plan_command(jsonb) FROM PUBLIC,anon,authenticated;

COMMIT;
