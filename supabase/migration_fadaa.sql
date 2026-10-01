-- فضاء: جلسات ومساهمات (شغّل مرة في Supabase SQL Editor)
create table if not exists public.fadaa_sessions (
  id text primary key,
  bot_id text,
  kind text not null default 'knowledge',
  title text not null,
  purpose text default '',
  duration_hours int default 24,
  visibility text default 'public',
  plan text default 'free',
  status text default 'open',
  owner_id text not null,
  owner_name text,
  created_at timestamptz default now(),
  closes_at timestamptz,
  closed_at timestamptz,
  participant_ids jsonb default '[]'::jsonb,
  roles jsonb default '{}'::jsonb
);
create index if not exists fadaa_sessions_status_idx on public.fadaa_sessions (status);
create index if not exists fadaa_sessions_bot_idx on public.fadaa_sessions (bot_id);

create table if not exists public.fadaa_contributions (
  id text primary key,
  session_id text not null references public.fadaa_sessions(id) on delete cascade,
  author_id text not null,
  author_name text,
  role text,
  kind text,
  text text not null,
  hidden boolean default false,
  created_at timestamptz default now()
);
create index if not exists fadaa_contrib_session_idx on public.fadaa_contributions (session_id);
