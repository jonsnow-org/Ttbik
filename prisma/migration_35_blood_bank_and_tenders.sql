-- «نبض» blood bank (MEDICAL_BOT) + «اطلب وهم يتنافسون» price-quote requests
-- (JOBS_BOT). New tables only — nothing existing is altered. Run once in
-- Supabase's SQL Editor. Idempotent (safe to run again).

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsTender" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "budget" DOUBLE PRECISION,
    "governorate" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "awardedBidId" TEXT,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobsTender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobsTenderBid" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobsTenderBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedBloodDonor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bloodType" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "lastDonationAt" TIMESTAMP(3),
    "donationsCount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedBloodDonor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedBloodRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "bloodType" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "place" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "note" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedBloodRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MedBloodResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedBloodResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobsTender_status_expiresAt_idx" ON "JobsTender"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobsTenderBid_tenderId_bidderId_key" ON "JobsTenderBid"("tenderId", "bidderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MedBloodDonor_userId_key" ON "MedBloodDonor"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MedBloodRequest_status_expiresAt_idx" ON "MedBloodRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MedBloodResponse_requestId_donorId_key" ON "MedBloodResponse"("requestId", "donorId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "JobsTenderBid" ADD CONSTRAINT "JobsTenderBid_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "JobsTender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodDonor" ADD CONSTRAINT "MedBloodDonor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodRequest" ADD CONSTRAINT "MedBloodRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodResponse" ADD CONSTRAINT "MedBloodResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MedBloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MedBloodResponse" ADD CONSTRAINT "MedBloodResponse_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "MedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
