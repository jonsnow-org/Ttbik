import crypto from "crypto";
import { mediaBotToken, mediaDb } from "@/lib/mediaSocial";

/**
 * Media bot front door: Telegram webhook → Vercel → forward to the Python engine.
 * Two engines can be registered: "primary" (Oracle, always on) and "backup"
 * (Render, sleeps when idle). Updates go to the primary; only when it is
 * unreachable are they handed to the backup. The Vercel replies themselves are
 * the last resort (not primary UX).
 */

export const MINI_APP_URL = "https://ttbik.vercel.app/mini-app";
const RENDER_URL_KEY = "media_bot_render_url"; // the backup engine (kept for compatibility)
const PRIMARY_URL_KEY = "media_bot_primary_url";

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

/** Prefer DB value (registered by Python on wake), then env MEDIA_BOT_RENDER_URL. */
export async function getRenderUrl(): Promise<string> {
  if (cachedUrl && Date.now() - cachedUrl.at < 30_000) return cachedUrl.url;
  const envUrl = (process.env.MEDIA_BOT_RENDER_URL || "").trim().replace(/\/$/, "");
  const db = await mediaDb();
  if (db) {
    const { data } = await db.from("bot_settings").select("value").eq("key", RENDER_URL_KEY).maybeSingle();
    const url = typeof (data as any)?.value === "string" ? String((data as any).value).replace(/\/$/, "") : "";
    if (url) {
      cachedUrl = { url, at: Date.now() };
      return url;
    }
  }
  if (envUrl) {
    cachedUrl = { url: envUrl, at: Date.now() };
    return envUrl;
  }
  cachedUrl = { url: "", at: Date.now() };
  return "";
}

export async function setRenderUrl(url: string): Promise<boolean> {
  const db = await mediaDb();
  if (!db) return false;
  const clean = url.trim().replace(/\/$/, "");
  const { error } = await db
    .from("bot_settings")
    .upsert({ key: RENDER_URL_KEY, value: clean, updated_at: new Date().toISOString() });
  if (!error) cachedUrl = { url: clean, at: Date.now() };
  return !error;
}

let cachedPrimary: { url: string; at: number } | null = null;

/** The always-on engine (Oracle), registered by the Python bot with MEDIA_ENGINE_ROLE=primary. */
export async function getPrimaryUrl(): Promise<string> {
  if (cachedPrimary && Date.now() - cachedPrimary.at < 30_000) return cachedPrimary.url;
  let url = "";
  const db = await mediaDb();
  if (db) {
    const { data } = await db.from("bot_settings").select("value").eq("key", PRIMARY_URL_KEY).maybeSingle();
    url = typeof (data as any)?.value === "string" ? String((data as any).value).replace(/\/$/, "") : "";
  }
  cachedPrimary = { url, at: Date.now() };
  return url;
}

export async function setPrimaryUrl(url: string): Promise<boolean> {
  const db = await mediaDb();
  if (!db) return false;
  const clean = url.trim().replace(/\/$/, "");
  const { error } = await db
    .from("bot_settings")
    .upsert({ key: PRIMARY_URL_KEY, value: clean, updated_at: new Date().toISOString() });
  if (!error) cachedPrimary = { url: clean, at: Date.now() };
  return !error;
}

/** Engines in the order updates should be tried: primary first, then the backup. */
export async function getEngineUrls(): Promise<string[]> {
  const [primary, backup] = await Promise.all([getPrimaryUrl().catch(() => ""), getRenderUrl().catch(() => "")]);
  return [primary, backup].filter((u, i, a) => !!u && a.indexOf(u) === i);
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
      /* ignore */
    }
  }
  const res = await tg("setWebhook", {
    url: target,
    secret_token: secret,
    max_connections: 10,
    allowed_updates: [
      "message",
      "edited_message",
      "callback_query",
      "inline_query",
      "chosen_inline_result",
      "my_chat_member",
      "chat_member",
      "pre_checkout_query",
    ],
  });
  return {
    ok: !!res?.ok,
    changed: !!res?.ok,
    detail: res?.description || (res?.ok ? "webhook moved to front door" : "setWebhook failed"),
  };
}
