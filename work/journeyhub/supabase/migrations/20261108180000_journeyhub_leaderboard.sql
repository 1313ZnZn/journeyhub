-- Weekly leaderboards: places most often put in Must go, and place-debate champions.
-- Only aggregate counts leave the database; no traveler is identified.

create table if not exists journey_hub.debate_results(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  city text not null,
  place_id text not null,
  place_name text not null,
  place_kind text,
  opponent_id text not null,
  outcome text not null check (outcome in ('won','lost','both','none')),
  created_at timestamptz not null default now()
);
create index if not exists debate_results_city_time on journey_hub.debate_results(city,created_at desc);
create index if not exists debate_results_user_time on journey_hub.debate_results(user_id,created_at desc);
alter table journey_hub.debate_results enable row level security;
revoke all on journey_hub.debate_results from public,anon,authenticated;

-- Records one finished debate as two rows (one per place). At most 60 debates per user per hour.
create or replace function public.journeyhub_debate_record(p_user_id uuid,p_city text,p_places jsonb,p_choice text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare a jsonb:=p_places->0; b jsonb:=p_places->1;
begin
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
    raise exception 'verified account required';
  end if;
  if p_city not in ('Bangkok','Shanghai','Singapore') or jsonb_typeof(p_places)<>'array' or jsonb_array_length(p_places)<>2 or p_choice not in ('a','b','both','none')
     or coalesce(a->>'id','')='' or coalesce(b->>'id','')='' or a->>'id'=b->>'id' or coalesce(a->>'name','')='' or coalesce(b->>'name','')='' then
    raise exception 'invalid debate result';
  end if;
  if (select count(*) from journey_hub.debate_results where user_id=p_user_id and created_at>now()-interval '1 hour')>=60 then
    raise exception 'rate limit reached';
  end if;
  insert into journey_hub.debate_results(user_id,city,place_id,place_name,place_kind,opponent_id,outcome) values
    (p_user_id,p_city,left(a->>'id',200),left(a->>'name',160),left(a->>'kind',60),left(b->>'id',200),case p_choice when 'a' then 'won' when 'b' then 'lost' else p_choice end),
    (p_user_id,p_city,left(b->>'id',200),left(b->>'name',160),left(b->>'kind',60),left(a->>'id',200),case p_choice when 'b' then 'won' when 'a' then 'lost' else p_choice end);
  return jsonb_build_object('recorded',true);
end;
$$;
revoke all on function public.journeyhub_debate_record(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.journeyhub_debate_record(uuid,text,jsonb,text) to service_role;

-- This week's boards for one city (or all three when p_city is null).
create or replace function public.journeyhub_leaderboard(p_city text)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
with picks as (
  select h.user_id,h.id as history_id,h.input->>'city' as city,w.place_id
  from journey_hub.trip_history h cross join lateral unnest(h.wanted) as w(place_id)
  where h.parent_id is null and h.updated_at>now()-interval '7 days' and w.place_id not like 'jh_sample_%'
    and (p_city is null or h.input->>'city'=p_city)
),
must as (
  select place_id,min(city) as city,count(distinct user_id) as travelers,count(distinct history_id) as trips from picks group by place_id
),
named as (
  select m.*,n.name,n.kind from must m
  cross join lateral (
    select p->>'name' as name,p->>'kind' as kind
    from journey_hub.trip_display_snapshots s cross join lateral jsonb_array_elements(coalesce(s.payload->'places','[]'::jsonb)) p
    where p->>'id'=m.place_id and coalesce(p->>'name','')<>'' order by s.saved_at desc limit 1
  ) n
),
debates as (
  select place_id,(array_agg(place_name order by created_at desc))[1] as name,(array_agg(place_kind order by created_at desc))[1] as kind,min(city) as city,
    count(*) filter (where outcome in ('won','both')) as wins,count(*) as debates
  from journey_hub.debate_results
  where created_at>now()-interval '7 days' and (p_city is null or city=p_city)
  group by place_id
)
select jsonb_build_object(
  'city',p_city,
  'mustGo',coalesce((select jsonb_agg(jsonb_build_object('placeId',place_id,'name',name,'kind',kind,'city',city,'travelers',travelers,'trips',trips) order by travelers desc,trips desc,name) from (select * from named order by travelers desc,trips desc,name limit 10) x),'[]'::jsonb),
  'debates',coalesce((select jsonb_agg(jsonb_build_object('placeId',place_id,'name',name,'kind',kind,'city',city,'wins',wins,'debates',debates) order by wins::numeric/debates desc,wins desc,name) from (select * from debates where wins>0 order by wins::numeric/debates desc,wins desc,name limit 10) x),'[]'::jsonb)
);
$$;
revoke all on function public.journeyhub_leaderboard(text) from public,anon,authenticated;
grant execute on function public.journeyhub_leaderboard(text) to service_role;
