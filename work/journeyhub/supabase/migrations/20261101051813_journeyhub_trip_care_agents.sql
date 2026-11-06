-- Confirmed-trip care. Persist itinerary structure and derived alerts, never Google place content.
BEGIN;
CREATE TABLE journey_hub.trip_care (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source_type text NOT NULL CHECK(source_type IN ('history','run')), source_id uuid NOT NULL,
 input jsonb NOT NULL, plan jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
 checks jsonb NOT NULL DEFAULT '[]', proposal jsonb, confirmed_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz, check_claimed_at timestamptz, worker_claimed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_type,source_id), CHECK(octet_length(plan::text)<=32768), CHECK(octet_length(checks::text)<=12000),
 CHECK(proposal IS NULL OR octet_length(proposal::text)<=32768)
);
CREATE INDEX trip_care_active ON journey_hub.trip_care(status,updated_at) WHERE status='active';
ALTER TABLE journey_hub.trip_care ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.trip_care FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY trip_care_owner ON journey_hub.trip_care FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE TABLE journey_hub.trip_care_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,care_id uuid NOT NULL REFERENCES journey_hub.trip_care(id) ON DELETE CASCADE,
 event_key text NOT NULL,kind text NOT NULL,stop_id text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(care_id,event_key)
);
ALTER TABLE journey_hub.trip_care_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.trip_care_events FROM PUBLIC,anon,authenticated,service_role;
CREATE POLICY trip_care_events_owner ON journey_hub.trip_care_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM journey_hub.trip_care c WHERE c.id=care_id AND c.user_id=(SELECT auth.uid())));

CREATE FUNCTION journey_hub.care_json(c journey_hub.trip_care) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',c.id,'sourceId',c.source_id,'sourceType',c.source_type,'input',c.input,'plan',c.plan,'revision',c.revision,
 'status',c.status,'confirmedAt',c.confirmed_at,'checkedAt',c.checked_at,'checks',c.checks,'proposal',c.proposal,
 'run',CASE WHEN c.source_type='run' THEN journey_hub.agent_view(c.source_id) ELSE NULL END,
 'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'stopId',e.stop_id,'createdAt',e.created_at) ORDER BY e.id DESC) FROM (SELECT * FROM journey_hub.trip_care_events WHERE care_id=c.id ORDER BY id DESC LIMIT 12)e),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION journey_hub.care_json(journey_hub.trip_care) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.journeyhub_care_confirm(p_user_id uuid,p_source_type text,p_source_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;i jsonb;p jsonb;
BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE user_id=p_user_id AND source_type=p_source_type AND source_id=p_source_id;
 IF FOUND THEN RETURN journey_hub.care_json(c);END IF;
 IF p_source_type='history' THEN
  SELECT input,plan INTO i,p FROM journey_hub.trip_history WHERE id=p_source_id AND user_id=p_user_id AND parent_id IS NOT NULL AND plan IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(place_ids)x WHERE x LIKE 'jh_sample_%');
 ELSIF p_source_type='run' THEN
  SELECT r.input,a.snapshot INTO i,p FROM journey_hub.agent_runs r JOIN journey_hub.agent_approvals a ON a.run_id=r.id AND a.user_id=r.user_id WHERE r.id=p_source_id AND r.user_id=p_user_id AND r.confirmed_at IS NOT NULL;
 ELSE RAISE EXCEPTION 'Invalid care source';END IF;
 IF i IS NULL OR p IS NULL THEN RAISE EXCEPTION 'Confirmed trip not found';END IF;
 IF ((i->>'date')::date+COALESCE((i->>'days')::int,1)) <= (now() AT TIME ZONE CASE i->>'city' WHEN 'Bangkok' THEN 'Asia/Bangkok' WHEN 'Shanghai' THEN 'Asia/Shanghai' ELSE 'Asia/Singapore' END)::date THEN RAISE EXCEPTION 'Trip date has passed';END IF;
 INSERT INTO journey_hub.trip_care(user_id,source_type,source_id,input,plan)VALUES(p_user_id,p_source_type,p_source_id,i,p)ON CONFLICT(user_id,source_type,source_id)DO NOTHING;
 SELECT * INTO c FROM journey_hub.trip_care WHERE user_id=p_user_id AND source_type=p_source_type AND source_id=p_source_id;
 RETURN journey_hub.care_json(c);
END $$;

-- Runs enroll in the same transaction as approval, even if the browser closes immediately.
CREATE FUNCTION journey_hub.care_after_confirm() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
  INSERT INTO journey_hub.trip_care(user_id,source_type,source_id,input,plan)VALUES(NEW.user_id,'run',NEW.id,NEW.input,NEW.plan)ON CONFLICT(user_id,source_type,source_id)DO NOTHING;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION journey_hub.care_after_confirm() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER journeyhub_care_auto_start AFTER UPDATE OF confirmed_at ON journey_hub.agent_runs FOR EACH ROW EXECUTE FUNCTION journey_hub.care_after_confirm();

CREATE FUNCTION journey_hub.care_tick() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;s jsonb;tz text;t timestamptz;sid text;runstatus text;n int:=0;
BEGIN
 FOR c IN SELECT * FROM journey_hub.trip_care WHERE status='active' FOR UPDATE SKIP LOCKED LOOP
  tz:=CASE c.input->>'city' WHEN 'Bangkok' THEN 'Asia/Bangkok' WHEN 'Shanghai' THEN 'Asia/Shanghai' ELSE 'Asia/Singapore' END;
  IF ((c.input->>'date')::date+COALESCE((c.input->>'days')::int,1)) <= (now() AT TIME ZONE tz)::date THEN UPDATE journey_hub.trip_care SET status='completed',updated_at=now()WHERE id=c.id;CONTINUE;END IF;
  IF c.source_type='run' THEN
   SELECT status INTO runstatus FROM journey_hub.agent_runs WHERE id=c.source_id;
   IF runstatus IN ('booked','failed')THEN INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind)VALUES(c.id,'booking:'||runstatus,'booking_'||runstatus)ON CONFLICT DO NOTHING;END IF;
   INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind,stop_id)
    SELECT c.id,'reservation:'||b.booking_id||':'||b.status,'reservation_'||b.status,a.session_id FROM journey_hub.agent_reservations a JOIN journey_hub.bookings b USING(booking_id) WHERE a.run_id=c.source_id AND b.status<>'confirmed' ON CONFLICT DO NOTHING;
  END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(c.plan->'stops') LOOP
   sid:=COALESCE(s->>'id',s->>'sessionId');
   IF c.source_type='run' THEN t:=(s->>'startsAt')::timestamptz;
   ELSE t:=(((c.input->>'date')::date+(s->>'dayIndex')::int-1)::text||' '||(s->>'start'))::timestamp AT TIME ZONE tz;END IF;
   IF t BETWEEN now() AND now()+interval '60 minutes' THEN
    INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind,stop_id)VALUES(c.id,'departure:'||sid||':'||c.revision,'departure',sid)ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;n:=n+1;
 END LOOP;RETURN n;
END $$;
REVOKE ALL ON FUNCTION journey_hub.care_tick() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.journeyhub_care_list(p_user_id uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 SELECT COALESCE(jsonb_agg(journey_hub.care_json(c)ORDER BY c.confirmed_at DESC),'[]'::jsonb)INTO result FROM(SELECT * FROM journey_hub.trip_care WHERE user_id=p_user_id ORDER BY confirmed_at DESC LIMIT 20)c;
 RETURN result;
END $$;
CREATE FUNCTION public.journeyhub_care_get(p_user_id uuid,p_id uuid)RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT journey_hub.care_json(c)FROM journey_hub.trip_care c WHERE c.id=p_id AND c.user_id=p_user_id
$$;
CREATE FUNCTION public.journeyhub_care_claim_check(p_user_id uuid,p_id uuid)RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE journey_hub.trip_care SET check_claimed_at=now()WHERE id=p_id AND user_id=p_user_id AND status='active' AND(check_claimed_at IS NULL OR check_claimed_at<now()-interval '5 minutes');
 RETURN FOUND;
END $$;
CREATE FUNCTION public.journeyhub_care_update(p_user_id uuid,p_id uuid,p_revision int,p_checks jsonb,p_proposal jsonb)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR c.revision<>p_revision OR c.status<>'active' THEN RAISE EXCEPTION 'Care request conflict';END IF;
 UPDATE journey_hub.trip_care SET checks=COALESCE(p_checks,checks),checked_at=CASE WHEN p_checks IS NOT NULL THEN now()ELSE checked_at END,proposal=p_proposal,updated_at=now()WHERE id=c.id RETURNING * INTO c;
 RETURN journey_hub.care_json(c);
END $$;
CREATE FUNCTION public.journeyhub_care_accept(p_user_id uuid,p_id uuid,p_proposal_id uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;BEGIN
 SELECT * INTO c FROM journey_hub.trip_care WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR c.source_type<>'history' OR c.status<>'active' OR c.proposal IS NULL OR c.proposal->>'id'<>p_proposal_id::text OR c.proposal->>'canApply'<>'true' OR (c.proposal->>'revision')::int<>c.revision OR (c.proposal->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Care proposal conflict';END IF;
 UPDATE journey_hub.trip_care SET plan=c.proposal->'plan',revision=revision+1,proposal=NULL,updated_at=now()WHERE id=c.id RETURNING * INTO c;
 INSERT INTO journey_hub.trip_care_events(care_id,event_key,kind)VALUES(c.id,'adjustment:'||c.revision,'adjustment_accepted');
 RETURN journey_hub.care_json(c);
END $$;
CREATE FUNCTION public.journeyhub_care_stop(p_user_id uuid,p_id uuid)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c journey_hub.trip_care;BEGIN
 UPDATE journey_hub.trip_care SET status='paused',proposal=NULL,updated_at=now()WHERE id=p_id AND user_id=p_user_id RETURNING * INTO c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Care trip not found';END IF;RETURN journey_hub.care_json(c);
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_confirm(uuid,text,uuid),public.journeyhub_care_list(uuid),public.journeyhub_care_get(uuid,uuid),public.journeyhub_care_claim_check(uuid,uuid),public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb),public.journeyhub_care_accept(uuid,uuid,uuid),public.journeyhub_care_stop(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_confirm(uuid,text,uuid),public.journeyhub_care_list(uuid),public.journeyhub_care_get(uuid,uuid),public.journeyhub_care_claim_check(uuid,uuid),public.journeyhub_care_update(uuid,uuid,int,jsonb,jsonb),public.journeyhub_care_accept(uuid,uuid,uuid),public.journeyhub_care_stop(uuid,uuid) TO service_role;
CREATE FUNCTION public.journeyhub_care_due(p_limit integer DEFAULT 2)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;BEGIN
 WITH due AS(SELECT id FROM journey_hub.trip_care WHERE status='active' AND source_type='history'
  AND (input->>'date')::date<=(now()AT TIME ZONE CASE input->>'city' WHEN 'Bangkok' THEN 'Asia/Bangkok' WHEN 'Shanghai' THEN 'Asia/Shanghai' ELSE 'Asia/Singapore' END)::date+1
  AND (input->>'date')::date+COALESCE((input->>'days')::int,1)>(now()AT TIME ZONE CASE input->>'city' WHEN 'Bangkok' THEN 'Asia/Bangkok' WHEN 'Shanghai' THEN 'Asia/Shanghai' ELSE 'Asia/Singapore' END)::date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours')AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes')
  ORDER BY checked_at NULLS FIRST,id LIMIT greatest(1,least(COALESCE(p_limit,2),2))FOR UPDATE SKIP LOCKED),claimed AS(
  UPDATE journey_hub.trip_care c SET worker_claimed_at=now()FROM due WHERE c.id=due.id RETURNING c.id,c.user_id)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'userId',user_id)),'[]'::jsonb)INTO result FROM claimed;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.journeyhub_care_due(integer)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_care_due(integer)TO service_role;
SELECT cron.schedule('journeyhub-trip-care','* * * * *','SELECT journey_hub.care_tick();');
SELECT cron.schedule('journeyhub-trip-place-check','*/10 * * * *',$schedule$
 SELECT net.http_post(url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/journeyhub-care',body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||w.decrypted_secret),timeout_milliseconds:=60000)
 FROM(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret'ORDER BY created_at DESC LIMIT 1)w
 WHERE length(w.decrypted_secret)>=32 AND EXISTS(SELECT 1 FROM journey_hub.trip_care WHERE status='active'AND source_type='history'
  AND(input->>'date')::date<=current_date+1 AND(input->>'date')::date+COALESCE((input->>'days')::int,1)>=current_date
  AND(checked_at IS NULL OR checked_at<now()-interval '6 hours')AND(worker_claimed_at IS NULL OR worker_claimed_at<now()-interval '10 minutes'));
 $schedule$);
COMMIT;
