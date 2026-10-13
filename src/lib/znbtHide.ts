import crypto from "crypto";
import { Address } from "@ton/core";

/**
 * Platform moderation for ZNBt launches: the owner can hide an abusive coin from the Zenobia pages.
 * Nothing on-chain changes (a launched coin cannot be removed); hiding only removes it from our lists.
 * The owner proves identity with a TonConnect ton_proof signed by the owner wallet; the challenge is an HMAC'd, expiring payload.
 */
export const OWNER_WALLET = "UQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQJSz";

const mac = (secret: string, data: string) => crypto.createHmac("sha256", crypto.createHash("sha256").update("znbt-hide:" + secret).digest()).update(data).digest("hex").slice(0, 32);
const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function makeHidePayload(secret: string, now = Date.now(), ttlMs = 15 * 60_000): string {
  const body = `hide.${Math.floor((now + ttlMs) / 1000)}.${crypto.randomBytes(6).toString("hex")}`;
  return `${body}.${mac(secret, "p:" + body)}`;
}
export function readHidePayload(secret: string, payload: string, now = Date.now()): boolean {
  const m = /^hide\.(\d{9,11})\.([0-9a-f]{12})\.([0-9a-f]{32})$/.exec(payload || "");
  if (!m) return false;
  if (!safeEq(mac(secret, `p:hide.${m[1]}.${m[2]}`), m[3])) return false;
  return Number(m[1]) * 1000 >= now;
}

export function isOwnerAddress(addr: string): boolean {
  try {
    return Address.parse(addr).equals(Address.parse(OWNER_WALLET));
  } catch {
    return false;
  }
}

export function validCurve(addr: string): string | null {
  try {
    return Address.parse(addr).toString({ bounceable: true, urlSafe: true });
  } catch {
    return null;
  }
}
