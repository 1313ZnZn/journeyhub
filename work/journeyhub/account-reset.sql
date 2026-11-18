-- REVIEW REQUIRED: additive RPC and reset ledger classification. Do not apply automatically.
BEGIN;
ALTER TABLE journey_hub.demo_ledger DROP CONSTRAINT demo_ledger_kind_check;
ALTER TABLE journey_hub.demo_ledger DROP CONSTRAINT demo_ledger_check;
ALTER TABLE journey_hub.demo_ledger ADD CONSTRAINT demo_ledger_kind_check CHECK(kind IN('topup','payment','refund','reset'));
ALTER TABLE journey_hub.demo_ledger ADD CONSTRAINT demo_ledger_check CHECK(
 (kind='topup' AND amount_minor>0) OR (kind IN('payment','reset') AND amount_minor<=0) OR (kind='refund' AND amount_minor>=0));

CREATE FUNCTION journey_hub.reset_virtual_wallet(p_commit boolean,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); balance integer; receipt uuid; req journey_hub.demo_requests;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_commit IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Invalid reset request'; END IF;
 IF NOT p_commit THEN
  RETURN jsonb_build_object('ready',true,'balanceMinor',COALESCE((SELECT balance_minor FROM journey_hub.demo_wallets WHERE user_id=uid),0));
 END IF;
 balance:=journey_hub.demo_wallet_lock(uid);
 SELECT * INTO req FROM journey_hub.demo_requests WHERE user_id=uid AND request_id=p_request_id;
 IF FOUND THEN
  IF req.operation<>'account_wallet_reset' THEN RAISE EXCEPTION 'DEMO_REQUEST_REUSED'; END IF;
  RETURN jsonb_build_object('ok',true,'receiptId',req.resource_id,'alreadyApplied',true);
 END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.bookings b JOIN journey_hub.travelers t USING(traveler_id)
  WHERE t.auth_user_id=uid AND b.demo=true AND b.status='confirmed') THEN
  RAISE EXCEPTION 'Cancel active simulated reservations before resetting the wallet';
 END IF;
 IF EXISTS(SELECT 1 FROM journey_hub.demo_bookings WHERE user_id=uid AND status='simulated_confirmed') THEN
  RAISE EXCEPTION 'Active legacy simulated reservations require review before reset';
 END IF;
 UPDATE journey_hub.demo_wallets SET balance_minor=0,updated_at=now() WHERE user_id=uid;
 INSERT INTO journey_hub.demo_ledger(user_id,kind,amount_minor,balance_after_minor)
 VALUES(uid,'reset',-balance,0) RETURNING id INTO receipt;
 INSERT INTO journey_hub.demo_requests(user_id,request_id,operation,payload,resource_id)
 VALUES(uid,p_request_id,'account_wallet_reset','{}'::jsonb,receipt);
 RETURN jsonb_build_object('ok',true,'receiptId',receipt,'clearedMinor',balance);
END $$;
REVOKE ALL ON FUNCTION journey_hub.reset_virtual_wallet(boolean,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION journey_hub.reset_virtual_wallet(boolean,uuid) TO authenticated;
CREATE FUNCTION public.journeyhub_reset_virtual_wallet(p_commit boolean,p_request_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT journey_hub.reset_virtual_wallet(p_commit,p_request_id)$$;
REVOKE ALL ON FUNCTION public.journeyhub_reset_virtual_wallet(boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.journeyhub_reset_virtual_wallet(boolean,uuid) TO authenticated;
COMMIT;
