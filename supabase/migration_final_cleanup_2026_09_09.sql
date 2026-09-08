-- Owner directive (2026-09-09): "بالنسبة للادوات المحذوفة والملغية ازلها
-- نهائيا" — permanently remove every dead/cancelled catalog tool. Run
-- once in Supabase's SQL Editor. Idempotent (safe to run even if some of
-- these were already applied by an earlier migration file).
--
-- This consolidates three separate migrations that already existed
-- (migration_merge_ai_tools_2026_09_03.sql,
-- migration_hard_delete_locked_code_products.sql,
-- migration_remove_locked_code_products.sql) — no evidence was found
-- anywhere in this project's own tracking (docs/AGENT_BUS.md,
-- docs/agent-state.json) that any of them were actually run against the
-- live database, and this session has no production Supabase credentials
-- to run them directly — only the owner can, from Supabase's dashboard.
--
-- Safety net preserved from the original: orders.service_id is
-- "on delete restrict". If any of these slugs turns out to have a real
-- historical order against it, this statement fails loudly on that row
-- instead of silently orphaning/corrupting an order record — if it
-- fails, tell Claude which slug it failed on rather than forcing it
-- through.

-- 1) The 7 dead AI-tool catalog entries (never had a working page behind
--    them — 6 were rebuilt for real as free-tools/writing-assistant and
--    free-tools/text-analyzer modes; the 7th, ai-chat-assistant, was
--    deliberately never rebuilt).
delete from services
where slug in (
  'smart-translator', 'text-summarizer', 'ai-chat-assistant', 'review-analyzer',
  'social-caption-generator', 'blog-writer', 'product-description-writer'
);

delete from categories where slug in ('ai-translation', 'content-design');

-- 2) The 6 locked-code-for-sale products, never purchased by anyone
--    (owner-confirmed at the time).
delete from services
where slug in (
  'order-manager-bot', 'ad-slot-bot', 'landing-page-generator',
  'workflow-templates', 'invoice-generator', 'whatsapp-catalog'
);

-- 3) hosted-bot-builder ($15) — previously only soft-retired
--    (is_active=false in migration_remove_locked_code_products.sql)
--    because its redemption path was broken (told buyers to redeem on
--    /bots, but /bots/deploy never reads the orders table). Owner now
--    wants it gone for good, not just hidden — hard delete.
delete from services where slug = 'hosted-bot-builder';
