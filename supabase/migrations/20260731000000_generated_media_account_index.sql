create index if not exists generated_media_account_idx
  on public.generated_media (account_id, created_at desc);
