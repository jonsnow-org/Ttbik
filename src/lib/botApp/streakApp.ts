/**
 * The daily chains bot's own Mini App (STREAK_BOT template, @Slaselbot), server side. Every action runs for the Telegram user
 * proven by initData signed with THIS bot's token (checked by /api/bot-app/[botId] before anything here).
 * Same rules as the chat: check-ins (checkInCore), juz taps (tapJuzCore), memorial orders (KHATMA:<order> Stars, credited by the
 * bot's own successful_payment handler), contest prizes (claimPrizes) and contest sponsorship (createSponsorOrder / paySponsor).
 */
import { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STREAK_CATEGORIES, checkInCore, ensureStreakUser, todayKey, yesterdayKey } from "@/lib/streakBotLogic";
import {
  INTENTS, MAX_OPEN_PER_USER, MEMORIAL_TIERS, SPONSOR_PRODUCTS, TG_PRIZE_TEXT, activeSponsorRow, checkSponsorUsdt, createMemorialOrderCore, createSponsorOrder, khatmaForApp,
  khatmaView, myKhatmas, openMemorials, paySponsor, refreshGroupBoard, sponsorByCode, tapJuzCore,
} from "@/lib/khatma/khatma";
import { cleanText, JUZ_COUNT } from "@/lib/khatma/rules";
import { ensureContestTables, weeklyGroups } from "@/lib/contests/contests";
import { CLAIM_DAYS, MIN_POINTS, MIN_ROUNDS, PREMIUM_STARS, claimPrizes, ensurePrizeTables, sponsorPrizes } from "@/lib/contests/prizes";
import { FIRST_BONUS, POINTS_CORRECT, ROUND_SIZE, weekStart } from "@/lib/contests/rules";
import { rateLimit, type TgWebAppUser } from "@/lib/match/inline";

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
export type AppResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; code?: string; [k: string]: unknown };
const fail = (error: string, code?: string): AppResult => ({ ok: false, error, ...(code ? { code } : {}) });
const tgName = (tg: TgWebAppUser) => cleanText([tg.firstName, (tg as any).lastName].filter(Boolean).join(" ") || (tg.username ? `@${tg.username}` : "مشارك"), 24);

const gateCache = new Map<string, { at: number; ok: boolean }>();
async function passesChannelGate(bot: TelegramBot, botRow: BotRow, tgId: string, fresh = false): Promise<boolean> {
  if (!botRow.requiredChannel || tgId === SUPER_ADMIN_ID) return true;
  const key = `${botRow.id}:${tgId}`;
  const hit = gateCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
  // Same rule as the chat: fail open when the channel or the bot's admin rights are misconfigured.
  const m = await bot.api.getChatMember(`@${botRow.requiredChannel.replace(/^@/, "")}`, Number(tgId)).catch(() => null);
  const ok = !m || ["creator", "administrator", "member"].includes(m.status);
  gateCache.set(key, { at: Date.now(), ok });
  return ok;
}

async function streaksOf(uid: string) {
  const rows = await prisma.streakEntry.findMany({ where: { userId: uid } });
  const today = todayKey();
  const yest = yesterdayKey();
  return STREAK_CATEGORIES.map((c) => {
    const e = rows.find((r) => r.category === c.id);
    const last = e?.lastCheckInDate || null;
    // A streak whose last check-in is older than yesterday restarts at the next check-in (the stored number is shown as «at risk» → 0).
    const alive = last === today || last === yest;
    return { id: c.id, emoji: c.emoji, title: c.title, current: e && alive ? e.currentStreak : 0, longest: e?.longestStreak || 0, today: last === today, atRisk: !!e && last === yest && e.currentStreak > 0 };
  });
}

async function playerWeek(botId: string, uid: string) {
  await ensureContestTables();
  const since = weekStart();
  const rows = await prisma.$queryRaw<{ user_id: string; name: string | null; points: bigint; rounds: bigint }[]>`
    SELECT a.user_id, max(a.user_name) name, sum(a.points) points, count(DISTINCT a.round_id) rounds
    FROM contest_answers a JOIN contest_rounds r ON r.id = a.round_id
    WHERE r.bot_id = ${botId} AND a.at >= ${since} GROUP BY a.user_id HAVING sum(a.points) > 0 ORDER BY sum(a.points) DESC LIMIT 200`;
  const i = rows.findIndex((r) => r.user_id === uid);
  return {
    top: rows.slice(0, 10).map((r, n) => ({ rank: n + 1, name: (r.name || "لاعب").slice(0, 24), points: Number(r.points), me: r.user_id === uid })),
    me: i >= 0 ? { rank: i + 1, points: Number(rows[i].points), rounds: Number(rows[i].rounds) } : { rank: null, points: 0, rounds: 0 },
  };
}

async function slotStanding(botId: string, uid: string, s: { starts_at: Date; ends_at: Date } | null) {
  if (!s) return null;
  const rows = await prisma.$queryRaw<{ user_id: string; points: bigint; rounds: bigint }[]>`
    SELECT a.user_id, sum(a.points) points, count(DISTINCT a.round_id) rounds FROM contest_answers a JOIN contest_rounds r ON r.id = a.round_id
    WHERE r.bot_id = ${botId} AND a.at >= ${s.starts_at} AND a.at < ${s.ends_at} GROUP BY a.user_id ORDER BY sum(a.points) DESC LIMIT 200`;
  const i = rows.findIndex((r) => r.user_id === uid);
  const me = i >= 0 ? rows[i] : null;
  const points = Number(me?.points || 0);
  const rounds = Number(me?.rounds || 0);
  return { rank: i >= 0 ? i + 1 : null, points, rounds, eligible: points >= MIN_POINTS && rounds >= MIN_ROUNDS };
}

async function prizesOf(uid: string) {
  await ensurePrizeTables();
  const r = await prisma.$queryRaw<{ id: bigint; rank: number; kind: string; status: string; points: number; created_at: Date; name: string; prize: string | null }[]>`
    SELECT p.id, p.rank, p.kind, p.status, p.points, p.created_at, s.name, s.prize FROM contest_prizes p JOIN khatma_sponsors s ON s.code = p.sponsor_code
    WHERE p.user_id = ${uid} ORDER BY p.id DESC LIMIT 20`;
  return r.map((x) => ({ id: String(x.id), rank: x.rank, kind: x.kind, status: x.status, points: x.points, at: x.created_at.toISOString(), sponsor: x.name, prize: x.kind === "PREMIUM3" ? "تيليجرام بريميوم 3 أشهر" : x.kind === "GIFT" ? "هدية تيليجرام" : x.prize || "جائزة الراعي" }));
}

export async function handleStreakAppAction(botRow: BotRow, tg: TgWebAppUser, action: string, body: any): Promise<AppResult> {
  const uid = tg.id;
  const bot = new TelegramBot(botRow.token);
  const user = await ensureStreakUser(botRow.id, uid);
  if (user.isBanned) return fail("🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.", "banned");
  if (user.mutedUntil && user.mutedUntil > new Date()) return fail("🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.", "muted");
  const me = await bot.api.getMe().catch(() => null);
  const username = me?.username || "";

  if (action === "init" || action === "gate_check") {
    const joined = await passesChannelGate(bot, botRow, uid, action === "gate_check");
    await prisma.streakUser.update({ where: { id: uid }, data: { lastActiveAt: new Date() } }).catch(() => null);
    return {
      ok: true, gate: joined ? null : { channel: String(botRow.requiredChannel || "").replace(/^@/, "") },
      user: { id: uid, firstName: tg.firstName || "", username: tg.username || "" }, bot: { username },
      streaks: await streaksOf(uid),
    };
  }
  if (!(await passesChannelGate(bot, botRow, uid))) return fail("انضم إلى قناة البوت أولاً.", "gate");

  switch (action) {
    // ---------------------------------------------------------------- 🔥 السلاسل اليومية
    case "streaks":
      return { ok: true, streaks: await streaksOf(uid) };
    case "check_in": {
      const cat = STREAK_CATEGORIES.find((c) => c.id === body?.category);
      if (!cat) return fail("اختر سلسلة.");
      if (!rateLimit(`sapp-ci:${uid}`, 30, 60_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await checkInCore(botRow.id, uid, cat.id);
      return { ok: true, already: r.already, continued: r.continued, current: r.entry.currentStreak, longest: r.entry.longestStreak, streaks: await streaksOf(uid) };
    }

    // ---------------------------------------------------------------- 📖 الختمة الجماعية
    case "kh_home": {
      const [mine, open] = await Promise.all([myKhatmas(botRow.id, uid), openMemorials().catch(() => [])]);
      const views = await Promise.all(mine.map(async (k) => {
        const v = await khatmaView(k);
        const myJuz = v.board.filter((j) => j.userId === uid).map((j) => ({ juz: j.juz, done: j.done }));
        return { id: v.id, kind: v.kind, title: v.title, round: v.round, completedRounds: v.completedRounds, slug: v.slug, done: v.board.filter((j) => j.done).length, taken: v.board.filter((j) => j.userId).length, myJuz };
      }));
      return {
        ok: true, mine: views, open, bot: username, maxOpen: MAX_OPEN_PER_USER, juzCount: JUZ_COUNT,
        tiers: MEMORIAL_TIERS.map((t) => ({ id: t.id, stars: t.stars, label: t.label })), intents: INTENTS.map((i) => ({ id: i.id, label: i.label })),
      };
    }
    case "kh_board": {
      const k = await khatmaForApp(botRow.id, { id: body?.id ? String(body.id) : undefined, slug: body?.slug ? String(body.slug) : undefined });
      if (!k) return fail("هذه الختمة غير متاحة.", "gone");
      const v = await khatmaView(k);
      return {
        ok: true, khatma: { ...v, board: v.board.map((j) => ({ juz: j.juz, state: j.done ? "done" : j.userId ? "taken" : "free", mine: j.userId === uid, by: j.userId && j.userId !== uid ? j.userName : null })) },
        joinUrl: k.kind === "MEMORIAL" && k.slug && username ? `https://t.me/${username}?start=k_${k.slug}` : null,
      };
    }
    case "kh_tap": {
      if (!rateLimit(`sapp-kt:${uid}`, 40, 60_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const k = await khatmaForApp(botRow.id, { id: String(body?.id || "") });
      if (!k) return fail("هذه الختمة مغلقة.", "gone");
      if (Number(body?.round) !== k.round) return fail("اكتملت هذه الختمة وبدأت التالية. حدّث اللوحة.", "round");
      const juz = Number(body?.juz);
      if (!Number.isInteger(juz) || juz < 1 || juz > JUZ_COUNT) return fail("رقم جزء غير صحيح.");
      // A group board belongs to its group: only a member of that group may take or mark a juz from the app.
      if (k.kind === "GROUP") {
        const m = k.chat_id ? await bot.api.getChatMember(k.chat_id, Number(uid)).catch(() => null) : null;
        if (!m || !["creator", "administrator", "member", "restricted"].includes(m.status)) return fail("هذه ختمة مجموعة، والمشاركة فيها لأعضاء المجموعة فقط.", "not_member");
      }
      const r = await tapJuzCore(bot, k, juz, uid, tgName(tg));
      if (k.kind === "GROUP") await refreshGroupBoard(bot, k);
      if (!r.ok) return fail(r.message, "busy");
      return { ok: true, message: r.message, completed: !!r.completed };
    }
    case "kh_memorial": {
      if (!rateLimit(`sapp-km:${uid}`, 6, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const o = await createMemorialOrderCore(botRow.id, uid, { name: String(body?.name || ""), intent: String(body?.intent || ""), dedication: String(body?.dedication || ""), tier: String(body?.tier || "") });
      if (!o.ok) return fail(o.error);
      try {
        // Same Stars payload as the chat (KHATMA:<order>): the bot's pre_checkout and successful_payment handlers open the khatma.
        const link = await bot.api.createInvoiceLink("ختمة صدقة جارية", `${o.title} · ${o.tierLabel}`.slice(0, 255), o.payload, "", "XTR", [{ label: "ختمة", amount: o.stars }]);
        return { ok: true, link, stars: o.stars, orderId: o.orderId };
      } catch (e) {
        console.error("streak-app memorial invoice failed", (e as Error)?.message);
        return fail("تعذّر إنشاء فاتورة النجوم الآن.");
      }
    }

    // ---------------------------------------------------------------- 🏆 مسابقات الجروبات
    case "ct_home": {
      const [sponsor, groups, week, prizes] = await Promise.all([
        activeSponsorRow("contest").catch(() => null), weeklyGroups(botRow.id).catch(() => []), playerWeek(botRow.id, uid), prizesOf(uid).catch(() => []),
      ]);
      const standing = await slotStanding(botRow.id, uid, sponsor ? { starts_at: sponsor.starts_at, ends_at: sponsor.ends_at } : null).catch(() => null);
      return {
        ok: true, bot: username,
        sponsor: sponsor ? { name: sponsor.name, url: sponsor.url, prize: sponsor.prize, endsAt: sponsor.ends_at.toISOString() } : null,
        groups: groups.slice(0, 10).map((g, i) => ({ rank: i + 1, title: g.username ? g.title || "جروب" : "جروب خاص", username: g.username, points: Number(g.points), players: Number(g.players) })),
        week, standing, prizes,
        rules: { roundSize: ROUND_SIZE, correct: POINTS_CORRECT, first: POINTS_CORRECT + FIRST_BONUS, minPoints: MIN_POINTS, minRounds: MIN_ROUNDS, claimDays: CLAIM_DAYS, sponsorPrice: SPONSOR_PRODUCTS.contest.price, sponsorDays: SPONSOR_PRODUCTS.contest.days, tgPrize: TG_PRIZE_TEXT, premiumStars: PREMIUM_STARS },
      };
    }
    case "ct_claim": {
      if (!rateLimit(`sapp-cc:${uid}`, 5, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      // Hands over only THIS user's undelivered prizes, into this user's own chat (same as /start prize).
      await claimPrizes(bot, Number(uid), uid);
      return { ok: true, prizes: await prizesOf(uid) };
    }
    case "ct_sponsor": {
      if (!rateLimit(`sapp-cs:${uid}`, 5, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await createSponsorOrder({ product: "contest", name: String(body?.name || ""), url: String(body?.url || ""), contact: String(body?.contact || ""), prizeMode: body?.prizeMode === "TG" ? "TG" : "VOUCHER", prize: String(body?.prize || ""), prizeSecret: String(body?.prizeSecret || "") });
      return r.ok ? { ok: true, code: r.code, price: r.price } : fail(r.error);
    }
    case "ct_pay": {
      const method = ["stars", "nowpayments", "usdt"].includes(body?.method) ? body.method : "stars";
      const r: any = await paySponsor(String(body?.code || "").toUpperCase(), method);
      if (!r.ok) return fail(r.error);
      if (method === "usdt") return { ok: true, manual: true, amount: r.amount, address: r.usdt, network: r.network, expiresInMin: r.expiresInMin, note: r.note };
      return { ok: true, url: r.invoiceUrl };
    }
    case "ct_sponsor_status": {
      const code = String(body?.code || "").toUpperCase();
      const s = await sponsorByCode(code);
      if (!s || s.product !== "contest") return fail("الكود غير موجود.");
      if (s.status === "PENDING_PAYMENT" && body?.check) await checkSponsorUsdt(code).catch(() => null);
      const fresh = (await sponsorByCode(code))!;
      return { ok: true, sponsor: { code, name: fresh.name, status: fresh.status, price: fresh.price, prizeMode: fresh.prize_mode, prize: fresh.prize, startsAt: fresh.starts_at?.toISOString() || null, endsAt: fresh.ends_at?.toISOString() || null, settled: !!fresh.settled_at }, winners: fresh.settled_at ? await sponsorPrizes(code).catch(() => []) : [] };
    }
  }
  return fail("طلب غير معروف.");
}
