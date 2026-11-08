-- Accounts listed here skip the hourly request allowances (search/planning, Pip, reopening
-- trips and the experience agent). Other limits, such as retries and cart rules, still apply.
-- Rows are added by an operator with the service role; nothing in the app can write here.
create table if not exists journey_hub.quota_exempt(
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table journey_hub.quota_exempt enable row level security;
revoke all on journey_hub.quota_exempt from public,anon,authenticated;

-- Each allowance returns early for an exempt account, after the verified-account check.
do $$
declare
  fn text;
  def text;
  guard constant text := E'  if exists(select 1 from journey_hub.quota_exempt where user_id=p_user_id) then return; end if;\n';
begin
  foreach fn in array array['journeyhub_discovery_quota','journeyhub_pip_quota','journeyhub_refresh_quota'] loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=fn;
    if def is null then raise exception 'missing %',fn; end if;
    if position('quota_exempt' in def)>0 then continue; end if;
    def:=regexp_replace(def,E'(raise exception ''verified account required'';\\s*end if;\\n)',E'\\1'||guard);
    if position('quota_exempt' in def)=0 then raise exception 'could not patch %',fn; end if;
    execute def;
  end loop;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='journey_hub' and p.proname='agent_begin';
  if def is not null and position('quota_exempt' in def)=0 then
    def:=replace(def,'IF (SELECT count(*) FROM agent_runs WHERE user_id=p_user_id AND created_at>now()-interval ''1 hour'')>=6 OR',
      'IF NOT EXISTS(SELECT 1 FROM journey_hub.quota_exempt WHERE user_id=p_user_id) AND ((SELECT count(*) FROM agent_runs WHERE user_id=p_user_id AND created_at>now()-interval ''1 hour'')>=6 OR');
    def:=replace(def,'>=20 THEN RAISE EXCEPTION ''PLANNER_RATE_LIMIT''','>=20) THEN RAISE EXCEPTION ''PLANNER_RATE_LIMIT''');
    if position('quota_exempt' in def)=0 then raise exception 'could not patch agent_begin'; end if;
    execute def;
  end if;
end $$;
