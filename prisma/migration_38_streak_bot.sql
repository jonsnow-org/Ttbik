-- STREAK_BOT — بوت السلاسل اليومية (docs/claude-feature-backlog.md item 5).
-- Fully independent tables from every other bot template. Run once in
-- Supabase's SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS "StreakUser" (
    "id"            TEXT NOT NULL,
    "botId"         TEXT NOT NULL,
    "pendingAction" JSONB,
    "isBanned"      BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil"    TIMESTAMP(3),
    "lastActiveAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreakUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StreakEntry" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "category"        TEXT NOT NULL,
    "currentStreak"   INTEGER NOT NULL DEFAULT 0,
    "longestStreak"   INTEGER NOT NULL DEFAULT 0,
    "lastCheckInDate" TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreakEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StreakEntry_userId_category_key" ON "StreakEntry"("userId", "category");
CREATE INDEX IF NOT EXISTS "StreakEntry_userId_idx" ON "StreakEntry"("userId");

-- Foreign key (added after both tables exist, IF NOT EXISTS via DO-block
-- since Postgres has no native "ADD CONSTRAINT IF NOT EXISTS").
DO $$ BEGIN
    ALTER TABLE "StreakEntry" ADD CONSTRAINT "StreakEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StreakUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants — required for Supabase's service_role to read/write these
-- tables (RLS bypass alone is not enough, an explicit GRANT is required).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "StreakUser" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "StreakEntry" TO service_role;
