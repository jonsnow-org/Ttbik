-- MARRIAGE_BOT (owner-approved 2026-11-11), additive only — no existing data is changed or dropped.
-- The app also creates these on first use (appStore.ts DDL_FALLBACK v9 / trust.ts ensureTrustTables), so running
-- this file by hand is optional; it is idempotent.

-- 🔔 opt-in daily «3 best matches» digest (one row per member who switched it on; enabled=false after «🔕 إيقاف»).
CREATE TABLE IF NOT EXISTS match_digest_optin (user_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_digest_optin_bot_idx ON match_digest_optin (bot_id) WHERE enabled;

-- 🙅 «غير مناسب» + reason on a matchmaker suggestion (feeds the next ranking for that member).
ALTER TABLE match_matchmaker_sent ADD COLUMN IF NOT EXISTS verdict TEXT;
ALTER TABLE match_matchmaker_sent ADD COLUMN IF NOT EXISTS verdict_at TIMESTAMPTZ;
