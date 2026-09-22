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
