
-- Close public read paths that must follow the media application's visibility rules.
-- Run after migration_media_feed.sql and migration_admin_settings.sql.
-- Server-side media routes continue to use SUPABASE_SERVICE_ROLE_KEY.

begin;

alter table public.media_feed enable row level security;
drop policy if exists "public read media_feed" on public.media_feed;
drop policy if exists "public read visible media_feed" on public.media_feed;
create policy "public read visible media_feed"
  on public.media_feed
  for select
  to anon, authenticated
  using (
    coalesce(hidden, false) = false
    and coalesce(squad_code, '') = ''
  );

-- Comments are public only when their parent post is visible to the public.
alter table public.media_comments enable row level security;
drop policy if exists "public read media_comments" on public.media_comments;
drop policy if exists "public read comments on visible media" on public.media_comments;
create policy "public read comments on visible media"
  on public.media_comments
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.media_feed mf
      where mf.id = media_comments.post_id
    )
  );

-- Watch-party rooms and chat are private application data.
-- Access is mediated by /api/party after Telegram identity and membership checks.
alter table public.party_rooms enable row level security;
alter table public.party_messages enable row level security;
drop policy if exists "public read party_rooms" on public.party_rooms;
drop policy if exists "public read party_messages" on public.party_messages;
revoke all on public.party_rooms, public.party_messages from anon, authenticated;
grant all on public.party_rooms, public.party_messages to service_role;
grant usage, select on sequence public.party_messages_id_seq to service_role;

commit;
