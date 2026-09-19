-- Media Mini-App real notifications (follow, etc.)
-- Run once in Supabase → SQL Editor → New query → Run
--
-- Fixes: the mini-app's 🔔 button used to write "X started following you"
-- straight into the CURRENT viewer's own browser localStorage -- so it
-- never reached the person who was actually followed at all, on any
-- device. This table is the real, server-side, cross-device delivery this
-- needed; localStorage was never going to be able to do it.

create table if not exists public.media_notifications (
  id            bigint generated always as identity primary key,
  to_id         text not null,
  from_id       text not null default '',
  from_name     text not null default 'مستخدم',
  type          text not null default 'follow',
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_media_notifications_to on public.media_notifications (to_id, created_at desc);

alter table public.media_notifications enable row level security;

-- No public read policy: notifications are fetched only through the API
-- route (service role), which filters by the caller's own Telegram id.
grant all on public.media_notifications to service_role;
grant usage, select on sequence public.media_notifications_id_seq to service_role;
