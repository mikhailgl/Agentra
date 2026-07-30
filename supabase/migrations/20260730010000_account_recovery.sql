alter table public.player_accounts
  add column if not exists recovery_token_hash text;

update public.player_accounts
set recovery_token_hash = md5(id::text || ':' || session_token_hash)
where recovery_token_hash is null;

alter table public.player_accounts
  alter column recovery_token_hash set not null;

create unique index if not exists player_accounts_recovery_token_idx
  on public.player_accounts (recovery_token_hash);

comment on column public.player_accounts.recovery_token_hash is 'Hash of the one-time-displayed account recovery key.';
