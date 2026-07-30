insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('match-media', 'match-media', true, 26214400, array['video/webm', 'video/mp4'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.generated_media (
  id uuid primary key,
  account_id uuid not null references public.player_accounts(id) on delete cascade,
  match_number integer not null,
  media jsonb not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.generated_media enable row level security;

create index if not exists generated_media_match_idx on public.generated_media (match_number, created_at desc);
create index if not exists generated_media_created_idx on public.generated_media (created_at desc);

comment on table public.generated_media is 'Public generated match videos archived by authenticated player accounts.';
