create table if not exists public.match_logs (
  client_id text not null,
  match_number integer not null,
  match_id text not null,
  log jsonb not null,
  created_at timestamptz not null default now(),
  primary key (client_id, match_number)
);

alter table public.match_logs enable row level security;

create index if not exists match_logs_client_created_idx
  on public.match_logs (client_id, match_number desc);

create index if not exists match_logs_match_id_idx
  on public.match_logs (match_id);

comment on table public.match_logs is 'Full completed-match timelines and highlights for post-processing into video scripts and other content.';
