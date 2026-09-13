-- ============================================================
-- Nova AI — كل ترحيلات قاعدة البيانات في ملف واحد
--
-- آمن تماماً للتشغيل كاملاً دفعة واحدة، حتى لو كان بعضه مُشغَّلاً
-- من قبل: كل أمر هنا يستخدم IF NOT EXISTS، أي أن الموجود يُتخطى
-- بلا خطأ ولا يُمسّ أي بيان قائم. انسخه كله والصقه في
-- Supabase -> SQL Editor -> Run.
--
-- مولَّد من ملفات prisma/migration_*.sql الحقيقية، وليس مكتوباً
-- من الذاكرة — إن عُدِّل أصلٌ منها فأعد توليد هذا الملف.
-- ============================================================

-- ---------- 19_nova_ai : جداول نوفا الأساسية: المستخدمون، سجل المحادثات، الاشتراكات ----------
CREATE TABLE IF NOT EXISTS "NovaUser" (
    "id"                    TEXT NOT NULL,
    "telegramId"            TEXT,
    "email"                 TEXT,
    "apiKey"                TEXT,
    "plan"                  TEXT NOT NULL DEFAULT 'FREE',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "dailyUsed"             INTEGER NOT NULL DEFAULT 0,
    "dailyResetAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NovaUser_telegramId_key" ON "NovaUser"("telegramId");
CREATE UNIQUE INDEX IF NOT EXISTS "NovaUser_email_key" ON "NovaUser"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "NovaUser_apiKey_key" ON "NovaUser"("apiKey");

CREATE TABLE IF NOT EXISTS "NovaUsageLog" (
    "id"         TEXT NOT NULL,
    "novaUserId" TEXT NOT NULL,
    "channel"    TEXT NOT NULL,
    "queryType"  TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaUsageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaUsageLog_novaUserId_idx" ON "NovaUsageLog"("novaUserId");

CREATE TABLE IF NOT EXISTS "NovaSubscription" (
    "id"         TEXT NOT NULL,
    "novaUserId" TEXT NOT NULL,
    "plan"       TEXT NOT NULL,
    "amountUsd"  DOUBLE PRECISION NOT NULL,
    "status"     TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedBy" TEXT,
    "startedAt"  TIMESTAMP(3),
    "expiresAt"  TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaSubscription_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaSubscription_novaUserId_idx" ON "NovaSubscription"("novaUserId");

DO $$ BEGIN
    ALTER TABLE "NovaUsageLog" ADD CONSTRAINT "NovaUsageLog_novaUserId_fkey" FOREIGN KEY ("novaUserId") REFERENCES "NovaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "NovaSubscription" ADD CONSTRAINT "NovaSubscription_novaUserId_fkey" FOREIGN KEY ("novaUserId") REFERENCES "NovaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "NovaUser" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "NovaUsageLog" TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "NovaSubscription" TO service_role;

-- ---------- 20_nova_training_log : حفظ نص السؤال والجواب (بيانات التدريب الأسبوعي) ----------
ALTER TABLE "NovaUsageLog" ADD COLUMN IF NOT EXISTS "message" TEXT;
ALTER TABLE "NovaUsageLog" ADD COLUMN IF NOT EXISTS "answer" TEXT;

-- ---------- 21_nova_tiered_quota : الخطط والحصص (مجاني/PRO) ----------
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "dailyUsedImage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "weeklyUsedText" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "weeklyUsedImage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "weeklyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------- 22_nova_feedback : تقييم الردود (يُستخدم الآن لاستبعاد الردود السيئة من التدريب) ----------
ALTER TABLE "NovaUsageLog" ADD COLUMN IF NOT EXISTS "rating" TEXT;

-- ---------- 23_nova_knowledge_bank : بنك المعرفة — البحث الحي المخزَّن + صلاحية الكتابة ----------
CREATE TABLE IF NOT EXISTS "NovaKnowledgeEntry" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'general', -- "general" | "live_info"
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaKnowledgeEntry_pkey" PRIMARY KEY ("id")
);

GRANT SELECT, INSERT, UPDATE ON public."NovaKnowledgeEntry" TO service_role;

-- ---------- 24_nova_owner_verification : تفعيل وضع المالك بكلمة مرور ----------
ALTER TABLE "NovaUser" ADD COLUMN IF NOT EXISTS "ownerVerifiedAt" TIMESTAMP(3);

-- ---------- 25_nova_video_queue : طابور الفيديو على Kaggle ----------
CREATE TABLE IF NOT EXISTS "NovaVideoQueue" (
    "id"           TEXT NOT NULL,
    "novaUserId"   TEXT NOT NULL,
    "channel"      TEXT NOT NULL,
    "chatId"       TEXT NOT NULL,
    "prompt"       TEXT NOT NULL,
    "seconds"      INTEGER NOT NULL DEFAULT 6,
    "status"       TEXT NOT NULL DEFAULT 'PENDING',
    "error"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "NovaVideoQueue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaVideoQueue_status_idx" ON "NovaVideoQueue"("status");

GRANT SELECT, INSERT, UPDATE ON public."NovaVideoQueue" TO service_role;

-- ---------- 26_nova_self_improvement : اقتراحات التطوير الذاتي (مطلوب — لم يُشغَّل بعد) ----------
CREATE TABLE IF NOT EXISTS "NovaSelfImprovementProposal" (
    "id"           TEXT NOT NULL,
    "topic"        TEXT NOT NULL,
    "finding"      TEXT NOT NULL,
    "usefulness"   TEXT,
    "impact"       TEXT,
    "file_path"    TEXT,
    "status"       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | AWAITING_MERGE | ACCEPTED | REJECTED
    "trigger"      TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | owner_directed
    "pr_url"       TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at"   TIMESTAMP(3),

    CONSTRAINT "NovaSelfImprovementProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "NovaSelfImprovementProposal_status_idx" ON "NovaSelfImprovementProposal"("status");

GRANT SELECT, INSERT, UPDATE ON public."NovaSelfImprovementProposal" TO service_role;

-- ---------- 27_nova_knowledge_domains : تصنيف بنك المعرفة + أثر التفكير العميق (مطلوب — لم يُشغَّل بعد) ----------
ALTER TABLE "NovaKnowledgeEntry" ADD COLUMN IF NOT EXISTS "domain" TEXT NOT NULL DEFAULT 'GENERAL_KNOWLEDGE';
CREATE INDEX IF NOT EXISTS "NovaKnowledgeEntry_domain_idx" ON "NovaKnowledgeEntry"("domain");

