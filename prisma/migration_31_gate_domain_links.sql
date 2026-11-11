-- Vercel stopped (HTTP 402, 2026-11-11): stored platform links that still name ttbik.vercel.app are moved to the live address
-- (the gate, deploy/hosting/site.json gateUrl), keeping path and query. Plain UPDATE of URL text only — no row is deleted,
-- no column dropped. Idempotent (a second run matches nothing). Not touched on purpose: page_views.referrer (history) and the
-- coder_* chat/task logs (conversation records).
-- At runtime the code already rewrites these (src/lib/siteUrl.ts rewriteLegacyLinks / isLegacySiteUrl), so this is a tidy-up.

UPDATE "ShortLink"
   SET "targetUrl" = regexp_replace("targetUrl", '^(https?://)?ttbik(-[a-z0-9-]+)?\.vercel\.app', 'https://ttbik-gate.jonsnowx1r.workers.dev', 'i')
 WHERE "targetUrl" ~* '^(https?://)?ttbik(-[a-z0-9-]+)?\.vercel\.app';

UPDATE "Ad"
   SET content = regexp_replace(content, '(https?://)?ttbik(-[a-z0-9-]+)?\.vercel\.app', 'https://ttbik-gate.jonsnowx1r.workers.dev', 'gi')
 WHERE content ~* 'ttbik(-[a-z0-9-]+)?\.vercel\.app';

-- the channel rotation's «already posted» memory (so the same pages are not re-posted under the new address within 48h)
UPDATE bot_settings
   SET value = regexp_replace(value::text, 'https?://ttbik(-[a-z0-9-]+)?\.vercel\.app', 'https://ttbik-gate.jonsnowx1r.workers.dev', 'gi')::jsonb
 WHERE key = 'channel_rotation_state' AND value::text ~* 'ttbik(-[a-z0-9-]+)?\.vercel\.app';
