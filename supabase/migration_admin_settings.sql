-- Admin settings + hidden media flag
-- Run once in Supabase SQL Editor

alter table public.media_feed add column if not exists hidden boolean default false;
alter table public.media_feed add column if not exists duration_sec int default 0;
alter table public.media_feed add column if not exists quality text default '';

create table if not exists public.bot_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

insert into public.bot_settings (key, value) values
  ('force_sub_channels', '[]'::jsonb),
  ('daily_limit_free', '8'::jsonb),
  ('daily_limit_share', '20'::jsonb),
  ('features', '{"party":true,"clone":true,"feed":true}'::jsonb)
on conflict (key) do nothing;

alter table public.bot_settings enable row level security;
drop policy if exists "public read bot_settings" on public.bot_settings;
create policy "public read bot_settings" on public.bot_settings for select using (true);
grant select on public.bot_settings to anon, authenticated;
grant all on public.bot_settings to service_role;
