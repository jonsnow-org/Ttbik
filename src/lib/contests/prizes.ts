/**
 * Automatic contest prizes (owner, 2026-11-10: «لا أحب القيام بأشياء يدوية»). When a paid contest sponsor slot ends, the system picks
 * the top players of that slot and delivers the prizes itself; nobody approves or sends anything by hand.
 *
 *  - TG (paid in Stars to the contest bot): 1st gets Telegram Premium for 3 months (1000⭐), 2nd and 3rd a Telegram gift (≤ 50⭐ each),
 *    bought from the bot's own Stars balance (Bot API giftPremiumSubscription / sendGift). The rest of the 1500⭐ stays as the platform's cut.
 *  - VOUCHER (any rail, USDT first): the sponsor funds their own prize (coupon, product, cash); its private part is sent only to the winners.
 *    The platform keeps the whole sponsorship fee.
 * A winner the bot cannot reach yet (never opened it) gets a «🎁 استلم جائزتك» button in the group results: /start prize delivers it.
 * Idempotent: a slot is claimed for settlement once (settled_at), each prize row is unique per (sponsor, rank).
 */
import type { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureKhatmaTables } from "@/lib/khatma/khatma";
import { ensureContestTables } from "@/lib/contests/contests";

export const PRIZE_RANKS = 3;
export const MIN_POINTS = 20; // at least two right answers
export const MIN_ROUNDS = 2; // played in at least two rounds of the slot
export const PREMIUM_STARS = 1000; // Bot API: 3 months = 1000 Stars
export const GIFT_MAX_STARS = 50;
export const CLAIM_DAYS = 30;
export const PRIZE_START = "prize";

let ready: Promise<void> | null = null;
export function ensurePrizeTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureKhatmaTables();
      await ensureContestTables();
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS contest_prizes (id BIGSERIAL PRIMARY KEY, sponsor_code TEXT NOT NULL, rank INT NOT NULL, user_id TEXT NOT NULL, user_name TEXT, points INT NOT NULL DEFAULT 0, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', detail TEXT, stars INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), delivered_at TIMESTAMPTZ, UNIQUE (sponsor_code, rank))`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS contest_prizes_user_idx ON contest_prizes (user_id, status)`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export type Winner = { user_id: string; name: string; points: number; rounds: number };
export type PrizeKind = "PREMIUM3" | "GIFT" | "VOUCHER";

/** Prize per rank for a mode. Pure. */
export function prizeFor(mode: "TG" | "VOUCHER", rank: number): PrizeKind {
  if (mode === "VOUCHER") return "VOUCHER";
  return rank === 1 ? "PREMIUM3" : "GIFT";
}

/** Eligible winners from raw per-player totals: thresholds, then points desc, ties by earlier first answer. Pure. */
export function pickWinners(rows: { user_id: string; name: string | null; points: number; rounds: number; first_at: Date }[], n = PRIZE_RANKS): Winner[] {
  return rows
    .filter((r) => r.points >= MIN_POINTS && r.rounds >= MIN_ROUNDS)
    .sort((a, b) => b.points - a.points || a.first_at.getTime() - b.first_at.getTime())
    .slice(0, n)
    .map((r) => ({ user_id: r.user_id, name: (r.name || "لاعب").slice(0, 24), points: r.points, rounds: r.rounds }));
}

/** The most valuable regular gift the bot may send within the cap (sold-out limited gifts skipped). Pure. */
export function chooseGift(gifts: { id: string; star_count: number; total_count?: number; remaining_count?: number }[], cap = GIFT_MAX_STARS): { id: string; star_count: number } | null {
  const ok = gifts.filter((g) => g.star_count <= cap && (g.total_count == null || (g.remaining_count ?? 0) > 0));
  ok.sort((a, b) => b.star_count - a.star_count);
  return ok[0] ? { id: ok[0].id, star_count: ok[0].star_count } : null;
}

const medal = (r: number) => ["🥇", "🥈", "🥉"][r - 1] || `${r}.`;
const kindLabel = (k: PrizeKind, prize: string | null) => (k === "PREMIUM3" ? "تيليجرام بريميوم 3 أشهر" : k === "GIFT" ? "هدية تيليجرام" : prize || "جائزة الراعي");

async function tg(token: string, method: string, body: unknown): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }).catch(() => null);
  return (await r?.json().catch(() => null)) || { ok: false, description: "network" };
}

async function contestBot() {
  return prisma.bot.findFirst({ where: { template: "STREAK_BOT", isActive: true }, orderBy: { created_at: "asc" } });
}

type SponsorRow = { code: string; name: string; url: string | null; prize: string | null; prize_mode: string; prize_secret: string | null; starts_at: Date; ends_at: Date; contact: string | null };
type PrizeRow = { id: bigint; sponsor_code: string; rank: number; user_id: string; user_name: string | null; kind: PrizeKind; status: string };

/** Tries to hand one prize over right now. SENT on success, CLAIMABLE when the user is not reachable yet, FAILED_FUNDS when Stars ran out. */
async function deliver(token: string, p: PrizeRow, s: SponsorRow): Promise<string> {
  const note = `🏆 جائزة مسابقات الجروبات برعاية ${s.name}`.slice(0, 120);
  if (p.kind === "VOUCHER") {
    const text = `🎉 مبروك! فزت بالمركز ${medal(p.rank)} في مسابقات الجروبات.\n\n🎁 الجائزة: ${s.prize || "جائزة الراعي"}\n🔐 الاستلام: ${s.prize_secret || "تواصل مع الراعي"}\n\nبرعاية ${s.name}${s.url ? ` · ${s.url}` : ""}${s.contact ? ` · ${s.contact}` : ""}`;
    const r = await tg(token, "sendMessage", { chat_id: Number(p.user_id), text, link_preview_options: { is_disabled: true } });
    return r.ok ? "SENT" : "CLAIMABLE";
  }
  const bal = await tg(token, "getMyStarBalance", {});
  const have = Number(bal?.result?.amount ?? NaN);
  if (p.kind === "PREMIUM3") {
    if (Number.isFinite(have) && have < PREMIUM_STARS) return "FAILED_FUNDS";
    const r = await tg(token, "giftPremiumSubscription", { user_id: Number(p.user_id), month_count: 3, star_count: PREMIUM_STARS, text: note });
    if (r.ok) { await prisma.$executeRaw`UPDATE contest_prizes SET stars = ${PREMIUM_STARS} WHERE id = ${p.id}`; return "SENT"; }
    return /not enough|BALANCE_TOO_LOW|STARS/i.test(String(r.description || "")) ? "FAILED_FUNDS" : "CLAIMABLE";
  }
  const gifts = await tg(token, "getAvailableGifts", {});
  const g = chooseGift(Array.isArray(gifts?.result?.gifts) ? gifts.result.gifts : []);
  if (!g) return "FAILED_FUNDS";
  if (Number.isFinite(have) && have < g.star_count) return "FAILED_FUNDS";
  const r = await tg(token, "sendGift", { user_id: Number(p.user_id), gift_id: g.id, text: note });
  if (r.ok) { await prisma.$executeRaw`UPDATE contest_prizes SET stars = ${g.star_count} WHERE id = ${p.id}`; return "SENT"; }
  return /not enough|BALANCE_TOO_LOW|STARS/i.test(String(r.description || "")) ? "FAILED_FUNDS" : "CLAIMABLE";
}

async function setStatus(id: bigint, status: string, detail?: string) {
  await prisma.$executeRaw`UPDATE contest_prizes SET status = ${status}, detail = ${detail || null}, delivered_at = CASE WHEN ${status} IN ('SENT','CLAIMED') THEN now() ELSE delivered_at END WHERE id = ${id}`;
}

/** Settles every contest slot that has ended. Safe to run from several schedulers at once. */
export async function settleDueSponsors(): Promise<{ settled: number; prizes: number }> {
  await ensurePrizeTables();
  const bot = await contestBot();
  if (!bot) return { settled: 0, prizes: 0 };
  const out = { settled: 0, prizes: 0 };
  for (let i = 0; i < 10; i++) {
    const s = (await prisma.$queryRaw<SponsorRow[]>`
      UPDATE khatma_sponsors SET settled_at = now()
      WHERE code = (SELECT code FROM khatma_sponsors WHERE product = 'contest' AND status = 'ACTIVE' AND settled_at IS NULL AND ends_at <= now() ORDER BY ends_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING code, name, url, prize, prize_mode, prize_secret, starts_at, ends_at, contact`)[0];
    if (!s) break;
    out.settled++;
    const rows = await prisma.$queryRaw<{ user_id: string; name: string | null; points: bigint; rounds: bigint; first_at: Date }[]>`
      SELECT a.user_id, max(a.user_name) name, sum(a.points) points, count(DISTINCT a.round_id) rounds, min(a.at) first_at
      FROM contest_answers a JOIN contest_rounds r ON r.id = a.round_id
      WHERE r.bot_id = ${bot.id} AND a.at >= ${s.starts_at} AND a.at < ${s.ends_at}
      GROUP BY a.user_id ORDER BY sum(a.points) DESC LIMIT 50`;
    const winners = pickWinners(rows.map((r) => ({ ...r, points: Number(r.points), rounds: Number(r.rounds) })));
    const mode = s.prize_mode === "TG" ? "TG" : "VOUCHER";
    for (const [i2, w] of winners.entries()) {
      const rank = i2 + 1;
      const p = (await prisma.$queryRaw<PrizeRow[]>`
        INSERT INTO contest_prizes (sponsor_code, rank, user_id, user_name, points, kind) VALUES (${s.code}, ${rank}, ${w.user_id}, ${w.name}, ${w.points}, ${prizeFor(mode, rank)})
        ON CONFLICT (sponsor_code, rank) DO NOTHING RETURNING id, sponsor_code, rank, user_id, user_name, kind, status`)[0];
      if (!p) continue;
      out.prizes++;
      await setStatus(p.id, await deliver(bot.token, p, s).catch(() => "CLAIMABLE"));
    }
    await announce(bot.token, bot.id, s, winners).catch(() => null);
  }
  // unclaimed prizes lapse after CLAIM_DAYS (the Stars stay in the bot's balance)
  await prisma.$executeRaw`UPDATE contest_prizes SET status = 'EXPIRED' WHERE status = 'CLAIMABLE' AND created_at < now() - make_interval(days => ${CLAIM_DAYS})`;
  return out;
}

async function announce(token: string, botId: string, s: SponsorRow, winners: Winner[]) {
  const me = await tg(token, "getMe", {});
  const u = String(me?.result?.username || "");
  const lines = winners.length
    ? winners.map((w, i) => `${medal(i + 1)} ${w.name} · ${w.points} نقطة → ${kindLabel(prizeFor(s.prize_mode === "TG" ? "TG" : "VOUCHER", i + 1), s.prize)}`)
    : [`لم يصل أحد للحد الأدنى (${MIN_POINTS} نقطة في جولتين على الأقل). الجولات مستمرة!`];
  const text = [`🏆 نتائج مسابقة الأسبوع برعاية ${s.name}`, "", ...lines, "", winners.length ? "الجوائز أُرسلت تلقائياً. لم تصلك؟ اضغط الزر 👇" : "", "جولة جديدة: /contest"].filter(Boolean).join("\n");
  const kb = u && winners.length ? { inline_keyboard: [[{ text: "🎁 استلم جائزتك", url: `https://t.me/${u}?start=${PRIZE_START}` }]] } : undefined;
  const chats = await prisma.$queryRaw<{ chat_id: string }[]>`SELECT DISTINCT chat_id FROM contest_rounds WHERE bot_id = ${botId} AND created_at >= ${s.starts_at} AND created_at < ${s.ends_at} LIMIT 30`;
  for (const c of chats) await tg(token, "sendMessage", { chat_id: c.chat_id, text, reply_markup: kb });
  const admin = process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (admin) await tg(token, "sendMessage", { chat_id: admin, text: `ℹ️ (للعلم فقط) سُوّيت رعاية ${s.code}:\n${lines.join("\n")}` });
}

/** /start prize in private chat: hands over every prize of this user that could not be delivered before. */
export async function claimPrizes(bot: TelegramBot, chatId: number, userId: string): Promise<void> {
  await ensurePrizeTables();
  const rows = await prisma.$queryRaw<(PrizeRow & SponsorRow)[]>`
    SELECT p.id, p.sponsor_code, p.rank, p.user_id, p.user_name, p.kind, p.status, s.code, s.name, s.url, s.prize, s.prize_mode, s.prize_secret, s.starts_at, s.ends_at, s.contact
    FROM contest_prizes p JOIN khatma_sponsors s ON s.code = p.sponsor_code WHERE p.user_id = ${userId} AND p.status IN ('CLAIMABLE','FAILED_FUNDS') ORDER BY p.id`;
  const sent = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM contest_prizes WHERE user_id = ${userId} AND status IN ('SENT','CLAIMED')`;
  if (!rows.length) {
    await bot.api.sendMessage(chatId, Number(sent[0]?.n || 0) ? "✅ كل جوائزك وصلتك من قبل. مبروك!" : "لا توجد جائزة باسمك الآن. العب /contest في جروبك وادخل الصدارة 🏆").catch(() => null);
    return;
  }
  const token = bot.token;
  for (const p of rows) {
    const st = await deliver(token, p, p).catch(() => "CLAIMABLE");
    if (st === "SENT") await setStatus(p.id, "CLAIMED");
    else {
      await setStatus(p.id, st);
      await bot.api.sendMessage(chatId, st === "FAILED_FUNDS" ? "⏳ جائزتك محجوزة باسمك، وتُرسل تلقائياً فور توفّر رصيد النجوم. جرّب الزر لاحقاً." : "تعذّر التسليم الآن، حاول بعد قليل.").catch(() => null);
    }
  }
}

/** Retries prizes that waited for Stars (e.g. a payment still settling). */
export async function retryPendingPrizes(): Promise<number> {
  await ensurePrizeTables();
  const bot = await contestBot();
  if (!bot) return 0;
  const rows = await prisma.$queryRaw<(PrizeRow & SponsorRow)[]>`
    SELECT p.id, p.sponsor_code, p.rank, p.user_id, p.user_name, p.kind, p.status, s.code, s.name, s.url, s.prize, s.prize_mode, s.prize_secret, s.starts_at, s.ends_at, s.contact
    FROM contest_prizes p JOIN khatma_sponsors s ON s.code = p.sponsor_code WHERE p.status = 'FAILED_FUNDS' AND p.created_at > now() - make_interval(days => ${CLAIM_DAYS}) ORDER BY p.id LIMIT 20`;
  let n = 0;
  for (const p of rows) {
    const st = await deliver(bot.token, p, p).catch(() => "FAILED_FUNDS");
    if (st !== p.status) await setStatus(p.id, st);
    if (st === "SENT") n++;
  }
  return n;
}

/** Public view for the sponsor's status box. */
export async function sponsorPrizes(code: string) {
  await ensurePrizeTables();
  const r = await prisma.$queryRaw<{ rank: number; user_name: string | null; points: number; kind: string; status: string }[]>`SELECT rank, user_name, points, kind, status FROM contest_prizes WHERE sponsor_code = ${code} ORDER BY rank`;
  return r;
}

