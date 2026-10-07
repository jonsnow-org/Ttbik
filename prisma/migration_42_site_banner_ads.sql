
CREATE TABLE IF NOT EXISTS "SiteBannerAd" (
  id TEXT PRIMARY KEY,
  "reservationCode" TEXT NOT NULL UNIQUE,
  "bannerUrl" TEXT NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "altText" TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'sitewide',
  "durationDays" INTEGER NOT NULL,
  "totalPrice" DOUBLE PRECISION NOT NULL,
  "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "adStatus" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  "startsAt" TIMESTAMP,
  "endsAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
