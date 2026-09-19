-- Watch Party + ensure media_feed
-- Run in Supabase SQL Editor once

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

create table if not exists public.party_rooms (
  id            text primary key,
  host_id       text not null,
  host_name     text default 'مضيف',
  media_id      text default '',
  media_title   text default '',
  media_url     text default '',
  media_thumb   text default '',
  media_type    text default 'video',
  playing       boolean default false,
  current_time  double precision default 0,
  host_only     boolean default true,
  members       jsonb default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.party_messages (
  id            bigserial primary key,
  room_id       text not null references public.party_rooms(id) on delete cascade,
  user_id       text not null,
  user_name     text default 'مستخدم',
  body          text not null,
  kind          text default 'chat',
  created_at    timestamptz not null default now()
);

create index if not exists idx_party_msg_room on public.party_messages(room_id, id desc);
create index if not exists idx_party_rooms_updated on public.party_rooms(updated_at desc);

alter table public.media_feed enable row level security;
alter table public.party_rooms enable row level security;
alter table public.party_messages enable row level security;

drop policy if exists "public read media_feed" on public.media_feed;
create policy "public read media_feed" on public.media_feed for select using (true);

drop policy if exists "public read party_rooms" on public.party_rooms;
create policy "public read party_rooms" on public.party_rooms for select using (true);

drop policy if exists "public read party_messages" on public.party_messages;
create policy "public read party_messages" on public.party_messages for select using (true);

grant select on public.media_feed to anon, authenticated;
grant select on public.party_rooms to anon, authenticated;
grant select on public.party_messages to anon, authenticated;
grant all on public.media_feed to service_role;
grant all on public.party_rooms to service_role;
grant all on public.party_messages to service_role;
grant usage, select on sequence public.party_messages_id_seq to service_role;
