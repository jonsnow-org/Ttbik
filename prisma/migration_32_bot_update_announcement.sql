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
