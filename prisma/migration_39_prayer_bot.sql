-- PRAYER_BOT — بوت مواقيت الصلاة (docs/claude-feature-backlog.md item 6).
-- Fully independent table from every other bot template. Run once in
-- Supabase's SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS "PrayerUser" (
    "id"            TEXT NOT NULL,
    "botId"         TEXT NOT NULL,
    "cityId"        TEXT,
    "dailyReminder" BOOLEAN NOT NULL DEFAULT false,
    "pendingAction" JSONB,
    "isBanned"      BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrayerUser_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PrayerUser_botId_dailyReminder_idx" ON "PrayerUser"("botId", "dailyReminder");

-- Grants — required for Supabase's service_role to read/write this table.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "PrayerUser" TO service_role;
