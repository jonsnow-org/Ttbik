// Daily quota for Nova's media generation (pictures, videos, speech): open to EVERY user, not only the owner.
//   Free: 3 pictures + 3 videos a day (owner's rule, 2026-10-28). Plus / Pro get more. The owner is exempt.
// The day is the calendar day in Europe/Istanbul (it renews at midnight there). A slot is RESERVED before the Studio is called (one atomic UPDATE, so
// two requests at once cannot both take the last slot) and handed back when nothing was made, so only a successful, vetted result is ever counted.
import { prismaDb, tierFor, type Db } from "@/lib/coderAuth";
import { coderChatKey } from "@/lib/coderAuth";
import { getSubscription } from "@/lib/coderPlans";

export type MediaKind = "image" | "audio" | "video";
export const MEDIA_TZ = "Europe/Istanbul";
/** Per plan id; an unknown plan counts as free. Speech is cheap on the CPU, video is the expensive one (about a minute each). */
export const MEDIA_DAILY: Record<string, Record<MediaKind, number>> = {
  free: { image: 3, video: 3, audio: 10 },
  plus: { image: 20, video: 8, audio: 40 },
  pro: { image: 60, video: 20, audio: 120 },
};
export const mediaLimit = (planId: string, kind: MediaKind): number => (MEDIA_DAILY[planId] || MEDIA_DAILY.free)[kind];
/** The Istanbul calendar day (YYYY-MM-DD) of an instant. */
export const mediaDay = (now = Date.now()): string => new Intl.DateTimeFormat("en-CA", { timeZone: MEDIA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));

let ready: Promise<void> | null = null;
function ensureTables(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();
  if (!ready) {
    ready = db.exec(`CREATE TABLE IF NOT EXISTS coder_media_daily (chat_key TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (chat_key, day, kind))`)
      .then(() => undefined).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export type MediaSlot = { ok: true; owner?: boolean; used: number; limit: number; planId: string } | { ok: false; used: number; limit: number; planId: string; kind: MediaKind };

/** Take one slot for today. Owner: always (no counting). Free / paid: only while today's count is under the plan's limit. A database failure never blocks a request. */
export async function reserveMedia(chatId: number | string, kind: MediaKind, db: Db = prismaDb, now = Date.now()): Promise<MediaSlot> {
  if (tierFor(Number(chatId)) === "owner") return { ok: true, owner: true, used: 0, limit: -1, planId: "owner" };
  let planId = "free";
  try { planId = (await getSubscription(chatId, db)).plan_id; } catch { /* free */ }
  const limit = mediaLimit(planId, kind);
  if (limit <= 0) return { ok: false, used: 0, limit: 0, planId, kind };
  try {
    await ensureTables(db);
    const r = await db.query<{ n: number }>(
      `INSERT INTO coder_media_daily (chat_key, day, kind, n) VALUES ($1, $2, $3, 1)
       ON CONFLICT (chat_key, day, kind) DO UPDATE SET n = coder_media_daily.n + 1 WHERE coder_media_daily.n < $4 RETURNING n`,
      coderChatKey(chatId), mediaDay(now), kind, limit);
    if (r[0]) return { ok: true, used: Number(r[0].n), limit, planId };
    return { ok: false, used: limit, limit, planId, kind };
  } catch {
    return { ok: true, used: 0, limit, planId };                       // the counter is unreachable: do not block people because of it
  }
}

/** Give a reserved slot back (nothing was made / the result failed the quality gate). */
export async function releaseMedia(chatId: number | string, kind: MediaKind, db: Db = prismaDb, now = Date.now()): Promise<void> {
  if (tierFor(Number(chatId)) === "owner") return;
  await db.exec(`UPDATE coder_media_daily SET n = GREATEST(n - 1, 0) WHERE chat_key = $1 AND day = $2 AND kind = $3`, coderChatKey(chatId), mediaDay(now), kind).catch(() => undefined);
}

const KIND_AR: Record<MediaKind, string> = { image: "الصور", video: "مقاطع الفيديو", audio: "الملفات الصوتية" };
/** What the user sees when today's quota is used up: clear, Arabic, with the way to get more. Never "owners only". */
export function mediaQuotaMessage(q: Extract<MediaSlot, { ok: false }>): string {
  const free = q.planId === "free";
  const next = free ? "بلس أو برو" : q.planId === "plus" ? "برو" : "";
  return `🎨 وصلت إلى حدّك اليومي من ${KIND_AR[q.kind]} (${q.limit} في اليوم` + (free ? " في الخطة المجانية" : "") + `). يتجدد الحد كل يوم عند منتصف الليل بتوقيت إسطنبول.`
    + (next ? `\n⭐ للحصول على المزيد يمكنك الترقية إلى ${next} من قسم «الاشتراك» في التطبيق.` : "");
}
