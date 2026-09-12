-- Owner spec, 2026-09-12: "owner mode" (Nova recognizing/addressing its
-- own owner, quota.is_platform_owner) now requires the owner's Telegram
-- ID AND a one-time password, not the ID alone — the owner asked for
-- this second factor explicitly. ownerVerifiedAt is set once by
-- quota.py's verify_owner_password (called from novaBotLogic.ts's
-- "/تفعيل_المالك <password>" command) and checked alongside the
-- existing SUPER_ADMIN_TELEGRAM_ID comparison from then on. Run once in
-- Supabase's SQL Editor. Idempotent.

ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "ownerVerifiedAt" TIMESTAMP(3);
