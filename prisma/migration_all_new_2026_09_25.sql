-- كل ما يلزم للقوالب والميزات الجديدة دفعة واحدة:
--   1) بوت الاعترافات (migration_34)  2) بوت توافق الأسماء (migration_35)
--   3) «نبض» بنك الدم + «اطلب وهم يتنافسون» (migration_36)
-- جداول جديدة فقط، لا يعدّل أي جدول موجود. آمن للتشغيل أكثر من مرة.
-- الصقه كاملاً في Supabase → SQL Editor ثم Run.

-- ================= migration_34_confession_bot =================
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

-- ================= migration_35_name_compat_bot =================
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

-- ================= migration_36_blood_bank_and_tenders =================
-- «نبض» blood bank (MEDICAL_BOT) + «اطلب وهم يتنافسون» price-quote requests
-- (JOBS_BOT). New tables only — nothing existing is altered. Run once in
-- Supabase's SQL Editor. Idempotent (safe to run again).

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsTender" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "budget" DOUBLE PRECISION,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "awardedBidId" TEXT,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobsTender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsTenderBid" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobsTenderBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedBloodDonor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bloodType" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "lastDonationAt" TIMESTAMP(3),
    "donationsCount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedBloodDonor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedBloodRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "bloodType" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "place" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "note" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedBloodRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedBloodResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedBloodResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobsTender_status_expiresAt_idx" ON "JobsTender"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobsTenderBid_tenderId_bidderId_key" ON "JobsTenderBid"("tenderId", "bidderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MedBloodDonor_userId_key" ON "MedBloodDonor"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MedBloodRequest_status_expiresAt_idx" ON "MedBloodRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MedBloodResponse_requestId_donorId_key" ON "MedBloodResponse"("requestId", "donorId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "JobsTenderBid" ADD CONSTRAINT "JobsTenderBid_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "JobsTender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodDonor" ADD CONSTRAINT "MedBloodDonor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodRequest" ADD CONSTRAINT "MedBloodRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodResponse" ADD CONSTRAINT "MedBloodResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MedBloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodResponse" ADD CONSTRAINT "MedBloodResponse_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

