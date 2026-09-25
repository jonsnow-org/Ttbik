import crypto from "crypto";
import { mediaBotToken, mediaDb } from "@/lib/mediaSocial";

/**
 * Media bot "front door" (owner request, 2026-09-25): keep the media bot
 * answering when its Render free instance hours run out.
 *
 * Telegram's webhook points here (Vercel, always on) instead of straight at
 * Render. Every update is forwarded unchanged to the Python bot on Render,
 * so while Render is up nothing about the bot changes. When Render is
 * unreachable (suspended for the month, crashed, redeploying):
 *   - /start and plain messages get a real answer with the mini-app button
 *     (the mini-app runs on Vercel + Supabase and keeps working fully);
 *   - "/start clone_<id>" deep links from the mini-app are served from the
 *     Telegram file_id cache directly — no download needed;
 *   - download links are saved in media_bot_queue and the Python bot
 *     replays them automatically as soon as it is back.
 *
 * The Python bot registers its Render URL here on every start
 * (bot_settings.media_bot_render_url) and only then moves the webhook to
 * this route, so an old Vercel deploy can never strand the bot.
 */

export const MINI_APP_URL = "https://ttbik.vercel.app/mini-app";
const RENDER_URL_KEY = "media_bot_render_url";

// Same derivation as media-bot/main.py (_HOOK_SECRET / _HOOK_PATH), so
// rotating the bot token rotates both, and nothing extra must be configured.
export function hookSecret(): string {
  const token = mediaBotToken();
  return token ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 48) : "";
}
export function hookPath(): string {
  return `/tg/${hookSecret().slice(0, 24)}`;
}
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

let cachedUrl: { url: string; at: number } | null = null;
export async function getRenderUrl(): Promise<string> {
  if (cachedUrl && Date.now() - cachedUrl.at < 60_000) return cachedUrl.url;
  const db = await mediaDb();
  if (!db) return "";
  const { data } = await db.from("bot_settings").select("value").eq("key", RENDER_URL_KEY).maybeSingle();
  const url = typeof (data as any)?.value === "string" ? String((data as any).value) : "";
  cachedUrl = { url, at: Date.now() };
  return url;
}
export async function setRenderUrl(url: string): Promise<boolean> {
  const db = await mediaDb();
  if (!db) return false;
  const { error } = await db.from("bot_settings").upsert({ key: RENDER_URL_KEY, value: url, updated_at: new Date().toISOString() });
  if (!error) cachedUrl = { url, at: Date.now() };
  return !error;
}

export async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const token = mediaBotToken();
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export function miniAppKeyboard() {
  return { inline_keyboard: [[{ text: "📱 فتح التطبيق المصغر", web_app: { url: MINI_APP_URL } }]] };
}

export function frontDoorUrl(): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  return `${site}/api/media-bot/webhook`;
}

/**
 * Points the media bot's webhook at the front door without needing the
 * Python bot to run first — needed exactly when Render is suspended and
 * can't start to do it itself. The Render address is learned from the
 * webhook Telegram currently has (".../tg/<hash>" is the bot's own path),
 * so forwarding resumes by itself once Render is back.
 * Idempotent and harmless to call often: it only ever points the bot at
 * this site's own route.
 */
export async function ensureFrontDoor(): Promise<{ ok: boolean; changed: boolean; detail: string }> {
  const secret = hookSecret();
  if (!secret) return { ok: false, changed: false, detail: "no bot token" };
  const info = await tg("getWebhookInfo", {});
  const current = String(info?.result?.url || "");
  const target = frontDoorUrl();
  if (current === target) return { ok: true, changed: false, detail: "already active" };

  if (/\/tg\/[a-f0-9]{24}$/.test(current)) {
    try {
      const origin = new URL(current).origin;
      if (!(await getRenderUrl())) await setRenderUrl(origin);
    } catch {
      /* keep going: fallback mode still works without it */
    }
  }
  const res = await tg("setWebhook", {
    url: target,
    secret_token: secret,
    max_connections: 10,
    allowed_updates: ["message", "edited_message", "callback_query", "inline_query", "chosen_inline_result", "my_chat_member", "chat_member", "pre_checkout_query"],
  });
  return { ok: !!res?.ok, changed: !!res?.ok, detail: res?.description || (res?.ok ? "webhook moved to front door" : "setWebhook failed") };
}
