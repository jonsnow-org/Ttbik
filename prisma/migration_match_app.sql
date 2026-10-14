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

CREATE TABLE IF NOT EXISTS match_anon_filters (user_id TEXT PRIMARY KEY, filter JSONB, paid_until TIMESTAMPTZ, active_queue_id TEXT, notified_queue_id TEXT);
CREATE TABLE IF NOT EXISTS match_rate_limits (key TEXT PRIMARY KEY, window_start TIMESTAMPTZ NOT NULL DEFAULT now(), n INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS match_admin_audit (id BIGSERIAL PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT, via TEXT NOT NULL DEFAULT 'bot', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_admin_audit_created_idx ON match_admin_audit (created_at DESC);
CREATE TABLE IF NOT EXISTS match_anon_rt (session_id TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS match_app_presence (user_id TEXT PRIMARY KEY, last_seen TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS match_app_schema (id INT PRIMARY KEY, version INT NOT NULL);

-- Recommended indexes on the existing MARRIAGE_BOT tables (additive, run manually once;
-- not executed by the app so no lock is ever taken during a request).
CREATE INDEX IF NOT EXISTS match_profile_search_idx ON "MatchProfile" (status, gender, "isHidden");
CREATE INDEX IF NOT EXISTS match_profile_verif_idx ON "MatchProfile" ("verificationStatus");
CREATE INDEX IF NOT EXISTS random_queue_wait_idx ON "RandomChatQueue" ("botId", status, "expiresAt");
CREATE INDEX IF NOT EXISTS random_queue_user_idx ON "RandomChatQueue" ("userId", created_at DESC);
CREATE INDEX IF NOT EXISTS random_session_pair_idx ON "RandomChatSession" ("user1Id", "user2Id", created_at);
CREATE INDEX IF NOT EXISTS random_session_status_idx ON "RandomChatSession" (status);
CREATE INDEX IF NOT EXISTS match_report_target_idx ON "MatchReport" ("targetId", status);
CREATE INDEX IF NOT EXISTS match_report_status_idx ON "MatchReport" (status, source, created_at);
CREATE INDEX IF NOT EXISTS match_visit_viewer_idx ON "MatchProfileVisit" ("viewerId", "visitedAt");
CREATE INDEX IF NOT EXISTS match_block_blocked_idx ON "MatchBlock" ("blockedId");

-- v5 (2026-10-14): monetization + chat UX (also created lazily by ensureMatchAppTables)
CREATE TABLE IF NOT EXISTS match_first_discount (user_id TEXT PRIMARY KEY, charge_type TEXT, used_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS match_funnel_events (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, event TEXT NOT NULL, detail TEXT, via TEXT NOT NULL DEFAULT 'app', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_funnel_events_created_idx ON match_funnel_events (created_at DESC, event);
CREATE TABLE IF NOT EXISTS match_expiry_reminders (user_id TEXT NOT NULL, kind TEXT NOT NULL, until_day TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, kind, until_day));
CREATE TABLE IF NOT EXISTS match_app_passes_log (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, target_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS match_app_passes_log_user_idx ON match_app_passes_log (user_id, id DESC);
CREATE TABLE IF NOT EXISTS match_anon_state (session_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read BIGINT NOT NULL DEFAULT 0, typing_at TIMESTAMPTZ, PRIMARY KEY (session_id, user_id));

-- v6 (2026-10-14): Athar moments (flag MATCH_ENABLE_ATHAR) + privacy-safe share page
CREATE TABLE IF NOT EXISTS match_athar_moments (user_id TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, dismissed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, kind, day));
CREATE TABLE IF NOT EXISTS match_share (token TEXT PRIMARY KEY, bot_id TEXT NOT NULL, day TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
