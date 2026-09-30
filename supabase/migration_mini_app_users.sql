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
