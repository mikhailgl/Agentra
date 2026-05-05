create table if not exists public.player_states (
  client_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_pools (
  client_id text primary key,
  bots jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.arena_states (
  client_id text primary key,
  state jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.arena_queues (
  client_id text primary key,
  queue_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.match_results (
  client_id text not null,
  match_number integer not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (client_id, match_number)
);

alter table public.player_states enable row level security;
alter table public.bot_pools enable row level security;
alter table public.arena_states enable row level security;
alter table public.arena_queues enable row level security;
alter table public.match_results enable row level security;

create index if not exists match_results_client_created_idx
  on public.match_results (client_id, match_number desc);

comment on table public.player_states is 'Durable player wallet, betting history, and sponsor stats keyed by browser client id.';
comment on table public.bot_pools is 'Durable bot progression, custom bots, journals, relationships, and doctrine keyed by browser client id.';
comment on table public.arena_states is 'Small resumable arena phase snapshot keyed by browser client id.';
comment on table public.arena_queues is 'Durable arena entrant queue keyed by browser client id.';
comment on table public.match_results is 'Recent durable match summaries keyed by browser client id.';
