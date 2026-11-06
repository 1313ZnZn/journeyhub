DO $$ DECLARE r record; BEGIN
FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='journey_hub' LOOP
EXECUTE format('CREATE POLICY deny_direct_client_access ON journey_hub.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', r.tablename);
END LOOP;
END $$;
