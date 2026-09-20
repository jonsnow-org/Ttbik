-- One single, current, ready-to-run SQL script equivalent to the entire
-- prisma/schema.prisma (generated 2026-09-20, in response to the owner
-- asking for "the full ready Prisma text" -- schema.prisma itself is
-- Prisma's own schema language, not SQL, and cannot be pasted into
-- Supabase's SQL editor directly; this is the real runnable equivalent).
--
-- Regenerate after any schema.prisma change with:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- then re-apply the same idempotency post-processing described below
-- (IF NOT EXISTS on CREATE TABLE/INDEX, DO-block duplicate_object guards
-- on CREATE TYPE and ADD CONSTRAINT) -- prisma's raw output assumes an
-- empty database and errors on every statement otherwise.
--
-- Safe to run against a database that already has some or all of these
-- tables (this project's actual DB was built incrementally via the
-- numbered migration_N_*.sql files, run by hand in Supabase's SQL
-- editor, never via `prisma migrate deploy`) -- anything that already
-- exists is left untouched; anything missing is created.


-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
DO $$ BEGIN CREATE TYPE "Role" AS ENUM ('USER', 'BOT_OWNER', 'SUPER_ADMIN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "AdType" AS ENUM ('LINK', 'TELEGRAM', 'YOUTUBE', 'TWITTER', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Bot" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "ownerBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "pendingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "webhookSecret" TEXT NOT NULL,
    "requiredChannel" TEXT,
    "referredByOwnerId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "depositAddress" TEXT,
    "tonMemo" TEXT,
    "referredBy" TEXT,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "phoneNumber" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "multiAccountFlag" BOOLEAN NOT NULL DEFAULT false,
    "contestWinnerAt" TIMESTAMP(3),
    "pendingAction" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Ad" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "type" "AdType" NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "totalBudget" DOUBLE PRECISION NOT NULL,
    "cpc" DOUBLE PRECISION NOT NULL,
    "ownerCut" DOUBLE PRECISION NOT NULL,
    "creatorCut" DOUBLE PRECISION NOT NULL,
    "workerCut" DOUBLE PRECISION NOT NULL,
    "remaining" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT NOT NULL DEFAULT 'TARGETED',
    "targetBotId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdReport" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeviceFingerprint" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ip" TEXT,
    "userId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "destination" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlatformSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "accumulatedOwnerProfit" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TonTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "asset" TEXT NOT NULL DEFAULT 'TON',
    "amountTon" DOUBLE PRECISION NOT NULL,
    "usdValue" DOUBLE PRECISION NOT NULL,
    "txHash" TEXT NOT NULL,
    "toAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TonTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdClick" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BotPurchase" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "code" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transferReference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchUser" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'ar',
    "pendingAction" JSONB,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "tonMemo" TEXT,
    "advancedFiltersUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "profileVisitorsUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "extraPhotosUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "vipUntil" TIMESTAMP(3),
    "referredBy" TEXT,
    "referralRewardGranted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MatchUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "txHash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "country" TEXT NOT NULL,
    "job" TEXT,
    "education" TEXT,
    "attributes" TEXT,
    "city" TEXT,
    "maritalStatus" TEXT,
    "contactMethod" TEXT NOT NULL,
    "contactValue" TEXT NOT NULL,
    "photoFileId" TEXT,
    "photoFileId2" TEXT,
    "photoFileId3" TEXT,
    "voiceFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "boostedUntil" TIMESTAMP(3),
    "verificationStatus" TEXT NOT NULL DEFAULT 'NONE',
    "verificationPhotoFileId" TEXT,
    "isIncognito" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchProfileVisit" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchProfileVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchPhotoPermission" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPhotoPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PartnerPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "ageMin" INTEGER,
    "ageMax" INTEGER,
    "job" TEXT,
    "education" TEXT,
    "attributes" TEXT,
    "city" TEXT,
    "maritalStatus" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchLike" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MatchReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SEARCH',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdminMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RandomChatQueue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RandomChatQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RandomChatSession" (
    "id" TEXT NOT NULL,
    "user1Id" TEXT NOT NULL,
    "user2Id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "contactOfferSent" BOOLEAN NOT NULL DEFAULT false,
    "contactRequestedBy" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "RandomChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsUser" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "pendingAction" JSONB,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "tonMemo" TEXT,

    CONSTRAINT "JobsUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "country" TEXT NOT NULL,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "contactMethod" TEXT NOT NULL,
    "contactValue" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "seekerProfession" TEXT,
    "employerBusinessName" TEXT,
    "professionalCategory" TEXT,
    "professionalDescription" TEXT,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobsProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobPosting" (
    "id" TEXT NOT NULL,
    "posterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "workersCount" INTEGER NOT NULL DEFAULT 1,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "description" TEXT,
    "contactMethod" TEXT NOT NULL,
    "contactValue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StoreListing" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "photoFileIds" JSONB,
    "deliveryMethod" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StoreWantedListing" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "budget" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreWantedListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StoreOrder" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "deliveryMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "escrowedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StoreOffer" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "listingId" TEXT,
    "wantedId" TEXT,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "lastOfferBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsDispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "openedBy" TEXT NOT NULL,
    "buyerStatement" TEXT,
    "buyerEvidencePhotoIds" JSONB,
    "sellerStatement" TEXT,
    "sellerEvidencePhotoIds" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "JobsDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL DEFAULT 'profile',
    "reason" TEXT NOT NULL,
    "evidencePhotoFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobsBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsAdminMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobsAdminMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "txHash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShortLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerIpHash" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DigitalCard" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "links" JSONB NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'simple',
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerIpHash" TEXT,
    "editToken" TEXT NOT NULL,

    CONSTRAINT "DigitalCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedUser" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PATIENT',
    "fullName" TEXT,
    "phone" TEXT,
    "pendingAction" JSONB,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedPatientProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedPatientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedFacility" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isDuty" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedDepartment" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedDoctor" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "workingDays" TEXT NOT NULL,
    "workingHours" TEXT NOT NULL,
    "feeUsd" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedDoctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedAppointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "appointmentAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "reminder24hSent" BOOLEAN NOT NULL DEFAULT false,
    "reminder1hSent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedPrescriptionQuery" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "patientMessage" TEXT NOT NULL,
    "reply" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedPrescriptionQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedActivationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isRedeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemedBy" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedActivationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NovaUser" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT,
    "email" TEXT,
    "apiKey" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "dailyUsed" INTEGER NOT NULL DEFAULT 0,
    "dailyUsedImage" INTEGER NOT NULL DEFAULT 0,
    "dailyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weeklyUsedText" INTEGER NOT NULL DEFAULT 0,
    "weeklyUsedImage" INTEGER NOT NULL DEFAULT 0,
    "weeklyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NovaConnection" (
    "id" TEXT NOT NULL,
    "novaUserId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "credential" TEXT NOT NULL,
    "baseBranch" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "NovaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NovaUsageLog" (
    "id" TEXT NOT NULL,
    "novaUserId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "queryType" TEXT NOT NULL,
    "message" TEXT,
    "answer" TEXT,
    "rating" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NovaKnowledgeEntry" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'general',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaKnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NovaSubscription" (
    "id" TEXT NOT NULL,
    "novaUserId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovaSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Bot_token_key" ON "Bot"("token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_tonMemo_key" ON "User"("tonMemo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AdReport_adId_userId_key" ON "AdReport"("adId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceFingerprint_fingerprint_userId_key" ON "DeviceFingerprint"("fingerprint", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_txHash_key" ON "Transaction"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TonTransaction_txHash_key" ON "TonTransaction"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AdClick_adId_userId_key" ON "AdClick"("adId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BotPurchase_code_key" ON "BotPurchase"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MatchUser_tonMemo_key" ON "MatchUser"("tonMemo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MatchTransaction_txHash_key" ON "MatchTransaction"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MatchProfile_userId_key" ON "MatchProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MatchProfileVisit_ownerId_viewerId_key" ON "MatchProfileVisit"("ownerId", "viewerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MatchPhotoPermission_ownerId_viewerId_key" ON "MatchPhotoPermission"("ownerId", "viewerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerPreference_userId_key" ON "PartnerPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MatchLike_fromUserId_toUserId_key" ON "MatchLike"("fromUserId", "toUserId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MatchBlock_blockerId_blockedId_key" ON "MatchBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobsUser_tonMemo_key" ON "JobsUser"("tonMemo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobsProfile_userId_key" ON "JobsProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobsDispute_orderId_key" ON "JobsDispute"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobsBlock_blockerId_blockedId_key" ON "JobsBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobsTransaction_txHash_key" ON "JobsTransaction"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShortLink_code_key" ON "ShortLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DigitalCard_slug_key" ON "DigitalCard"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DigitalCard_editToken_key" ON "DigitalCard"("editToken");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MedPatientProfile_userId_key" ON "MedPatientProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MedFacility_ownerId_key" ON "MedFacility"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MedActivationCode_code_key" ON "MedActivationCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NovaUser_telegramId_key" ON "NovaUser"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NovaUser_email_key" ON "NovaUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NovaUser_apiKey_key" ON "NovaUser"("apiKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NovaConnection_novaUserId_idx" ON "NovaConnection"("novaUserId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Ad" ADD CONSTRAINT "Ad_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Ad" ADD CONSTRAINT "Ad_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TonTransaction" ADD CONSTRAINT "TonTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchTransaction" ADD CONSTRAINT "MatchTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchProfile" ADD CONSTRAINT "MatchProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PartnerPreference" ADD CONSTRAINT "PartnerPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchLike" ADD CONSTRAINT "MatchLike_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchLike" ADD CONSTRAINT "MatchLike_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchBlock" ADD CONSTRAINT "MatchBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchBlock" ADD CONSTRAINT "MatchBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MatchReport" ADD CONSTRAINT "MatchReport_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "AdminMessage" ADD CONSTRAINT "AdminMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "RandomChatQueue" ADD CONSTRAINT "RandomChatQueue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MatchUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "JobsProfile" ADD CONSTRAINT "JobsProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "JobsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "JobsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StoreListing" ADD CONSTRAINT "StoreListing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "JobsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "StoreWantedListing" ADD CONSTRAINT "StoreWantedListing_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "JobsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "JobsTransaction" ADD CONSTRAINT "JobsTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "JobsUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedPatientProfile" ADD CONSTRAINT "MedPatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedFacility" ADD CONSTRAINT "MedFacility_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedDepartment" ADD CONSTRAINT "MedDepartment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "MedFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedDoctor" ADD CONSTRAINT "MedDoctor_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "MedFacility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedDoctor" ADD CONSTRAINT "MedDoctor_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "MedDepartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedAppointment" ADD CONSTRAINT "MedAppointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "MedUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedAppointment" ADD CONSTRAINT "MedAppointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "MedDoctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedPrescriptionQuery" ADD CONSTRAINT "MedPrescriptionQuery_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "MedUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MedPrescriptionQuery" ADD CONSTRAINT "MedPrescriptionQuery_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "MedFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "NovaConnection" ADD CONSTRAINT "NovaConnection_novaUserId_fkey" FOREIGN KEY ("novaUserId") REFERENCES "NovaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "NovaUsageLog" ADD CONSTRAINT "NovaUsageLog_novaUserId_fkey" FOREIGN KEY ("novaUserId") REFERENCES "NovaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "NovaSubscription" ADD CONSTRAINT "NovaSubscription_novaUserId_fkey" FOREIGN KEY ("novaUserId") REFERENCES "NovaUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
