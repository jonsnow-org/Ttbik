-- NOVA AI — tiered subscription plans + separate daily/weekly quota
-- counters for text vs images (owner spec 2026-09-08: everything the
-- bot can do stays free for everyone, only the daily/weekly AMOUNT
-- scales by plan — a much stricter free image cap than the free text
-- cap, plus a rolling weekly ceiling on top of the daily one so a paid
-- plan can't be hammered non-stop). Exact numbers live in
-- ai-system/app/quota.py's PLANS dict, not here. Idempotent, run once
-- in Supabase's SQL Editor.

ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "dailyUsedImage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "weeklyUsedText" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "weeklyUsedImage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "weeklyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- "plan" and "NovaSubscription.plan" keep their existing TEXT type —
-- no CHECK constraint added, since the app layer (quota.py's PLANS
-- dict) is the single source of truth for which plan names are valid,
-- exactly like "FREE" | "PRO" worked before this migration.
