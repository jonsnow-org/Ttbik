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
