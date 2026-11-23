/**
 * The owner's switches for the new Telegram bot features (Bot API 10.x), shown in the Mini App's control panel (Telegram tab).
 *
 *  - Rich messages (`tg_rich`: off | owner | all)  — src/lib/telegramRich.ts. Stored here, read by the bot on every request (a 20 s cache).
 *  - Guest mode   (`tg_guest`: off | owner | all)  — the bot answers when it is mentioned in a chat it is not a member of (src/lib/tgGuest.ts). Needs the Telegram setting
 *                    `supports_guest_queries` as well; ONE control sets both, and "off" closes both.
 *  - Private-chat topics (Telegram settings has_topics_enabled / allows_users_to_create_topics / has_topic_sidebar) — set on Telegram itself with `setMySettings`, read back
 *                    with `getMe` (BotFullInfo). The bot answers inside the topic it was written in (src/lib/tgThread.ts).
 *  - The invite link: the owner can invite up to 10 people at once into a private chat with the bot (t.me/botinvite/<bot>).
 *
 * Every default is OFF except rich messages for the owner's own chats. A refusal from Telegram is returned to the panel as the real error, never hidden.
 */
import { prismaDb, type Db } from "@/lib/coderAuth";
import { setRichOverride, type RichMode } from "@/lib/telegramRich";

export type Audience = "off" | "owner" | "all";
export const AUDIENCES: Audience[] = ["off", "owner", "all"];
const isAudience = (v: unknown): v is Audience => v === "off" || v === "owner" || v === "all";

/** The Telegram-side settings the panel may switch (a whitelist: nothing else can be changed through the panel). */
export const TG_SETTINGS = ["has_topics_enabled", "allows_users_to_create_topics", "has_topic_sidebar"] as const;
export type TgSetting = (typeof TG_SETTINGS)[number];

const TTL = 20000;
let cache: { at: number; rich: Audience | null; guest: Audience } = { at: 0, rich: null, guest: "off" };

async function table(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
}

/** Reads the stored switches (cached 20 s) and pushes the rich-message mode into the sender. Never throws. */
export async function refreshTgFeatures(db: Db = prismaDb, force = false): Promise<{ rich: Audience | null; guest: Audience }> {
  if (!force && Date.now() - cache.at < TTL) return { rich: cache.rich, guest: cache.guest };
  try {
    await table(db);
    const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM coder_flags WHERE key IN ($1, $2)`, "tg_rich", "tg_guest");
    let rich: Audience | null = null;
    let guest: Audience = "off";
    for (const r of rows) {
      const v = String(r.value || "").trim();
      if (r.key === "tg_rich" && isAudience(v)) rich = v;
      if (r.key === "tg_guest" && isAudience(v)) guest = v;
    }
    cache = { at: Date.now(), rich, guest };
  } catch { cache = { ...cache, at: Date.now() }; }               // keep the last known values
  setRichOverride(cache.rich as RichMode | null);
  return { rich: cache.rich, guest: cache.guest };
}

export async function setTgAudience(key: "tg_rich" | "tg_guest", value: Audience, db: Db = prismaDb): Promise<void> {
  if (!isAudience(value)) throw new Error("bad value");
  await table(db);
  await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value);
  await refreshTgFeatures(db, true);
}

/** Guest mode audience for the webhook: off | owner | all. */
export const guestAudience = async (db: Db = prismaDb): Promise<Audience> => (await refreshTgFeatures(db)).guest;

type RawApi = { raw: Record<string, (p?: Record<string, unknown>) => Promise<unknown>> };

/** What Telegram says about the bot now (getMe returns BotFullInfo since Bot API 10.5): username, topics, guest queries. */
export async function readBotInfo(api: RawApi): Promise<{ username: string; guest: boolean; topics: boolean; usersCreateTopics: boolean; sidebar: boolean }> {
  // grammY's raw getMe takes NO payload: its first argument is the abort signal, so getMe({}) fails with «Incorrect abort signal instance found» (seen live in the Mini App, 2026-11-23)
  const me = (await api.raw.getMe()) as Record<string, unknown>;
  return {
    username: String(me.username || ""),
    guest: Boolean(me.supports_guest_queries),
    topics: Boolean(me.has_topics_enabled),
    usersCreateTopics: Boolean(me.allows_users_to_create_topics),
    sidebar: Boolean(me.has_topic_sidebar),
  };
}

export const inviteLink = (username: string): string => (username ? `https://t.me/botinvite/${username}` : "");

/** Switch one Telegram-side setting. Only the whitelisted keys; returns Telegram's own error text on a refusal. */
export async function setTelegramSetting(api: RawApi, key: string, value: boolean): Promise<void> {
  if (!(TG_SETTINGS as readonly string[]).includes(key)) throw new Error("setting not allowed");
  await api.raw.setMySettings({ [key]: Boolean(value) });
}

/** Guest mode: ONE control. "off" closes Telegram's guest queries AND our handler; "owner"/"all" open both and set who is answered. */
export async function setGuestMode(api: RawApi, mode: Audience, db: Db = prismaDb): Promise<void> {
  if (!isAudience(mode)) throw new Error("bad value");
  await api.raw.setMySettings({ supports_guest_queries: mode !== "off" });          // the Telegram side first: if it refuses, our flag is not changed
  await setTgAudience("tg_guest", mode, db);
}

export const _resetTgFeatures = (): void => { cache = { at: 0, rich: null, guest: "off" }; setRichOverride(null); };
