-- Owner spec, 2026-09-13 ("نظام الربط الحقيقي... يضيف نوفا لمواقعه كما
-- اضفتك انا لمواقعي"): the real trust boundary the owner described
-- repeatedly — Nova can act on an external site/repo ONLY if a row
-- exists here naming exactly which service, whose account, and what
-- credential. No row, no access; typing "اذهب ونفّذ كذا" in a chat can
-- never reach a site that was never connected here, by construction —
-- there is no code path that reads a token from anywhere else.
--
-- "credential" deliberately plain TEXT, not a second encryption layer:
-- this matches the real security level every other secret in this
-- project already lives at (GROQ_API_KEY, NOVA_DEV_AGENT_GITHUB_TOKEN,
-- etc. sit as plain env vars on Render, protected by Supabase's own
-- service-role access control, not a second application-level cipher)
-- — stated plainly rather than implying a stronger guarantee than the
-- rest of this project actually has.
CREATE TABLE IF NOT EXISTS "NovaConnection" (
    "id"           TEXT NOT NULL,
    "novaUserId"   TEXT NOT NULL,
    "service"      TEXT NOT NULL, -- "github" | "vercel" (real, tested services only — see connections.py)
    "label"        TEXT NOT NULL, -- e.g. "owner/my-shop" (GitHub) or a Vercel project name
    "credential"   TEXT NOT NULL, -- the fine-grained PAT / API token itself
    "baseBranch"   TEXT, -- GitHub only; null lets connections.py fall back to the repo's default branch
    "status"       TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | REVOKED
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at"   TIMESTAMP(3),

    CONSTRAINT "NovaConnection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaConnection_novaUserId_idx" ON "NovaConnection"("novaUserId");

DO $$ BEGIN
    ALTER TABLE "NovaConnection" ADD CONSTRAINT "NovaConnection_novaUserId_fkey"
        FOREIGN KEY ("novaUserId") REFERENCES "NovaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Same real gap this project has been bitten by twice already
-- (NovaVideoQueue, NovaSelfImprovementProposal) — a table created via
-- the SQL Editor does not automatically inherit service_role grants.
GRANT SELECT, INSERT, UPDATE ON public."NovaConnection" TO service_role;
