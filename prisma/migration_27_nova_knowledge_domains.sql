-- Owner spec, 2026-09-12 ("بنوك لا تحصى... بحثه عن تغذية تخصه وتقوي
-- نظامه في جميع المجالات وليس مجال واحد فقط"): real design decision,
-- stated plainly — a genuinely unlimited number of PHYSICAL tables
-- would be unmaintainable and buys nothing a single well-indexed table
-- doesn't already give for free (Postgres handles millions of rows
-- fine). What actually delivers "countless organized banks that never
-- fill up" is a real, broad DOMAIN taxonomy tagged on every entry —
-- see ai-system/app/knowledge_store.py's DOMAINS list for the real
-- categories (image/video/audio generation, live search, code, security,
-- conversation quality, general knowledge) every proactive/self-directed
-- research run rotates across, instead of narrowing into one area.
ALTER TABLE "NovaKnowledgeEntry" ADD COLUMN IF NOT EXISTS "domain" TEXT NOT NULL DEFAULT 'GENERAL_KNOWLEDGE';
CREATE INDEX IF NOT EXISTS "NovaKnowledgeEntry_domain_idx" ON "NovaKnowledgeEntry"("domain");
