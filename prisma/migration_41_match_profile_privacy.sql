-- بوت التعارف: خيار «إظهار ملفي لدولتي فقط». شغّله مرة واحدة في Supabase ← SQL Editor.
CREATE TABLE IF NOT EXISTS "MatchProfilePrivacy" (
  "userId" TEXT NOT NULL,
  "countryOnly" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchProfilePrivacy_pkey" PRIMARY KEY ("userId")
);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MatchProfilePrivacy" TO service_role;
