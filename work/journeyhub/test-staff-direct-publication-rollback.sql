-- Existing test accounts only. Entire hosted integration test rolls back.
-- Run with the Supabase SQL tool after the direct-publication migration.
BEGIN;
DO $test$
DECLARE employee record; traveler uuid; p jsonb; q jsonb; booked jsonb; retried jsonb; snap jsonb; cfg jsonb; payload jsonb; req uuid; sid text; expid text; output jsonb:='[]'; future date:=current_date+40; saved_version int;
BEGIN
 SELECT u.id INTO STRICT traveler FROM auth.users u WHERE u.email LIKE '%@example.com' AND NOT EXISTS(SELECT 1 FROM journey_hub.staff s WHERE s.auth_user_id=u.id) LIMIT 1;
 FOR employee IN SELECT s.staff_id,s.auth_user_id,b.original_role FROM journey_hub.staff s JOIN journey_hub.staff_role_backup_20261119 b USING(staff_id) JOIN auth.users u ON u.id=s.auth_user_id WHERE b.original_role IN('coordinator','host') AND u.email LIKE '%@example.com' ORDER BY b.original_role LOOP
  PERFORM set_config('request.jwt.claim.sub',employee.auth_user_id::text,true);
  expid:=CASE employee.original_role WHEN 'coordinator' THEN 'craft' ELSE 'bk-museum-siam' END;
  cfg:=journey_hub.plan_settings(expid);
  p:=public.journeyhub_command('plan',jsonb_build_object('action','create','exp',expid,'date',future,'startTime','11:17','cap',4,'price',500,'promo',0,'reason','ROLLBACK TEST direct publication'),gen_random_uuid());
  p:=public.journeyhub_command('plan',jsonb_build_object('action','save','id',p->>'id','version',p->'version','date',future,'startTime','11:17','cap',4,'price',500,'promo',0,'reason','ROLLBACK TEST direct publication','assumptions',jsonb_build_object('bookingRate',0.8,'cancellationRate',0.1,'attendanceRate',0.95,'hostRate',0.5,'materialCost',100,'basis','ROLLBACK TEST explicit staff estimates')),gen_random_uuid());
  saved_version:=(p->>'version')::int;
  p:=public.journeyhub_command('plan',jsonb_build_object('action','publish','id',p->>'id','version',saved_version),gen_random_uuid());sid:=p->>'createdSessionId';
  IF sid IS NULL OR NOT EXISTS(SELECT 1 FROM journey_hub.session_plans WHERE plan_id=p->>'id' AND created_by=employee.staff_id AND published_by=employee.staff_id AND published_at IS NOT NULL) THEN RAISE EXCEPTION 'Publisher verification failed';END IF;
  retried:=public.journeyhub_command('plan',jsonb_build_object('action','publish','id',p->>'id','version',saved_version),gen_random_uuid());
  IF retried->>'createdSessionId'<>sid THEN RAISE EXCEPTION 'Publish retry duplicated';END IF;
  PERFORM set_config('request.jwt.claim.sub',traveler::text,true);
  snap:=journey_hub.snapshot();
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'sessions') s WHERE s->>'session_id'=sid AND s->>'experience_id'=expid AND (s->>'price_thb')::int=500 AND (s->>'capacity')::int=4) THEN RAISE EXCEPTION 'Traveler session mismatch';END IF;
  PERFORM journey_hub.demo_wallet_topup(traveler,50000,gen_random_uuid());
  q:=journey_hub.demo_session_quote(traveler,sid,2);
  req:=gen_random_uuid();payload:=jsonb_build_object('quoteId',q->>'id','sessionId',sid,'guests',2);
  booked:=public.journeyhub_command('book',payload,req);
  retried:=public.journeyhub_command('book',payload,req);
  IF booked->>'id' IS NULL OR booked->>'id'<>retried->>'id' THEN RAISE EXCEPTION 'Booking retry mismatch';END IF;
  IF NOT EXISTS(SELECT 1 FROM journey_hub.bookings WHERE booking_id::text=booked->>'id' AND session_id=sid AND guests=2 AND status='confirmed') THEN RAISE EXCEPTION 'Booking association mismatch';END IF;
  IF journey_hub.unified_seats(sid)<>2 THEN RAISE EXCEPTION 'Remaining capacity mismatch';END IF;
  PERFORM set_config('request.jwt.claim.sub',employee.auth_user_id::text,true);snap:=journey_hub.snapshot();
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'bookings') b WHERE b->>'booking_id'=booked->>'id' AND b->>'session_id'=sid) THEN RAISE EXCEPTION 'Staff guest list missing';END IF;
  output:=output||jsonb_build_array(jsonb_build_object('formerRole',employee.original_role,'activity',expid,'sameAccountPublish',true,'travelerSlot',true,'simulatedBooking',true,'guestCount',2,'remainingSeats',2,'publishAndBookingRetries',true,'staffGuestList',true));
 END LOOP;
 IF jsonb_array_length(output)<>2 THEN RAISE EXCEPTION 'Expected two staff tests';END IF;
 PERFORM set_config('journeyhub.test_result',output::text,true);
END $test$;
SELECT current_setting('journeyhub.test_result')::jsonb AS rollback_test_results;
ROLLBACK;
