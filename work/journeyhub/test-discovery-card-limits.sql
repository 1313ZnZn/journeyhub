BEGIN;
DO $check$
DECLARE
 u uuid='1320ccd0-c391-43b1-908a-a56e18342b95'; root uuid=gen_random_uuid(); rev uuid=gen_random_uuid();
 prefs jsonb='{"city":"Shanghai","date":"2026-12-01","guests":1,"prompt":"Fixture - rolled back","days":4,"dayStart":"09:00","dayEnd":"18:00","transport":"walk"}';
 ids text[]; plan jsonb; saved jsonb;
BEGIN
 SELECT array_agg('fixture_'||i ORDER BY i),jsonb_build_object('summary','Four complete fixture days','stops',jsonb_agg(jsonb_build_object('id','fixture_'||i,'dayIndex',((i-1)/4)+1,'start',lpad((9+(i-1)%4*2)::text,2,'0')||':00','end',lpad((10+(i-1)%4*2)::text,2,'0')||':00','reason','Fixture') ORDER BY i)) INTO ids,plan FROM generate_series(1,16) i;
 IF NOT journey_hub.trip_history_payload_valid(prefs,ids,ids,'{}',plan) THEN RAISE EXCEPTION '16-stop history rejected'; END IF;
 IF journey_hub.trip_history_payload_valid(prefs,ids,ids,'{}',jsonb_set(plan,'{stops}',plan->'stops'||(plan->'stops'->0))) THEN RAISE EXCEPTION 'Invalid 17-stop history accepted'; END IF;
 PERFORM public.journeyhub_trip_history_save(u,root,prefs,ids,'{}','{}',NULL,NULL);
 saved=public.journeyhub_trip_history_save(u,rev,prefs,ids,ids,'{}',plan,root);
 saved=public.journeyhub_trip_history_get(u,rev);
 IF jsonb_array_length(saved->'plan'->'stops')<>16 THEN RAISE EXCEPTION '16-stop reopen truncated';END IF;
 IF public.journeyhub_trip_history_get(gen_random_uuid(),rev) IS NOT NULL THEN RAISE EXCEPTION 'Cross-account access';END IF;
END $check$;
SELECT 'PASS: 16 stops save/reopen, invalid extras rejected, owner isolation. All fixture rows rolled back.' AS result;
ROLLBACK;
