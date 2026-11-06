-- Transactional API/database regression: fixtures and bookings are rolled back.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean,label text)RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END $$;
CREATE OR REPLACE FUNCTION pg_temp.denied(payload jsonb,label text)RETURNS void LANGUAGE plpgsql AS $$
DECLARE failed boolean:=false;
BEGIN BEGIN PERFORM public.journeyhub_command('plan',payload,gen_random_uuid());EXCEPTION WHEN OTHERS THEN failed:=true;END;
PERFORM pg_temp.assert_true(failed,label);END $$;
DO $$
DECLARE coordinator uuid:=gen_random_uuid();manager uuid:=gen_random_uuid();manager2 uuid:=gen_random_uuid();traveler uuid:=gen_random_uuid();host_user uuid:=gen_random_uuid();
 expid text:='f3-test-'||gen_random_uuid();venue text:='f3-venue-'||gen_random_uuid();
 cstaff text:='ZC-'||lpad(floor(random()*10000)::text,4,'0');mstaff text:='ZM-'||lpad(floor(random()*10000)::text,4,'0');
 m2staff text:='ZN-'||lpad(floor(random()*10000)::text,4,'0');hstaff text:='ZH-'||lpad(floor(random()*10000)::text,4,'0');
 future_date date:=(date_trunc('month',now()AT TIME ZONE 'Asia/Singapore')+interval '2 months')::date;
 pid text;pid2 text;session1 text;session2 text;booking1 text;booking2 text;booking3 text;tid uuid;
 result1 jsonb;result2 jsonb;payload jsonb;snap jsonb;live jsonb;req uuid;revision int;oldrevision int;failed boolean;history_hash text;history_after text;
BEGIN
 SELECT md5(COALESCE(jsonb_agg(to_jsonb(s)ORDER BY experience_id,month,week)::text,''))INTO history_hash FROM journey_hub.activity_weekly_stats s;
 INSERT INTO auth.users(id,email,raw_user_meta_data)VALUES
 (coordinator,'f3-'||coordinator||'@example.invalid','{}'),(manager,'f3-'||manager||'@example.invalid','{}'),
 (manager2,'f3-'||manager2||'@example.invalid','{}'),(traveler,'f3-'||traveler||'@example.invalid','{}'),(host_user,'f3-'||host_user||'@example.invalid','{}');
 INSERT INTO journey_hub.venues(venue_id,name,kind,area,city,country,time_zone)VALUES(venue,'Feature 3 test venue','workshop_venue','Test','Singapore','Singapore','Asia/Singapore');
 INSERT INTO journey_hub.experiences(experience_id,venue_id,name,kind,price_thb,duration_min)VALUES(expid,venue,'Feature 3 test experience','Workshop',1500,95);
 INSERT INTO journey_hub.staff(staff_id,display_name,role,venue_id,pin_hash,auth_user_id)VALUES
 (cstaff,'Test coordinator','coordinator',venue,'disabled',coordinator),(mstaff,'Test manager','duty_manager',venue,'disabled',manager),
 (m2staff,'Test second manager','duty_manager',venue,'disabled',manager2),(hstaff,'Test host','host',venue,'disabled',host_user);

 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',coordinator)::text,true);
 payload:=jsonb_build_object('action','create','exp',expid,'date',future_date,'startTime','00:15','cap',10,'price',1400,'promo',100,'reason','');req:=gen_random_uuid();
 result1:=public.journeyhub_command('plan',payload,req);pid:=result1->>'id';revision:=(result1->>'version')::int;
 result2:=public.journeyhub_command('plan',payload,req);
 PERFORM pg_temp.assert_true(result1=result2,'same create request is idempotent');
 failed:=false;BEGIN PERFORM public.journeyhub_command('plan',payload||'{"cap":11}',req);EXCEPTION WHEN OTHERS THEN failed:=true;END;
 PERFORM pg_temp.assert_true(failed,'request id cannot represent different publication inputs');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM journey_hub.session_plans WHERE experience_id=expid),'one new plan row');
 PERFORM pg_temp.denied(jsonb_build_object('id',pid,'action','submit','version',revision),'empty draft reason cannot be submitted');

 payload:=jsonb_build_object('id',pid,'action','save','version',revision,'date',future_date,'startTime','00:15','cap',10,'price',1400,'promo',100,'reason','Regression test session publication');
 PERFORM pg_temp.denied(payload||jsonb_build_object('date',(now()AT TIME ZONE 'Asia/Singapore')::date-1),'past date rejected');
 PERFORM pg_temp.denied(payload||jsonb_build_object('date',(now()AT TIME ZONE 'Asia/Singapore')::date+366),'beyond one year rejected');
 PERFORM pg_temp.denied(payload||'{"startTime":"25:00"}','invalid exact time rejected');
 PERFORM pg_temp.denied(payload||'{"cap":41}','forecast capacity guard kept');
 PERFORM pg_temp.denied(payload||'{"price":2001}','forecast price guard kept');
 PERFORM pg_temp.denied(payload-'version','version required for mutation');
 result1:=public.journeyhub_command('plan',payload,gen_random_uuid());revision:=(result1->>'version')::int;
 PERFORM pg_temp.denied(payload,'stale draft save rejected');
 PERFORM pg_temp.assert_true((SELECT session_date=future_date AND start_time='00:15'AND capacity=10 AND price_thb=1400 AND promo_budget_thb=100 FROM journey_hub.session_plans WHERE plan_id=pid),'exact date time price capacity saved');
 snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'sessionPlans')x WHERE x->>'plan_id'=pid AND(x->>'session_date')::date=future_date AND(x->>'version')::int=revision),'refresh reloads saved revision and date');

 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid,'action','submit','version',revision),gen_random_uuid());revision:=(result1->>'version')::int;oldrevision:=revision;
 PERFORM pg_temp.denied(payload||jsonb_build_object('version',revision),'submitted draft cannot be edited');
 PERFORM pg_temp.denied(jsonb_build_object('id',pid,'action','approve','version',revision),'coordinator cannot approve');
 -- An old manager page cannot approve a withdrawn, changed and resubmitted revision.
 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid,'action','withdraw','version',revision),gen_random_uuid());revision:=(result1->>'version')::int;
 result1:=public.journeyhub_command('plan',payload||jsonb_build_object('version',revision),gen_random_uuid());revision:=(result1->>'version')::int;
 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid,'action','submit','version',revision),gen_random_uuid());revision:=(result1->>'version')::int;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager)::text,true);
 PERFORM pg_temp.denied(jsonb_build_object('id',pid,'action','approve','version',oldrevision),'stale approval cannot publish unseen changes');
 payload:=jsonb_build_object('id',pid,'action','approve','version',revision);req:=gen_random_uuid();
 result1:=public.journeyhub_command('plan',payload,req);session1:=result1->>'createdSessionId';
 PERFORM pg_temp.assert_true(result1=public.journeyhub_command('plan',payload,req),'approval network retry returns same result');
 PERFORM pg_temp.assert_true(result1=public.journeyhub_command('plan',payload,gen_random_uuid()),'different request cannot republish approved plan');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM journey_hub.sessions WHERE experience_id=expid),'only one session published');
 PERFORM pg_temp.assert_true((SELECT starts_at=(future_date+time '00:15')AT TIME ZONE 'Asia/Singapore'AND ends_at=starts_at+interval '95 minutes'AND capacity=10 AND price_thb=1400 AND status='open'FROM journey_hub.sessions WHERE session_id=session1),'published fields use destination time zone and exact values');

 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid,'action','new','date',future_date,'startTime','11:25','price',1800),gen_random_uuid());pid2:=result1->>'id';revision:=(result1->>'version')::int;
 PERFORM pg_temp.assert_true(pid<>pid2 AND(SELECT status='approved'AND created_session_id=session1 FROM journey_hub.session_plans WHERE plan_id=pid),'new draft preserves approved plan and session');
 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid2,'action','submit','version',revision),gen_random_uuid());revision:=(result1->>'version')::int;
 PERFORM pg_temp.denied(jsonb_build_object('id',pid2,'action','approve','version',revision),'duty manager cannot self approve');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager2)::text,true);
 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid2,'action','approve','version',revision),gen_random_uuid());session2:=result1->>'createdSessionId';
 -- A different plan cannot create a duplicate slot.
 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid,'action','new','date',future_date,'startTime','00:15'),gen_random_uuid());pid2:=result1->>'id';revision:=(result1->>'version')::int;
 result1:=public.journeyhub_command('plan',jsonb_build_object('id',pid2,'action','submit','version',revision),gen_random_uuid());revision:=(result1->>'version')::int;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager)::text,true);
 PERFORM pg_temp.denied(jsonb_build_object('id',pid2,'action','approve','version',revision),'duplicate experience/start cannot publish twice');
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM journey_hub.sessions WHERE experience_id=expid),'two separate planned sessions preserved');

 PERFORM set_config('request.jwt.claims','{}',true);snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'sessions')x WHERE x->>'session_id'=session1 AND x->>'status'='open'),'published session visible to traveler catalog');
 PERFORM pg_temp.assert_true(snap->'sessionPlans'='[]'::jsonb AND snap->'liveMetrics'='[]'::jsonb,'anonymous cannot read staff planning and metrics');
 PERFORM pg_temp.denied('{"action":"create"}','anonymous cannot mutate planning');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',host_user)::text,true);snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.assert_true(snap->'sessionPlans'='[]'::jsonb AND snap->'liveMetrics'='[]'::jsonb,'host cannot read coordinator metrics');
 PERFORM pg_temp.denied('{"action":"create"}','host cannot create plans');

 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',traveler)::text,true);
 PERFORM public.journeyhub_command('profile','{}',gen_random_uuid());SELECT traveler_id INTO tid FROM journey_hub.travelers WHERE auth_user_id=traveler;
 PERFORM pg_temp.denied('{"action":"create"}','traveler cannot create staff plans');
 req:=gen_random_uuid();payload:=jsonb_build_object('sessionId',session1,'guests',6,'price',1);
 result1:=public.journeyhub_command('book',payload,req);booking1:=result1->>'id';
 PERFORM pg_temp.assert_true(result1=public.journeyhub_command('book',payload,req),'booking retry reserves once');
 result1:=public.journeyhub_command('book',jsonb_build_object('sessionId',session1,'guests',4),gen_random_uuid());booking2:=result1->>'id';
 failed:=false;BEGIN PERFORM public.journeyhub_command('book',jsonb_build_object('sessionId',session1,'guests',1),gen_random_uuid());EXCEPTION WHEN OTHERS THEN failed:=true;END;
 PERFORM pg_temp.assert_true(failed,'published capacity cannot be oversold');
 result1:=public.journeyhub_command('book',jsonb_build_object('sessionId',session2,'guests',3),gen_random_uuid());booking3:=result1->>'id';
 PERFORM pg_temp.assert_true((SELECT guests=6 AND unit_price_thb=1400 AND traveler_id=tid FROM journey_hub.bookings WHERE booking_id=booking1),'traveler booking stores authoritative price and owner');
 snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.assert_true((SELECT(x->>'seats_taken')::int=10 FROM jsonb_array_elements(snap->'sessions')x WHERE x->>'session_id'=session1),'traveler refresh sees reserved seats');
 PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM jsonb_array_elements(snap->'bookings')x WHERE x->>'booking_id'IN(booking1,booking2,booking3))AND snap->'liveMetrics'='[]'::jsonb,'traveler refresh sees own persistent bookings only');

 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',manager)::text,true);snap:=public.journeyhub_snapshot();
 SELECT x INTO live FROM jsonb_array_elements(snap->'liveMetrics')x WHERE x->>'experience_id'=expid;
 PERFORM pg_temp.assert_true((live->>'sessions')::int=2 AND(live->>'seats_offered')::int=20 AND(live->>'booked')::int=13 AND(live->>'confirmed')::int=13,'live counts guests and each capacity once, including equal capacities');
 PERFORM pg_temp.assert_true((live->>'booked_value_thb')::int=19400 AND(live->>'month')::date=future_date,'live value uses booked unit prices and venue-local session month');
 -- Simulate authoritative cancellation and attendance changes; nothing is externally charged.
 UPDATE journey_hub.bookings SET status='cancelled'WHERE booking_id=booking2;
 UPDATE journey_hub.bookings SET checked_in_at=now()WHERE booking_id=booking1;
 UPDATE journey_hub.sessions SET seats_held_other_channels=2 WHERE session_id=session2;
 snap:=public.journeyhub_snapshot();SELECT x INTO live FROM jsonb_array_elements(snap->'liveMetrics')x WHERE x->>'experience_id'=expid;
 PERFORM pg_temp.assert_true((live->>'booked')::int=13 AND(live->>'cancelled')::int=4 AND(live->>'confirmed')::int=9 AND(live->>'attended')::int=6 AND(live->>'booked_value_thb')::int=13800 AND(live->>'other_channel_held')::int=2,'cancellation attendance and channel holds are distinct');
 PERFORM pg_temp.assert_true((SELECT(x->>'seats_taken')::int=6 FROM jsonb_array_elements(snap->'sessions')x WHERE x->>'session_id'=session1),'cancelled guests release live seats');
 SELECT md5(COALESCE(jsonb_agg(to_jsonb(s)ORDER BY experience_id,month,week)::text,''))INTO history_after FROM journey_hub.activity_weekly_stats s;
 PERFORM pg_temp.assert_true(history_hash=history_after,'historical forecast input rows are untouched');
 PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','journey_hub.plan_command(jsonb)','execute')AND NOT has_function_privilege('authenticated','journey_hub.live_metrics()','execute'),'internal privileged helpers inaccessible directly');
END $$;
SELECT 'PASS: multi-plan lifecycle, future dates, exact timezone publication, stale approvals, role isolation, idempotency, traveler availability, capacity and persisted live reporting; historical forecasts unchanged'AS result;
ROLLBACK;
