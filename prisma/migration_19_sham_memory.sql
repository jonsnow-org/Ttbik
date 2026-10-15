-- SHAM MEMORY (Palmyra Memory, 2026-10-14) — the Telegram bot's conversation memory for Sham (src/lib/shamMemory.ts).
-- Two new tables, nothing else touched. chat_key is a salted SHA-256 of the Telegram chat id (never the raw id).
-- Run once in Supabase's SQL Editor. Idempotent (the bot also creates them on first use if this was not run).

CREATE TABLE IF NOT EXISTS sham_chat_memory (
    id          BIGSERIAL PRIMARY KEY,
    chat_key    TEXT        NOT NULL,
    question    TEXT        NOT NULL,
    answer      TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sham_chat_memory_chat_idx ON sham_chat_memory (chat_key, id DESC);

CREATE TABLE IF NOT EXISTS sham_user_facts (
    chat_key         TEXT PRIMARY KEY,
    facts            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    summary          TEXT        NOT NULL DEFAULT '',
    summarized_upto  BIGINT      NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- the site reaches these with the service role (Prisma); nobody else needs them
ALTER TABLE sham_chat_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE sham_user_facts  ENABLE ROW LEVEL SECURITY;
