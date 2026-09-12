-- Owner spec, 2026-09-12 ("هو يملك كل الصلاحيات للتعديلات الخفيفة على
-- نظامه ولكن الادوات والتطوير الذاتي يعطيني تقرير... فاقبل او ارفض"):
-- real, durable record of every self-improvement proposal Nova ever
-- researches (tools/methods it found for improving itself), whether
-- triggered on a weekly schedule or by the owner's own direct command
-- — see ai-system/app/self_improve.py. Never auto-applied:
-- "status" only ever moves PENDING -> ACCEPTED/REJECTED via the
-- owner's own explicit decision, and only ACCEPTED rows with a
-- confident file_path ever reach dev_agent.py's real PR machinery.
CREATE TABLE IF NOT EXISTS "NovaSelfImprovementProposal" (
    "id"           TEXT NOT NULL,
    "topic"        TEXT NOT NULL,
    "finding"      TEXT NOT NULL,
    "usefulness"   TEXT,
    "impact"       TEXT,
    "file_path"    TEXT,
    "status"       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | ACCEPTED | REJECTED
    "trigger"      TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | owner_directed
    "pr_url"       TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at"   TIMESTAMP(3),

    CONSTRAINT "NovaSelfImprovementProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaSelfImprovementProposal_status_idx" ON "NovaSelfImprovementProposal"("status");

-- Same real bug class hit before (migration_25's own GRANT) — a brand
-- new table via SQL Editor does not automatically inherit the
-- service_role privileges older tables got implicitly. Idempotent.
GRANT SELECT, INSERT, UPDATE ON public."NovaSelfImprovementProposal" TO service_role;
