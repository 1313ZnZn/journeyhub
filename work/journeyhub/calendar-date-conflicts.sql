-- One active itinerary per traveler/date. Existing historical versions are retained.
-- Apply after calendar-management.sql. No reservations, emails or provider calls.
BEGIN;

CREATE OR REPLACE FUNCTION journey_hub.calendar_trip_span(p_input jsonb) RETURNS daterange
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE first_day date; day_count integer;
BEGIN
 IF p_input IS NULL OR p_input->>'date' IS NULL OR p_input->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
  OR COALESCE(p_input->>'days','1') !~ '^\d{1,2}$' THEN RAISE EXCEPTION 'INVALID_TRIP_DATES';END IF;
 first_day:=(p_input->>'date')::date;day_count:=COALESCE(p_input->>'days','1')::integer;
 IF day_count NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'INVALID_TRIP_DATES';END IF;
 RETURN daterange(first_day,first_day+day_count,'[)');
END $$;

CREATE OR REPLACE FUNCTION journey_hub.calendar_date_conflict(p_user_id uuid,p_input jsonb,p_kind text DEFAULT NULL,p_id uuid DEFAULT NULL)
RETURNS date LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT min(greatest(lower(x.span),lower(journey_hub.calendar_trip_span(p_input))))
 FROM (
  SELECT journey_hub.calendar_trip_span(h.input) span
  FROM journey_hub.trip_history h
  WHERE h.user_id=p_user_id AND h.plan IS NOT NULL
   AND (p_kind IS DISTINCT FROM 'history' OR h.id IS DISTINCT FROM p_id)
   AND NOT EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d WHERE d.user_id=h.user_id AND d.kind='history' AND d.item_id=h.id::text)
  UNION ALL
  SELECT journey_hub.calendar_trip_span(r.input)
  FROM journey_hub.agent_runs r
  WHERE r.user_id=p_user_id
   AND (r.plan IS NOT NULL OR r.status='queued' OR (r.status='planning' AND r.planning_until>clock_timestamp()))
   AND (p_kind IS DISTINCT FROM 'run' OR r.id IS DISTINCT FROM p_id)
   AND NOT EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d WHERE d.user_id=r.user_id AND d.kind='run' AND d.item_id=r.id::text)
 )x WHERE x.span && journey_hub.calendar_trip_span(p_input)
$$;

-- Trusted backend only; browser callers cannot supply another owner's identity.
-- VOLATILE gives the conflict query a fresh READ COMMITTED snapshot after waiting.
CREATE OR REPLACE FUNCTION journey_hub.plan_dates_check(p_user_id uuid,p_input jsonb,p_kind text DEFAULT NULL,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE conflict_day date;
BEGIN
 IF p_user_id IS NULL OR (p_kind IS NOT NULL AND p_kind NOT IN('history','run')) OR ((p_kind IS NULL)<>(p_id IS NULL))
  THEN RAISE EXCEPTION 'INVALID_TRIP_DATES';END IF;
 PERFORM journey_hub.calendar_trip_span(p_input);
 PERFORM pg_advisory_xact_lock(hashtextextended('calendar-dates:'||p_user_id::text,0));
 conflict_day:=journey_hub.calendar_date_conflict(p_user_id,p_input,p_kind,p_id);
 IF conflict_day IS NOT NULL THEN RAISE EXCEPTION 'PLAN_DATE_CONFLICT:%',conflict_day;END IF;
 RETURN jsonb_build_object('available',true);
END $$;

CREATE OR REPLACE FUNCTION public.journeyhub_plan_dates_check(p_user_id uuid,p_input jsonb,p_kind text DEFAULT NULL,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT journey_hub.plan_dates_check(p_user_id,p_input,p_kind,p_id)
$$;

CREATE OR REPLACE FUNCTION journey_hub.calendar_dates_guard_history() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.plan IS NULL THEN RETURN NEW;END IF;
 -- INSERT ON CONFLICT retries must return their immutable existing version.
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM journey_hub.trip_history h WHERE h.id=NEW.id AND h.user_id=NEW.user_id) THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND OLD.plan IS NOT NULL AND OLD.user_id=NEW.user_id
  AND journey_hub.calendar_trip_span(OLD.input)=journey_hub.calendar_trip_span(NEW.input) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d WHERE d.user_id=NEW.user_id AND d.kind='history' AND d.item_id=NEW.id::text) THEN RETURN NEW;END IF;
 PERFORM journey_hub.plan_dates_check(NEW.user_id,NEW.input,'history',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER calendar_dates_guard_history BEFORE INSERT OR UPDATE OF input,plan,user_id ON journey_hub.trip_history
 FOR EACH ROW EXECUTE FUNCTION journey_hub.calendar_dates_guard_history();

CREATE OR REPLACE FUNCTION journey_hub.calendar_dates_guard_run() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE new_active boolean;old_active boolean;
BEGIN
 new_active:=NEW.plan IS NOT NULL OR NEW.status='queued' OR (NEW.status='planning' AND NEW.planning_until>clock_timestamp());
 IF NOT new_active THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' THEN
  old_active:=OLD.plan IS NOT NULL OR OLD.status='queued' OR (OLD.status='planning' AND OLD.planning_until>clock_timestamp());
  -- Existing plan/job progress remains legal; reactivating expired work is rechecked.
  IF old_active AND OLD.user_id=NEW.user_id AND journey_hub.calendar_trip_span(OLD.input)=journey_hub.calendar_trip_span(NEW.input) THEN RETURN NEW;END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d WHERE d.user_id=NEW.user_id AND d.kind='run' AND d.item_id=NEW.id::text) THEN RETURN NEW;END IF;
 PERFORM journey_hub.plan_dates_check(NEW.user_id,NEW.input,'run',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER calendar_dates_guard_run BEFORE INSERT OR UPDATE OF status,plan,input,user_id,planning_until ON journey_hub.agent_runs
 FOR EACH ROW EXECUTE FUNCTION journey_hub.calendar_dates_guard_run();

-- calendar_manage already locks and authenticates the source. This trigger also
-- fences any future restore path, without adding locks on other source rows.
CREATE OR REPLACE FUNCTION journey_hub.calendar_dates_guard_restore() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE prefs jsonb;
BEGIN
 -- Cascading account deletion is cleanup, not restoration.
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=OLD.user_id) THEN RETURN OLD;END IF;
 IF OLD.kind='history' THEN
  SELECT h.input INTO prefs FROM journey_hub.trip_history h WHERE h.user_id=OLD.user_id AND h.id::text=OLD.item_id AND h.plan IS NOT NULL;
 ELSIF OLD.kind='run' THEN
  SELECT r.input INTO prefs FROM journey_hub.agent_runs r WHERE r.user_id=OLD.user_id AND r.id::text=OLD.item_id
   AND (r.plan IS NOT NULL OR r.status='queued' OR (r.status='planning' AND r.planning_until>clock_timestamp()));
 END IF;
 IF prefs IS NOT NULL THEN PERFORM journey_hub.plan_dates_check(OLD.user_id,prefs,OLD.kind,OLD.item_id::uuid);END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER calendar_dates_guard_restore BEFORE DELETE ON journey_hub.calendar_removed_items
 FOR EACH ROW EXECUTE FUNCTION journey_hub.calendar_dates_guard_restore();

REVOKE ALL ON FUNCTION journey_hub.calendar_trip_span(jsonb),journey_hub.calendar_date_conflict(uuid,jsonb,text,uuid),
 journey_hub.plan_dates_check(uuid,jsonb,text,uuid),journey_hub.calendar_dates_guard_history(),
 journey_hub.calendar_dates_guard_run(),journey_hub.calendar_dates_guard_restore(),
 public.journeyhub_plan_dates_check(uuid,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION journey_hub.plan_dates_check(uuid,jsonb,text,uuid),public.journeyhub_plan_dates_check(uuid,jsonb,text,uuid) TO service_role;
COMMIT;
