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

/**
 * Whether a Telegram user has the paid media-bot upgrade — mirrored here
 * from the bot's own local grant (see supabase/migration_media_premium_sync.sql)
 * so the mini-app or any other site feature can check premium status without
 * reaching into the bot process. Not wired into the mini-app UI yet (no
 * premium-gated feature exists there today); this is the read side ready
 * for whenever one does.
 */
export async function isMediaPremium(tgUserId: string): Promise<boolean> {
  const db = await mediaDb();
  if (!db) return false;
  const { data } = await db.from("media_premium_users").select("tg_user_id").eq("tg_user_id", tgUserId).maybeSingle();
  return !!data;
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

/** Display names for Telegram ids: mini_app_users first, then the name on their posts. */
export async function namesFor(db: any, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  const { data: users } = await db.from("mini_app_users").select("id,name").in("id", ids);
  for (const u of users || []) if (u?.name) out[String(u.id)] = String(u.name);
  const missing = ids.filter((id) => !out[id]);
  if (missing.length) {
    const { data: posts } = await db.from("media_feed").select("sharer_id,sharer_name").in("sharer_id", missing).limit(500);
    for (const p of posts || []) if (p?.sharer_name && !out[String(p.sharer_id)]) out[String(p.sharer_id)] = String(p.sharer_name);
  }
  return out;
}

const NOTIFY_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Tells a user's followers (via the bot) that they shared something new.
 * Skips followers who turned the 🔔 off for this person, who muted or are
 * blocked either way, and anyone already notified about this person in the
 * last 30 minutes (so a burst of downloads is one message, not ten).
 */
export async function notifyFollowers(item: { id: string; sharer_id: string; sharer_name: string; title: string; media_type: string }) {
  const db = await mediaDb();
  if (!db || !item.sharer_id) return { sent: 0 };
  const { data: follows, error } = await db
    .from("media_follows")
    .select("follower_id,notify,notified_at")
    .eq("followee_id", item.sharer_id)
    .limit(500);
  if (error || !follows?.length) return { sent: 0 };

  const now = Date.now();
  let targets = follows
    .filter((f: any) => f.notify !== false)
    .filter((f: any) => !f.notified_at || now - new Date(f.notified_at).getTime() > NOTIFY_THROTTLE_MS)
    .map((f: any) => String(f.follower_id));
  if (!targets.length) return { sent: 0 };

  const [mutes, blocks] = await Promise.all([
    db.from("media_mutes").select("user_id").eq("muted_id", item.sharer_id).in("user_id", targets),
    db.from("media_blocks").select("user_id,blocked_id").or(`user_id.eq.${item.sharer_id},blocked_id.eq.${item.sharer_id}`),
  ]);
  const skip = new Set<string>([
    ...(mutes.data || []).map((m: any) => String(m.user_id)),
    ...(blocks.data || []).flatMap((b: any) => [String(b.user_id), String(b.blocked_id)]),
  ]);
  targets = targets.filter((t: string) => !skip.has(t) && t !== item.sharer_id);
  if (!targets.length) return { sent: 0 };

  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  const kind = item.media_type === "audio" || item.media_type === "voice" ? "مقطعاً صوتياً" : item.media_type === "photo" ? "صورة" : "فيديو";
  const title = isPlaceholderTitle(item.title) ? "" : `\n«${item.title.slice(0, 80)}»`;
  const text = `💜 ${item.sharer_name || "شخص تتابعه"} شارك ${kind} جديداً${title}`;
  const reply_markup = {
    inline_keyboard: [[{ text: "👀 شاهده في التطبيق", web_app: { url: `${site}/mini-app?u=${encodeURIComponent(item.sharer_id)}` } }]],
  };

  let sent = 0;
  const notified: string[] = [];
  for (let i = 0; i < targets.length; i += 20) {
    const batch = targets.slice(i, i + 20);
    const results = await Promise.all(
      batch.map((chat_id: string) => tgApi("sendMessage", { chat_id, text, reply_markup }).catch(() => null))
    );
    results.forEach((r: any, j: number) => {
      if (r?.ok) {
        sent++;
        notified.push(batch[j]);
      }
    });
  }
  if (notified.length) {
    await db
      .from("media_follows")
      .update({ notified_at: new Date().toISOString() })
      .eq("followee_id", item.sharer_id)
      .in("follower_id", notified)
      .then(() => {}, () => {});
  }
  return { sent };
}
