-- Rollback-only regression suite: no external provider calls or messages.
-- Run after database.sql + agent-backend.sql on a test database.
BEGIN;
CREATE FUNCTION pg_temp.agent_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label; END IF;END $$;
CREATE FUNCTION pg_temp.agent_error(command text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
  IF position(expected IN SQLERRM)>0 THEN RETURN;END IF;
  RAISE EXCEPTION 'Expected %, got % for %',expected,SQLERRM,command;
 END;
 RAISE EXCEPTION 'Expected error %, command succeeded: %',expected,command;
END $$;
CREATE FUNCTION pg_temp.agent_plan(uid uuid,session_ids text[]) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE started jsonb;proposal jsonb;dt date;
BEGIN
 SELECT (starts_at AT TIME ZONE 'Asia/Bangkok')::date INTO dt FROM journey_hub.sessions WHERE session_id=session_ids[1];
 started:=public.journeyhub_agent_begin(uid,gen_random_uuid(),jsonb_build_object('city','Bangkok','date',dt,'guests',2,'budgetThb',20000,'prompt','A relaxed culture day'));
 SELECT jsonb_build_object('summary','A test trip','stops',jsonb_agg(jsonb_build_object('sessionId',sid,'reason','Matches your interests') ORDER BY ord),'tips',jsonb_build_array('Bring water')) INTO proposal FROM unnest(session_ids) WITH ORDINALITY s(sid,ord);
 RETURN public.journeyhub_agent_finalize((started->>'id')::uuid,(started->>'planning_token')::uuid,proposal,'test-model','test-response');
END $$;
-- A rollback-only transient-error injection demonstrates all-or-nothing retries.
CREATE FUNCTION pg_temp.agent_simulate_retry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('test.agent.retry',true)='on' AND NEW.booking_id LIKE 'B-AG-%' AND NEW.session_id='agent-test-6' THEN RAISE EXCEPTION 'Injected serialization failure on second stop' USING ERRCODE='40001';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_test_retry BEFORE INSERT ON journey_hub.bookings FOR EACH ROW EXECUTE FUNCTION pg_temp.agent_simulate_retry();
DO $$
DECLARE u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();unverified uuid:=gen_random_uuid();exp text;venueid text;dt date:=current_date+3;
 inp jsonb;started jsonb;again jsonb;r jsonb;r2 jsonb;bad jsonb;retryrun jsonb;rid uuid;request_id uuid:=gen_random_uuid();
 jobs jsonb;j jsonb;token uuid;mailid uuid;result jsonb;counts int;i int;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 (u1,'agent-test-one@example.invalid',now(),'{"display_name":"Agent Test One"}'),
 (u2,'agent-test-two@example.invalid',now(),'{"display_name":"Agent Test Two"}'),
 (unverified,'agent-test-unverified@example.invalid',NULL,'{}');
 SELECT e.experience_id INTO exp FROM journey_hub.experiences e JOIN journey_hub.venues v USING(venue_id) WHERE v.city='Bangkok' ORDER BY e.experience_id LIMIT 1;
 SELECT venue_id INTO venueid FROM journey_hub.experiences WHERE experience_id=exp;
 FOR i IN 1..10 LOOP
  INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb)
  VALUES('agent-test-'||i,exp,((dt+((i-1)/2))::timestamp+make_interval(hours=>9+((i-1)%2)*3)) AT TIME ZONE 'Asia/Bangkok',((dt+((i-1)/2))::timestamp+make_interval(hours=>10+((i-1)%2)*3)) AT TIME ZONE 'Asia/Bangkok',6,1200);
 END LOOP;
 inp:=jsonb_build_object('city','Bangkok','date',dt,'guests',2,'budgetThb',20000,'prompt','Culture please');
 PERFORM pg_temp.agent_assert(jsonb_array_length(public.journeyhub_agent_catalog('Bangkok',dt,2))>=2,'catalog has authoritative future fixtures');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_catalog(NULL,%L,2)',dt),'INVALID_TRIP_INPUT');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',unverified,gen_random_uuid(),inp),'VERIFIED_ACCOUNT_REQUIRED');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',u1,gen_random_uuid(),inp-'city'),'INVALID_TRIP_INPUT');
 started:=public.journeyhub_agent_begin(u1,request_id,inp);rid:=(started->>'id')::uuid;
 again:=public.journeyhub_agent_begin(u1,request_id,inp);
 PERFORM pg_temp.agent_assert(again->>'id'=started->>'id' AND (again->>'cached')::bool AND again->>'planning_token' IS NULL,'request replay cannot call provider twice');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',u1,request_id,inp||'{"guests":3}'),'REQUEST_ID_REUSED');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_finalize(%L,%L,%L,''test'',''test'')',rid,gen_random_uuid(),'{"stops":[{"sessionId":"agent-test-1"}]}'),'INVALID_PLANNER_LEASE');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_finalize(%L,%L,%L,''test'',''test'')',rid,started->>'planning_token','{"stops":[{"sessionId":"agent-test-1"},{"sessionId":"agent-test-1"}]}'),'DUPLICATE_SESSION');
 r:=public.journeyhub_agent_finalize(rid,(started->>'planning_token')::uuid,'{"summary":"Two culture stops","stops":[{"sessionId":"agent-test-1","reason":"Morning"},{"sessionId":"agent-test-2","reason":"Afternoon"}],"tips":["Water"]}','test','test');
 PERFORM pg_temp.agent_assert(r->>'status'='awaiting_confirmation' AND r#>>'{plan,totalThb}'='4800' AND r#>>'{plan,stops,0,unitPriceThb}'='1200' AND length(r->>'planHash')=64,'server snapshots price, quantity and hash');
 PERFORM pg_temp.agent_assert(NOT EXISTS(SELECT 1 FROM journey_hub.agent_booking_jobs WHERE run_id=rid) AND NOT EXISTS(SELECT 1 FROM journey_hub.agent_mail_jobs WHERE run_id=rid),'no pre-consent side effects');
 PERFORM pg_temp.agent_error(format('UPDATE journey_hub.agent_runs SET plan=plan||''{"totalThb":1}'' WHERE id=%L',rid),'immutable');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u2)::text,true);
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_get(%L)',rid),'RUN_NOT_FOUND');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,true)',rid,r->>'planHash'),'RUN_NOT_FOUND');
 PERFORM pg_temp.agent_assert(public.journeyhub_agent_list()='[]','other owner sees no run');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u1)::text,true);
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,''wrong'',true)',rid),'APPROVAL_MISMATCH');
 UPDATE journey_hub.sessions SET price_thb=1300 WHERE session_id='agent-test-2';
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,true)',rid,r->>'planHash'),'PRICE_CHANGED');
 UPDATE journey_hub.sessions SET price_thb=1200,capacity=1 WHERE session_id='agent-test-2';
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,true)',rid,r->>'planHash'),'CAPACITY_CHANGED');
 UPDATE journey_hub.sessions SET capacity=6,starts_at=starts_at+interval '1 minute' WHERE session_id='agent-test-2';
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,true)',rid,r->>'planHash'),'SESSION_CHANGED');
 UPDATE journey_hub.sessions SET starts_at=starts_at-interval '1 minute' WHERE session_id='agent-test-2';
 UPDATE journey_hub.venues SET city='Singapore' WHERE venue_id=venueid;
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,true)',rid,r->>'planHash'),'ITINERARY_CHANGED');
 UPDATE journey_hub.venues SET city='Bangkok' WHERE venue_id=venueid;
 PERFORM pg_temp.agent_assert(NOT EXISTS(SELECT 1 FROM journey_hub.agent_approvals WHERE run_id=rid),'all failed confirmations leave no consent or jobs');
 r:=public.journeyhub_agent_confirm(rid,1,r->>'planHash',true);
 again:=public.journeyhub_agent_confirm(rid,1,r->>'planHash',true);
 PERFORM pg_temp.agent_assert(r=again AND (SELECT count(*)=1 FROM journey_hub.agent_booking_jobs WHERE run_id=rid),'confirmation is idempotent');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,false)',rid,r->>'planHash'),'APPROVAL_MISMATCH');
 PERFORM pg_temp.agent_error(format('UPDATE journey_hub.agent_approvals SET email_opt_in=false WHERE run_id=%L',rid),'immutable');
 result:=public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.agent_assert(result->>'booked'='1','confirmed run books');
 PERFORM pg_temp.agent_assert((SELECT count(*)=2 FROM journey_hub.agent_reservations WHERE run_id=rid) AND (SELECT count(*)=4 FROM journey_hub.agent_mail_jobs WHERE run_id=rid),'two actual catalog reservations and consented confirmation/reminders');
 PERFORM pg_temp.agent_assert((public.journeyhub_agent_get(rid)->>'status')='booked','run reports booked');
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM public.journeyhub_agent_confirm(rid,1,r->>'planHash',true);
 PERFORM pg_temp.agent_assert((SELECT count(*)=2 FROM journey_hub.agent_reservations WHERE run_id=rid),'replay cannot duplicate bookings');

 -- Reserve conflicts arising after consent must roll back the entire itinerary.
 bad:=pg_temp.agent_plan(u1,ARRAY['agent-test-3','agent-test-4']);
 PERFORM public.journeyhub_agent_confirm((bad->>'id')::uuid,1,bad->>'planHash',true);
 UPDATE journey_hub.sessions SET capacity=1 WHERE session_id='agent-test-4';
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.agent_assert((SELECT status='failed' AND error_code='CAPACITY_CHANGED' FROM journey_hub.agent_runs WHERE id=(bad->>'id')::uuid),'post-consent capacity change fails run');
 PERFORM pg_temp.agent_assert(NOT EXISTS(SELECT 1 FROM journey_hub.agent_reservations WHERE run_id=(bad->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM journey_hub.bookings WHERE session_id='agent-test-3') AND NOT EXISTS(SELECT 1 FROM journey_hub.agent_mail_jobs WHERE run_id=(bad->>'id')::uuid),'failed itinerary has zero partial reservations or emails');

 -- Recover a serialization failure; no email opt-in produces no outbox entries.
 retryrun:=pg_temp.agent_plan(u1,ARRAY['agent-test-5','agent-test-6']);
 PERFORM public.journeyhub_agent_confirm((retryrun->>'id')::uuid,1,retryrun->>'planHash',false);
 PERFORM set_config('test.agent.retry','on',true);
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.agent_assert((SELECT status='pending' AND attempts=1 FROM journey_hub.agent_booking_jobs WHERE run_id=(retryrun->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM journey_hub.agent_reservations WHERE run_id=(retryrun->>'id')::uuid),'retryable failure releases atomic transaction');
 PERFORM set_config('test.agent.retry','off',true);
 UPDATE journey_hub.agent_booking_jobs SET run_at=now() WHERE run_id=(retryrun->>'id')::uuid;
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.agent_assert((SELECT status='booked' FROM journey_hub.agent_runs WHERE id=(retryrun->>'id')::uuid) AND (SELECT attempts=2 FROM journey_hub.agent_booking_jobs WHERE run_id=(retryrun->>'id')::uuid),'bounded retry succeeds once');
 PERFORM pg_temp.agent_assert(NOT EXISTS(SELECT 1 FROM journey_hub.agent_mail_jobs WHERE run_id=(retryrun->>'id')::uuid),'no email without consent');

 -- Mail status means provider acceptance, never a fabricated delivery receipt.
 jobs:=public.journeyhub_agent_claim_mail(1);j:=jobs->0;mailid:=(j->>'id')::uuid;token:=(j->>'lease_token')::uuid;
 PERFORM pg_temp.agent_assert(jsonb_array_length(jobs)=1 AND j->>'to_email'='agent-test-one@example.invalid' AND (j->>'verified_email')::bool AND j->>'booking_status'='confirmed','claim only verified confirmed mail');
 PERFORM pg_temp.agent_assert((j->>'send_window_expires_at')::timestamptz=now()+interval '23 hours','provider idempotency is bounded below 24 hours');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_finish_mail(%L,%L,''sent'',''id'',NULL)',mailid,gen_random_uuid()),'STALE_MAIL_LEASE');
 result:=public.journeyhub_agent_finish_mail(mailid,token,'config_missing',NULL,'provider configuration',60);
 PERFORM pg_temp.agent_assert(result->>'status'='pending' AND result->>'attempts'='0','configuration absence does not burn attempts');
 UPDATE journey_hub.agent_mail_jobs SET run_at=now()-interval '1 minute' WHERE id=mailid;
 j:=public.journeyhub_agent_claim_mail(1)->0;token:=(j->>'lease_token')::uuid;
 PERFORM pg_temp.agent_assert(j->>'id'=mailid::text AND j->'snapshot'=jobs#>'{0,snapshot}','retry preserves provider idempotency payload');
 result:=public.journeyhub_agent_finish_mail(mailid,token,'retry',NULL,'http_429',30);
 PERFORM pg_temp.agent_assert(result->>'attempts'='1' AND result->>'status'='pending','retry attempt is recorded');
 UPDATE journey_hub.agent_mail_jobs SET run_at=now()-interval '1 minute' WHERE id=mailid;
 j:=public.journeyhub_agent_claim_mail(1)->0;token:=(j->>'lease_token')::uuid;
 UPDATE journey_hub.agent_mail_jobs SET lease_until=now()-interval '1 second' WHERE id=mailid;
 j:=public.journeyhub_agent_claim_mail(1)->0;
 PERFORM pg_temp.agent_assert(j->>'lease_token'<>token::text AND (SELECT attempts=2 FROM journey_hub.agent_mail_jobs WHERE id=mailid),'expired lease is reclaimed with new token and retry budget');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_finish_mail(%L,%L,''sent'',''id'',NULL)',mailid,token),'STALE_MAIL_LEASE');
 result:=public.journeyhub_agent_finish_mail(mailid,(j->>'lease_token')::uuid,'sent','test-provider-accepted',NULL,60);
 PERFORM pg_temp.agent_assert(result->>'status'='accepted' AND result->>'attempts'='3','provider accepted is explicit');
 PERFORM pg_temp.agent_assert((SELECT status='booked' FROM journey_hub.agent_runs WHERE id=rid),'mail independent from reservation state');
 -- A changed verified recipient cannot silently receive the old job payload.
 UPDATE auth.users SET email='agent-test-changed@example.invalid' WHERE id=u1;
 jobs:=public.journeyhub_agent_claim_mail();
 PERFORM pg_temp.agent_assert(jobs='[]' AND (SELECT count(*)=1 FROM journey_hub.agent_mail_jobs WHERE run_id=rid AND status='failed' AND last_error='RECIPIENT_OR_BOOKING_CHANGED'),'changed verified recipient cancels queued confirmation');
 UPDATE auth.users SET email='agent-test-one@example.invalid' WHERE id=u1;
 UPDATE journey_hub.agent_mail_jobs SET run_at=now(),first_lease_at=now()-interval '24 hours',send_window_expires_at=now()-interval '1 hour' WHERE run_id=rid AND template='booking_reminder';
 jobs:=public.journeyhub_agent_claim_mail();
 PERFORM pg_temp.agent_assert(jobs='[]' AND (SELECT count(*)=2 FROM journey_hub.agent_mail_jobs WHERE run_id=rid AND template='booking_reminder' AND status='failed'),'expired idempotency window prevents resend');

 -- SMTP cannot safely reclaim a possibly accepted send; transport is frozen.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u2)::text,true);
 r2:=pg_temp.agent_plan(u2,ARRAY['agent-test-7','agent-test-8']);
 PERFORM public.journeyhub_agent_confirm((r2->>'id')::uuid,1,r2->>'planHash',true);
 PERFORM public.journeyhub_agent_process_bookings();
 j:=public.journeyhub_agent_claim_mail(1,'smtp')->0;mailid:=(j->>'id')::uuid;
 UPDATE journey_hub.agent_mail_jobs SET lease_until=now()-interval '1 second',run_at=now()-interval '1 minute' WHERE id=mailid;
 jobs:=public.journeyhub_agent_claim_mail(1,'smtp');
 PERFORM pg_temp.agent_assert(jobs='[]' AND (SELECT status='failed' AND last_error='smtp_delivery_unknown' FROM journey_hub.agent_mail_jobs WHERE id=mailid),'expired SMTP lease is never resent automatically');
 j:=public.journeyhub_agent_claim_mail(1,'smtp')->0;mailid:=(j->>'id')::uuid;
 PERFORM public.journeyhub_agent_finish_mail(mailid,(j->>'lease_token')::uuid,'config_missing',NULL,NULL,60);
 UPDATE journey_hub.agent_mail_jobs SET run_at=now()-interval '1 minute' WHERE id=mailid;
 jobs:=public.journeyhub_agent_claim_mail(1,'resend');
 PERFORM pg_temp.agent_assert(jobs='[]' AND (SELECT status='failed' AND last_error='MAIL_PROVIDER_CHANGED' FROM journey_hub.agent_mail_jobs WHERE id=mailid),'transport changes require review instead of duplicate send');

 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u1)::text,true);
 r2:=pg_temp.agent_plan(u1,ARRAY['agent-test-9','agent-test-10']);
 UPDATE journey_hub.agent_runs SET expires_at=now()-interval '1 second' WHERE id=(r2->>'id')::uuid;
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,true)',r2->>'id',r2->>'planHash'),'PLAN_EXPIRED_OR_NOT_READY');
 UPDATE journey_hub.agent_runs SET expires_at=now()+interval '1 minute' WHERE id=(r2->>'id')::uuid;
 PERFORM public.journeyhub_agent_confirm((r2->>'id')::uuid,1,r2->>'planHash',true);
 PERFORM public.journeyhub_agent_process_bookings();
 j:=public.journeyhub_agent_claim_mail(1,'resend')->0;mailid:=(j->>'id')::uuid;
 FOR i IN 1..5 LOOP
  result:=public.journeyhub_agent_finish_mail(mailid,(j->>'lease_token')::uuid,'retry',NULL,'http_503',60);
  IF i<5 THEN
   UPDATE journey_hub.agent_mail_jobs SET run_at=now()-interval '1 minute' WHERE id=mailid;
   j:=public.journeyhub_agent_claim_mail(1,'resend')->0;
  END IF;
 END LOOP;
 PERFORM pg_temp.agent_assert(result->>'attempts'='5' AND result->>'status'='failed' AND (SELECT status='booked' FROM journey_hub.agent_runs WHERE id=(r2->>'id')::uuid),'mail retry exhaustion does not lose reservations');

 bad:=pg_temp.agent_plan(u1,ARRAY['agent-test-7','agent-test-8']);
 PERFORM public.journeyhub_agent_confirm((bad->>'id')::uuid,1,bad->>'planHash',false);
 UPDATE journey_hub.venues SET city='Singapore' WHERE venue_id=venueid;
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.agent_assert((SELECT status='failed' AND error_code='ITINERARY_CHANGED' FROM journey_hub.agent_runs WHERE id=(bad->>'id')::uuid) AND NOT EXISTS(SELECT 1 FROM journey_hub.agent_reservations WHERE run_id=(bad->>'id')::uuid),'post-consent venue change cannot book a different itinerary');
 UPDATE journey_hub.venues SET city='Bangkok' WHERE venue_id=venueid;

 -- Planner request token can be reclaimed only three times in total.
 started:=public.journeyhub_agent_begin(u2,gen_random_uuid(),inp);token:=(started->>'planning_token')::uuid;
 SELECT ar.request_id INTO request_id FROM journey_hub.agent_runs ar WHERE id=(started->>'id')::uuid;
 UPDATE journey_hub.agent_runs SET planning_until=now()-interval '1 second' WHERE id=(started->>'id')::uuid;
 again:=public.journeyhub_agent_begin(u2,request_id,inp);
 PERFORM pg_temp.agent_assert((again->>'planning_token')::uuid<>token AND NOT (again->>'cached')::bool,'expired planner lease is reclaimed');
 UPDATE journey_hub.agent_runs SET planning_until=now()-interval '1 second',planning_attempts=3 WHERE id=(started->>'id')::uuid;
 again:=public.journeyhub_agent_begin(u2,request_id,inp);
 PERFORM pg_temp.agent_assert(again->>'status'='failed' AND again#>>'{run,errorCode}'='PLANNER_TIMEOUT','planner timeout budget is bounded');
 FOR i IN 1..4 LOOP
  started:=public.journeyhub_agent_begin(u2,gen_random_uuid(),inp);
  IF i=1 THEN
   UPDATE journey_hub.agent_runs SET planning_until=now()-interval '2 minutes' WHERE id=(started->>'id')::uuid;
   bad:=started;
  ELSIF i=2 THEN
   UPDATE journey_hub.agent_runs SET planning_until=now()-interval '30 seconds' WHERE id=(started->>'id')::uuid;
  END IF;
 END LOOP;
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM public.journeyhub_agent_process_bookings();
 PERFORM pg_temp.agent_assert((SELECT status='failed' AND error_code='PLANNER_TIMEOUT' FROM journey_hub.agent_runs WHERE id=(bad->>'id')::uuid),'watchdog fails abandoned planning requests');
 PERFORM pg_temp.agent_assert((SELECT count(*)=1 FROM journey_hub.agent_events WHERE run_id=(bad->>'id')::uuid AND type='planning_failed' AND detail->>'source'='watchdog'),'watchdog audit event is idempotent');
 PERFORM pg_temp.agent_assert((SELECT count(*)=3 FROM journey_hub.agent_runs WHERE user_id=u2 AND status='planning'),'watchdog preserves valid leases and grace period');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_finalize(%L,%L,%L,''test'',''test'')',bad->>'id',bad->>'planning_token','{"stops":[{"sessionId":"agent-test-1"}]}'),'PLANNER_LEASE_EXPIRED');
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_begin(%L,%L,%L)',u2,gen_random_uuid(),inp),'PLANNER_RATE_LIMIT');
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM pg_temp.agent_error(format('SELECT public.journeyhub_agent_confirm(%L,1,%L,true)',rid,r->>'planHash'),'SIGN_IN_REQUIRED');
 PERFORM pg_temp.agent_error('SELECT public.journeyhub_agent_list()','SIGN_IN_REQUIRED');
 PERFORM pg_temp.agent_assert(NOT has_function_privilege('anon','public.journeyhub_agent_confirm(uuid,integer,text,boolean)','execute'),'anonymous confirm denied');
 PERFORM pg_temp.agent_assert(NOT has_function_privilege('authenticated','public.journeyhub_agent_claim_mail(integer,text)','execute') AND NOT has_function_privilege('authenticated','public.journeyhub_agent_begin(uuid,uuid,jsonb)','execute'),'traveler cannot execute server planner or mail');
 PERFORM pg_temp.agent_assert(has_function_privilege('service_role','public.journeyhub_agent_claim_mail(integer,text)','execute') AND NOT has_table_privilege('authenticated','journey_hub.agent_approvals','update'),'worker privilege and immutable consent storage');
 PERFORM set_config('test.agent.owner',u1::text,true);
 PERFORM set_config('test.agent.run',rid::text,true);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.agent.owner'))::text,true);
SELECT pg_temp.agent_assert(public.journeyhub_agent_get(current_setting('test.agent.run')::uuid)->>'status'='booked','authenticated invoker wrapper works without table grants');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.agent_assert(jsonb_typeof(public.journeyhub_agent_worker_config())='object','service-only configuration wrapper works');
RESET ROLE;
SELECT 'PASS: agent approval/ownership/replay, immutable prices, atomic reservations, retries, consent, mail leases and recipient freeze; all fixtures rolled back' AS result;
ROLLBACK;
