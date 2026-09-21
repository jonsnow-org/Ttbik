-- "متجر" (affiliate products store) -- owner directive 2026-09-21.
-- Run this once in Supabase's own SQL Editor (dashboard) -- a migration
-- file sitting in the repo does not apply itself to production, and this
-- project's tables need their grants stated explicitly (see the
-- "Base table privileges" note in schema.sql: service_role does NOT
-- automatically get table-level grants here, a real bug hit and fixed
-- today on the "services" table -- these grants are written correctly
-- from the start this time to avoid repeating that).

create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  title_ar text not null,
  description_ar text,
  image_url text,
  affiliate_url text not null,
  category text not null default 'عام',
  price_display text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table store_products enable row level security;

create policy "public read active store_products" on store_products
  for select using (is_active = true);

grant usage on schema public to anon, authenticated;
grant select on public.store_products to anon, authenticated;
grant select, insert, update, delete on public.store_products to service_role;
