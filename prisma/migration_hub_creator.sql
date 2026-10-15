-- Creator hub (/create): six tools + bot templates HUB_*_BOT. The app also creates these on first use (src/lib/hub/hubDb.ts).
-- Run once in Supabase → SQL Editor if you prefer creating them by hand. Safe to re-run.
CREATE TABLE IF NOT EXISTS hub_points (uid text PRIMARY KEY, name text, balance int NOT NULL DEFAULT 0, total int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS hub_points_log (id bigserial PRIMARY KEY, uid text NOT NULL, action text NOT NULL, amount int NOT NULL, day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS hub_points_log_uid_day ON hub_points_log (uid, day);
CREATE TABLE IF NOT EXISTS hub_apps (slug text PRIMARY KEY, owner_uid text NOT NULL, edit_key_hash text NOT NULL, config jsonb NOT NULL, views int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS hub_apps_owner ON hub_apps (owner_uid);
CREATE TABLE IF NOT EXISTS hub_mood (id bigserial PRIMARY KEY, uid text NOT NULL, score int NOT NULL CHECK (score BETWEEN 1 AND 5), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS hub_mood_uid ON hub_mood (uid, created_at DESC);
CREATE TABLE IF NOT EXISTS hub_usage (uid text NOT NULL, day date NOT NULL, n int NOT NULL DEFAULT 0, PRIMARY KEY (uid, day));
CREATE TABLE IF NOT EXISTS hub_bot_state (uid text PRIMARY KEY, state jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE hub_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_points_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_mood ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_bot_state ENABLE ROW LEVEL SECURITY;
