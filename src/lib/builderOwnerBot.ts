// The owner (platform) bot of the ads & earn builder: one AD_BOT row of the Bot table, chosen by config, never hardcoded.
// The owner himself is recognised by his Telegram ID exactly as everywhere in the builder (SUPER_ADMIN_TELEGRAM_ID); this file only
// says WHICH bot is the platform's own bot, i.e. where builder flows send people (e.g. «احصل على بوت مشابه») and which bot sells
// and delivers activation codes.
//
// Selection, in order: env BUILDER_OWNER_BOT_ID (a Bot row id), then bot_settings key `builder_owner_bot` (a Bot row id, written by
// ensureOwnerBotFromEnv when the owner bot's token is given as env BUILDER_OWNER_BOT_TOKEN / SHAM_TEST0_BOT_TOKEN).
// Unset → every feature that needs it degrades gracefully (no link shown).
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

/** Makes `botId` the builder's owner bot, or clears it with null (server side only). */
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

/** The owner bot's token when it is provided by env instead of the /bots form: BUILDER_OWNER_BOT_TOKEN (alias SHAM_TEST0_BOT_TOKEN). */
export function ownerBotEnvToken(): string {
  return String(process.env.BUILDER_OWNER_BOT_TOKEN || process.env.SHAM_TEST0_BOT_TOKEN || "").trim();
}

export type EnsureResult = { ok: boolean; note: string; id?: string; username?: string; webhook?: string };
/**
 * Idempotent: registers the env-provided owner bot as an AD_BOT row of the builder (owner = SUPER_ADMIN_TELEGRAM_ID, the owner's
 * existing ID), points its webhook at the gate and selects it as the builder's owner bot. No env token → nothing happens.
 * Never takes over a row of another template. Called by the hourly hosting-gate-sync and by POST /api/admin/bots/bind-owner-bot.
 */
export async function ensureOwnerBotFromEnv(gateBase: string): Promise<EnsureResult> {
  const token = ownerBotEnvToken();
  if (!token) return { ok: false, note: "no env token (BUILDER_OWNER_BOT_TOKEN / SHAM_TEST0_BOT_TOKEN)" };
  const ownerId = String(process.env.SUPER_ADMIN_TELEGRAM_ID || "").trim();
  if (!/^\d{5,15}$/.test(ownerId)) return { ok: false, note: "SUPER_ADMIN_TELEGRAM_ID not set" };
  const tg = async (method: string, body?: unknown) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(8000) });
    return res.json().catch(() => null);
  };
  const me = await tg("getMe").catch(() => null);
  const username = String(me?.result?.username || "");
  if (!me?.ok || !username) return { ok: false, note: "Telegram rejected the env token (getMe)" };
  const base = gateBase.replace(/\/$/, "");
  let row = await prisma.bot.findFirst({ where: { token }, select: { id: true, template: true, isActive: true, webhookSecret: true } });
  if (row && row.template !== "AD_BOT") return { ok: false, note: `this token belongs to a ${row.template} bot; not taken over`, id: row.id, username };
  if (row && !row.isActive) return { ok: false, note: "the bot's row is deactivated; activate it in /admin/platform first", id: row.id, username };
  if (!row) {
    // same order as /api/bots/deploy: webhook first, so a failed setWebhook never leaves an orphaned row
    const crypto = await import("crypto");
    const id = crypto.randomUUID();
    const webhookSecret = crypto.randomBytes(32).toString("hex");
    const hook = await tg("setWebhook", { url: `${base}/api/telegram/${id}`, secret_token: webhookSecret }).catch(() => null);
    if (!hook?.ok) return { ok: false, note: `setWebhook failed: ${String(hook?.description || "").slice(0, 80)}`, username };
    row = await prisma.bot.create({ data: { id, token, template: "AD_BOT", ownerId, webhookSecret }, select: { id: true, template: true, isActive: true, webhookSecret: true } });
  } else {
    const info = await tg("getWebhookInfo").catch(() => null);
    const want = `${base}/api/telegram/${row.id}`;
    if (info?.result?.url !== want) await tg("setWebhook", { url: want, secret_token: row.webhookSecret }).catch(() => null);
  }
  if (!String(process.env.BUILDER_OWNER_BOT_ID || "").trim() && (await ownerBotId().catch(() => "")) !== row.id) await setOwnerBotId(row.id);
  await setBotAppMenu(token, base, row.id).catch(() => false); // its Mini App: the platform's services
  const info = await tg("getWebhookInfo").catch(() => null);
  return { ok: info?.result?.url === `${base}/api/telegram/${row.id}`, note: "owner bot bound", id: row.id, username, webhook: String(info?.result?.url || "") };
}

/** The builder bots' Mini App (the platform's services), opened from the chat's menu button. Pure. */
export function botAppUrl(gateBase: string, botId: string): string {
  return `${gateBase.replace(/\/$/, "")}/bot-app/${encodeURIComponent(botId)}`;
}
/** Sets the bot's menu button to the builder Mini App (all features, for every user). Done for the owner bot and for supervisor bots;
 *  bots owned by the owner that are not the owner bot (e.g. the platform's supervisory bot) are never touched. */
export async function setBotAppMenu(token: string, gateBase: string, botId: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ menu_button: { type: "web_app", text: "التطبيق", web_app: { url: botAppUrl(gateBase, botId) } } }), signal: AbortSignal.timeout(8000) }).catch(() => null);
  const data = await res?.json().catch(() => null);
  return !!data?.ok;
}
