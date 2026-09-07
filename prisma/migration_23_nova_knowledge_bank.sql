-- Durable twin of rag.py's in-memory ChromaDB knowledge bank. Render's
-- free-tier disk is NOT persistent, so ./chroma_data is wiped on every
-- restart/redeploy — this table is what actually survives, and what
-- rag.py rehydrates Chroma from after a cold start. Also read directly by
-- the Kaggle training notebook as a real training-data source (owner
-- spec 2026-09-08).
CREATE TABLE IF NOT EXISTS "NovaKnowledgeEntry" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'general', -- "general" | "live_info"
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaKnowledgeEntry_pkey" PRIMARY KEY ("id")
);
