-- Optional: user behavior events for mini-app (run once in Supabase SQL editor)
create table if not exists public.mini_app_events (
  id bigserial primary key,
  user_id text not null,
  name text,
  event text not null,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists mini_app_events_created_idx on public.mini_app_events (created_at desc);
create index if not exists mini_app_events_user_idx on public.mini_app_events (user_id);
create index if not exists mini_app_events_event_idx on public.mini_app_events (event);
