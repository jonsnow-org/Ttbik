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
