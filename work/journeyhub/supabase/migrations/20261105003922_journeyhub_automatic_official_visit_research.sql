-- Account-scoped, date-specific official visitor guidance. No prompts, map tiles or supplier transactions.
BEGIN;
CREATE TABLE journey_hub.visit_research (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, source_type text NOT NULL CHECK(source_type IN ('history','run')),
 trip_id uuid NOT NULL, stop_id text NOT NULL, visit_date date NOT NULL, city text NOT NULL, label text NOT NULL, kind text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','checking','verified','partial','unconfirmed','not_applicable')),
 lat double precision, lng double precision, facts jsonb NOT NULL DEFAULT '{}', checked_at timestamptz, due_at timestamptz DEFAULT now(), lease uuid, attempts int NOT NULL DEFAULT 0,
 PRIMARY KEY(source_type,trip_id,stop_id,visit_date)
);
ALTER TABLE journey_hub.visit_research ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.visit_research FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON journey_hub.visit_research TO service_role;
CREATE INDEX visit_research_due ON journey_hub.visit_research(due_at) WHERE due_at IS NOT NULL;
CREATE INDEX visit_research_owner ON journey_hub.visit_research(owner_id,source_type,trip_id);
CREATE POLICY visit_own_read ON journey_hub.visit_research FOR SELECT TO authenticated USING(owner_id=(select auth.uid()));
CREATE FUNCTION journey_hub.visit_seed(t text,k uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; city_name text; base date; schedule jsonb; labels jsonb; s jsonb; l jsonb; ident text; vdate date; nm text; category text;
BEGIN
 IF t='history' THEN
 SELECT h.user_id,h.input->>'city',(h.input->>'date')::date,h.plan->'stops',snap.payload->'places' INTO uid,city_name,base,schedule,labels FROM journey_hub.trip_history h LEFT JOIN journey_hub.trip_display_snapshots snap ON snap.history_id=h.id AND snap.user_id=h.user_id WHERE h.id=k;
 ELSIF t='run' THEN
 SELECT h.user_id,h.input->>'city',(h.input->>'date')::date,h.plan->'stops' INTO uid,city_name,base,schedule FROM journey_hub.agent_runs h WHERE h.id=k;
 END IF;
 IF uid IS NULL OR schedule IS NULL OR EXISTS(SELECT FROM journey_hub.calendar_removed_items d WHERE d.user_id=uid AND d.kind=t AND d.item_id=k::text) THEN
 DELETE FROM journey_hub.visit_research WHERE source_type=t AND trip_id=k; RETURN; END IF;
 DELETE FROM journey_hub.visit_research q WHERE q.source_type=t AND q.trip_id=k AND NOT EXISTS(SELECT FROM jsonb_array_elements(schedule) x WHERE coalesce(x->>'id',x->>'sessionId')=q.stop_id AND base+coalesce((x->>'dayIndex')::int-1,0)=q.visit_date);
 FOR s IN SELECT value FROM jsonb_array_elements(schedule) LOOP
 ident:=coalesce(s->>'id',s->>'sessionId'); vdate:=base+coalesce((s->>'dayIndex')::int-1,0);
 SELECT value INTO l FROM jsonb_array_elements(labels) WHERE value->>'id'=ident LIMIT 1;
 nm:=coalesce(l->>'name',s->>'venue',s->>'title',''); category:=coalesce(l->>'kind',s->>'kind','');
 IF ident IS NULL THEN CONTINUE; END IF;
 IF lower(category) ~ 'restaurant|cafe|café|bakery|coffee|dining|food|餐饮' THEN
 DELETE FROM journey_hub.visit_research WHERE source_type=t AND trip_id=k AND stop_id=ident; CONTINUE; END IF;
 INSERT INTO journey_hub.visit_research AS q(owner_id,source_type,trip_id,stop_id,visit_date,city,label,kind,lat,lng)
 VALUES(uid,t,k,ident,vdate,city_name,nm,category,CASE WHEN t='run' THEN (s->>'lat')::float8 END,CASE WHEN t='run' THEN (s->>'lng')::float8 END)
 ON CONFLICT(source_type,trip_id,stop_id,visit_date) DO UPDATE SET label=excluded.label,kind=excluded.kind,
 due_at=CASE WHEN q.label='' AND q.checked_at IS NULL THEN now() ELSE q.due_at END
 WHERE excluded.label<>'' AND (q.label,q.kind) IS DISTINCT FROM (excluded.label,excluded.kind);
 END LOOP;
END $$;
CREATE FUNCTION journey_hub.visit_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='calendar_removed_items' THEN
 IF TG_OP='INSERT' THEN DELETE FROM journey_hub.visit_research WHERE owner_id=NEW.user_id AND source_type=NEW.kind AND trip_id::text=NEW.item_id;
 ELSIF OLD.kind IN ('history','run') THEN PERFORM journey_hub.visit_seed(OLD.kind,OLD.item_id::uuid); END IF;
 ELSIF TG_OP='DELETE' THEN DELETE FROM journey_hub.visit_research WHERE source_type=TG_ARGV[0] AND trip_id=OLD.id;
 ELSIF TG_TABLE_NAME='trip_display_snapshots' THEN PERFORM journey_hub.visit_seed('history',NEW.history_id);
 ELSE PERFORM journey_hub.visit_seed(TG_ARGV[0],NEW.id); END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER visit_history AFTER INSERT OR UPDATE OF plan,input OR DELETE ON journey_hub.trip_history FOR EACH ROW EXECUTE FUNCTION journey_hub.visit_sync('history');
CREATE TRIGGER visit_labels AFTER INSERT OR UPDATE OF payload ON journey_hub.trip_display_snapshots FOR EACH ROW EXECUTE FUNCTION journey_hub.visit_sync();
CREATE TRIGGER visit_runs AFTER INSERT OR UPDATE OF plan OR DELETE ON journey_hub.agent_runs FOR EACH ROW EXECUTE FUNCTION journey_hub.visit_sync('run');
CREATE TRIGGER visit_removal AFTER INSERT OR DELETE ON journey_hub.calendar_removed_items FOR EACH ROW EXECUTE FUNCTION journey_hub.visit_sync();
CREATE FUNCTION public.journeyhub_visit_claim() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH take AS (SELECT q.source_type,q.trip_id,q.stop_id,q.visit_date FROM journey_hub.visit_research q WHERE q.due_at<=now() ORDER BY q.due_at LIMIT 3 FOR UPDATE SKIP LOCKED),
 rows AS(UPDATE journey_hub.visit_research q SET state='checking',lease=gen_random_uuid(),due_at=now()+interval '4 minutes',attempts=q.attempts+1 FROM take WHERE (q.source_type,q.trip_id,q.stop_id,q.visit_date)=(take.source_type,take.trip_id,take.stop_id,take.visit_date) RETURNING q.source_type,q.stop_id,q.visit_date,q.city,q.label,q.kind,q.lease,q.lat,q.lng)
 SELECT coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) FROM rows $$;
CREATE FUNCTION public.journeyhub_visit_finish(p_lease uuid,p_facts jsonb,p_state text,p_transient boolean) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_state NOT IN ('verified','partial','unconfirmed','not_applicable') OR jsonb_typeof(p_facts)<>'object' OR octet_length(p_facts::text)>24000 THEN RETURN false; END IF;
 UPDATE journey_hub.visit_research q SET lease=NULL,
 facts=CASE WHEN p_transient AND facts<>'{}' AND p_facts='{}' THEN facts ELSE p_facts END,
 checked_at=CASE WHEN p_transient AND facts<>'{}' AND p_facts='{}' THEN checked_at ELSE now() END,
 state=CASE WHEN p_transient AND facts<>'{}' AND p_facts='{}' THEN 'partial' ELSE p_state END,
 attempts=CASE WHEN p_transient THEN attempts ELSE 0 END,
 due_at=CASE WHEN p_transient AND attempts<3 THEN now()+interval '5 minutes'*greatest(1,attempts)
 WHEN visit_date >= current_date AND p_state <> 'not_applicable' THEN now()+CASE WHEN visit_date<=current_date+7 THEN interval '1 day' ELSE interval '7 days' END ELSE NULL END
 WHERE lease=p_lease AND state='checking'; RETURN FOUND;
END $$;
CREATE FUNCTION journey_hub.visit_read(t text,k uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',stop_id,'date',visit_date,'state',state,'fields',facts,'checkedAt',checked_at)),'[]'::jsonb) FROM journey_hub.visit_research q WHERE owner_id=(SELECT auth.uid()) AND source_type=t AND trip_id=k
 AND NOT EXISTS(SELECT FROM journey_hub.calendar_removed_items d WHERE d.user_id=q.owner_id AND d.kind=t AND d.item_id=k::text) $$;
CREATE FUNCTION public.journeyhub_visit_details(p_type text,p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT journey_hub.visit_read(p_type,p_id) $$;
REVOKE ALL ON FUNCTION journey_hub.visit_seed(text,uuid),journey_hub.visit_sync(),journey_hub.visit_read(text,uuid),public.journeyhub_visit_details(text,uuid),public.journeyhub_visit_claim(),public.journeyhub_visit_finish(uuid,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION journey_hub.visit_read(text,uuid),public.journeyhub_visit_details(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.journeyhub_visit_claim(),public.journeyhub_visit_finish(uuid,jsonb,text,boolean) TO service_role;
SELECT journey_hub.visit_seed('history',id) FROM journey_hub.trip_history WHERE plan IS NOT NULL;
SELECT journey_hub.visit_seed('run',id) FROM journey_hub.agent_runs WHERE plan IS NOT NULL;
SELECT cron.schedule('journeyhub-official-visit-facts','* * * * *',$task$
 SELECT net.http_post(url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/journeyhub-visit-research',body:='{}',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||w.decrypted_secret),timeout_milliseconds:=110000)
 FROM (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret' LIMIT 1) w
 WHERE EXISTS(SELECT FROM journey_hub.visit_research WHERE due_at<=now()) $task$);
COMMIT;
