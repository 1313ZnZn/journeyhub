-- Additive scheduler activation. Secret generated server-side; never returned.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
REVOKE ALL ON net.http_request_queue FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='journeyhub_agent_worker_secret') THEN
  PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'journeyhub_agent_worker_secret','Dedicated JourneyHub mail worker token');
 END IF;
END $$;
-- Activation script for the existing JourneyHub Supabase project.
-- Review and execute separately after agent-backend.sql and the two Edge Functions.
-- Prerequisites (managed separately): pg_cron, pg_net, and Vault secret named
-- journeyhub_agent_worker_secret, generated in the DB without printing its value.
-- This file creates no extension and contains no credential value.
-- Source: https://supabase.com/docs/guides/functions/schedule-functions
BEGIN;
DO $$ BEGIN
 IF to_regclass('cron.job') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
  RAISE EXCEPTION 'Enable pg_cron and pg_net before activating the agent scheduler';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret' AND length(decrypted_secret)>=32) THEN
  RAISE EXCEPTION 'Create the named worker secret in Vault before activating the scheduler';
 END IF;
END $$;
SELECT cron.schedule('journeyhub-agent-bookings','* * * * *',
 $$SELECT journey_hub.agent_process_bookings(10);$$);
SELECT cron.schedule('journeyhub-agent-mail','* * * * *',$schedule$
 SELECT net.http_post(
  url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/journeyhub-mail',
  body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||w.decrypted_secret),
  timeout_milliseconds:=60000
 ) FROM (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='journeyhub_agent_worker_secret' ORDER BY created_at DESC LIMIT 1) w
 WHERE length(w.decrypted_secret)>=32 AND EXISTS(
  SELECT 1 FROM journey_hub.agent_mail_jobs
  WHERE (status='pending' AND run_at<=now()) OR (status='leased' AND lease_until<now())
 );
$schedule$);
COMMIT;
-- Safe readiness query (does not expose credentials):
-- SELECT jobname,active,schedule FROM cron.job
-- WHERE jobname IN ('journeyhub-agent-bookings','journeyhub-agent-mail');
