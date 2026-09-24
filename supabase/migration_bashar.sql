-- «بَشَر» (/bashar). The app creates these itself on first use through
-- DATABASE_URL (src/lib/bashar.ts ensureTables). Run by hand ONLY if the page
-- shows «الخدمة غير متاحة مؤقتاً» because that role can't create tables.
CREATE TABLE IF NOT EXISTS bashar_players (
  id text PRIMARY KEY,
  credits int NOT NULL DEFAULT 1,
  credits_at timestamptz NOT NULL DEFAULT now(),
  answered int NOT NULL DEFAULT 0,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bashar_questions (
  id text PRIMARY KEY,
  asker text NOT NULL,
  asker_cc text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  claimed_at timestamptz,
  answer text,
  answerer text,
  answer_cc text,
  answered_at timestamptz,
  expired boolean NOT NULL DEFAULT false,
  reports int NOT NULL DEFAULT 0,
  hidden boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS bashar_q_open ON bashar_questions (created_at) WHERE answer IS NULL AND expired = false;
ALTER TABLE bashar_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE bashar_questions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bashar_players, bashar_questions TO service_role;
