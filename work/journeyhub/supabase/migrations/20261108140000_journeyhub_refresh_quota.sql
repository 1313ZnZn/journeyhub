-- Reopening a saved trip refreshes its places from the map service. It gets its own hourly
-- allowance so reopening trips never uses up the allowance for searching and planning.
create table if not exists journey_hub.refresh_quota(
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  uses integer not null default 0
);
alter table journey_hub.refresh_quota enable row level security;
revoke all on journey_hub.refresh_quota from public,anon,authenticated;

create or replace function public.journeyhub_refresh_quota(p_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare used integer;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
    raise exception 'verified account required';
  end if;
  insert into journey_hub.refresh_quota(user_id,window_start,uses) values(p_user_id,now(),1)
  on conflict(user_id) do update set
    uses=case when journey_hub.refresh_quota.window_start <= now()-interval '1 hour' then 1 else journey_hub.refresh_quota.uses+1 end,
    window_start=case when journey_hub.refresh_quota.window_start <= now()-interval '1 hour' then now() else journey_hub.refresh_quota.window_start end
  returning uses into used;
  if used>40 then raise exception 'rate limit reached'; end if;
end;
$$;
revoke all on function public.journeyhub_refresh_quota(uuid) from public,anon,authenticated;
grant execute on function public.journeyhub_refresh_quota(uuid) to service_role;
