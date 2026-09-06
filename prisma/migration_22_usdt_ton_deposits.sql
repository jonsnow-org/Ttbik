-- Owner request (2026-09-06): enable USDT as a second direct on-chain
-- deposit method alongside native TON, sharing the exact same shared hot
-- wallet + memo scheme — completes what src/services/ton-service.ts's own
-- 2026-09-02 comment already promised ("Native TON / USDT-TON payment
-- rail") but never actually scanned for.
ALTER TABLE "TonTransaction" ADD COLUMN IF NOT EXISTS "asset" TEXT NOT NULL DEFAULT 'TON';
