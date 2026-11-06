-- Durable, account-owned display labels for saved itineraries. Provider photos,
-- reviews, addresses, coordinates and road routes are deliberately not stored.
-- Authoritative input, choices and schedule remain in trip_history.
BEGIN;

CREATE FUNCTION journey_hub.trip_display_snapshot_valid(p_payload jsonb,p_place_ids text[] DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE entry jsonb; key text; seen text[]:='{}';
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR octet_length(p_payload::text)>65536
  OR NOT(p_payload ?& ARRAY['schemaVersion','places'])
  OR p_payload->'schemaVersion'<>'1'::jsonb
  OR jsonb_typeof(p_payload->'places')<>'array' THEN RETURN false; END IF;
 FOR key IN SELECT jsonb_object_keys(p_payload) LOOP
  IF key NOT IN ('schemaVersion','places') THEN RETURN false; END IF;
 END LOOP;
 IF jsonb_array_length(p_payload->'places') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_payload->'places') LOOP
  IF jsonb_typeof(entry)<>'object' OR NOT(entry ?& ARRAY['id','name','kind']) THEN RETURN false; END IF;
  FOR key IN SELECT jsonb_object_keys(entry) LOOP
   IF key NOT IN ('id','name','kind','category','reason') THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(entry->'id')<>'string' OR entry->>'id' !~ '^[A-Za-z0-9_-]{1,200}$'
   OR entry->>'id'=ANY(seen)
   OR (p_place_ids IS NOT NULL AND NOT(entry->>'id'=ANY(p_place_ids)))
   OR jsonb_typeof(entry->'name')<>'string' OR length(btrim(entry->>'name')) NOT BETWEEN 1 AND 160
   OR length(entry->>'name')>160
   OR jsonb_typeof(entry->'kind')<>'string' OR length(btrim(entry->>'kind')) NOT BETWEEN 1 AND 80
   OR length(entry->>'kind')>80 THEN RETURN false; END IF;
  IF entry ? 'category' AND (jsonb_typeof(entry->'category')<>'string' OR length(entry->>'category')>80) THEN RETURN false; END IF;
  IF entry ? 'reason' AND (jsonb_typeof(entry->'reason')<>'string' OR length(entry->>'reason')>300) THEN RETURN false; END IF;
  seen:=array_append(seen,entry->>'id');
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- A composite FK makes the owner invariant hold even for internal writes.
ALTER TABLE journey_hub.trip_history ADD CONSTRAINT trip_history_id_owner_unique UNIQUE(id,user_id);
CREATE TABLE journey_hub.trip_display_snapshots (
 history_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 source_updated_at timestamptz NOT NULL,
 payload jsonb NOT NULL CHECK(journey_hub.trip_display_snapshot_valid(payload)),
 saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(history_id,user_id) REFERENCES journey_hub.trip_history(id,user_id) ON DELETE CASCADE
);
CREATE INDEX trip_display_snapshots_owner ON journey_hub.trip_display_snapshots(user_id);
ALTER TABLE journey_hub.trip_display_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON journey_hub.trip_display_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON journey_hub.trip_display_snapshots TO service_role;
CREATE POLICY trip_display_snapshot_owner ON journey_hub.trip_display_snapshots
 FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
-- These invoker RPCs only need to read tombstones, never change them.
GRANT SELECT ON journey_hub.calendar_removed_items TO service_role;

CREATE FUNCTION public.journeyhub_trip_snapshot_get(p_user_id uuid,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('payload',s.payload,'savedAt',s.saved_at,'sourceUpdatedAt',s.source_updated_at)
 FROM journey_hub.trip_display_snapshots s
 JOIN journey_hub.trip_history h ON h.id=s.history_id AND h.user_id=s.user_id
 WHERE h.id=p_id AND h.user_id=p_user_id AND s.source_updated_at=h.updated_at
  AND NOT EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d
   WHERE d.user_id=h.user_id AND d.kind='history' AND d.item_id=h.id::text)
$$;

CREATE FUNCTION public.journeyhub_trip_snapshot_put(p_user_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE history journey_hub.trip_history; saved timestamptz;
BEGIN
 -- Same lock order as calendar mutations and itinerary edits: history, then snapshot.
 SELECT * INTO history FROM journey_hub.trip_history h WHERE h.id=p_id AND h.user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.calendar_removed_items d
  WHERE d.user_id=p_user_id AND d.kind='history' AND d.item_id=p_id::text) THEN
  RETURN jsonb_build_object('ok',false,'reason','removed');
 END IF;
 IF p_expected_updated_at IS NULL OR history.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RETURN jsonb_build_object('ok',false,'reason','revision_changed');
 END IF;
 IF NOT journey_hub.trip_display_snapshot_valid(p_payload,history.place_ids) THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid_payload');
 END IF;
 -- Retrying an identical write should not pretend that its content was refreshed.
 INSERT INTO journey_hub.trip_display_snapshots AS s(history_id,user_id,source_updated_at,payload,saved_at)
 VALUES(p_id,p_user_id,history.updated_at,p_payload,clock_timestamp())
 ON CONFLICT(history_id) DO UPDATE SET user_id=EXCLUDED.user_id,source_updated_at=EXCLUDED.source_updated_at,
  payload=EXCLUDED.payload,saved_at=CASE WHEN s.source_updated_at=EXCLUDED.source_updated_at AND s.payload=EXCLUDED.payload
   THEN s.saved_at ELSE EXCLUDED.saved_at END
 RETURNING saved_at INTO saved;
 RETURN jsonb_build_object('ok',true,'savedAt',saved);
END $$;

-- Existing mutation callers already update updated_at. Ensure a real source edit
-- always has a new version, including two writes in the same transaction.
CREATE FUNCTION journey_hub.trip_display_snapshot_source_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (NEW.input,NEW.place_ids,NEW.wanted,NEW.skipped,NEW.plan,NEW.user_id,NEW.parent_id)
  IS DISTINCT FROM (OLD.input,OLD.place_ids,OLD.wanted,OLD.skipped,OLD.plan,OLD.user_id,OLD.parent_id)
  AND NEW.updated_at<=OLD.updated_at THEN
  NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_display_snapshot_source_version BEFORE UPDATE ON journey_hub.trip_history
 FOR EACH ROW EXECUTE FUNCTION journey_hub.trip_display_snapshot_source_version();

CREATE FUNCTION journey_hub.trip_display_snapshot_invalidate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Swiping changes selections, not display labels. Atomically carry the labels
 -- to that new revision while all choices still come from the authoritative row.
 IF (NEW.input,NEW.place_ids,NEW.plan,NEW.user_id,NEW.parent_id)
  IS NOT DISTINCT FROM (OLD.input,OLD.place_ids,OLD.plan,OLD.user_id,OLD.parent_id) THEN
  UPDATE journey_hub.trip_display_snapshots SET source_updated_at=NEW.updated_at
   WHERE history_id=NEW.id AND user_id=NEW.user_id AND source_updated_at=OLD.updated_at;
 ELSE
  DELETE FROM journey_hub.trip_display_snapshots WHERE history_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_display_snapshot_invalidate AFTER UPDATE ON journey_hub.trip_history
 FOR EACH ROW WHEN(OLD.updated_at IS DISTINCT FROM NEW.updated_at)
 EXECUTE FUNCTION journey_hub.trip_display_snapshot_invalidate();

-- Removal and restoration both fence in-flight hydrations. Just deleting a
-- snapshot on removal is insufficient: an old request could write it after restore.
CREATE FUNCTION journey_hub.trip_display_snapshot_visibility_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; history_key text; item_kind text;
BEGIN
 IF TG_OP='DELETE' THEN owner_id:=OLD.user_id;history_key:=OLD.item_id;item_kind:=OLD.kind;
 ELSE owner_id:=NEW.user_id;history_key:=NEW.item_id;item_kind:=NEW.kind; END IF;
 IF item_kind='history' THEN
  -- Acquire the source lock before touching its snapshot, even for internal
  -- tombstone writes that did not enter through the calendar RPC.
  PERFORM h.id FROM journey_hub.trip_history h WHERE h.user_id=owner_id AND h.id::text=history_key FOR UPDATE;
  DELETE FROM journey_hub.trip_display_snapshots s WHERE s.user_id=owner_id AND s.history_id::text=history_key;
  UPDATE journey_hub.trip_history h SET updated_at=greatest(clock_timestamp(),h.updated_at+interval '1 microsecond')
   WHERE h.user_id=owner_id AND h.id::text=history_key;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trip_display_snapshot_visibility_changed AFTER INSERT OR DELETE ON journey_hub.calendar_removed_items
 FOR EACH ROW EXECUTE FUNCTION journey_hub.trip_display_snapshot_visibility_changed();

REVOKE ALL ON FUNCTION journey_hub.trip_display_snapshot_valid(jsonb,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION journey_hub.trip_display_snapshot_valid(jsonb,text[]) TO service_role;
REVOKE ALL ON FUNCTION journey_hub.trip_display_snapshot_source_version(),journey_hub.trip_display_snapshot_invalidate(),
 journey_hub.trip_display_snapshot_visibility_changed() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.journeyhub_trip_snapshot_get(uuid,uuid),
 public.journeyhub_trip_snapshot_put(uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.journeyhub_trip_snapshot_get(uuid,uuid),
 public.journeyhub_trip_snapshot_put(uuid,uuid,timestamptz,jsonb) TO service_role;
COMMIT;
