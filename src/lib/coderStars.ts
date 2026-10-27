// Paying for a coder plan with Telegram Stars (XTR) — zero cost to run: no payment provider, Telegram handles the purchase.
//   1. Mini App → appOp("buy") → createInvoiceLink (currency XTR, provider_token "") → the app opens it with invoice.openUrl
//   2. Telegram → pre_checkout_query → preCheckoutCoder(): the payload is HMAC-signed and bound to the buyer, the plan and the price
//   3. Telegram → message.successful_payment → recordCoderPayment(): stored once per charge id (coder_payments), the subscription is
//      activated / extended server-side (coder_subscriptions), and the user gets a confirmation.
// The owner sets each plan's Stars price and period in the Mini App (Billing → owner pricing).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Bot as TelegramBot } from "grammy";
import { coderChatKey, prismaDb, type Db } from "@/lib/coderAuth";
import { getSubscription, listPlans, setSubscription, type Plan } from "@/lib/coderPlans";

const key = () => process.env.CODER_TOKEN_KEY || process.env.CRON_SECRET || process.env.SUPER_ADMIN_TELEGRAM_ID || "coder-stars";
const sig = (body: string) => createHmac("sha256", key()).update(`stars|${body}`).digest("hex").slice(0, 16);

export function starsPayload(chatId: number, plan: Plan, nonce = randomBytes(4).toString("hex")): string {
  const body = `cplan:${plan.id}:${plan.days ?? 30}:${plan.price_stars}:${chatId}:${nonce}`;
  return `${body}:${sig(body)}`;
}
export type ParsedPayload = { planId: string; days: number; stars: number; chatId: number };
export function parseStarsPayload(payload: string): ParsedPayload | null {
  const p = String(payload || "").split(":");
  if (p.length !== 7 || p[0] !== "cplan") return null;
  const body = p.slice(0, 6).join(":");
  const a = Buffer.from(sig(body));
  const b = Buffer.from(p[6]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const out = { planId: p[1], days: Number(p[2]), stars: Number(p[3]), chatId: Number(p[4]) };
  return Number.isSafeInteger(out.chatId) && out.days > 0 && out.stars > 0 ? out : null;
}
export const isCoderPayload = (payload: unknown) => String(payload || "").startsWith("cplan:");

/** A Stars invoice link for one plan (null when the plan is not on sale). */
export async function createPlanInvoice(bot: TelegramBot, chatId: number, planId: string, db: Db = prismaDb): Promise<string> {
  const plan = (await listPlans(db)).find((p) => p.id === planId);
  if (!plan || !plan.active || plan.id === "free" || !plan.price_stars || plan.price_stars <= 0) throw new Error("هذه الخطة غير متاحة للشراء الآن.");
  const days = plan.days ?? 30;
  return bot.api.createInvoiceLink(
    `خطة ${plan.name.ar} — ${days} يوماً`.slice(0, 32),
    `اشتراك Nova AI في خطة «${plan.name.ar}» لمدة ${days} يوماً. يُفعَّل فور الدفع.`.slice(0, 255),
    starsPayload(chatId, plan),
    "",
    "XTR",
    [{ label: `${plan.name.ar} · ${days}d`, amount: plan.price_stars }],
  );
}

/** pre_checkout_query for a coder plan: the signed payload, the buyer, the plan still on sale at the same price. */
export async function preCheckoutCoder(q: { from?: { id?: number }; currency?: string; total_amount?: number; invoice_payload?: string }, db: Db = prismaDb): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = parseStarsPayload(String(q.invoice_payload || ""));
  if (!p || q.currency !== "XTR" || Number(q.from?.id) !== p.chatId) return { ok: false, message: "رابط الدفع غير صالح. افتح الاشتراك من التطبيق من جديد." };
  const plan = (await listPlans(db)).find((x) => x.id === p.planId);
  if (!plan || !plan.active || plan.price_stars !== p.stars || Number(q.total_amount) !== p.stars) return { ok: false, message: "تغيّر سعر الخطة. افتح الاشتراك من التطبيق من جديد." };
  return { ok: true };
}

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();   // `ddl: true` = a real SQL engine in tests
  if (!ready) {
    ready = db.exec(`CREATE TABLE IF NOT EXISTS coder_payments (charge_id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, plan_id TEXT NOT NULL, stars INT NOT NULL, days INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** successful_payment: record once (charge id), then activate or extend the plan. Returns the new end date, or null if ignored. */
export async function recordCoderPayment(chatId: number, sp: { currency?: string; total_amount?: number; invoice_payload?: string; telegram_payment_charge_id?: string }, db: Db = prismaDb, now = Date.now()): Promise<{ plan: Plan; until: string | null; duplicate: boolean } | null> {
  const p = parseStarsPayload(String(sp.invoice_payload || ""));
  if (!p || p.chatId !== chatId || sp.currency !== "XTR" || !sp.telegram_payment_charge_id) return null;
  const plan = (await listPlans(db)).find((x) => x.id === p.planId);
  if (!plan) return null;
  await ensureTable(db);
  const fresh = await db.query<{ charge_id: string }>(
    `INSERT INTO coder_payments (charge_id, chat_key, plan_id, stars, days) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (charge_id) DO NOTHING RETURNING charge_id`,
    sp.telegram_payment_charge_id, coderChatKey(chatId), plan.id, Number(sp.total_amount) || p.stars, p.days,
  );
  if (!fresh.length) return { plan, until: null, duplicate: true };
  // same plan still running: the new period starts where the current one ends
  const cur = await getSubscription(chatId, db);
  const end = cur.plan_id === plan.id && cur.period_end ? Date.parse(String(cur.period_end).replace(" ", "T").replace(/\+00$/, "Z")) : 0;
  const carry = end > now ? Math.ceil((end - now) / 86400000) : 0;
  const days = p.days + carry;
  await setSubscription(chatId, plan.id, days, "telegram-stars", db);
  return { plan, until: new Date(now + days * 86400000).toISOString(), duplicate: false };
}

/** The bot side of a successful payment message. */
export async function handleCoderPaymentMessage(bot: TelegramBot, msg: any, db: Db = prismaDb): Promise<boolean> {
  const sp = msg?.successful_payment;
  if (!sp || !isCoderPayload(sp.invoice_payload)) return false;
  const chatId = Number(msg.chat?.id);
  const r = await recordCoderPayment(chatId, sp, db).catch(() => null);
  const text = !r
    ? "وصل الدفع، لكن تعذّر تفعيل الخطة تلقائياً. سنراجع ذلك ونفعّلها لك؛ لن تخسر شيئاً."
    : r.duplicate ? "✅ هذا الدفع مسجّل مسبقاً، وخطتك فعّالة."
    : `🎉 شكراً لك! فُعّلت خطة «${r.plan.name.ar}»${r.until ? ` حتى ${new Intl.DateTimeFormat("ar-SY", { day: "numeric", month: "long", year: "numeric" }).format(new Date(r.until))}` : ""}.`;
  await bot.api.sendMessage(chatId, text).catch(() => null);
  if (!r) {
    const owner = process.env.SUPER_ADMIN_TELEGRAM_ID;
    if (owner) await bot.api.sendMessage(Number(owner), `⚠️ دفعة نجوم لخطة Nova AI لم تُفعَّل تلقائياً (المستخدم ${chatId}، ${sp.total_amount} XTR، المعرّف ${String(sp.telegram_payment_charge_id || "").slice(0, 40)}).`).catch(() => null);
  }
  return true;
}
