import { verifyTelegramInitData } from "@/lib/verifyTelegramOwner";

// Shared server helpers for the media mini-app's social layer
// (follow / mute / block / report), backed by the tables in
// supabase/migration_media_social.sql.

export const MEDIA_OWNER_ID = (process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || "420066855").split(",")[0].trim();

export function mediaBotToken() {
  return (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

export async function mediaDb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Verified Telegram user (id + display name) from the mini-app's initData, or null. */
export function mediaUser(initData: string): { id: string; name: string } | null {
  const v = verifyTelegramInitData(initData, mediaBotToken());
  if (!v) return null;
  let name = "مستخدم";
  try {
    const u = JSON.parse(new URLSearchParams(initData).get("user") || "{}");
    name = [u.first_name, u.last_name].filter(Boolean).join(" ").slice(0, 40) || (u.username ? `@${u.username}` : name);
  } catch {
    /* keep default */
  }
  return { id: v.id, name };
}

export type Relations = {
  following: string[];
  mutes: string[];
  blocks: string[];
  blockedBy: string[];
};

export const EMPTY_RELATIONS: Relations = { following: [], mutes: [], blocks: [], blockedBy: [] };

export async function loadRelations(db: any, uid: string): Promise<Relations> {
  const [f, m, b, bb] = await Promise.all([
    db.from("media_follows").select("followee_id").eq("follower_id", uid).limit(2000),
    db.from("media_mutes").select("muted_id").eq("user_id", uid).limit(2000),
    db.from("media_blocks").select("blocked_id").eq("user_id", uid).limit(2000),
    db.from("media_blocks").select("user_id").eq("blocked_id", uid).limit(2000),
  ]);
  return {
    following: (f.data || []).map((r: any) => String(r.followee_id)),
    mutes: (m.data || []).map((r: any) => String(r.muted_id)),
    blocks: (b.data || []).map((r: any) => String(r.blocked_id)),
    blockedBy: (bb.data || []).map((r: any) => String(r.user_id)),
  };
}

/** True if either user has blocked the other. */
export async function isBlockedEitherWay(db: any, a: string, b: string): Promise<boolean> {
  const { data } = await db
    .from("media_blocks")
    .select("user_id")
    .in("user_id", [a, b])
    .in("blocked_id", [a, b])
    .limit(2);
  return (data || []).length > 0;
}

export async function tgApi(method: string, payload: Record<string, unknown>) {
  const token = mediaBotToken();
  if (!token) return { ok: false, description: "BOT_TOKEN not configured" } as any;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
}

let cachedBotUsername = "";
export async function mediaBotUsername(): Promise<string> {
  const env = (process.env.NEXT_PUBLIC_MEDIA_BOT_USERNAME || "").replace(/^@/, "").trim();
  if (env) return env;
  if (cachedBotUsername) return cachedBotUsername;
  const me = await tgApi("getMe", {});
  cachedBotUsername = me?.result?.username || "";
  return cachedBotUsername;
}

// ---- TikTok / X metadata (thumbnails + real titles) ----------------------

export function isTikTok(url: string) {
  return /tiktok\.com/i.test(url || "");
}

/** The downloader stores the platform's numeric media id as the title for some sources. */
export function isPlaceholderTitle(title: string) {
  const t = (title || "").trim();
  return !t || /^\d{6,}$/.test(t) || t === "فيديو تيك توك" || t === "بدون عنوان";
}

export async function tiktokOembed(url: string): Promise<{ title: string; author: string; thumbnail: string } | null> {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return {
      title: String(j.title || "").trim(),
      author: String(j.author_name || "").trim(),
      thumbnail: String(j.thumbnail_url || ""),
    };
  } catch {
    return null;
  }
}

export async function xOembedText(url: string): Promise<string> {
  try {
    const r = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`, { cache: "no-store" });
    if (!r.ok) return "";
    const j = await r.json();
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(String(j.html || ""))?.[1] || "";
    return p
      .replace(/<a[^>]*>(pic\.twitter\.com|https?:\/\/t\.co)[^<]*<\/a>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/** Best real title for a feed item whose stored title is a placeholder. */
export async function resolveRealTitle(url: string): Promise<string> {
  if (isTikTok(url)) {
    const o = await tiktokOembed(url);
    if (o) return (o.title || (o.author ? `فيديو من ${o.author}` : "")).slice(0, 120);
  } else if (/(twitter\.com|x\.com)/i.test(url)) {
    return (await xOembedText(url)).slice(0, 120);
  }
  return "";
}
