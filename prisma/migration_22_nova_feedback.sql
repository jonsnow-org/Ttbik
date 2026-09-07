-- NOVA AI — feedback loop (owner spec 2026-09-08, "حلقة التدريب
-- والتطوير الذاتي / DPO"): a rating column so a 👍/👎 tap on any real
-- answer becomes training signal. UP/DOWN/NULL (no feedback given).
-- Idempotent, run once in Supabase's SQL Editor.

ALTER TABLE "NovaUsageLog" ADD COLUMN IF NOT EXISTS "rating" TEXT;
