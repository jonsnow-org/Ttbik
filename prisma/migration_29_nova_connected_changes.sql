-- Owner spec, 2026-09-13 ("خيار امر تنفيذ ودمج وان حدث خطأ نقول له
-- اعده للسابق"): every real change Nova proposes on a CONNECTED
-- external repo gets a row here — this is what makes "نفّذ رقم كذا" /
-- "ارجع للسابق في رقم كذا" possible without guessing which PR or which
-- repo/credential a bare number refers to, and without ever touching
-- another user's change (novaUserId is checked on every action, not
-- just used to create the row).
--
-- "previousContent"/"previousSha" are the real, deterministic basis for
-- REVERT: GitHub's REST API has no single "revert this merge" endpoint
-- (only a GraphQL mutation this project could not verify the exact
-- schema of from this environment — GitHub's own docs domain is
-- blocked here, and this project's own rule is never guess an API
-- shape). Since dev_agent.get_file already reads the file's exact
-- content before proposing any edit, storing that here makes revert
-- trivial and 100%-verified: open a real PR that restores this exact
-- text, using the same create_branch/update_file/open_pull_request
-- calls already tested this session — no new, unverified API surface.
CREATE TABLE IF NOT EXISTS "NovaConnectedChange" (
    "id"              TEXT NOT NULL,
    "novaUserId"      TEXT NOT NULL,
    "service"         TEXT NOT NULL DEFAULT 'github',
    "repo"            TEXT NOT NULL,
    "filePath"        TEXT NOT NULL,
    "previousContent" TEXT,        -- NULL means the file was newly created (revert = delete-equivalent: see council.py's own handling)
    "prNumber"        INTEGER NOT NULL,
    "prUrl"           TEXT NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'AWAITING_MERGE', -- AWAITING_MERGE | MERGED | REJECTED | REVERTED
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at"      TIMESTAMP(3),

    CONSTRAINT "NovaConnectedChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaConnectedChange_novaUserId_idx" ON "NovaConnectedChange"("novaUserId");

DO $$ BEGIN
    ALTER TABLE "NovaConnectedChange" ADD CONSTRAINT "NovaConnectedChange_novaUserId_fkey"
        FOREIGN KEY ("novaUserId") REFERENCES "NovaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public."NovaConnectedChange" TO service_role;
