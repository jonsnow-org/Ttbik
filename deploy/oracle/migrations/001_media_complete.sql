-- 001: everything the media mini-app and the media bot store, in one safe-to-repeat script.
-- Applied automatically by the Oracle update agent (agent/migrate.sh); nothing to run by hand.

-- ===== from supabase/migration_media_feed.sql =====
-- Media Mini-App feed persistence
-- Run once in Supabase → SQL Editor → New query → Run

create table if not exists public.media_feed (
  id            text primary key,
  file_id       text not null,
  media_type    text not null default 'video',
  title         text not null default '',
  url           text default '',
  thumbnail     text default '',
  sharer_name   text default 'مستخدم',
  sharer_id     text default '',
  clones        int not null default 0,
  views         int not null default 0,
  likes         int not null default 0,
  tags          text[] default '{}',
  squad_code    text default '',
  created_at    timestamptz not null default now()
);

create index if not exists idx_media_feed_created on public.media_feed (created_at desc);
create index if not exists idx_media_feed_sharer on public.media_feed (sharer_id);
create index if not exists idx_media_feed_type on public.media_feed (media_type);
create index if not exists idx_media_feed_clones on public.media_feed (clones desc);

-- Public read for Mini App (anon). Writes only via service role from API.
alter table public.media_feed enable row level security;

drop policy if exists "public read media_feed" on public.media_feed;
create policy "public read media_feed" on public.media_feed
  for select using (true);

grant select on public.media_feed to anon, authenticated;
grant all on public.media_feed to service_role;

-- ===== from supabase/migration_media_social.sql =====
-- Media Mini-App: real (server-side) follow / mute / block / report.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to re-run.
--
-- Before this, "follow" lived only in each visitor's localStorage, so a
-- "following" feed was impossible and nobody's follower count was real.

create table if not exists public.media_follows (
  follower_id  text not null,
  followee_id  text not null,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id)
);
create index if not exists idx_media_follows_followee on public.media_follows (followee_id);
-- Per-follow bot notification when the followed user shares something new:
-- notify = the follower's 🔔 toggle for that person; notified_at throttles
-- it to at most one message per follow every 30 minutes.
alter table public.media_follows add column if not exists notify boolean not null default true;
alter table public.media_follows add column if not exists notified_at timestamptz;

-- Mute: the muter stops seeing the muted user's posts. The muted user is
-- not told and nothing else changes.
create table if not exists public.media_mutes (
  user_id     text not null,
  muted_id    text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, muted_id)
);

-- Block: both sides stop seeing each other's posts, and the blocked user
-- can no longer follow, message, or comment on the blocker's posts.
create table if not exists public.media_blocks (
  user_id     text not null,
  blocked_id  text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, blocked_id)
);
create index if not exists idx_media_blocks_blocked on public.media_blocks (blocked_id);

create table if not exists public.media_reports (
  id             text primary key,
  post_id        text not null,
  post_title     text default '',
  post_owner_id  text default '',
  reporter_id    text not null,
  reporter_name  text default '',
  reason         text not null,
  details        text default '',
  status         text not null default 'open', -- open | hidden | dismissed
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists idx_media_reports_status on public.media_reports (status, created_at desc);
-- One open report per person per post (re-reporting just updates it).
create unique index if not exists idx_media_reports_once on public.media_reports (post_id, reporter_id);

-- Writes only go through the API (service role) after Telegram initData
-- verification; nothing here is readable with the public anon key.
alter table public.media_follows enable row level security;
alter table public.media_mutes   enable row level security;
alter table public.media_blocks  enable row level security;
alter table public.media_reports enable row level security;

grant select, insert, update, delete on public.media_follows to service_role;
grant select, insert, update, delete on public.media_mutes   to service_role;
grant select, insert, update, delete on public.media_blocks  to service_role;
grant select, insert, update, delete on public.media_reports to service_role;
grant delete on public.media_feed to service_role;

-- Accurate counters: one view per person per post (the post's own sharer
-- never counts), one like per person per post. media_feed.views / likes
-- only change when a row here is actually inserted/deleted.
create table if not exists public.media_views (
  post_id    text not null,
  viewer_id  text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, viewer_id)
);
create table if not exists public.media_likes (
  post_id    text not null,
  user_id    text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists idx_media_likes_user on public.media_likes (user_id);
alter table public.media_views enable row level security;
alter table public.media_likes enable row level security;
grant select, insert, update, delete on public.media_views to service_role;
grant select, insert, update, delete on public.media_likes to service_role;

-- Rewarded ads → extra bot downloads: each finished rewarded ad in the
-- mini-app adds bonus downloads for that UTC day (capped per day). The bot
-- reads today's bonus before every download and adds it to the daily limit.
create table if not exists public.media_ad_rewards (
  user_id  text not null,
  day      text not null,          -- YYYY-MM-DD (UTC, same day boundary as the bot)
  ads      int  not null default 0,
  bonus    int  not null default 0,
  last_at  timestamptz,
  primary key (user_id, day)
);
alter table public.media_ad_rewards enable row level security;
grant select, insert, update, delete on public.media_ad_rewards to service_role;

-- ===== from supabase/migration_media_comments.sql =====
-- Media Mini-App comments (+ threaded replies) and post-linked notifications
-- Run once in Supabase → SQL Editor → New query → Run
--
-- The 💬 button on each feed card used to open a private-message thread
-- with the post's sharer -- there was no actual public comment feature at
-- all. This adds real comments, replies to a comment, and replies to a
-- reply (arbitrary depth via parent_id), each one notifying the right
-- person (the post owner on a top-level comment, the parent comment's
-- author on a reply).

create table if not exists public.media_comments (
  id            text primary key,
  post_id       text not null,
  parent_id     text references public.media_comments(id) on delete cascade,
  from_id       text not null,
  from_name     text not null default 'مستخدم',
  body          text not null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_media_comments_post on public.media_comments (post_id, created_at asc);
create index if not exists idx_media_comments_parent on public.media_comments (parent_id);

alter table public.media_comments enable row level security;

-- Public read for the Mini App (comments are public, same as the feed
-- itself). Writes only via service role from the API route.
drop policy if exists "public read media_comments" on public.media_comments;
create policy "public read media_comments" on public.media_comments
  for select using (true);

grant select on public.media_comments to anon, authenticated;
grant all on public.media_comments to service_role;

-- So a comment/reply notification can jump straight to the post instead
-- of just the commenter's profile.
alter table public.media_notifications add column if not exists post_id text;

-- ===== from supabase/migration_media_notifications.sql =====
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

-- ===== from supabase/migration_media_premium_sync.sql =====
-- Media bot premium — single, website-queryable record of who has the paid
-- upgrade (owner concern, 2026-09-26: a payment made inside the Telegram
-- bot must not be invisible to the mini app, now or if a mini-app feature
-- is ever paywalled). Before this, "premium" only ever lived inside the
-- Python bot's own in-memory store, persisted as a JSON blob pinned to a
-- Telegram archive channel (services/store.py's persist()/load_from_archive())
-- — completely unreachable from this site's Supabase project, for BOTH the
-- existing NOWPayments/order-code redemption AND the new Telegram Stars
-- path. This table becomes the one shared source of truth going forward;
-- the bot's local store is kept too (so it still enforces limits offline),
-- but every grant, regardless of payment method, is now also written here.
-- Run once in Supabase → SQL Editor. Safe to run again.
create table if not exists public.media_premium_users (
  tg_user_id text primary key,
  source     text not null, -- 'order_code' (existing NOWPayments/manual flow) | 'telegram_stars'
  granted_at timestamptz not null default now()
);
alter table public.media_premium_users enable row level security; -- no public policies: server (service_role) only
grant all on public.media_premium_users to service_role;

-- ===== from supabase/migration_mini_app_users.sql =====
-- إحصائيات مستخدمي التطبيق المصغّر (Mini App): شغّله مرة واحدة في Supabase ← SQL Editor.
-- بدونه كانت الأعداد تُحفظ في ذاكرة الخادم فقط وتُصفَّر مع كل إعادة تشغيل.
create table if not exists public.mini_app_users (
  id         text primary key,
  name       text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists mini_app_users_last_seen_idx on public.mini_app_users (last_seen);
create index if not exists mini_app_users_first_seen_idx on public.mini_app_users (first_seen);
alter table public.mini_app_users enable row level security;
grant select, insert, update, delete on table public.mini_app_users to service_role;
alter table public.mini_app_users add column if not exists name text;
alter table public.mini_app_users add column if not exists first_seen timestamptz not null default now();
alter table public.mini_app_users add column if not exists last_seen timestamptz not null default now();
alter table public.mini_app_users add column if not exists avatar text;

-- ===== from supabase/migration_mini_app_events.sql =====
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

-- ===== from supabase/migration_media_bot_front_door.sql =====
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


-- ===== new in 001 =====
-- columns the code reads from media_feed that older databases may lack
alter table public.media_feed add column if not exists views int not null default 0;
alter table public.media_feed add column if not exists likes int not null default 0;
alter table public.media_feed add column if not exists clones int not null default 0;
alter table public.media_feed add column if not exists tags text[] default '{}';
alter table public.media_feed add column if not exists squad_code text default '';
alter table public.media_feed add column if not exists duration_sec int default 0;
alter table public.media_feed add column if not exists quality text default '';
alter table public.media_feed add column if not exists hidden boolean not null default false;

-- Views count again after a cooldown (a person who comes back to a post is a new view), so remember when each viewer last counted
alter table public.media_views add column if not exists last_at timestamptz not null default now();
alter table public.media_views add column if not exists times int not null default 1;

-- Private messages. The code has always written here, but no script ever created it: without the table every message lived only in
-- one server instance's memory and vanished on the next restart.
create table if not exists public.direct_messages (
  id          text primary key,
  from_id     text not null,
  from_name   text not null default 'مستخدم',
  to_id       text not null,
  body        text not null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_direct_messages_to on public.direct_messages (to_id, created_at desc);
create index if not exists idx_direct_messages_pair on public.direct_messages (from_id, to_id, created_at desc);
alter table public.direct_messages enable row level security;
grant select, insert, update, delete on public.direct_messages to service_role;

-- What a person wants the bot to send them. Stopping bot messages is part of the paid upgrade; in-app notifications always stay.
create table if not exists public.media_notify_prefs (
  user_id     text primary key,
  push_off    boolean not null default false,        -- stop every bot notification (paid)
  off_types   text[] not null default '{}',          -- or only some types: like, comment, reply, follow, message, post
  updated_at  timestamptz not null default now()
);
alter table public.media_notify_prefs enable row level security;
grant select, insert, update, delete on public.media_notify_prefs to service_role;

-- Bot pushes already sent, so one burst of activity is one message (and so we can show "sent" honestly)
create table if not exists public.media_push_log (
  id          bigint generated always as identity primary key,
  to_id       text not null,
  type        text not null,
  from_id     text not null default '',
  ok          boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_media_push_log_to on public.media_push_log (to_id, type, created_at desc);
alter table public.media_push_log enable row level security;
grant select, insert, delete on public.media_push_log to service_role;
grant usage, select on sequence public.media_push_log_id_seq to service_role;

-- make the API see the new tables and columns at once
notify pgrst, 'reload schema';
