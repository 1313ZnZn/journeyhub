-- Integration tests: one transaction, disposable identities/fixtures, always ROLLBACK.
-- Run after unified-booking.sql. No provider calls, outbound mail or real payments.
BEGIN;
CREATE FUNCTION pg_temp.ub_assert(ok boolean,label text)RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END $$;
CREATE FUNCTION pg_temp.ub_error(statement text,expected text)RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN;END IF;RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM;END;RAISE EXCEPTION 'Expected %, command succeeded',expected;END $$;
CREATE FUNCTION pg_temp.ub_history(uid uuid,dt date)RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE root uuid:=gen_random_uuid();hid uuid:=gen_random_uuid();prefs jsonb;plan jsonb;
BEGIN
 prefs:=jsonb_build_object('city','Shanghai','date',dt,'guests',2,'prompt','Rollback-only museum, lunch, tea and park itinerary','days',1,'dayStart','09:00','dayEnd','21:00','transport','walk');
 plan:='{"summary":"Rollback fixture","stops":[{"id":"ub_museum","dayIndex":1,"start":"09:00","end":"10:00","reason":"Museum"},{"id":"ub_restaurant","dayIndex":1,"start":"12:00","end":"13:00","reason":"Lunch"},{"id":"ub_cafe","dayIndex":1,"start":"14:00","end":"15:00","reason":"Tea"},{"id":"ub_park","dayIndex":1,"start":"16:00","end":"17:00","reason":"Park"}]}';
 PERFORM public.journeyhub_trip_history_save(uid,root,prefs,ARRAY['ub_museum','ub_restaurant','ub_cafe','ub_park'],'{}','{}',NULL,NULL);
 PERFORM public.journeyhub_trip_history_save(uid,hid,prefs,ARRAY['ub_museum','ub_restaurant','ub_cafe','ub_park'],ARRAY['ub_museum','ub_restaurant','ub_cafe','ub_park'],'{}',plan,root);
 RETURN hid;
END $$;
CREATE FUNCTION pg_temp.ub_items()RETURNS jsonb LANGUAGE sql AS $$SELECT '[{"stopId":"ub_museum","kind":"ticket","unitMinor":4000,"displayTitle":"Museum visit"},{"stopId":"ub_restaurant","kind":"restaurant","unitMinor":5000,"displayTitle":"Restaurant lunch"},{"stopId":"ub_cafe","kind":"cafe","unitMinor":2000,"displayTitle":"Tea cafe"},{"stopId":"ub_park","kind":"free","unitMinor":0}]'::jsonb$$;
DO $$
DECLARE u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();staffuser uuid:=gen_random_uuid();tid uuid;h uuid;h2 uuid;h3 uuid;rid uuid;bid text;newbid text;did uuid;qid uuid;q2id uuid;
 q jsonb;result jsonb;snap jsonb;items jsonb;plan jsonb;prefs jsonb;ss journey_hub.sessions;dt date:=current_date+80;initial_balance int;beforecount int;beforeledger int;sid text;sid2 text;exp text;ven text;req uuid:=gen_random_uuid();cancelreq uuid:=gen_random_uuid();worker jsonb;runhash text;staffid text;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)VALUES
 (u,'unified-'||u||'@example.invalid',now(),'{}'),(v,'unified-'||v||'@example.invalid',now(),'{}'),(staffuser,'unified-'||staffuser||'@example.invalid',now(),'{}');
 PERFORM pg_temp.ub_assert(NOT has_function_privilege('authenticated','public.journeyhub_demo_session_quote(uuid,text,integer)','EXECUTE'),'browser cannot select quote owner');
 PERFORM pg_temp.ub_assert(NOT has_function_privilege('anon','public.journeyhub_demo_book(uuid,uuid,uuid)','EXECUTE'),'anonymous cannot debit wallet');
 PERFORM pg_temp.ub_assert(NOT has_function_privilege('authenticated','journey_hub.unified_reserve(uuid,uuid,jsonb)','EXECUTE'),'shared primitive not browser callable');
 PERFORM pg_temp.ub_assert(NOT has_function_privilege('service_role','journey_hub.command_before_unified(text,jsonb,uuid)','EXECUTE'),'legacy bypass revoked');
 PERFORM pg_temp.ub_assert(NOT has_table_privilege('authenticated','journey_hub.demo_wallets','UPDATE'),'wallet table mutation blocked');
 PERFORM pg_temp.ub_assert(has_function_privilege('service_role','public.journeyhub_demo_book(uuid,uuid,uuid)','EXECUTE'),'backend booking wrapper authorized');
 PERFORM public.journeyhub_demo_wallet_topup(u,100000,gen_random_uuid());
 PERFORM public.journeyhub_demo_wallet_topup(v,100000,gen_random_uuid());
 tid:=journey_hub.unified_traveler(u);PERFORM journey_hub.unified_traveler(v);
 SELECT e.experience_id,e.venue_id INTO exp,ven FROM journey_hub.experiences e WHERE e.demo_owner_id IS NULL ORDER BY e.experience_id LIMIT 1;
 sid:='UB-MANUAL-'||u;sid2:='UB-AGENT-'||u;
 INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb)VALUES
 (sid,exp,(dt::text||' 09:00')::timestamp AT TIME ZONE 'Asia/Shanghai',(dt::text||' 10:00')::timestamp AT TIME ZONE 'Asia/Shanghai',3,200),
 (sid2,exp,((dt+1)::text||' 09:00')::timestamp AT TIME ZONE 'Asia/Shanghai',((dt+1)::text||' 10:00')::timestamp AT TIME ZONE 'Asia/Shanghai',3,300);
 -- Manual review freezes server conversion and confirms through the public manual command.
 q:=public.journeyhub_demo_session_quote(u,sid,2);qid:=(q->>'id')::uuid;
 PERFORM pg_temp.ub_assert(q->>'totalMinor'='8000' AND q->'items'->0->>'availableSeats'='3','manual quote freezes THB200*0.20 CNY per guest');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_command(''book'',%L,%L)',jsonb_build_object('sessionId',sid,'guests',2),gen_random_uuid()),'DEMO_QUOTE_REQUIRED');
 result:=public.journeyhub_command('book',jsonb_build_object('sessionId',sid,'guests',2,'quoteId',qid),req);bid:=result->>'id';
 PERFORM pg_temp.ub_assert(bid IS NOT NULL AND result->'wallet'->>'balanceMinor'='92000','manual confirmation creates canonical booking and single debit');
 PERFORM pg_temp.ub_assert(journey_hub.unified_seats(sid)=1,'manual canonical booking deducts exact guest count');
 PERFORM pg_temp.ub_assert(EXISTS(SELECT 1 FROM journey_hub.bookings WHERE booking_id=bid AND payment_status='simulated_paid' AND length(checkin_code)=6),'ticket carries canonical booking id and code');
 result:=public.journeyhub_command('book',jsonb_build_object('sessionId',sid,'guests',2,'quoteId',qid),req);
 PERFORM pg_temp.ub_assert(result->'wallet'->>'balanceMinor'='92000','manual retry never double pays');
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',v,qid,gen_random_uuid()),'DEMO_QUOTE_NOT_FOUND');
 q:=public.journeyhub_demo_session_quote(v,sid,2);q2id:=(q->>'id')::uuid;
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',v,q2id,gen_random_uuid()),'CAPACITY_CHANGED');
 PERFORM pg_temp.ub_assert((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=v)=100000,'capacity failure never debits second traveler');
 -- Canonical calendar cancellation refunds, restores seats, preserves the cancelled record.
 PERFORM public.journeyhub_calendar_manage('booking',bid,'cancel',cancelreq);
 PERFORM public.journeyhub_calendar_manage('booking',bid,'cancel',cancelreq);
 PERFORM public.journeyhub_calendar_manage('booking',bid,'cancel',gen_random_uuid());
 PERFORM pg_temp.ub_assert(journey_hub.unified_seats(sid)=3 AND(SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=u)=100000,'cancellation refunds and releases seats exactly once');
 PERFORM pg_temp.ub_assert((SELECT count(*)FROM journey_hub.demo_ledger l JOIN journey_hub.demo_bookings d ON d.id=l.booking_id WHERE d.booking_id=bid AND l.kind='refund')=1,'one immutable refund receipt');
 LOOP staffid:='UT-'||(1000+floor(random()*9000)::int)::text;EXIT WHEN NOT EXISTS(SELECT 1 FROM journey_hub.staff WHERE staff_id=staffid);END LOOP;
 INSERT INTO journey_hub.staff(staff_id,display_name,role,venue_id,pin_hash,auth_user_id)VALUES(staffid,'Rollback duty manager','duty_manager',ven,'disabled-fixture',staffuser);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staffuser)::text,true);
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_command(''checkin'',%L,%L)',jsonb_build_object('id',bid,'checked',true),gen_random_uuid()),'Active booking not found');
 snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.ub_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'bookings')b WHERE b->>'booking_id'=bid AND b->>'status'='cancelled' AND b->>'payment_status'='refunded'),'staff sees canonical cancelled/refunded record');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 q:=public.journeyhub_demo_session_quote(u,sid,2);result:=public.journeyhub_demo_book(u,(q->>'id')::uuid,gen_random_uuid());newbid:=result->'bookings'->0->>'bookingId';
 PERFORM pg_temp.ub_assert(newbid<>bid AND journey_hub.unified_seats(sid)=1,'explicit rebook creates new ticket with old cancelled record retained');
 -- Fresh external-place itinerary gets private simulated inventory visible to its owner and staff.
 h:=pg_temp.ub_history(u,dt+2);q:=public.journeyhub_demo_quote_save(u,'history',h,pg_temp.ub_items());qid:=(q->>'id')::uuid;
 PERFORM pg_temp.ub_assert(q->>'totalMinor'='22000'AND q->'items'->0->>'capacity'='40','three paid kinds and free stop priced with actual configured capacity');
 PERFORM pg_temp.ub_assert(EXISTS(SELECT 1 FROM journey_hub.sessions WHERE session_id=q->'items'->0->>'sessionId' AND demo_owner_id=u AND is_demo),'simulated session has private owner');
 result:=public.journeyhub_demo_book(u,qid,gen_random_uuid());
 PERFORM pg_temp.ub_assert(result->'wallet'->>'balanceMinor'='70000' AND jsonb_array_length(result->'bookings')=4,'whole itinerary charges ticket/restaurant/cafe atomically, free stop is explicit');
 PERFORM pg_temp.ub_assert((SELECT count(*)FROM journey_hub.bookings WHERE source_id=h AND status='confirmed')=3,'paid items all share canonical bookings');
 PERFORM pg_temp.ub_assert((SELECT count(*)FROM journey_hub.demo_bookings WHERE source_id=h AND status='not_required' AND booking_id IS NULL)=1,'free walk is not a fictitious ticket');
 q:=public.journeyhub_demo_quote_save(u,'history',h,pg_temp.ub_items());
 PERFORM pg_temp.ub_assert(q->>'totalMinor'='0'AND q->>'itineraryTotalMinor'='22000','re-review retains already paid items without double payment');
 result:=public.journeyhub_demo_book(u,(q->>'id')::uuid,gen_random_uuid());
 PERFORM pg_temp.ub_assert(result->'wallet'->>'balanceMinor'='70000','retained itinerary does not charge twice');
 SELECT d.id,d.booking_id INTO did,bid FROM journey_hub.demo_bookings d WHERE source_id=h AND stop_id='ub_museum'AND status='simulated_confirmed';
 PERFORM public.journeyhub_demo_cancel(u,did,gen_random_uuid());
 q:=public.journeyhub_demo_quote_save(u,'history',h,pg_temp.ub_items());
 PERFORM pg_temp.ub_assert(q->>'totalMinor'='8000','requote only charges explicitly cancelled item');
 result:=public.journeyhub_demo_book(u,(q->>'id')::uuid,gen_random_uuid());
 PERFORM pg_temp.ub_assert(result->'wallet'->>'balanceMinor'='70000'AND(SELECT count(*)FROM journey_hub.bookings WHERE source_id=h AND stop_id='ub_museum')=2,'cancel/rebook retains historical ticket and refunds exactly once');
 -- An edited paid stop cannot silently cancel or change a reservation.
 UPDATE journey_hub.trip_history hist SET plan=jsonb_set(hist.plan,'{stops,0,end}','"10:15"')WHERE hist.id=h;
 UPDATE journey_hub.trip_care care SET plan=jsonb_set(care.plan,'{stops,0,end}','"10:15"'),revision=care.revision+1 WHERE care.user_id=u AND care.source_id=h;
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_quote_save(%L,''history'',%L,%L)',u,h,pg_temp.ub_items()),'BOOKING_CHANGE_REQUIRES_CANCEL');
 PERFORM pg_temp.ub_assert((SELECT count(*)FROM journey_hub.bookings WHERE source_id=h AND status='confirmed')=3,'editing does not alter existing bookings');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v)::text,true);snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.ub_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'bookings')b WHERE b->>'source_id'=h::text),'other traveler cannot see receipts');
 PERFORM pg_temp.ub_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'sessions')s JOIN journey_hub.sessions real ON real.session_id=s->>'session_id' WHERE real.demo_owner_id=u),'other traveler cannot see private inventory');
 snap:=public.journeyhub_agent_catalog_trip(jsonb_build_object('city','Shanghai','date',dt+2,'guests',1,'days',1,'budgetThb',10000,'prompt','catalog privacy fixture'));
 PERFORM pg_temp.ub_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap)s JOIN journey_hub.sessions real ON real.session_id=s->>'sessionId'WHERE real.demo_owner_id IS NOT NULL),'planner catalog excludes private simulated sessions');
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_cancel(%L,%L,%L)',v,did,gen_random_uuid()),'DEMO_BOOKING_NOT_FOUND');
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_quote_save(%L,''history'',%L,%L)',v,h,pg_temp.ub_items()),'DEMO_SOURCE_NOT_FOUND');
 -- Late capacity failure (one of three sessions) rolls back all prior writes in the plan.
 h2:=pg_temp.ub_history(u,dt+3);q:=public.journeyhub_demo_quote_save(u,'history',h2,pg_temp.ub_items());qid:=(q->>'id')::uuid;
 SELECT value->>'sessionId'INTO sid2 FROM jsonb_array_elements(q->'items')WHERE value->>'sessionId'IS NOT NULL ORDER BY value->>'sessionId'DESC LIMIT 1;
 UPDATE journey_hub.sessions SET capacity=1 WHERE session_id=sid2;
 SELECT balance_minor INTO initial_balance FROM journey_hub.demo_wallets WHERE user_id=u;SELECT count(*)INTO beforeledger FROM journey_hub.demo_ledger WHERE user_id=u;
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,qid,gen_random_uuid()),'CAPACITY_CHANGED');
 PERFORM pg_temp.ub_assert((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=u)=initial_balance AND(SELECT count(*)FROM journey_hub.demo_ledger WHERE user_id=u)=beforeledger AND NOT EXISTS(SELECT 1 FROM journey_hub.bookings WHERE source_id=h2),'partial itinerary capacity failure rolls back reservations, wallet and ledger');
 UPDATE journey_hub.sessions SET capacity=40 WHERE session_id=sid2;
 -- Unknown availability never creates a partially successful itinerary.
 items:=jsonb_set(jsonb_set(pg_temp.ub_items(),'{1,kind}','"unavailable"'),'{1,unitMinor}','0');q:=public.journeyhub_demo_quote_save(u,'history',h2,items);
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,q->>'id',gen_random_uuid()),'DEMO_NOT_READY');
 -- Insufficient balance, expired quote and request reuse are all read-only failures.
 h3:=pg_temp.ub_history(v,dt+4);q:=public.journeyhub_demo_quote_save(v,'history',h3,pg_temp.ub_items());qid:=(q->>'id')::uuid;
 UPDATE journey_hub.demo_wallets SET balance_minor=1 WHERE user_id=v;
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',v,qid,gen_random_uuid()),'DEMO_INSUFFICIENT_FUNDS');
 UPDATE journey_hub.demo_quotes SET expires_at=now()-interval '1 second'WHERE id=qid;
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',v,qid,gen_random_uuid()),'DEMO_QUOTE_EXPIRED');
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,qid,req),'DEMO_REQUEST_REUSED');
 -- Catalog Agent: use immutable approval then the real background worker, same engine.
 sid2:='UB-AGENT-'||u;SELECT *INTO ss FROM journey_hub.sessions WHERE session_id=sid2;
 SELECT jsonb_build_object('city',vv.city,'date',(ss.starts_at AT TIME ZONE vv.time_zone)::date,'guests',1,'budgetThb',10000,'prompt','Rollback catalog agent')INTO prefs FROM journey_hub.venues vv WHERE vv.venue_id=ven;
 SELECT jsonb_build_object('city',vv.city,'date',prefs->>'date','guests',1,'currency','THB','totalThb',300,'stops',jsonb_build_array(jsonb_build_object('sessionId',sid2,'experienceId',exp,'title',e.name,'city',vv.city,'venueId',ven,'venue',vv.name,'startsAt',ss.starts_at,'endsAt',ss.ends_at,'timeZone',vv.time_zone,'unitPriceThb',300,'guests',1,'totalThb',300)))INTO plan FROM journey_hub.experiences e JOIN journey_hub.venues vv USING(venue_id)WHERE e.experience_id=exp;
 rid:=gen_random_uuid();runhash:=encode(extensions.digest(plan::text,'sha256'),'hex');
 INSERT INTO journey_hub.agent_runs(id,user_id,request_id,input,status,plan,plan_hash,expires_at)VALUES(rid,u,gen_random_uuid(),prefs,'queued',plan,runhash,now()+interval '30 minutes');
 INSERT INTO journey_hub.agent_approvals(run_id,user_id,version,plan_hash,snapshot,email_opt_in)VALUES(rid,u,1,runhash,plan,false);
 -- Only fixture jobs are due during this rollback; no unrelated pending work is processed.
 UPDATE journey_hub.agent_booking_jobs SET run_at=now()+interval '2 days'WHERE status='pending';
 INSERT INTO journey_hub.agent_booking_jobs(run_id)VALUES(rid);
 SELECT balance_minor INTO initial_balance FROM journey_hub.demo_wallets WHERE user_id=u;
 worker:=public.journeyhub_agent_process_bookings(1);
 PERFORM pg_temp.ub_assert(worker->>'booked'='1','catalog background agent succeeds');
 PERFORM pg_temp.ub_assert((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=u)=initial_balance-6000 AND journey_hub.unified_seats(sid2)=2,'catalog agent pays frozen converted price and books shared seats');
 PERFORM pg_temp.ub_assert(EXISTS(SELECT 1 FROM journey_hub.agent_reservations ar JOIN journey_hub.bookings b USING(booking_id)WHERE ar.run_id=rid AND b.payment_status='simulated_paid'),'catalog agent returns canonical ticket');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staffuser)::text,true);snap:=public.journeyhub_snapshot();
 PERFORM pg_temp.ub_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'bookings')b WHERE b->>'source_id'=rid::text),'staff sees new agent reservations after snapshot reload');
 PERFORM pg_temp.ub_assert(jsonb_typeof(snap->'liveMetrics')='array'AND jsonb_typeof(snap->'metrics')='array','live and historical metrics remain separate');
 PERFORM pg_temp.ub_assert(EXISTS(SELECT 1 FROM journey_hub.trip_history hist WHERE hist.id=h AND hist.plan IS NOT NULL),'cancel/reserve operations retain itinerary history');
 -- A delayed queued worker recognizes receipts already created by wallet confirmation.
 UPDATE journey_hub.agent_booking_jobs SET status='pending',run_at=now()WHERE run_id=rid;
 SELECT balance_minor INTO initial_balance FROM journey_hub.demo_wallets WHERE user_id=u;
 worker:=public.journeyhub_agent_process_bookings(1);
 PERFORM pg_temp.ub_assert(worker->>'booked'='1'AND(SELECT status FROM journey_hub.agent_runs WHERE id=rid)='booked'AND(SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=u)=initial_balance,'late worker acknowledges existing receipts without double debit or false failure');
 -- Old unpaid catalog records remain unchanged and yield a readable canonical receipt.
 sid2:='UB-LEGACY-'||u;
 INSERT INTO journey_hub.sessions(session_id,experience_id,starts_at,ends_at,capacity,price_thb)VALUES(sid2,exp,((dt+5)::text||' 09:00')::timestamp AT TIME ZONE 'Asia/Shanghai',((dt+5)::text||' 10:00')::timestamp AT TIME ZONE 'Asia/Shanghai',3,200);
 bid:='UB-OLD-'||u;
 INSERT INTO journey_hub.bookings(booking_id,session_id,traveler_id,guest_name,guests,channel,unit_price_thb,checkin_code)
 VALUES(bid,sid2,tid,'Unpaid legacy fixture',1,'app',200,'UZ9W8Q');
 q:=public.journeyhub_demo_session_quote(u,sid2,1);result:=public.journeyhub_demo_book(u,(q->>'id')::uuid,gen_random_uuid());
 PERFORM pg_temp.ub_assert(q->>'totalMinor'='0'AND result->'bookings'->0->>'bookingId'=bid AND result->'bookings'->0->>'paymentStatus'='legacy_unpaid'AND result->'bookings'->0->>'checkinCode'='UZ9W8Q','legacy unpaid receipt returns original ID and ticket, never claims a payment');
 PERFORM pg_temp.ub_assert((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=u)=initial_balance AND NOT EXISTS(SELECT 1 FROM journey_hub.demo_bookings WHERE booking_id=bid),'legacy receipt retrieval creates no wallet charge or fake paid detail');
 -- A free-only quote cannot bypass the departure-time guard on the day of travel.
 -- Deliberately tamper the service-owned quote to model a later invocation; even zero-charge stops must be future.
 h3:=pg_temp.ub_history(u,dt+6);
 SELECT jsonb_agg(jsonb_set(jsonb_set(value,'{kind}','"free"'),'{unitMinor}','0'))INTO items FROM jsonb_array_elements(pg_temp.ub_items());
 q:=public.journeyhub_demo_quote_save(u,'history',h3,items);qid:=(q->>'id')::uuid;
 UPDATE journey_hub.demo_quotes target SET items=(SELECT jsonb_agg(jsonb_set(value,'{date}',to_jsonb((current_date-1)::text)))FROM jsonb_array_elements(target.items))WHERE target.id=qid;
 PERFORM pg_temp.ub_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,qid,gen_random_uuid()),'DEMO_TRIP_PASSED');
 RAISE NOTICE 'Unified booking regression passed: manual, catalog Agent, external demo, inventory, idempotency, refunds, check-in invalidation, isolation, atomic rollback and staff snapshot.';
END $$;
SELECT 'PASS' AS unified_booking_regression,'manual + catalog Agent + external itinerary; atomic inventory/payment/refund; cancelled tickets; rebooking; private inventory; late worker; legacy unpaid receipts; expired free stops'AS coverage;
ROLLBACK;
