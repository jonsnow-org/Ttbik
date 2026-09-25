-- NAME_COMPAT_BOT — نسبة التوافق بين اسمين (docs/claude-feature-backlog.md
-- item 3). Fully independent tables from every other bot template. Run
-- once in Supabase's SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS "NameCompatUser" (
    "id"                TEXT NOT NULL,
    "botId"             TEXT NOT NULL,
    "pendingAction"     JSONB,
    "calculationsCount" INTEGER NOT NULL DEFAULT 0,
    "isBanned"          BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil"        TIMESTAMP(3),
    "lastActiveAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NameCompatUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NameCompatResult" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "name1"      TEXT NOT NULL,
    "name2"      TEXT NOT NULL,
    "percentage" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NameCompatResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NameCompatResult_userId_idx" ON "NameCompatResult"("userId");

-- Foreign key (added after both tables exist, IF NOT EXISTS via DO-block
-- since Postgres has no native "ADD CONSTRAINT IF NOT EXISTS").
DO $$ BEGIN
    ALTER TABLE "NameCompatResult" ADD CONSTRAINT "NameCompatResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "NameCompatUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants — required for Supabase's service_role to read/write these
-- tables (RLS bypass alone is not enough, an explicit GRANT is required).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "NameCompatUser" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "NameCompatResult" TO service_role;
