// 🤖 «احصل على بوت مشابه» (owner, 2026-11-10): self-serve activation codes for the ad-bot builder, sold in the site bot and in the builder's owner bot
// (config-driven, src/lib/builderOwnerBot.ts; chat flow in src/lib/botSalesChat.ts).
// Two plans, both on the builder's existing split (adBotLogic payoutTask: 50% the user who does the task / 20% the bot's supervisor /
// 30% the platform, then the 5% referral and 5% B2B commissions out of the platform's part):
//   FREE — no payment; the supervisor's cut is 10% instead of 20% and the other 10% goes to the platform (one free code per person).
//   PAID — $20 once (2000⭐); the supervisor keeps the normal 20%.
// Payment: USDT TRC20 straight to the platform wallet (exact-amount match on-chain), NOWPayments, or Stars to the bot. The code is
// minted and sent the moment the payment is confirmed, then redeemed on /bots exactly as the old manual codes (BotPurchase).
// The platform can still mint codes by hand: /code <telegram id> [free|paid].
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const BOT_PAID_USD = 20;
export const NORMAL_CREATOR_PCT = 20;
export const FREE_CREATOR_PCT = 10;
export const BOTBUY_STARS_PREFIX = "BOTBUY:";
export const BOTBUY_USDT_PREFIX = "botbuy:";
export const GETBOT_BUTTON = "🤖 احصل على بوت مشابه";

export const PLANS_TEXT = [
  "🤖 بوت إعلانات وأرباح باسمك، بنفس نظام هذا البوت:",
  "• مستخدمو بوتك يربحون 50% من قيمة كل مهمة ينجزونها، ويمكنهم نشر إعلاناتهم فيه.",
  "• أنت مشرف البوت وتربح عمولة من كل مهمة تُنجز داخله، قابلة للسحب.",
  "",
  `🆓 مجاني: بلا دفع، عمولتك ${FREE_CREATOR_PCT}% من كل مهمة.`,
  `💎 مدفوع: ${BOT_PAID_USD}$ مرة واحدة، عمولتك ${NORMAL_CREATOR_PCT}% من كل مهمة (الضعف).`,
  "",
  "كود التفعيل يصلك هنا تلقائياً، ثم تفعّل بوتك بنفسك خلال دقيقة.",
].join("\n");

/** The supervisor's cut of one task for a bot on a given share (pure; the platform gets the difference). */
export function splitCreatorCut(creatorCut: number, pct: number): { creator: number; toPlatform: number } {
  const p = Math.max(0, Math.min(NORMAL_CREATOR_PCT, pct));
  const creator = (creatorCut * p) / NORMAL_CREATOR_PCT;
  return { creator, toPlatform: creatorCut - creator };
}

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) ready = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS bot_share (bot_id TEXT PRIMARY KEY, creator_pct DOUBLE PRECISION NOT NULL, plan TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}
/** The supervisor's percentage for a bot (20 unless it was activated with a free code). */
export async function creatorPct(botId: string): Promise<number> {
  await ensure();
  const r = await prisma.$queryRaw<{ creator_pct: number }[]>`SELECT creator_pct FROM bot_share WHERE bot_id = ${botId}`;
  return r[0] ? Number(r[0].creator_pct) : NORMAL_CREATOR_PCT;
}
/** Called by /api/bots/deploy after a code is redeemed: a free code (amount 0) sets the free share on the new bot. */
export async function recordBotPlan(botId: string, purchaseAmount: number): Promise<void> {
  await ensure();
  const free = !(purchaseAmount > 0);
  await prisma.$executeRaw`INSERT INTO bot_share (bot_id, creator_pct, plan) VALUES (${botId}, ${free ? FREE_CREATOR_PCT : NORMAL_CREATOR_PCT}, ${free ? "FREE" : "PAID"}) ON CONFLICT (bot_id) DO NOTHING`;
}

function newCode(): string {
  return crypto.randomBytes(6).toString("hex").toUpperCase(); // same shape as the codes minted by hand in adBotLogic
}

export function codeMessage(code: string, buyerId: string, site: string, free: boolean): string {
  return [
    `✅ كود التفعيل الخاص بك (${free ? "مجاني" : "مدفوع"}):`,
    code,
    "",
    "خطوات تفعيل بوتك:",
    "1. أنشئ بوتاً جديداً عبر @BotFather وانسخ التوكن.",
    `2. افتح: ${site.replace(/\/$/, "")}/bots`,
    `3. ضع التوكن، وآيديك (${buyerId})، وكود التفعيل أعلاه.`,
    "4. اضغط «تفعيل البوت»، فيعمل بوتك فوراً وتصبح مشرفه.",
    "",
    `عمولتك: ${free ? FREE_CREATOR_PCT : NORMAL_CREATOR_PCT}% من كل مهمة تُنجز في بوتك.`,
  ].join("\n");
}

/** Mints a free code at once. One free code per person (an unused or redeemed one is returned again). */
export async function freeCode(buyerId: string): Promise<{ code: string; reused: boolean }> {
  const had = await prisma.botPurchase.findFirst({ where: { buyerId, amount: 0, status: { in: ["APPROVED", "REDEEMED"] } }, orderBy: { created_at: "desc" } });
  if (had?.code) return { code: had.code, reused: true };
  const code = newCode();
  await prisma.botPurchase.create({ data: { buyerId, amount: 0, status: "APPROVED", code, transferReference: "free plan" } });
  return { code, reused: false };
}

/** A pending paid order (reused while unpaid). */
export async function paidOrder(buyerId: string): Promise<{ id: string }> {
  const open = await prisma.botPurchase.findFirst({ where: { buyerId, amount: BOT_PAID_USD, status: "PENDING", transferReference: "auto" }, orderBy: { created_at: "desc" } });
  if (open) return { id: open.id };
  const row = await prisma.botPurchase.create({ data: { buyerId, amount: BOT_PAID_USD, status: "PENDING", transferReference: "auto" } });
  return { id: row.id };
}

/** The single "paid" transition: PENDING → APPROVED with a fresh code. `first` is true only once. */
export async function markBotOrderPaid(id: string, via: string, db: any = prisma): Promise<{ first: boolean; code: string | null; buyerId: string | null }> {
  const code = newCode();
  const moved = await db.botPurchase.updateMany({ where: { id, status: "PENDING", transferReference: "auto" }, data: { status: "APPROVED", code, transferReference: `auto paid: ${via}`.slice(0, 180) } });
  const row = await db.botPurchase.findUnique({ where: { id } });
  return { first: moved.count === 1, code: row?.code || null, buyerId: row?.buyerId || null };
}

export async function botOrder(id: string) {
  return prisma.botPurchase.findUnique({ where: { id } }).catch(() => null);
}

/** Manual codes from the platform: /code <telegram id> [free|paid]. Pure parse. */
export function parseCodeCommand(text: string): { buyerId: string; free: boolean } | null {
  const m = /^\/code(?:@\w+)?\s+(\d{5,15})(?:\s+(free|paid|مجاني|مدفوع))?\s*$/i.exec(String(text || "").trim());
  return m ? { buyerId: m[1], free: /^(free|مجاني)$/i.test(m[2] || "") } : null;
}
export async function manualCode(buyerId: string, free: boolean): Promise<string> {
  const code = newCode();
  await prisma.botPurchase.create({ data: { buyerId, amount: free ? 0 : BOT_PAID_USD, status: "APPROVED", code, transferReference: "issued by the platform" } });
  return code;
}

// ---------- USDT (TRC20) ----------
export async function botOrderUsdtQuote(id: string) {
  const { usdtQuote } = await import("@/lib/payments/usdtOrders");
  return usdtQuote(`${BOTBUY_USDT_PREFIX}${id}`, BOT_PAID_USD);
}
export async function checkBotOrderUsdt(id: string): Promise<{ first: boolean; code: string | null; buyerId: string | null }> {
  const row = await botOrder(id);
  if (!row || row.status !== "PENDING") return { first: false, code: row?.code || null, buyerId: row?.buyerId || null };
  const { usdtCheck } = await import("@/lib/payments/usdtOrders");
  let out: { first: boolean; code: string | null; buyerId: string | null } = { first: false, code: null, buyerId: row.buyerId };
  await usdtCheck(`${BOTBUY_USDT_PREFIX}${id}`, async (tx, p) => {
    out = await markBotOrderPaid(id, `USDT TRC20 ${p.hash.slice(0, 16)}`, tx);
    if (!out.first) throw new Error("not pending");
  });
  return out;
}
/** Sweep of every open bot-order USDT quote; `deliver` sends the code to the buyer. */
export async function sweepBotOrdersUsdt(deliver: (buyerId: string, code: string) => Promise<unknown>): Promise<number> {
  const { openPayers } = await import("@/lib/payments/usdtOrders");
  let n = 0;
  for (const ref of await openPayers(BOTBUY_USDT_PREFIX)) {
    const r = await checkBotOrderUsdt(ref.slice(BOTBUY_USDT_PREFIX.length)).catch(() => null);
    if (r?.first && r.code && r.buyerId) { n++; await deliver(r.buyerId, r.code).catch(() => null); }
  }
  return n;
}
