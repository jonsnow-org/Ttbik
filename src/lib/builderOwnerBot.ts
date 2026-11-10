// The owner (platform) bot of the ads & earn builder: one AD_BOT row of the Bot table, chosen by config, never hardcoded.
// The owner himself is recognised by his Telegram ID exactly as everywhere in the builder (SUPER_ADMIN_TELEGRAM_ID); this file only
// says WHICH bot is the platform's own bot, i.e. where builder flows send people (e.g. «احصل على بوت مشابه») and which bot sells
// and delivers activation codes.
//
// Selection, in order: env BUILDER_OWNER_BOT_ID (a Bot row id), then bot_settings key `builder_owner_bot` (set by the owner with
// /ownerbot inside that bot; /ownerbot off clears it). Unset → every feature that needs it degrades gracefully (no link shown).
// The site bot (بوت الموقع, /api/ads/telegram) is NOT and can never be this bot: it is not in the Bot table.
import { prisma } from "@/lib/prisma";

export const OWNER_BOT_SETTING = "builder_owner_bot";
export type OwnerBot = { id: string; token: string; username: string };

let idCache: { at: number; v: string } | null = null;
export async function ownerBotId(): Promise<string> {
  const env = String(process.env.BUILDER_OWNER_BOT_ID || "").trim();
  if (env) return env;
  if (idCache && Date.now() - idCache.at < 60_000) return idCache.v;
  let v = "";
  try {
    const { supabaseAdmin } = await import("@/lib/supabase");
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", OWNER_BOT_SETTING).maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    v = typeof raw === "string" ? raw.trim() : "";
  } catch {
    v = "";
  }
  idCache = { at: Date.now(), v };
  return v;
}

/** Owner only (the caller checks the owner's Telegram ID): makes `botId` the builder's owner bot, or clears it with null. */
export async function setOwnerBotId(botId: string | null): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  if (botId) await supabaseAdmin().from("bot_settings").upsert({ key: OWNER_BOT_SETTING, value: botId, updated_at: new Date().toISOString() });
  else await supabaseAdmin().from("bot_settings").delete().eq("key", OWNER_BOT_SETTING);
  idCache = null;
  botCache = null;
}

export async function isOwnerBot(botId: string): Promise<boolean> {
  const id = await ownerBotId().catch(() => "");
  return !!id && id === botId;
}

let botCache: { at: number; v: OwnerBot | null } | null = null;
/** The configured owner bot (an active AD_BOT row) with its @username, or null when none is set or it is not usable. */
export async function ownerBot(): Promise<OwnerBot | null> {
  if (botCache && Date.now() - botCache.at < 600_000) return botCache.v;
  const id = await ownerBotId().catch(() => "");
  let v: OwnerBot | null = null;
  if (id) {
    const row = await prisma.bot.findUnique({ where: { id }, select: { id: true, token: true, template: true, isActive: true } }).catch(() => null);
    if (row && row.isActive && row.template === "AD_BOT") {
      try {
        const res = await fetch(`https://api.telegram.org/bot${row.token}/getMe`, { signal: AbortSignal.timeout(6000) });
        const data = await res.json();
        const username = String(data?.result?.username || "");
        if (username) v = { id: row.id, token: row.token, username };
      } catch {
        v = null;
      }
    }
  }
  botCache = { at: Date.now(), v };
  return v;
}

/** Deep link to the owner bot's «احصل على بوت مشابه» checkout, or null when no owner bot is configured. */
export async function ownerBotGetbotLink(): Promise<string | null> {
  const b = await ownerBot().catch(() => null);
  return b ? `https://t.me/${b.username}?start=getbot` : null;
}

/** "/ownerbot" or "/ownerbot off". Pure. */
export function parseOwnerBotCommand(text: string): { off: boolean } | null {
  const m = /^\/ownerbot(?:@\w+)?(?:\s+(off|clear|إلغاء))?\s*$/i.exec(String(text || "").trim());
  return m ? { off: !!m[1] } : null;
}

