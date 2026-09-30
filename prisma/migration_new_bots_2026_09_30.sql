-- شغّل هذا الملف مرة واحدة في Supabase ← SQL Editor.
-- يُنشئ كل جداول البوتات الجديدة (الاعترافات، التوافق، الاختبارات، السلاسل، الصلاة،
-- بنك الدم، المناقصات، الزيارات، نقاط المنصة). آمن لإعادة التشغيل (IF NOT EXISTS).
-- يفترض وجود migration_full_current_schema.sql مسبقاً.

-- ===== migration_31 =====
-- Owner report, 2026-09-22: "البوتات لا يزيد عدد مستخدميها رغم النشر
-- والترويج المستمر على فيسبوك" (bots' user counts never grow despite
-- continuous Facebook promotion).
--
-- Real root cause found in code, not assumed: every per-template user
-- table (User for AD_BOT, MatchUser for MARRIAGE_BOT, JobsUser for
-- JOBS_BOT) upserts a real person's row keyed on their GLOBAL Telegram
-- id alone (`prisma.user.upsert({ where: { id: tgUserId }, update: {},
-- create: { id: tgUserId, botId, ... } })`) -- the `update: {}` branch
-- never touches `botId` again once a row exists. A real person who
-- already started ANY OTHER bot deployment sharing that same table (a
-- different AD_BOT clone sold to another creator via the B2B resale
-- flow, for instance) keeps that FIRST bot's botId permanently. Every
-- OTHER bot's own "عدد المستخدمين" (prisma.user.count({ where: { botId
-- } })) then understates its real reach for exactly that population --
-- which is precisely the invisible-growth symptom reported.
--
-- Fix is deliberately additive, not a restructuring of User/MatchUser/
-- JobsUser's primary key: those tables carry live financial data
-- (balances, ad budgets, transactions, escrow) already foreign-keyed on
-- the single `id` column; changing that key on a live production table
-- is a real, unnecessary risk. This new table exists only to answer,
-- accurately, "how many distinct real people have ever actually started
-- THIS bot" -- one row per (botId, tgUserId) pair, written once via
-- recordBotVisit() (src/lib/botVisit.ts) on every real /start, regardless
-- of what any other table's botId column says.

CREATE TABLE IF NOT EXISTS "BotVisit" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "tgUserId" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BotVisit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BotVisit_botId_tgUserId_key" ON "BotVisit"("botId", "tgUserId");
CREATE INDEX IF NOT EXISTS "BotVisit_botId_idx" ON "BotVisit"("botId");

-- One-time real backfill: seed BotVisit from every row that already
-- exists across all three per-template tables, so bots don't start this
-- fix at zero and look like they lost history. This backfill inherits
-- the SAME undercount the bug already caused (a crossed-over user's
-- earlier bots never got their row in the first place) -- it cannot
-- retroactively recover visits the old code never recorded anywhere,
-- only carry forward what each table does have on file today. Going
-- forward, every real /start records its own accurate row regardless.
INSERT INTO "BotVisit" ("id", "botId", "tgUserId", "firstSeenAt")
SELECT gen_random_uuid()::text, "botId", "id", "created_at" FROM "User"
ON CONFLICT ("botId", "tgUserId") DO NOTHING;

INSERT INTO "BotVisit" ("id", "botId", "tgUserId", "firstSeenAt")
SELECT gen_random_uuid()::text, "botId", "id", "created_at" FROM "MatchUser"
ON CONFLICT ("botId", "tgUserId") DO NOTHING;

INSERT INTO "BotVisit" ("id", "botId", "tgUserId", "firstSeenAt")
SELECT gen_random_uuid()::text, "botId", "id", "created_at" FROM "JobsUser"
ON CONFLICT ("botId", "tgUserId") DO NOTHING;

-- Missing on first ship (caught 2026-09-22, see AGENT_BUS.md's standing
-- "always GRANT a new table" rule) -- safe to re-run, GRANT is idempotent.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "BotVisit" TO service_role;

-- ===== migration_32 =====
-- Owner directive, 2026-09-22: after a real bot update ships, the bot
-- itself should message its users about it automatically -- not the
-- owner pressing the existing manual "إذاعة" broadcast button each time.
--
-- This table is the queue: Claude inserts one row per real, user-facing
-- update (plain Arabic, starting with "#تحديث", never internal/sensitive
-- detail) as part of shipping that update's own migration (or a small
-- standalone one like this file, when the update itself needed no schema
-- change). The new /api/cron/bot-update-announcements cron (see
-- vercel.json) picks up every row with sentAt still null, sends it to
-- that template's real users, and stamps sentAt + sentCount -- fully
-- automatic from here, no manual broadcast action needed.

CREATE TABLE IF NOT EXISTS "BotUpdateAnnouncement" (
  "id"        TEXT NOT NULL,
  "template"  TEXT NOT NULL,
  "text"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"    TIMESTAMP(3),
  "sentCount" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "BotUpdateAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BotUpdateAnnouncement_template_sentAt_idx" ON "BotUpdateAnnouncement"("template", "sentAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "BotUpdateAnnouncement" TO service_role;

-- ===== migration_33 =====
-- Backlog item 1 (docs/claude-feature-backlog.md) — a single points/rewards
-- balance per real Telegram person, shared across every bot on the
-- platform: earned in any one bot (daily streak, referral, quiz win, ...)
-- and spendable in any other. Deliberately keyed on tgUserId alone (NOT
-- botId+tgUserId), the opposite of BotVisit's per-bot design in
-- migration_31 — the whole point here is one balance that follows the
-- person across bots.
--
-- Foundational: no bot template earns or spends against this yet. Later
-- queue items plug into it via earnPoints()/spendPoints() in
-- src/lib/platformPoints.ts. This migration is safe to run now regardless
-- — it only adds new, empty tables.

CREATE TABLE IF NOT EXISTS "PlatformPoints" (
  "id"         TEXT NOT NULL,
  "tgUserId"   TEXT NOT NULL,
  "balance"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformPoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformPoints_tgUserId_key" ON "PlatformPoints"("tgUserId");

-- Append-only ledger behind PlatformPoints.balance — every earn/spend
-- writes one row here (positive amount = earn, negative = spend) in the
-- same DB transaction as the balance update, so the balance can always be
-- reconciled/audited from history, same pattern as Transaction backing
-- User.balance elsewhere in this schema.
CREATE TABLE IF NOT EXISTS "PlatformPointsTransaction" (
  "id"           TEXT NOT NULL,
  "tgUserId"     TEXT NOT NULL,
  "botId"        TEXT,
  "amount"       INTEGER NOT NULL,
  "reason"       TEXT NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformPointsTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlatformPointsTransaction_tgUserId_idx" ON "PlatformPointsTransaction"("tgUserId");

-- Grants — required for Supabase's service_role to read/write these
-- tables (RLS bypass alone is not enough, an explicit GRANT is required).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "PlatformPoints" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "PlatformPointsTransaction" TO service_role;

-- ===== migration_34 =====
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

-- ===== migration_35 =====
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

-- ===== migration_36 =====
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

-- ===== migration_37 =====
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

-- ===== migration_38 =====
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

-- ===== migration_39 =====
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

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

-- ===== migration_40 =====
-- CAPSULE_BOT (كبسولة الزمن): شغّل مرة واحدة في Supabase ← SQL Editor. آمن لإعادة التشغيل.
CREATE TABLE IF NOT EXISTS "CapsuleUser" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "pendingAction" JSONB,
  "isBanned" BOOLEAN NOT NULL DEFAULT false,
  "mutedUntil" TIMESTAMP(3),
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapsuleUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Capsule" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "deliverAt" TIMESTAMP(3) NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Capsule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Capsule_code_key" ON "Capsule"("code");
CREATE INDEX IF NOT EXISTS "Capsule_deliverAt_deliveredAt_idx" ON "Capsule"("deliverAt", "deliveredAt");
CREATE INDEX IF NOT EXISTS "Capsule_senderId_idx" ON "Capsule"("senderId");
CREATE INDEX IF NOT EXISTS "Capsule_botId_idx" ON "Capsule"("botId");

DO $$ BEGIN
  ALTER TABLE "Capsule" ADD CONSTRAINT "Capsule_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "CapsuleUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CapsuleUser" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Capsule" TO service_role;

-- ===== migration_41 =====
-- بوت التعارف: خيار «إظهار ملفي لدولتي فقط». شغّله مرة واحدة في Supabase ← SQL Editor.
CREATE TABLE IF NOT EXISTS "MatchProfilePrivacy" (
  "userId" TEXT NOT NULL,
  "countryOnly" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchProfilePrivacy_pkey" PRIMARY KEY ("userId")
);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MatchProfilePrivacy" TO service_role;
