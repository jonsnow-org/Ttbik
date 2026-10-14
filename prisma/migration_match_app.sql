-- MARRIAGE_BOT premium Mini App (2026-10-14). Additive; the app also runs these on first use.
CREATE TABLE IF NOT EXISTS match_app_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_app_messages_session_idx ON match_app_messages (session_id, id);
CREATE TABLE IF NOT EXISTS match_app_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  spins INT NOT NULL DEFAULT 0,
  superlikes INT NOT NULL DEFAULT 0,
  extra_superlikes INT NOT NULL DEFAULT 0,
  anon_chats INT NOT NULL DEFAULT 0,
  extra_anon INT NOT NULL DEFAULT 0,
  compliments INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS match_app_passes (
  user_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id)
);
CREATE TABLE IF NOT EXISTS match_app_compliments (
  sender_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (sender_id, target_id, day)
);
CREATE TABLE IF NOT EXISTS match_app_perks (
  user_id TEXT PRIMARY KEY,
  referral_vip_claimed BOOLEAN NOT NULL DEFAULT false,
  anon_filter JSONB
);
