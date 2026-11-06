-- Fail abandoned planning runs after the planner lease plus one minute of grace.
BEGIN;
CREATE INDEX IF NOT EXISTS agent_runs_planning_due ON journey_hub.agent_runs(planning_until,id) WHERE status='planning';
CREATE OR REPLACE FUNCTION journey_hub.agent_process_bookings(p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=journey_hub,pg_catalog AS $$
DECLARE job agent_booking_jobs;r agent_runs;a agent_approvals;t travelers;item jsonb;bid text;code text;snapshot jsonb;trycode int;codeok boolean;done int:=0;bad int:=0;err text;retryable boolean;
BEGIN
 -- A stopped Edge request cannot leave an orphaned planning run forever.
 -- One minute of grace avoids racing the request's normal failure callback;
 -- row locks fence concurrent finalize/reclaim calls without blocking them.
 WITH stale AS (
  SELECT id FROM agent_runs WHERE status='planning' AND planning_until<now()-interval '1 minute'
  ORDER BY planning_until,id LIMIT 100 FOR UPDATE SKIP LOCKED
 ),expired AS (
  UPDATE agent_runs target_run SET status='failed',error_code='PLANNER_TIMEOUT',updated_at=now()
  FROM stale s WHERE target_run.id=s.id AND target_run.status='planning' RETURNING target_run.id
 ) INSERT INTO agent_events(run_id,type,detail)
 SELECT id,'planning_failed',jsonb_build_object('code','PLANNER_TIMEOUT','source','watchdog') FROM expired;
 FOR job IN SELECT * FROM agent_booking_jobs WHERE status='pending' AND run_at<=now() ORDER BY run_at,id LIMIT greatest(1,least(COALESCE(p_limit,10),50)) FOR UPDATE SKIP LOCKED LOOP
  UPDATE agent_booking_jobs SET status='processing',attempts=attempts+1 WHERE id=job.id;
  BEGIN
   SELECT * INTO r FROM agent_runs WHERE id=job.run_id FOR UPDATE;
   SELECT * INTO a FROM agent_approvals WHERE run_id=r.id;
   IF NOT FOUND OR r.status<>'queued' OR a.plan_hash<>r.plan_hash OR a.snapshot<>r.plan THEN RAISE EXCEPTION 'APPROVAL_MISSING';END IF;
   IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=r.user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE';END IF;
   PERFORM agent_validate(a.snapshot,r.user_id);
   SELECT * INTO t FROM travelers WHERE auth_user_id=r.user_id;
   FOR item IN SELECT value FROM jsonb_array_elements(a.snapshot->'stops') ORDER BY value->>'sessionId' LOOP
    bid:='B-AG-'||replace(r.id::text,'-','')||'-'||substr(md5(item->>'sessionId'),1,12);codeok:=false;
    FOR trycode IN 1..8 LOOP
     SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',1+floor(random()*length('ABCDEFGHJKMNPQRSTUVWXYZ23456789'))::integer,1),'') INTO code FROM generate_series(1,6);
     BEGIN
      INSERT INTO bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code)
      VALUES(bid,item->>'sessionId',t.traveler_id,t.display_name,(a.snapshot->>'guests')::int,'app',(item->>'unitPriceThb')::int,code);
      codeok:=true;EXIT;
     EXCEPTION WHEN unique_violation THEN IF EXISTS(SELECT 1 FROM bookings WHERE booking_id=bid) THEN RAISE;END IF;
     END;
    END LOOP;
    IF NOT codeok THEN RAISE EXCEPTION 'CODE_ALLOCATION_FAILED' USING ERRCODE='40001';END IF;
    INSERT INTO agent_reservations(run_id,session_id,booking_id) VALUES(r.id,item->>'sessionId',bid);
    IF a.email_opt_in THEN
     snapshot:=jsonb_build_object('booking_id',bid,'session_id',item->>'sessionId','experience_title',item->>'title','starts_at',item->>'startsAt','time_zone',item->>'timeZone','venue_name',item->>'venue','address',item->>'venue','party_size',(a.snapshot->>'guests')::int,'traveler_name',t.display_name,'booking_reference',code);
     INSERT INTO agent_mail_jobs(run_id,session_id,booking_id,template,to_email,snapshot)
     VALUES(r.id,item->>'sessionId',bid,'booking_confirmation',a.to_email,snapshot);
     IF (item->>'startsAt')::timestamptz>now()+interval '15 minutes' THEN
      INSERT INTO agent_mail_jobs(run_id,session_id,booking_id,template,to_email,snapshot,run_at)
      VALUES(r.id,item->>'sessionId',bid,'booking_reminder',a.to_email,snapshot,greatest(now()+interval '5 minutes',(item->>'startsAt')::timestamptz-interval '2 hours'));
     END IF;
    END IF;
   END LOOP;
   UPDATE agent_runs SET status='booked',updated_at=now(),error_code=NULL WHERE id=r.id;
   UPDATE agent_booking_jobs SET status='succeeded',finished_at=now(),last_error=NULL WHERE id=job.id;
   INSERT INTO agent_events(run_id,type,detail) VALUES(r.id,'reservations_created',jsonb_build_object('count',jsonb_array_length(a.snapshot->'stops')));done:=done+1;
  EXCEPTION WHEN OTHERS THEN
   err:=CASE WHEN SQLERRM IN ('APPROVAL_MISSING','ACCOUNT_UNAVAILABLE','PROFILE_REQUIRED','SESSION_CHANGED','ITINERARY_CHANGED','PRICE_CHANGED','CAPACITY_CHANGED','ALREADY_BOOKED') THEN SQLERRM ELSE 'BOOKING_FAILED' END;retryable:=SQLSTATE IN ('40001','40P01','55P03');
   UPDATE agent_booking_jobs SET status=CASE WHEN retryable AND attempts<max_attempts THEN 'pending' ELSE 'failed' END,
    last_error=CASE WHEN retryable THEN 'TEMPORARY_DATABASE_ERROR' ELSE err END,run_at=now()+make_interval(secs=>least(900,30*(2^least(attempts,5))::int)),finished_at=CASE WHEN retryable AND attempts<max_attempts THEN NULL ELSE now() END WHERE id=job.id;
   IF NOT retryable OR job.attempts+1>=job.max_attempts THEN UPDATE agent_runs SET status='failed',error_code=CASE WHEN retryable THEN 'BOOKING_RETRIES_EXHAUSTED' ELSE err END,updated_at=now() WHERE id=job.run_id;END IF;
   INSERT INTO agent_events(run_id,type,detail) VALUES(job.run_id,'booking_attempt_failed',jsonb_build_object('code',CASE WHEN retryable THEN 'TEMPORARY_DATABASE_ERROR' ELSE err END));bad:=bad+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('booked',done,'failedAttempts',bad);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;

