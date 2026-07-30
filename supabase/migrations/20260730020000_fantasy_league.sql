create index if not exists player_accounts_fantasy_roster_idx
  on public.player_accounts using gin ((state -> 'draftedBotIds'));

create or replace function public.get_fantasy_leaderboard(p_season_id text, p_limit integer default 50)
returns table (
  account_id uuid,
  account_name text,
  points integer,
  roster_size integer
)
language sql
security definer
set search_path = public
as $$
  select
    id as account_id,
    coalesce(state ->> 'accountName', 'Guest account') as account_name,
    coalesce((state #>> '{fantasy,points}')::integer, 0) as points,
    case
      when jsonb_typeof(state -> 'draftedBotIds') = 'array' then jsonb_array_length(state -> 'draftedBotIds')
      else 0
    end as roster_size
  from public.player_accounts
  where state #>> '{fantasy,seasonId}' = p_season_id
    and coalesce((state #>> '{fantasy,points}')::integer, 0) > 0
  order by points desc, account_name asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.get_fantasy_leaderboard(text, integer) from public, anon, authenticated;
grant execute on function public.get_fantasy_leaderboard(text, integer) to service_role;

comment on function public.get_fantasy_leaderboard(text, integer) is 'Server-only public coach ranking derived from authoritative fantasy scores for one season.';
