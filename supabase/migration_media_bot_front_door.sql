-- Media bot front door (src/lib/mediaFrontDoor.ts): download links received
-- while the Render server was down, replayed automatically when it's back.
-- Run once in Supabase → SQL Editor. Safe to run again.
create table if not exists public.media_bot_queue (
  update_id  bigint primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.media_bot_queue enable row level security; -- no public policies: server (service_role) only
grant all on public.media_bot_queue to service_role;
