// "Gift a plan" (the idea behind Mira's "gift Pro"): a user pays a plan in Telegram Stars for SOMEONE ELSE.
//   /gift -> a native "choose a user" button (KeyboardButtonRequestUsers, request_id GIFT_REQ) -> users_shared -> plan buttons (gift|<plan>|<recipient>)
//   -> a Stars invoice paid by the giver, payload `cgift:` HMAC-signed and bound to giver, recipient, plan and price
//   -> pre_checkout_query (preCheckoutGift) -> successful_payment (recordGiftPayment): stored once per charge id, the RECIPIENT's plan is activated / extended,
//   both sides are told. The recipient does not need to have opened the bot: the plan is waiting for them on their Telegram id.
// Nothing here touches anyone's data except the recipient's subscription row (one row per user, the same one a normal purchase writes).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Bot as TelegramBot } from "grammy";
import { coderChatKey, prismaDb, type Db } from "@/lib/coderAuth";
import { getSubscription, listPlans, setSubscription, type Plan } from "@/lib/coderPlans";

export const GIFT_REQ = 7701;
const key = () => process.env.CODER_TOKEN_KEY || process.env.CRON_SECRET || process.env.SUPER_ADMIN_TELEGRAM_ID || "coder-stars";
const sig = (body: string) => createHmac("sha256", key()).update(`gift|${body}`).digest("hex").slice(0, 16);

export function giftPayload(buyer: number, recipient: number, plan: Plan, nonce = randomBytes(3).toString("hex")): string {
  const body = `cgift:${plan.id}:${plan.days ?? 30}:${plan.price_stars}:${buyer}:${recipient}:${nonce}`;
  return `${body}:${sig(body)}`;
}
export type ParsedGift = { planId: string; days: number; stars: number; buyer: number; recipient: number };
export function parseGiftPayload(payload: string): ParsedGift | null {
  const p = String(payload || "").split(":");
  if (p.length !== 8 || p[0] !== "cgift") return null;
  const body = p.slice(0, 7).join(":");
  const a = Buffer.from(sig(body));
  const b = Buffer.from(p[7]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const out = { planId: p[1], days: Number(p[2]), stars: Number(p[3]), buyer: Number(p[4]), recipient: Number(p[5]) };
  return Number.isSafeInteger(out.buyer) && Number.isSafeInteger(out.recipient) && out.buyer !== out.recipient && out.days > 0 && out.stars > 0 ? out : null;
}
export const isGiftPayload = (payload: unknown) => String(payload || "").startsWith("cgift:");

const onSale = (p: Plan | undefined): p is Plan => Boolean(p && p.active && p.id !== "free" && p.price_stars && p.price_stars > 0);
export async function giftablePlans(db: Db = prismaDb): Promise<Plan[]> { return (await listPlans(db)).filter(onSale); }

export async function createGiftInvoice(bot: TelegramBot, buyer: number, recipient: number, planId: string, db: Db = prismaDb): Promise<{ title: string; description: string; payload: string; stars: number }> {
  if (buyer === recipient) throw new Error("لا يمكن إهداء خطة لنفسك؛ اشترها من التطبيق مباشرة.");
  const plan = (await listPlans(db)).find((p) => p.id === planId);
  if (!onSale(plan)) throw new Error("هذه الخطة غير متاحة للإهداء الآن.");
  const days = plan.days ?? 30;
  return { title: `🎁 هدية: ${plan.name.ar} — ${days} يومًا`.slice(0, 32), description: `إهداء خطة «${plan.name.ar}» لمدة ${days} يومًا لمستخدم آخر. تُفعَّل له فور الدفع.`.slice(0, 255), payload: giftPayload(buyer, recipient, plan), stars: plan.price_stars as number };
}

export async function preCheckoutGift(q: { from?: { id?: number }; currency?: string; total_amount?: number; invoice_payload?: string }, db: Db = prismaDb): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = parseGiftPayload(String(q.invoice_payload || ""));
  if (!p || q.currency !== "XTR" || Number(q.from?.id) !== p.buyer) return { ok: false, message: "رابط الهدية غير صالح. ابدأ من جديد بالأمر /gift." };
  const plan = (await listPlans(db)).find((x) => x.id === p.planId);
  if (!onSale(plan) || plan.price_stars !== p.stars || Number(q.total_amount) !== p.stars) return { ok: false, message: "تغيّر سعر الخطة. ابدأ من جديد بالأمر /gift." };
  return { ok: true };
}

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();
  if (!ready) {
    ready = db.exec(`CREATE TABLE IF NOT EXISTS coder_payments (charge_id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, plan_id TEXT NOT NULL, stars INT NOT NULL, days INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** successful_payment of a gift: once per charge id, the RECIPIENT's plan is activated or extended. */
export async function recordGiftPayment(payer: number, sp: { currency?: string; total_amount?: number; invoice_payload?: string; telegram_payment_charge_id?: string }, db: Db = prismaDb, now = Date.now()): Promise<{ plan: Plan; recipient: number; until: string | null; duplicate: boolean } | null> {
  const p = parseGiftPayload(String(sp.invoice_payload || ""));
  if (!p || p.buyer !== payer || sp.currency !== "XTR" || !sp.telegram_payment_charge_id) return null;
  const plan = (await listPlans(db)).find((x) => x.id === p.planId);
  if (!plan) return null;
  await ensureTable(db);
  const fresh = await db.query<{ charge_id: string }>(
    `INSERT INTO coder_payments (charge_id, chat_key, plan_id, stars, days) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (charge_id) DO NOTHING RETURNING charge_id`,
    sp.telegram_payment_charge_id, coderChatKey(p.recipient), plan.id, Number(sp.total_amount) || p.stars, p.days,
  );
  if (!fresh.length) return { plan, recipient: p.recipient, until: null, duplicate: true };
  const cur = await getSubscription(p.recipient, db);
  const end = cur.plan_id === plan.id && cur.period_end ? Date.parse(String(cur.period_end).replace(" ", "T").replace(/\+00$/, "Z")) : 0;
  const days = p.days + (end > now ? Math.ceil((end - now) / 86400000) : 0);
  await setSubscription(p.recipient, plan.id, days, "telegram-stars-gift", db);
  return { plan, recipient: p.recipient, until: new Date(now + days * 86400000).toISOString(), duplicate: false };
}

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("ar-SY", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)) : "");

/** The bot side: /gift, the shared user, the plan button, the payment. Returns true when the update was a gift step. */
export async function handleGiftUpdate(bot: TelegramBot, update: any, db: Db = prismaDb): Promise<boolean> {
  const msg = update.message;
  const sp = msg?.successful_payment;
  if (sp && isGiftPayload(sp.invoice_payload)) {
    const payer = Number(msg.chat?.id);
    const r = await recordGiftPayment(payer, sp, db).catch(() => null);
    if (!r) {
      await bot.api.sendMessage(payer, "وصل الدفع، لكن تعذّر تفعيل الهدية تلقائيًا. سنراجعها ونفعّلها؛ لن تخسر شيئًا.").catch(() => null);
      const owner = process.env.SUPER_ADMIN_TELEGRAM_ID;
      if (owner) await bot.api.sendMessage(Number(owner), `⚠️ هدية نجوم لم تُفعَّل تلقائيًا (الدافع ${payer}، ${sp.total_amount} XTR، ${String(sp.telegram_payment_charge_id || "").slice(0, 40)}).`).catch(() => null);
      return true;
    }
    if (r.duplicate) { await bot.api.sendMessage(payer, "✅ هذه الهدية مسجّلة مسبقًا.").catch(() => null); return true; }
    const toRecipient = await bot.api.sendMessage(r.recipient, `🎁 وصلتك هدية! فُعّلت لك خطة «${r.plan.name.ar}»${r.until ? ` حتى ${fmt(r.until)}` : ""}.`).then(() => true).catch(() => false);
    await bot.api.sendMessage(payer, `🎉 تم إرسال الهدية: خطة «${r.plan.name.ar}»${r.until ? ` حتى ${fmt(r.until)}` : ""}.${toRecipient ? " وصله إشعار." : " لم يفتح المستلم البوت بعد؛ الخطة محفوظة له وتعمل حين يفتحه."}`).catch(() => null);
    return true;
  }
  const text = typeof msg?.text === "string" ? msg.text.trim() : "";
  if (msg?.chat?.type === "private" && /^\/gift(?:@\w+)?(?:\s|$)/i.test(text)) {
    const plans = await giftablePlans(db).catch(() => []);
    if (!plans.length) { await bot.api.sendMessage(msg.chat.id, "لا توجد خطة متاحة للإهداء الآن.").catch(() => null); return true; }
    await bot.api.sendMessage(msg.chat.id, "🎁 اختر الشخص الذي تريد إهداءه خطة (من جهات اتصالك أو محادثاتك):", {
      reply_markup: { keyboard: [[{ text: "👤 اختيار المستلم", request_users: { request_id: GIFT_REQ, user_is_bot: false, max_quantity: 1 } }]], resize_keyboard: true, one_time_keyboard: true },
    } as never).catch(() => null);
    return true;
  }
  const shared = msg?.users_shared;
  if (shared && Number(shared.request_id) === GIFT_REQ) {
    const recipient = Number(shared.users?.[0]?.user_id ?? shared.user_ids?.[0]);
    const chatId = msg.chat.id;
    if (!Number.isSafeInteger(recipient) || recipient === Number(msg.from?.id ?? chatId)) {
      await bot.api.sendMessage(chatId, "اختر شخصًا آخر غيرك.", { reply_markup: { remove_keyboard: true } } as never).catch(() => null);
      return true;
    }
    const plans = await giftablePlans(db).catch(() => []);
    await bot.api.sendMessage(chatId, "اختر الخطة التي تريد إهداءها:", {
      reply_markup: { inline_keyboard: plans.map((p) => [{ text: `${p.name.ar} · ${p.days ?? 30} يومًا · ${p.price_stars}⭐`, callback_data: `gift|${p.id}|${recipient}` }]) },
    } as never).catch(() => null);
    return true;
  }
  const cq = update.callback_query;
  const data = String(cq?.data || "");
  if (data.startsWith("gift|")) {
    const [, planId, rec] = data.split("|");
    const buyer = Number(cq.from?.id);
    try {
      const inv = await createGiftInvoice(bot, buyer, Number(rec), planId, db);
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      await bot.api.sendInvoice(buyer, inv.title, inv.description, inv.payload, "XTR", [{ label: inv.title, amount: inv.stars }], { provider_token: "" } as never);
    } catch (e) {
      await bot.api.answerCallbackQuery(cq.id, { text: String((e as Error)?.message || e).slice(0, 190), show_alert: true }).catch(() => null);
    }
    return true;
  }
  return false;
}
