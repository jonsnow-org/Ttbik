// Server-side validation of Telegram Mini App initData with the official tma.js validator (@tma.js/init-data-node): HMAC-SHA256
// with the bot token, signature checked in constant time, auth_date at most `maxAgeS` old. Returns the verified user id, or null.
// The older hand-written check (src/lib/verifyTelegramOwner.ts) stays for the other mini apps.
import { parse, validate } from "@tma.js/init-data-node";
import { verifyTelegramInitData } from "@/lib/verifyTelegramOwner";

export type TmaUser = { id: string; firstName?: string; languageCode?: string; startParam?: string };
export function verifyTmaInitData(initData: string, botToken: string, maxAgeS = 24 * 3600): TmaUser | null {
  if (!initData || !botToken) return null;
  try {
    validate(initData, botToken, { expiresIn: maxAgeS });
    const d: any = parse(initData);
    const id = d?.user?.id;
    if (!id) return null;
    return { id: String(id), firstName: d.user.first_name ?? d.user.firstName, languageCode: d.user.language_code ?? d.user.languageCode, startParam: d.start_param ?? d.startParam };
  } catch (e) {
    // a validation failure is a hard no; only a library-level problem (e.g. an older client format it cannot parse) falls back
    const name = String((e as { name?: string })?.name || "");
    if (/Signature|Expired|AuthDate/i.test(name)) return null;
    const legacy = verifyTelegramInitData(initData, botToken);
    return legacy ? { id: legacy.id } : null;
  }
}
