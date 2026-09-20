import crypto from "crypto";

/**
 * Application-level AES-256-GCM encryption for NovaConnection.credential
 * (owner decision 2026-09-20: encrypt Nova's stored GitHub/Vercel tokens).
 * NOVA_CREDENTIAL_KEY must be a 32-byte key, hex or base64 encoded, set as
 * an env var on both Render and Vercel — never committed to the repo.
 *
 * The "encv1:" prefix lets decryptCredential() tell a row written before
 * this change (plain text) apart from a newly encrypted one, so existing
 * rows keep working without a backfill migration.
 */
const PREFIX = "encv1:";

function key(): Buffer {
  const raw = (process.env.NOVA_CREDENTIAL_KEY || "").trim();
  if (!raw) throw new Error("NOVA_CREDENTIAL_KEY is not configured");
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("NOVA_CREDENTIAL_KEY must decode to exactly 32 bytes");
  return buf;
}

export function encryptCredential(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Returns the row unchanged if it predates encryption (no PREFIX). */
export function decryptCredential(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
