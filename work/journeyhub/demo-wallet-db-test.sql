-- Rollback-only integration verification: no payment/provider APIs or user records.
BEGIN;
CREATE FUNCTION pg_temp.dw_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'TEST FAILED: %',label;END IF;END $$;
CREATE FUNCTION pg_temp.dw_error(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN;END IF;RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM;END;RAISE EXCEPTION 'Expected %, command succeeded',expected;END $$;
CREATE FUNCTION pg_temp.dw_history(uid uuid,dt date,guests integer DEFAULT 2) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE root uuid:=gen_random_uuid();id uuid:=gen_random_uuid();prefs jsonb;plan jsonb;
BEGIN
 prefs:=jsonb_build_object('city','Shanghai','date',dt,'guests',guests,'prompt','Rollback-only virtual wallet fixture','days',1,'dayStart','09:00','dayEnd','21:00','transport','walk');
 plan:='{"summary":"Rollback fixture","stops":[{"id":"dw_museum","dayIndex":1,"start":"09:00","end":"10:00","reason":"Museum"},{"id":"dw_restaurant","dayIndex":1,"start":"12:00","end":"13:00","reason":"Lunch"},{"id":"dw_park","dayIndex":1,"start":"14:00","end":"15:00","reason":"Walk"},{"id":"dw_unknown","dayIndex":1,"start":"16:00","end":"17:00","reason":"Unverified stop"}]}';
 PERFORM public.journeyhub_trip_history_save(uid,root,prefs,ARRAY['dw_museum','dw_restaurant','dw_park','dw_unknown'],'{}','{}',NULL,NULL);
 PERFORM public.journeyhub_trip_history_save(uid,id,prefs,ARRAY['dw_museum','dw_restaurant','dw_park','dw_unknown'],ARRAY['dw_museum','dw_restaurant','dw_park','dw_unknown'],'{}',plan,root);
 RETURN id;
END $$;
CREATE FUNCTION pg_temp.dw_items() RETURNS jsonb LANGUAGE sql AS $$
 SELECT '[{"stopId":"dw_museum","kind":"ticket","unitMinor":4000},{"stopId":"dw_restaurant","kind":"restaurant","unitMinor":5000},{"stopId":"dw_park","kind":"free","unitMinor":0},{"stopId":"dw_unknown","kind":"unavailable","unitMinor":0}]'::jsonb
$$;
DO $$
DECLARE u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();h uuid;h2 uuid;h3 uuid;h4 uuid;h5 uuid;rid uuid;req uuid:=gen_random_uuid();book_req uuid:=gen_random_uuid();cancel_req uuid:=gen_random_uuid();qid uuid;q2id uuid;bid uuid;restid uuid;
 s jsonb;q jsonb;again jsonb;result jsonb;items jsonb:=pg_temp.dw_items();dt date:=current_date+40;beforeledger int;amount integer;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data)VALUES(u,'wallet-fixture-'||u||'@example.invalid',now(),'{}'),(v,'wallet-fixture-'||v||'@example.invalid',now(),'{}');
 PERFORM pg_temp.dw_assert(NOT has_function_privilege('authenticated','public.journeyhub_demo_book(uuid,uuid,uuid)','execute'),'browser cannot call privileged API with chosen user');
 PERFORM pg_temp.dw_assert(NOT has_function_privilege('anon','public.journeyhub_demo_wallet_topup(uuid,integer,uuid)','execute'),'anonymous cannot credit any wallet');
 PERFORM pg_temp.dw_assert(has_function_privilege('service_role','public.journeyhub_demo_book(uuid,uuid,uuid)','execute'),'backend has narrow RPC grant');
 PERFORM pg_temp.dw_assert(NOT has_table_privilege('authenticated','journey_hub.demo_wallets','UPDATE'),'browser cannot mutate wallet table');
 s:=public.journeyhub_demo_wallet_state(u);
 PERFORM pg_temp.dw_assert(s->>'balanceMinor'='0' AND s->>'currency'='CNY' AND s->>'demo'='true','empty account is explicitly virtual CNY');
 s:=public.journeyhub_demo_wallet_topup(u,50000,req);
 again:=public.journeyhub_demo_wallet_topup(u,50000,req);
 PERFORM pg_temp.dw_assert(s->>'balanceMinor'='50000' AND again->>'balanceMinor'='50000' AND s->>'receiptId'=again->>'receiptId','topup retry does not duplicate credit');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_wallet_topup(%L,60000,%L)',u,req),'DEMO_REQUEST_REUSED');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_wallet_topup(%L,-100,%L)',u,gen_random_uuid()),'DEMO_INVALID_TOPUP');
 h:=pg_temp.dw_history(u,dt);h2:=pg_temp.dw_history(v,dt);
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_source(%L,''history'',%L)',v,h),'DEMO_SOURCE_NOT_FOUND');
 q:=public.journeyhub_demo_quote_save(u,'history',h,items);qid:=(q->>'id')::uuid;
 PERFORM pg_temp.dw_assert(q->>'totalMinor'='18000' AND q->>'status'='quoted','two guests priced from authoritative plan');
 PERFORM pg_temp.dw_assert(q->'items'->0->>'quantity'='2' AND q->'items'->0->>'date'=dt::text,'dates and quantities canonical');
 again:=public.journeyhub_demo_quote_save(u,'history',h,items);
 PERFORM pg_temp.dw_assert(again->>'id'=q->>'id','quote is reused');
 s:=public.journeyhub_demo_source(u,'history',h);
 PERFORM pg_temp.dw_assert(s->'quote'->>'id'=q->>'id','source returns reusable quote without provider work');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_quote_save(%L,''history'',%L,%L)',u,h,jsonb_set(items,'{0,unitMinor}','1')),'DEMO_INVALID_ITEMS');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_quote_save(%L,''history'',%L,%L)',u,h,jsonb_set(items,'{0,quantity}','1')),'DEMO_INVALID_ITEMS');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_quote_save(%L,''history'',%L,%L)',u,h,jsonb_set(items,'{0,stopId}','"not_in_plan"')),'DEMO_INVALID_ITEMS');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',v,qid,gen_random_uuid()),'DEMO_QUOTE_NOT_FOUND');
 -- Insufficient funds leaves quote, ledger and all stops unchanged.
 q:=public.journeyhub_demo_quote_save(v,'history',h2,items);q2id:=(q->>'id')::uuid;
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',v,q2id,gen_random_uuid()),'DEMO_INSUFFICIENT_FUNDS');
 PERFORM pg_temp.dw_assert(NOT EXISTS(SELECT 1 FROM journey_hub.demo_bookings WHERE user_id=v) AND NOT EXISTS(SELECT 1 FROM journey_hub.demo_ledger WHERE user_id=v),'failed booking is atomic');
 result:=public.journeyhub_demo_book(u,qid,book_req);
 PERFORM pg_temp.dw_assert(result->'wallet'->>'balanceMinor'='32000' AND result->'quote'->>'status'='booked','payment deducts total once');
 PERFORM pg_temp.dw_assert(jsonb_array_length(result->'bookings')=4,'every stop has explicit outcome');
 PERFORM pg_temp.dw_assert((SELECT count(*) FROM journey_hub.demo_bookings WHERE user_id=u AND status='simulated_confirmed')=2,'only paid known items are simulated reservations');
 PERFORM pg_temp.dw_assert(EXISTS(SELECT 1 FROM journey_hub.demo_bookings WHERE user_id=u AND stop_id='dw_unknown' AND status='unavailable' AND amount_minor=0),'unknown is never reserved or charged');
 PERFORM pg_temp.dw_assert(EXISTS(SELECT 1 FROM journey_hub.trip_care WHERE user_id=u AND source_type='history' AND source_id=h),'care enrolled atomically');
 PERFORM pg_temp.dw_assert(NOT EXISTS(SELECT 1 FROM journey_hub.bookings b JOIN journey_hub.travelers t ON t.traveler_id=b.traveler_id WHERE t.auth_user_id=u),'no actual catalog seat is booked');
 s:=public.journeyhub_demo_source(u,'history',h);
 PERFORM pg_temp.dw_assert(s->'quote'->>'id'=qid::text AND s->'quote'->>'status'='booked','booked quote is available without providers');
 again:=public.journeyhub_demo_book(u,qid,book_req);
 again:=public.journeyhub_demo_book(u,qid,gen_random_uuid());
 PERFORM pg_temp.dw_assert(again->'wallet'->>'balanceMinor'='32000' AND (SELECT count(*) FROM journey_hub.demo_ledger WHERE user_id=u AND kind='payment')=1,'repeated confirmation cannot double debit');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,qid,req),'DEMO_REQUEST_REUSED');
 SELECT id INTO bid FROM journey_hub.demo_bookings WHERE user_id=u AND stop_id='dw_museum';
 SELECT id INTO restid FROM journey_hub.demo_bookings WHERE user_id=u AND stop_id='dw_restaurant';
 result:=public.journeyhub_demo_cancel(u,bid,cancel_req);
 PERFORM pg_temp.dw_assert(result->'wallet'->>'balanceMinor'='40000' AND result->'booking'->>'status'='cancelled','cancel refunds simulated amount');
 again:=public.journeyhub_demo_cancel(u,bid,cancel_req);again:=public.journeyhub_demo_cancel(u,bid,gen_random_uuid());
 PERFORM pg_temp.dw_assert(again->'wallet'->>'balanceMinor'='40000' AND (SELECT count(*) FROM journey_hub.demo_ledger WHERE user_id=u AND kind='refund')=1,'refund replay is idempotent');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_cancel(%L,%L,%L)',v,bid,gen_random_uuid()),'DEMO_BOOKING_NOT_FOUND');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_cancel(%L,%L,%L)',u,restid,cancel_req),'DEMO_REQUEST_REUSED');
 PERFORM pg_temp.dw_error(format('UPDATE journey_hub.demo_ledger SET amount_minor=0 WHERE user_id=%L',u),'DEMO_LEDGER_IMMUTABLE');
 -- Read-only retries remain available after reversible plan removal.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 PERFORM public.journeyhub_calendar_manage('history',h::text,'remove',gen_random_uuid());
 UPDATE journey_hub.demo_quotes SET expires_at=now()-interval '1 minute'WHERE id=qid;
 again:=public.journeyhub_demo_book(u,qid,gen_random_uuid());
 PERFORM pg_temp.dw_assert(again->'wallet'->>'balanceMinor'='40000','completed removed plan retry performs no payment');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_source(%L,''history'',%L)',u,h),'DEMO_PLAN_REMOVED');
 -- New quotes are fenced against expiry, accepted adjustments and removal.
 h3:=pg_temp.dw_history(u,dt+1);q:=public.journeyhub_demo_quote_save(u,'history',h3,items);q2id:=(q->>'id')::uuid;
 UPDATE journey_hub.demo_quotes SET expires_at=now()-interval '1 minute'WHERE id=q2id;
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,q2id,gen_random_uuid()),'DEMO_QUOTE_EXPIRED');
 q:=public.journeyhub_demo_quote_save(u,'history',h3,items);
 PERFORM pg_temp.dw_assert(q->>'id'=q2id::text AND (q->>'expiresAt')::timestamptz>now(),'expired quote review can be refreshed');
 PERFORM public.journeyhub_care_confirm(u,'history',h3);
 UPDATE journey_hub.trip_care SET plan=jsonb_set(plan,'{stops,0,end}','"10:30"'),revision=revision+1 WHERE source_id=h3 AND user_id=u;
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,q2id,gen_random_uuid()),'DEMO_QUOTE_STALE');
 q:=public.journeyhub_demo_quote_save(u,'history',h3,items);q2id:=(q->>'id')::uuid;
 PERFORM pg_temp.dw_assert(q->'items'->0->>'end'='10:30','re-quote reflects care-adjusted schedule');
 PERFORM public.journeyhub_calendar_manage('history',h3::text,'remove',gen_random_uuid());
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,q2id,gen_random_uuid()),'DEMO_PLAN_REMOVED');
 -- Failure after preflight must roll back all balances, reservations and ledger.
 h4:=pg_temp.dw_history(u,dt+2);q:=public.journeyhub_demo_quote_save(u,'history',h4,items);q2id:=(q->>'id')::uuid;
 SELECT count(*) INTO beforeledger FROM journey_hub.demo_ledger WHERE user_id=u;
 EXECUTE format('ALTER TABLE journey_hub.trip_care ADD CONSTRAINT demo_fixture_reject_care CHECK(source_id<>%L::uuid)',h4);
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,q2id,gen_random_uuid()),'demo_fixture_reject_care');
 PERFORM pg_temp.dw_assert((SELECT count(*) FROM journey_hub.demo_ledger WHERE user_id=u)=beforeledger AND NOT EXISTS(SELECT 1 FROM journey_hub.demo_bookings WHERE source_id=h4),'care enrollment failure does not partially pay');
 -- A provider outage is never presented as a completed booking workflow.
 SELECT jsonb_agg(jsonb_set(jsonb_set(value,'{kind}','"unavailable"'),'{unitMinor}','0'))INTO items FROM jsonb_array_elements(pg_temp.dw_items());
 q:=public.journeyhub_demo_quote_save(u,'history',h4,items);q2id:=(q->>'id')::uuid;
 s:=public.journeyhub_demo_source(u,'history',h4);
 PERFORM pg_temp.dw_assert(s->'quote'='null'::jsonb,'all-unavailable quote does not suppress provider retry');
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_book(%L,%L,%L)',u,q2id,gen_random_uuid()),'DEMO_NOT_READY');
 -- All-free walking days can be confirmed with no simulated ticket claim.
 h5:=pg_temp.dw_history(u,dt+4);
 SELECT jsonb_agg(jsonb_set(jsonb_set(value,'{kind}','"free"'),'{unitMinor}','0'))INTO items FROM jsonb_array_elements(pg_temp.dw_items());
 q:=public.journeyhub_demo_quote_save(u,'history',h5,items);q2id:=(q->>'id')::uuid;
 result:=public.journeyhub_demo_book(u,q2id,gen_random_uuid());
 PERFORM pg_temp.dw_assert(result->'wallet'->>'balanceMinor'='40000' AND NOT EXISTS(SELECT 1 FROM journey_hub.demo_bookings WHERE source_id=h5 AND status<>'not_required'),'all-free quote confirms support without fake reservations');
 h5:=pg_temp.dw_history(u,current_date-2);
 PERFORM pg_temp.dw_error(format('SELECT public.journeyhub_demo_source(%L,''history'',%L)',u,h5),'DEMO_TRIP_PASSED');
 -- Catalog demo checkout does not authorize the existing live seat workflow.
 INSERT INTO journey_hub.agent_runs(user_id,request_id,input,status,plan)VALUES(u,gen_random_uuid(),
  jsonb_build_object('city','Shanghai','date',dt+3,'guests',1,'days',1,'dayStart','09:00','dayEnd','18:00','transport','walk','prompt','Catalog demo fixture'),
  'awaiting_confirmation',jsonb_build_object('stops',jsonb_build_array(jsonb_build_object('sessionId','demo_fixture_session','title','Fixture museum','startsAt',(dt+3)::text||'T09:00:00+08:00','endsAt',(dt+3)::text||'T10:00:00+08:00'))))RETURNING id INTO rid;
 q:=public.journeyhub_demo_quote_save(u,'run',rid,'[{"stopId":"demo_fixture_session","kind":"ticket","unitMinor":6000}]');
 result:=public.journeyhub_demo_book(u,(q->>'id')::uuid,gen_random_uuid());
 PERFORM pg_temp.dw_assert(result->'wallet'->>'balanceMinor'='34000','catalog sample charged demo credits only');
 PERFORM pg_temp.dw_assert(NOT EXISTS(SELECT 1 FROM journey_hub.agent_approvals WHERE run_id=rid) AND NOT EXISTS(SELECT 1 FROM journey_hub.agent_booking_jobs WHERE run_id=rid) AND NOT EXISTS(SELECT 1 FROM journey_hub.trip_care WHERE source_id=rid),'demo catalog does not enqueue real inventory or care requiring real approval');
 PERFORM pg_temp.dw_assert((public.journeyhub_demo_wallet_state(v)->>'balanceMinor')='0','other account balance isolated');
 PERFORM pg_temp.dw_assert((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=u)=(SELECT sum(amount_minor)FROM journey_hub.demo_ledger WHERE user_id=u),'balance reconciles exactly to immutable ledger');
END $$;
SELECT 'PASS: demo wallet ownership, top-up and payment idempotency, canonical quotes, insufficient funds atomicity, care enrollment, no real bookings, cancellation/refund, stale/expired/removed guards, ledger reconciliation. Fixtures rolled back.' AS result;
ROLLBACK;
