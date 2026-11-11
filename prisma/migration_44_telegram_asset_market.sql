-- Telegram asset marketplace identity + listing + sale records.
-- The numeric Telegram ID is the canonical identity key; phone numbers are self-shared contacts only.
CREATE TABLE IF NOT EXISTS telegram_asset_identities (
  telegram_id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  username TEXT NOT NULL,
  phone_number TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_asset_identity_username_idx
  ON telegram_asset_identities (lower(username));

CREATE TABLE IF NOT EXISTS telegram_asset_listings (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('CHANNEL','GROUP','BOT')),
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  asking_price NUMERIC NOT NULL,
  payout_address TEXT NOT NULL,
  payout_network TEXT NOT NULL,
  seller_telegram_id TEXT NOT NULL REFERENCES telegram_asset_identities(telegram_id),
  seller_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFY',
  verifier_bot TEXT,
  verification_mode TEXT NOT NULL,
  review_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_asset_active_identifier_unique
  ON telegram_asset_listings (asset_type, lower(identifier))
  WHERE status IN ('PENDING_VERIFY','PENDING_REVIEW','LISTED','RESERVED');
CREATE INDEX IF NOT EXISTS telegram_asset_listings_status_idx
  ON telegram_asset_listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS telegram_asset_listings_seller_idx
  ON telegram_asset_listings (seller_telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_asset_sales (
  code TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES telegram_asset_listings(id),
  seller_telegram_id TEXT NOT NULL,
  buyer_telegram_id TEXT NOT NULL,
  seller_snapshot JSONB NOT NULL,
  buyer_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  seller_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  buyer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  transfer_evidence TEXT,
  verification_bot TEXT,
  verification_reference TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS telegram_asset_one_open_sale_idx
  ON telegram_asset_sales (listing_id)
  WHERE status NOT IN ('RELEASED','REFUNDED','CANCELLED');
CREATE INDEX IF NOT EXISTS telegram_asset_sales_buyer_idx
  ON telegram_asset_sales (buyer_telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS telegram_asset_sales_seller_idx
  ON telegram_asset_sales (seller_telegram_id, created_at DESC);

-- All PII and sale snapshots are server-only. No anon/authenticated direct access.
ALTER TABLE telegram_asset_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_asset_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_asset_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE telegram_asset_identities, telegram_asset_listings, telegram_asset_sales FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE telegram_asset_identities, telegram_asset_listings, telegram_asset_sales TO service_role;
