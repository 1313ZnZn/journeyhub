BEGIN;
CREATE FUNCTION pg_temp.sat_assert(ok boolean,label text)RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'STAFF TRIAGE TEST FAILED: %',label;END IF;END $$;
DO $$
DECLARE u uuid:=gen_random_uuid();sid text;ven text;code text;demo text:='SA-DEMO-'||gen_random_uuid();normal text:='SA-NORMAL-'||gen_random_uuid();critical text:='SA-CRITICAL-'||gen_random_uuid();result jsonb;first_task jsonb;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data)VALUES(u,'triage-'||u||'@example.invalid','{}');
 SELECT venue_id INTO ven FROM journey_hub.experiences WHERE experience_id='craft';
 LOOP sid:='AZ-'||(1000+floor(random()*9000)::int);EXIT WHEN NOT EXISTS(SELECT 1 FROM journey_hub.staff WHERE staff_id=sid);END LOOP;
 INSERT INTO journey_hub.staff(staff_id,display_name,role,venue_id,pin_hash,auth_user_id)VALUES(sid,'Triage QA','coordinator',ven,'disabled',u);
 INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb,is_demo,seats_held_other_channels)VALUES
 (demo,'craft',now()+interval '12 hours',now()+interval '14 hours',20,1400,true,0),
 (normal,'craft',now()+interval '12 hours',now()+interval '14 hours',20,1400,false,0),
 (critical,'craft',now()+interval '13 hours',now()+interval '15 hours',20,1400,true,0);
 UPDATE journey_hub.sessions SET status='closed'WHERE session_id=critical;
 LOOP code:=translate(upper(left(gen_random_uuid()::text,6)),'01','AB');EXIT WHEN NOT EXISTS(SELECT 1 FROM journey_hub.bookings WHERE checkin_code=code);END LOOP;
 INSERT INTO journey_hub.bookings(booking_id,session_id,guest_name,guests,channel,unit_price_thb,checkin_code,demo)VALUES('SA-B-'||gen_random_uuid(),critical,'Rollback fixture',1,'partner_desk',1400,code,true);
 INSERT INTO journey_hub.staff_agent_tasks(task_key,kind,status,title,summary,evidence,session_id,venue_id)
 VALUES('session:'||demo,'session_attention','attention','Old synthesized inventory alert','Previously generated.',jsonb_build_object('reason','low_fill'),demo,ven);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);result:=public.journeyhub_staff_agent('refresh',NULL);
 PERFORM pg_temp.sat_assert((SELECT status='resolved'FROM journey_hub.staff_agent_tasks WHERE session_id=demo),'old demo low fill is resolved, not deleted');
 PERFORM pg_temp.sat_assert(EXISTS(SELECT 1 FROM journey_hub.staff_agent_tasks WHERE session_id=normal AND status='attention'AND evidence->>'reason'='low_fill'),'business low fill is retained');
 PERFORM pg_temp.sat_assert(EXISTS(SELECT 1 FROM journey_hub.staff_agent_tasks WHERE session_id=critical AND status='attention'AND evidence->>'reason'='closed_with_bookings'),'demo inventory still gets critical reservation check');
 first_task:=result->'tasks'->0;
 PERFORM pg_temp.sat_assert(first_task->>'kind'='session_attention'AND first_task#>>'{evidence,reason}'IN('capacity_conflict','closed_with_bookings'),'critical issues precede opportunity');
 PERFORM pg_temp.sat_assert((result->>'returnedCount')::int=jsonb_array_length(result->'tasks')AND(result->>'returnedCount')::int<=50,'returned count is truthful and bounded');
 PERFORM pg_temp.sat_assert((result->>'totalCount')::int=(SELECT count(*)FROM journey_hub.staff_agent_tasks WHERE status<>'resolved'),'total count includes tasks outside returned page');
 PERFORM pg_temp.sat_assert((result#>>'{counts,sessionChecks}')::int=(SELECT count(*)FROM journey_hub.staff_agent_tasks WHERE kind='session_attention'AND status<>'resolved'AND(acknowledged_until IS NULL OR acknowledged_until<=now())),'session check count is not truncated');
END $$;
SELECT 'PASS staff triage: synthetic low fill suppressed/resolved, critical inventory checks retained and prioritized, bounded response with truthful full counts'AS result;
ROLLBACK;
