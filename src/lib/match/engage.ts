/**
 * MARRIAGE_BOT engagement (owner-approved 2026-11-11): profile completeness, the opt-in daily «3 best matches»
 * digest (bot + Mini App), shared by the bot, the Mini App API and /api/cron/match-digest.
 * Storage: match_digest_optin (prisma/migration_30_marriage_bot_digest_feedback.sql, also lazily created by
 * appStore.ts v9) and the existing match_broadcast_log for dedupe. Never a guardian/parental feature.
 */
import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";
import { botUsername, miniAppUrl } from "@/lib/match/hybrid";
import { publicCardText, toPublicProfile } from "@/lib/match/inline";
import { quizOf } from "@/lib/match/extras";
import { hasAdvancedFilters } from "@/lib/match/entitlementRules";
import { twoWayFit, TWO_WAY_BADGE } from "@/lib/match/trustRules";
import {
  profileCompleteness, pickDigest, DIGEST_SIZE, DIGEST_BUTTON_OFF, DIGEST_OFF_CALLBACK, DIGEST_ON_CALLBACK, type DigestCandidate,
} from "@/lib/match/engageRules";

async function rows<T>(q: Promise<T[]> | undefined): Promise<T[]> {
  try { return (await q) ?? []; } catch { return []; }
}

// ---------------------------------------------------------------------------
// 📊 completeness
// ---------------------------------------------------------------------------
export async function completenessOf(userId: string): Promise<{ percent: number; tips: string[] } | null> {
  const [p, pref, quiz] = await Promise.all([
    prisma.matchProfile.findUnique({ where: { userId } }).catch(() => null),
    prisma.partnerPreference.findUnique({ where: { userId } }).catch(() => null),
    quizOf([userId]).catch(() => new Map<string, number[]>()),
  ]);
  if (!p) return null;
  return profileCompleteness({
    photo: !!p.photoFileId, voice: !!p.voiceFileId, city: p.city, job: p.job, education: p.education,
    maritalStatus: p.maritalStatus, attributes: p.attributes, hasPref: !!pref, quizDone: quiz.has(userId), verified: p.verificationStatus === "VERIFIED",
  });
}

// ---------------------------------------------------------------------------
// 🔔 digest opt-in
// ---------------------------------------------------------------------------
export async function digestOn(userId: string): Promise<boolean> {
  await ensureMatchAppTables().catch(() => null);
  const r = await rows(prisma.$queryRaw<{ enabled: boolean }[]>`SELECT enabled FROM match_digest_optin WHERE user_id = ${userId}`);
  return !!r[0]?.enabled;
}
export async function setDigest(userId: string, botId: string, enabled: boolean): Promise<void> {
  await ensureMatchAppTables().catch(() => null);
  await prisma.$executeRaw`INSERT INTO match_digest_optin (user_id, bot_id, enabled, updated_at) VALUES (${userId}, ${botId}, ${enabled}, now())
    ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, bot_id = EXCLUDED.bot_id, updated_at = now()`;
}
export function digestPromptText(on: boolean): string {
  return on
    ? "🔔 الملخص اليومي مفعّل: يصلك كل مساء أفضل 3 ملفات تناسبك (لم تُرسل لك من قبل)، مع احترام الخصوصية والحظر و«دولتي فقط».\nيمكنك إيقافه في أي وقت."
    : "🔔 أفضل 3 مطابقات يومياً: رسالة واحدة كل مساء فيها أفضل 3 ملفات تناسبك ولم تُرسل لك من قبل.\nاختياري تماماً، ويمكنك إيقافه في أي وقت.";
}
export function digestToggleKeyboard(on: boolean): InlineKeyboard {
  return on ? new InlineKeyboard().text(DIGEST_BUTTON_OFF, DIGEST_OFF_CALLBACK) : new InlineKeyboard().text("✅ تفعيل الملخص اليومي", DIGEST_ON_CALLBACK);
}
/** mdg_on / mdg_off — the member's own setting; true when handled. */
export async function handleDigestCallback(bot: TelegramBot, botId: string, cq: any): Promise<boolean> {
  const data = String(cq?.data || "");
  if (data !== DIGEST_ON_CALLBACK && data !== DIGEST_OFF_CALLBACK) return false;
  const userId = String(cq.from?.id || "");
  if (!userId) return true;
  const on = data === DIGEST_ON_CALLBACK;
  const ok = await setDigest(userId, botId, on).then(() => true, () => false);
  await bot.api.answerCallbackQuery(cq.id, { text: !ok ? "تعذّر الحفظ، حاول لاحقاً" : on ? "🔔 تم التفعيل" : "🔕 تم الإيقاف" }).catch(() => null);
  if (ok && cq.message?.chat?.id) {
    await bot.api.sendMessage(cq.message.chat.id, on ? digestPromptText(true) : "🔕 أوقفنا الملخص اليومي. لتفعيله من جديد: «ℹ️ معلومات ← 🔔 أفضل 3 مطابقات يومياً».", { reply_markup: digestToggleKeyboard(on) }).catch(() => null);
  }
  return true;
}

// ---------------------------------------------------------------------------
// 🔔 the daily run
// ---------------------------------------------------------------------------
export function digestDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
/** Claim a (campaign, key) row once; false when it was already claimed. */
async function claim(campaign: string, key: string): Promise<boolean> {
  const n = await prisma.$executeRaw`INSERT INTO match_broadcast_log (campaign, user_id, ok) VALUES (${campaign}, ${key}, true) ON CONFLICT DO NOTHING`;
  return n === 1;
}

/**
 * The member's best 3 for today. Candidates come ONLY from the bot's own search queue (buildSearchQueue), which
 * already applies approved-only, not hidden, banned, blocks both ways and «دولتي فقط»; never a profile they
 * liked already or one sent in an earlier digest.
 */
export async function digestPicksFor(botId: string, userId: string): Promise<string[]> {
  const { buildSearchQueue, compatibilityPercent, defaultPref } = await import("@/lib/matchBotLogic");
  const user = await prisma.matchUser.findUnique({ where: { id: userId }, include: { profile: true, preference: true } });
  if (!user?.profile || user.profile.status !== "APPROVED" || user.isBanned || (user.mutedUntil && user.mutedUntil > new Date())) return [];
  const pref = user.preference ?? defaultPref(userId, user.profile);
  const queue = (await buildSearchQueue(botId, userId, user.profile, pref)).slice(0, 40);
  if (!queue.length) return [];
  const [profiles, prefs, likesOut, likesIn, sent] = await Promise.all([
    prisma.matchProfile.findMany({ where: { userId: { in: queue }, status: "APPROVED", isHidden: false, user: { isBanned: false } }, include: { user: { select: { lastActiveAt: true } } } }),
    rows(prisma.partnerPreference.findMany({ where: { userId: { in: queue } }, select: { userId: true, country: true, ageMin: true, ageMax: true } })),
    rows(prisma.matchLike.findMany({ where: { fromUserId: userId, toUserId: { in: queue } }, select: { toUserId: true } })),
    rows(prisma.matchLike.findMany({ where: { toUserId: userId, fromUserId: { in: queue } }, select: { fromUserId: true } })),
    rows(prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM match_broadcast_log WHERE campaign = ${`dgp:${userId}`}`),
  ]);
  const prefOf = new Map(prefs.map((p) => [p.userId, p]));
  const out = new Set(likesOut.map((l) => l.toUserId));
  const inn = new Set(likesIn.map((l) => l.fromUserId));
  const seen = new Set(sent.map((s) => s.user_id));
  const advanced = hasAdvancedFilters(user);
  const now = Date.now();
  const list: DigestCandidate[] = profiles.map((p) => ({
    userId: p.userId,
    compat: compatibilityPercent(p, pref, advanced),
    twoWay: twoWayFit(user.profile!, user.preference, p, prefOf.get(p.userId) ?? null),
    likedMe: inn.has(p.userId), likedByMe: out.has(p.userId), sentBefore: seen.has(p.userId),
    activeDays: (now - new Date(p.user.lastActiveAt).getTime()) / 86400_000,
  }));
  return pickDigest(list, DIGEST_SIZE);
}

export async function sendDigest(bot: TelegramBot, botId: string, userId: string, day = digestDay()): Promise<"sent" | "dup" | "empty" | "failed"> {
  if (!(await claim(`digest:${day}`, userId))) return "dup";
  const picks = await digestPicksFor(botId, userId).catch(() => [] as string[]);
  if (!picks.length) return "empty";
  const [profiles, me, myPref, prefs] = await Promise.all([
    prisma.matchProfile.findMany({ where: { userId: { in: picks } } }),
    prisma.matchProfile.findUnique({ where: { userId } }),
    prisma.partnerPreference.findUnique({ where: { userId } }).catch(() => null),
    rows(prisma.partnerPreference.findMany({ where: { userId: { in: picks } }, select: { userId: true, country: true, ageMin: true, ageMax: true } })),
  ]);
  const byId = new Map(profiles.map((p) => [p.userId, p]));
  const prefOf = new Map(prefs.map((p) => [p.userId, p]));
  const username = await botUsername(bot, botId);
  const kb = new InlineKeyboard();
  const parts: string[] = ["🔔 أفضل 3 مطابقات لك اليوم", ""];
  picks.forEach((id, i) => {
    const p = byId.get(id);
    if (!p) return;
    const pub = toPublicProfile(p);
    const mutual = me ? twoWayFit(me, myPref, p, prefOf.get(id) ?? null) : false;
    parts.push(`${i + 1}) ${publicCardText(pub).split("\n").slice(0, 3).join(" · ")}${mutual ? `\n${TWO_WAY_BADGE}` : ""}`, "");
    if (username) kb.url(`👁 #${pub.shortId}`, `https://t.me/${username}?start=profile_${p.id}`);
  });
  kb.row().webApp("💍 افتح التطبيق", miniAppUrl(botId)).row().text(DIGEST_BUTTON_OFF, DIGEST_OFF_CALLBACK);
  parts.push("🔒 التواصل عبر البوت فقط وبموافقة الطرفين.");
  const ok = await bot.api.sendMessage(Number(userId), parts.join("\n"), { reply_markup: kb }).then(() => true, () => false);
  if (!ok) return "failed";
  for (const id of picks) await claim(`dgp:${userId}`, id).catch(() => false);
  return "sent";
}
