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
