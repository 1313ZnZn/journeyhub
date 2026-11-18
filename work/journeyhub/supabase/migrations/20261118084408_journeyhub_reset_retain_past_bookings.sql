-- Preserve started/checked-in simulated booking records, payment and seat usage.
BEGIN;
CREATE OR REPLACE FUNCTION journey_hub.reset_virtual_wallet(p_commit boolean,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); balance integer; receipt uuid; req journey_hub.demo_requests;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_commit IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid reset request'; END IF;
 IF NOT p_commit THEN
  RETURN jsonb_build_object('ready',true,'retainedBookingIds',COALESCE((SELECT jsonb_agg(b.booking_id) FROM journey_hub.bookings b JOIN journey_hub.travelers t USING(traveler_id) JOIN journey_hub.sessions s USING(session_id) WHERE t.auth_user_id=uid AND b.demo=true AND b.status='confirmed' AND (b.checked_in_at IS NOT NULL OR s.starts_at<=now())),'[]'::jsonb),'balanceMinor',COALESCE((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=uid),0));
 END IF;
 balance:=journey_hub.demo_wallet_lock(uid);
 SELECT * INTO req FROM journey_hub.demo_requests WHERE user_id=uid AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'account_wallet_reset' THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED'; END IF;
  RETURN jsonb_build_object('ok',true,'receiptId',req.resource_id,'alreadyApplied',true);
 END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.bookings b JOIN journey_hub.travelers t USING(traveler_id)
  JOIN journey_hub.sessions s USING(session_id)
  WHERE t.auth_user_id=uid AND b.demo=true AND b.status='confirmed' AND b.checked_in_at IS NULL AND s.starts_at>now()) THEN
  RAISE EXCEPTION 'Cancel active simulated reservations before resetting the wallet';
 END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.demo_bookings d WHERE d.user_id=uid AND d.status='simulated_confirmed' AND NOT EXISTS(SELECT 1 FROM journey_hub.bookings b JOIN journey_hub.travelers t USING(traveler_id) JOIN journey_hub.sessions s USING(session_id) WHERE b.booking_id=d.booking_id AND t.auth_user_id=uid AND b.demo=true AND b.status='confirmed' AND (b.checked_in_at IS NOT NULL OR s.starts_at<=now()))) THEN
  RAISE EXCEPTION 'Active legacy simulated reservations require review before reset';
 END IF;
 UPDATE journey_hub.demo_wallets SET balance_minor=0,updated_at=now() WHERE user_id=uid;
 INSERT INTO journey_hub.demo_ledger(user_id,kind,amount_minor,balance_after_minor)
 VALUES(uid,'reset',-balance,0) RETURNING id INTO receipt;
 INSERT INTO journey_hub.demo_requests(user_id,request_id,operation,payload,resource_id)
 VALUES(uid,p_request_id,'account_wallet_reset','{}'::jsonb,receipt);
 RETURN jsonb_build_object('ok',true,'receiptId',receipt,'clearedMinor',balance);
END $$;
COMMIT;
