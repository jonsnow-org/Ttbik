-- CAPSULE_BOT (كبسولة الزمن): شغّل مرة واحدة في Supabase ← SQL Editor. آمن لإعادة التشغيل.
CREATE TABLE IF NOT EXISTS "CapsuleUser" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "pendingAction" JSONB,
  "isBanned" BOOLEAN NOT NULL DEFAULT false,
  "mutedUntil" TIMESTAMP(3),
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapsuleUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Capsule" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "recipientId" TEXT,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "deliverAt" TIMESTAMP(3) NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Capsule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Capsule_code_key" ON "Capsule"("code");
CREATE INDEX IF NOT EXISTS "Capsule_deliverAt_deliveredAt_idx" ON "Capsule"("deliverAt", "deliveredAt");
CREATE INDEX IF NOT EXISTS "Capsule_senderId_idx" ON "Capsule"("senderId");
CREATE INDEX IF NOT EXISTS "Capsule_botId_idx" ON "Capsule"("botId");

DO $$ BEGIN
  ALTER TABLE "Capsule" ADD CONSTRAINT "Capsule_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "CapsuleUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CapsuleUser" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Capsule" TO service_role;
