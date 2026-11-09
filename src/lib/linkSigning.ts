import crypto from "crypto";

// HMAC for the short-lived "link your page / channel" links. The key is the server's CRON_SECRET and nothing else: the old built-in
// fallback strings were public in this repository, so anyone could have forged a link for any Telegram user. Without the secret
// the links fail closed (nothing verifies) instead of falling back to a known key.
function key(): string | null {
  const k = (process.env.CRON_SECRET || "").trim();
  return k ? k : null;
}

/** `purpose` keeps a signature for one link type from being valid for another. Returns "" when the server has no secret. */
export function signLink(purpose: string, payload: string): string {
  const k = key();
  if (!k) return "";
  return crypto.createHmac("sha256", k).update(`${purpose}:${payload}`).digest("base64url");
}

export function verifyLink(purpose: string, payload: string, mac: string): boolean {
  const want = signLink(purpose, payload);
  if (!want || !mac) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(String(mac));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
