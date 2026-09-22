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
