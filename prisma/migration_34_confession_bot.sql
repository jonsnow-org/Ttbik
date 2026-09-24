-- CONFESSION_BOT — صندوق اعترافات/أسئلة مجهولة (docs/claude-feature-backlog.md
-- item 2). Fully independent tables from every other bot template. Run
-- once in Supabase's SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS "ConfessionUser" (
    "id"                       TEXT NOT NULL,
    "botId"                    TEXT NOT NULL,
    "pendingAction"            JSONB,
    "lastActiveAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isBanned"                 BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil"               TIMESTAMP(3),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance"                  DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "revealSenderUnlocked"     BOOLEAN NOT NULL DEFAULT false,
    "unlimitedRepliesUnlocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConfessionUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConfessionMessage" (
    "id"             TEXT NOT NULL,
    "boxOwnerId"     TEXT NOT NULL,
    "senderId"       TEXT NOT NULL,
    "senderName"     TEXT,
    "senderUsername" TEXT,
    "text"           TEXT NOT NULL,
    "reply"          TEXT,
    "repliedAt"      TIMESTAMP(3),
    "replyCount"     INTEGER NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfessionMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ConfessionMessage_boxOwnerId_idx" ON "ConfessionMessage"("boxOwnerId");

CREATE TABLE IF NOT EXISTS "ConfessionBlock" (
    "id"              TEXT NOT NULL,
    "ownerId"         TEXT NOT NULL,
    "blockedSenderId" TEXT NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfessionBlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConfessionBlock_ownerId_blockedSenderId_key" ON "ConfessionBlock"("ownerId", "blockedSenderId");

CREATE TABLE IF NOT EXISTS "ConfessionTransaction" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "amount"     DOUBLE PRECISION NOT NULL,
    "currency"   TEXT NOT NULL,
    "type"       TEXT NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'COMPLETED',
    "txHash"     TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfessionTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConfessionTransaction_txHash_key" ON "ConfessionTransaction"("txHash");

-- Foreign keys (added after all tables exist, IF NOT EXISTS via DO-block
-- since Postgres has no native "ADD CONSTRAINT IF NOT EXISTS").
DO $$ BEGIN
    ALTER TABLE "ConfessionMessage" ADD CONSTRAINT "ConfessionMessage_boxOwnerId_fkey" FOREIGN KEY ("boxOwnerId") REFERENCES "ConfessionUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ConfessionMessage" ADD CONSTRAINT "ConfessionMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "ConfessionUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ConfessionBlock" ADD CONSTRAINT "ConfessionBlock_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "ConfessionUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ConfessionTransaction" ADD CONSTRAINT "ConfessionTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "ConfessionUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants — required for Supabase's service_role to read/write these
-- tables (RLS bypass alone is not enough, an explicit GRANT is required).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConfessionUser" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConfessionMessage" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConfessionBlock" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConfessionTransaction" TO service_role;
