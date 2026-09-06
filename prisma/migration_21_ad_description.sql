-- Owner audit fix (2026-09-06): AD_BOT's ad-creation wizard collected a
-- free-text description from every advertiser but never saved it anywhere
-- — only used transiently for the review screen and the moderation scan,
-- then silently dropped. Persisting it so it can actually be shown to
-- viewers on the carousel card.
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "description" TEXT;
