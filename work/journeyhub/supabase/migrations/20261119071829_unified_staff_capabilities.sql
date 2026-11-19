-- Approved unified Staff policy. Keep legacy role spelling for existing RPCs.
BEGIN;
LOCK TABLE journey_hub.staff IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE journey_hub.staff_role_backup_20261119 (
  staff_id text PRIMARY KEY,
  original_role text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE journey_hub.staff_role_backup_20261119 ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_direct_client_access ON journey_hub.staff_role_backup_20261119
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE journey_hub.staff_role_backup_20261119 FROM PUBLIC, anon, authenticated;
INSERT INTO journey_hub.staff_role_backup_20261119(staff_id,original_role)
SELECT staff_id,role FROM journey_hub.staff;

CREATE FUNCTION journey_hub.normalize_staff_role() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.role IS NULL OR NEW.role NOT IN ('coordinator','duty_manager','host') THEN
    RAISE EXCEPTION 'Invalid staff role' USING ERRCODE='23514';
  END IF;
  NEW.role := 'duty_manager';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION journey_hub.normalize_staff_role() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER normalize_staff_role
BEFORE INSERT OR UPDATE OF role ON journey_hub.staff
FOR EACH ROW EXECUTE FUNCTION journey_hub.normalize_staff_role();

UPDATE journey_hub.staff SET role='duty_manager' WHERE role IN ('coordinator','host');
-- Existing staff RLS, auth provisioning and independent-review checks are unchanged.
COMMIT;
