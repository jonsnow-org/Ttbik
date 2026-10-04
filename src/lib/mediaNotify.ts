// One place that decides who is told what, where, and how often, for the media mini-app and the media bot.
//   in-app:  a row in media_notifications (always, cannot be switched off)
//   bot:     a Telegram message with two buttons: open the thing, and stop this kind of message.
//            Stopping bot messages is a paid feature (the media bot's 💎 upgrade); free accounts keep them.
// The deciding rules are pure functions so they can be tested without a database.
import { isBlockedEitherWay, isPlaceholderTitle, mediaDb, tgApi } from "./mediaSocial";
import { write } from "./mediaSafe";

export type NotifyType = "like" | "comment" | "reply" | "follow" | "message" | "post";
export const NOTIFY_TYPES: NotifyType[] = ["like", "comment", "reply", "follow", "message", "post"];
export const TYPE_LABEL_AR: Record<NotifyType, string> = {
  like: "الإعجابات", comment: "التعليقات", reply: "الردود", follow: "المتابعون الجدد", message: "الرسائل الخاصة", post: "منشورات من تتابعهم",
};
export const isNotifyType = (t: unknown): t is NotifyType => typeof t === "string" && (NOTIFY_TYPES as string[]).includes(t);

export type Prefs = { pushOff: boolean; offTypes: NotifyType[] };
export const DEFAULT_PREFS: Prefs = { pushOff: false, offTypes: [] };

// one bot message per kind per person per window, and never more than this many an hour
export const PUSH_COOLDOWN_MS: Record<NotifyType, number> = { like: 15 * 60_000, comment: 5 * 60_000, reply: 5 * 60_000, follow: 10 * 60_000, message: 10 * 60_000, post: 30 * 60_000 };
export const PUSH_HOURLY_CAP = 12;

export function pushDecision(a: { prefs: Prefs; type: NotifyType; lastSameTypeAt: number | null; pushesLastHour: number; now: number }): { send: boolean; reason?: string } {
  if (a.prefs.pushOff) return { send: false, reason: "push-off" };
  if (a.prefs.offTypes.includes(a.type)) return { send: false, reason: "type-off" };
  if (a.lastSameTypeAt != null && a.now - a.lastSameTypeAt < PUSH_COOLDOWN_MS[a.type]) return { send: false, reason: "cooldown" };
  if (a.pushesLastHour >= PUSH_HOURLY_CAP) return { send: false, reason: "hourly-cap" };
  return { send: true };
}

export function pushText(type: NotifyType, from: string, extra = ""): string {
  const who = from || "مستخدم";
  switch (type) {
    case "like": return `❤️ ${who} أعجبه منشورك`;
    case "comment": return `💬 ${who} علّق على منشورك${extra ? `:\n«${extra}»` : ""}`;
    case "reply": return `↩️ ${who} ردّ على تعليقك${extra ? `:\n«${extra}»` : ""}`;
    case "follow": return `💜 ${who} بدأ بمتابعتك`;
    case "message": return `📩 رسالة جديدة من ${who}${extra ? `:\n«${extra}»` : ""}`;
    case "post": return extra ? `💜 ${who} شارك ${extra}` : `💜 ${who} شارك منشوراً جديداً`;
  }
}

/** The buttons under every bot notification: go to it, or stop this kind. */
export function pushKeyboard(type: NotifyType, openUrl: string, openText = "👀 افتح في التطبيق") {
  return {
    inline_keyboard: [
      [{ text: openText, web_app: { url: openUrl } }],
      [{ text: "🔕 إيقاف هذا النوع", callback_data: `mn:off:${type}` }, { text: "⚙️ الإشعارات", callback_data: "mn:menu" }],
    ],
  };
}

const site = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

export async function loadPrefs(db: any, uid: string): Promise<Prefs> {
  const { data, error } = await db.from("media_notify_prefs").select("push_off,off_types").eq("user_id", uid).maybeSingle();
  if (error || !data) return DEFAULT_PREFS;
  return { pushOff: !!data.push_off, offTypes: (Array.isArray(data.off_types) ? data.off_types : []).filter(isNotifyType) };
}

export async function savePrefs(db: any, uid: string, prefs: Prefs) {
  return write("notify prefs save", db.from("media_notify_prefs").upsert({ user_id: uid, push_off: prefs.pushOff, off_types: prefs.offTypes, updated_at: new Date().toISOString() }, { onConflict: "user_id" }));
}

/** Send one bot message to one person, if they allow it and it is not too soon after the last one. */
export async function pushToUser(db: any, a: { toId: string; fromId: string; type: NotifyType; text: string; openUrl: string; openText?: string }): Promise<{ pushed: boolean; reason?: string }> {
  const now = Date.now();
  const prefs = await loadPrefs(db, a.toId);
  let last: number | null = null, hour = 0;
  const l = await db.from("media_push_log").select("created_at").eq("to_id", a.toId).eq("type", a.type).eq("ok", true).order("created_at", { ascending: false }).limit(1);
  if (!l.error && l.data?.[0]?.created_at) last = new Date(l.data[0].created_at).getTime();
  const c = await db.from("media_push_log").select("id", { count: "exact", head: true }).eq("to_id", a.toId).eq("ok", true).gte("created_at", new Date(now - 3600_000).toISOString());
  if (!c.error) hour = c.count || 0;
  const d = pushDecision({ prefs, type: a.type, lastSameTypeAt: last, pushesLastHour: hour, now });
  if (!d.send) return { pushed: false, reason: d.reason };
  const r = await tgApi("sendMessage", { chat_id: a.toId, text: a.text, reply_markup: pushKeyboard(a.type, a.openUrl, a.openText) }).catch(() => null);
  const ok = !!r?.ok;
  await write("push log", db.from("media_push_log").insert({ to_id: a.toId, type: a.type, from_id: a.fromId, ok }));
  return ok ? { pushed: true } : { pushed: false, reason: r?.description || "telegram refused" };
}

/** Tell one person about something: the in-app row, then the bot message. Never to yourself, never across a block. */
export async function notify(db: any, a: { toId: string; fromId: string; fromName: string; type: Exclude<NotifyType, "message" | "post">; postId?: string | null; extra?: string }) {
  if (!db || !a.toId || !a.fromId || a.toId === a.fromId) return { stored: false, pushed: false, reason: "self-or-empty" };
  if (await isBlockedEitherWay(db, a.fromId, a.toId).catch(() => false)) return { stored: false, pushed: false, reason: "blocked" };
  // a like/unlike/like loop, or follow/unfollow/follow, is one notification, not many
  if (a.type === "like" || a.type === "follow") {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    let q = db.from("media_notifications").select("id").eq("to_id", a.toId).eq("from_id", a.fromId).eq("type", a.type).gte("created_at", since).limit(1);
    if (a.type === "like" && a.postId) q = q.eq("post_id", a.postId);
    const dup = await q;
    if (!dup.error && dup.data?.length) return { stored: false, pushed: false, reason: "duplicate" };
  }
  const ins = await write("notification insert", db.from("media_notifications").insert({ to_id: a.toId, from_id: a.fromId, from_name: a.fromName.slice(0, 40), type: a.type, post_id: a.postId || null }));
  const url = a.type === "follow" ? `${site()}/mini-app?u=${encodeURIComponent(a.fromId)}` : a.postId ? `${site()}/mini-app?post=${encodeURIComponent(a.postId)}` : `${site()}/mini-app`;
  const p = await pushToUser(db, { toId: a.toId, fromId: a.fromId, type: a.type, text: pushText(a.type, a.fromName, a.extra), openUrl: url });
  return { stored: ins.ok, pushed: p.pushed, reason: ins.ok ? p.reason : ins.error };
}

const NOTIFY_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Tells a user's followers that they shared something new: an in-app row for every follower who has not switched the 🔔 off for this
 * person, plus a bot message (subject to each follower's own settings). Skips mutes and blocks, and anyone already told about this
 * person in the last 30 minutes, so a burst of downloads is one message.
 */
export async function notifyFollowers(item: { id: string; sharer_id: string; sharer_name: string; title: string; media_type: string }) {
  const db = await mediaDb();
  if (!db || !item.sharer_id) return { sent: 0 };
  const { data: follows, error } = await db.from("media_follows").select("follower_id,notify,notified_at").eq("followee_id", item.sharer_id).limit(500);
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
  const skip = new Set<string>([...(mutes.data || []).map((m: any) => String(m.user_id)), ...(blocks.data || []).flatMap((b: any) => [String(b.user_id), String(b.blocked_id)])]);
  targets = targets.filter((t: string) => !skip.has(t) && t !== item.sharer_id);
  if (!targets.length) return { sent: 0 };

  const kind = item.media_type === "audio" || item.media_type === "voice" ? "مقطعاً صوتياً" : item.media_type === "photo" ? "صورة" : "فيديو";
  const title = isPlaceholderTitle(item.title) ? "" : `\n«${item.title.slice(0, 80)}»`;
  const text = `💜 ${item.sharer_name || "شخص تتابعه"} شارك ${kind} جديداً${title}`;
  const openUrl = `${site()}/mini-app?u=${encodeURIComponent(item.sharer_id)}`;

  await write("post notifications insert", db.from("media_notifications").insert(targets.map((to_id: string) => ({ to_id, from_id: item.sharer_id, from_name: (item.sharer_name || "مستخدم").slice(0, 40), type: "post", post_id: item.id }))));

  let sent = 0;
  const notified: string[] = [];
  for (let i = 0; i < targets.length; i += 15) {
    const batch = targets.slice(i, i + 15);
    const results = await Promise.all(batch.map((toId: string) => pushToUser(db, { toId, fromId: item.sharer_id, type: "post", text, openUrl, openText: "👀 شاهده في التطبيق" }).catch(() => ({ pushed: false }))));
    results.forEach((r, j) => { if (r.pushed) { sent++; notified.push(batch[j]); } });
  }
  if (notified.length) await write("follow notified_at", db.from("media_follows").update({ notified_at: new Date().toISOString() }).eq("followee_id", item.sharer_id).in("follower_id", notified));
  return { sent };
}
