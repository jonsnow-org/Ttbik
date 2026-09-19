import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verifies a Telegram Mini App `initData` string per Telegram's documented
 * algorithm (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * and returns the authenticated Telegram user id, or null if the signature
 * doesn't check out, has expired, or the bot token isn't configured.
 *
 * This exists because the mini-app is a public web page: anything hardcoded
 * in its client bundle (a shared secret, a "trust whatever owner_id the
 * client sends" check) is visible to every visitor and trivially replayable
 * from outside Telegram entirely. initData can only be produced by Telegram
 * itself for a real logged-in user, using a key derived from BOT_TOKEN that
 * never reaches the browser -- so this is the one check a browser can't forge.
 */
export function verifyTelegramInitData(initData: string, botToken: string): { id: string } | null {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash") || "";
    if (!hash) return null;
    params.delete("hash");

    const pairs: string[] = [];
    params.forEach((value, key) => pairs.push(`${key}=${value}`));
    pairs.sort();
    const dataCheckString = pairs.join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    const a = Buffer.from(computedHash, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

    const userRaw = params.get("user");
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    if (!user?.id) return null;
    return { id: String(user.id) };
  } catch {
    return null;
  }
}

/** Verifies initData AND that the authenticated user is the site owner. */
export function verifyTelegramOwner(initData: string, botToken: string, ownerId: string): boolean {
  const user = verifyTelegramInitData(initData, botToken);
  return !!user && user.id === ownerId;
}
