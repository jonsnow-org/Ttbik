-- Supabase change effective 2026-10-30: new tables in `public` no longer
-- get Data API grants automatically. This site's server code talks to the
-- Data API only with the service_role key, so:
--   1) grant service_role on every table that exists today (no-op for
--      tables that already have it), and
--   2) make every FUTURE table created in public (by the role that runs
--      migrations in the SQL editor) get the same grant automatically.
-- anon / authenticated are deliberately NOT granted here: many tables have
-- no RLS policies, so a blanket anon grant would expose them publicly.
-- Safe to run more than once.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
