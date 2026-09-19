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
