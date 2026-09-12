-- Owner spec, 2026-09-12 ("لا اريد عرض شرائح... اريد فديو حقيقي وليس
-- شرائح"): real video (CogVideoX-2B, actually confirmed working —
-- 157s on a real T4 GPU, see ai-system/colab/generate_image_model.ipynb's
-- own test cell) needs a real GPU this project has no free LIVE-serving
-- access to (ModelScope Studio is CPU-only). The honest way to still
-- deliver REAL video at $0: queue requests here, and a scheduled Kaggle
-- run (ai-system/colab/process_video_queue.ipynb, real free T4 GPU
-- quota) processes a batch periodically and delivers straight to
-- Telegram — real video, not instant. Run once in Supabase's SQL
-- Editor. Idempotent.

CREATE TABLE IF NOT EXISTS "NovaVideoQueue" (
    "id"           TEXT NOT NULL,
    "novaUserId"   TEXT NOT NULL,
    "channel"      TEXT NOT NULL,
    "chatId"       TEXT NOT NULL,
    "prompt"       TEXT NOT NULL,
    "seconds"      INTEGER NOT NULL DEFAULT 6,
    -- PENDING -> PROCESSING (claimed by a Kaggle run, avoids double
    -- work if a run overlaps the previous one) -> DONE | FAILED.
    "status"       TEXT NOT NULL DEFAULT 'PENDING',
    "error"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "NovaVideoQueue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaVideoQueue_status_idx" ON "NovaVideoQueue"("status");

-- Real bug hit live, 2026-09-12 (owner's own Render logs): this table
-- existing isn't enough on Supabase — the backend's service_role had no
-- table-level privileges on it, so every real insert failed with
-- "permission denied for table NovaVideoQueue" (Postgres error 42501),
-- silently breaking the ONLY real free video path this project has.
-- Every other table this project's service_role already touches got
-- this grant implicitly (existing default privileges); a brand new
-- table via SQL Editor does not inherit that automatically. Idempotent
-- (GRANT is safe to re-run).
GRANT SELECT, INSERT, UPDATE ON public."NovaVideoQueue" TO service_role;
