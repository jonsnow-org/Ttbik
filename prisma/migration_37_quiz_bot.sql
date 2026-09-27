-- QUIZ_BOT — بوت اختبارات الشخصية (docs/claude-feature-backlog.md item 4).
-- Fully independent tables from every other bot template. Run once in
-- Supabase's SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS "QuizUser" (
    "id"               TEXT NOT NULL,
    "botId"            TEXT NOT NULL,
    "pendingAction"    JSONB,
    "quizzesCompleted" INTEGER NOT NULL DEFAULT 0,
    "isBanned"         BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil"       TIMESTAMP(3),
    "lastActiveAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuizResult" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "quizId"     TEXT NOT NULL,
    "resultKey"  TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QuizResult_userId_idx" ON "QuizResult"("userId");

-- Foreign key (added after both tables exist, IF NOT EXISTS via DO-block
-- since Postgres has no native "ADD CONSTRAINT IF NOT EXISTS").
DO $$ BEGIN
    ALTER TABLE "QuizResult" ADD CONSTRAINT "QuizResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "QuizUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants — required for Supabase's service_role to read/write these
-- tables (RLS bypass alone is not enough, an explicit GRANT is required).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "QuizUser" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "QuizResult" TO service_role;
