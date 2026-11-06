-- Local fixture only; the test transaction rolls back all data and fixture changes.
begin;
alter table auth.users add column if not exists is_anonymous boolean default false;
insert into auth.users(id,email,email_confirmed_at) values('f0000000-0000-4000-8000-000000000001','discovery@example.invalid',now());
do $$
declare i integer; blocked boolean := false;
begin
  if has_function_privilege('anon','public.journeyhub_discovery_quota(uuid)','execute') or has_function_privilege('authenticated','public.journeyhub_discovery_quota(uuid)','execute') then raise exception 'client roles must not consume quota for arbitrary owners'; end if;
  if not has_function_privilege('service_role','public.journeyhub_discovery_quota(uuid)','execute') then raise exception 'backend must have quota access'; end if;
  for i in 1..12 loop perform public.journeyhub_discovery_quota('f0000000-0000-4000-8000-000000000001');end loop;
  begin perform public.journeyhub_discovery_quota('f0000000-0000-4000-8000-000000000001');exception when others then if sqlerrm like '%rate limit%' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'quota did not stop the thirteenth request';end if;
  update journey_hub.discovery_quota set window_start=now()-interval '2 hours' where user_id='f0000000-0000-4000-8000-000000000001';
  perform public.journeyhub_discovery_quota('f0000000-0000-4000-8000-000000000001');
  if (select uses from journey_hub.discovery_quota where user_id='f0000000-0000-4000-8000-000000000001')<>1 then raise exception 'quota failed to reset';end if;
  blocked:=false;
  begin perform public.journeyhub_discovery_quota('f0000000-0000-4000-8000-000000000002');exception when others then if sqlerrm like '%verified account%' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'unknown user allowed';end if;
end $$;
rollback;
