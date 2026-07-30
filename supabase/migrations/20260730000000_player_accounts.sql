create table if not exists public.player_accounts (
  id uuid primary key,
  session_token_hash text not null unique,
  state jsonb not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_accounts enable row level security;

create table if not exists public.bot_ownerships (
  bot_id text primary key,
  account_id uuid not null references public.player_accounts(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.bot_ownerships enable row level security;

create index if not exists bot_ownerships_account_idx on public.bot_ownerships (account_id);

create index if not exists player_accounts_pending_bets_idx
  on public.player_accounts using gin ((state -> 'bets'));

comment on table public.player_accounts is 'Server-authoritative virtual player accounts addressed by hashed opaque session tokens.';
comment on table public.bot_ownerships is 'Exclusive server-authoritative ownership claim for each custom fighter.';
