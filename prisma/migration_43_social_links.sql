CREATE TABLE IF NOT EXISTS "SocialLink" (
  id TEXT PRIMARY KEY,
  "tgUserId" TEXT NOT NULL,
  platform TEXT NOT NULL,
  "profileUrl" TEXT NOT NULL,
  handle TEXT,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SocialLink_tg_platform" ON "SocialLink" ("tgUserId", platform);
