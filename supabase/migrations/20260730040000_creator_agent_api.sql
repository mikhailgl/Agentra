create table if not exists public.creator_api_keys (
  account_id uuid primary key references public.player_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_strategies (
  id uuid primary key,
  account_id uuid not null references public.player_accounts(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  version integer not null check (version > 0),
  strategy jsonb not null,
  created_at timestamptz not null default now(),
  unique (account_id, slug, version)
);

alter table public.creator_api_keys enable row level security;
alter table public.agent_strategies enable row level security;

create index if not exists agent_strategies_created_idx on public.agent_strategies (created_at desc);
create index if not exists agent_strategies_owner_idx on public.agent_strategies (account_id, slug, version desc);

comment on table public.creator_api_keys is 'Hashed, rotatable credentials for the constrained BotArena creator API.';
comment on table public.agent_strategies is 'Versioned declarative agent policies submitted by authenticated fighter owners.';
