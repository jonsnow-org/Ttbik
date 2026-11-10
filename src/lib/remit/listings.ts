/**
 * Self-serve listings for money-transfer companies and agents on /remit (owner, 2026-11-10). The company applies itself, the owner taps
 * ✅ once in Telegram (or nothing at all if REMIT_AUTO_APPROVE=1), the company pays and the listing goes live by itself, expires by itself
 * and is reminded to renew. The owner needs no account at any transfer company and no KYC: the company pays the platform for visibility.
 * The site stays information only: it never receives, holds or moves anyone's transfer money; it shows the company's own link/contact.
 * Own tables, created on first use.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/siteUrl";
import { gateUrl } from "@/lib/hostingOps";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { adStars, bindSiteBot, findSiteBot, siteAdStarsEnabled } from "@/lib/siteAds";
import { openPayers, usdtCheck, usdtQuote } from "@/lib/payments/usdtOrders";

export const REMIT_PREFIX = "RMT-";
export const REMIT_STARS_PREFIX = "RMT:";
export type Plan = "BASIC" | "FEATURED";
export const PLANS: Record<Plan, { price: number; days: number; title: string; what: string }> = {
  BASIC: { price: 10, days: 30, title: "إدراج شركة تحويل", what: "اسمك ورابطك وبلدان التحويل في صفحة الحوالات لمدة 30 يوماً، مع عدّاد النقرات" },
  FEATURED: { price: 25, days: 30, title: "إدراج مميّز لشركة تحويل", what: "أعلى صفحة الحوالات بشارة ⭐ مميّز لمدة 30 يوماً، مع عدّاد النقرات" },
};
export const REMIND_DAYS = 3;
export const CODE_RE = /^RMT-[0-9A-F]{8}$/;

let ready: Promise<void> | null = null;
export function ensureRemitTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS remit_listings (code TEXT PRIMARY KEY, secret TEXT NOT NULL, name TEXT NOT NULL, country TEXT NOT NULL, license TEXT NOT NULL, corridors TEXT, url TEXT, contact TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'BASIC', price NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_REVIEW', paid_via TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, clicks INT NOT NULL DEFAULT 0, chat_id TEXT, reminded_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ)`,
        `CREATE TABLE IF NOT EXISTS remit_payments (ref TEXT PRIMARY KEY, code TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        `CREATE TABLE IF NOT EXISTS remit_clicks (code TEXT NOT NULL, day DATE NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (code, day))`,
      ];
      for (const q of ddl) await prisma.$executeRawUnsafe(q);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const clean = (s: unknown, max: number) => String(s ?? "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const contactOk = (s: string) => /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s.trim());
const isPlan = (p: unknown): p is Plan => p === "BASIC" || p === "FEATURED";

export type ApplyInput = { name: string; country: string; license: string; corridors?: string; url?: string; contact: string; plan?: string; agree?: boolean };
/** Validates an application. Pure. */
export function validateApplication(i: ApplyInput): { ok: true; v: { name: string; country: string; license: string; corridors: string; url: string; contact: string; plan: Plan } } | { ok: false; error: string } {
  const name = clean(i.name, 60), country = clean(i.country, 40), license = clean(i.license, 120), corridors = clean(i.corridors, 120);
  const url = String(i.url || "").trim();
  if (name.length < 2) return { ok: false, error: "اكتب اسم الشركة أو المكتب." };
  if (country.length < 2) return { ok: false, error: "اكتب بلد الترخيص." };
  if (license.length < 3) return { ok: false, error: "اكتب جهة الترخيص ورقمه (مثال: مصرف سوريا المركزي، ترخيص رقم …)." };
  if (url && !/^https:\/\/[^\s<>"]{3,200}$/i.test(url)) return { ok: false, error: "الرابط يجب أن يبدأ بـ https://" };
  if (!contactOk(i.contact)) return { ok: false, error: "اكتب معرّف تيليجرام للتواصل (@username)." };
  if (!i.agree) return { ok: false, error: "يجب الإقرار بأن الشركة مرخّصة وأن المعلومات صحيحة." };
  return { ok: true, v: { name, country, license, corridors, url, contact: i.contact.trim().replace(/^@?/, "@"), plan: isPlan(i.plan) ? i.plan : "BASIC" } };
}

export const autoApprove = (env: Record<string, string | undefined> = process.env) => env.REMIT_AUTO_APPROVE === "1";
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || gateUrl() || SITE_URL).replace(/\/$/, "");
export const listingUrl = (code: string, secret: string) => `${SITE_URL}/remit/listing/${code}?k=${secret}`;

async function siteBotCall(method: string, body: unknown) {
  const bot = await findSiteBot().catch(() => null);
  if (!bot) return null;
  const r = await fetch(`https://api.telegram.org/bot${bot.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return r?.json().catch(() => null);
}
async function notifyOwner(text: string, buttons?: { text: string; callback_data: string }[][]) {
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (admin) await siteBotCall("sendMessage", { chat_id: admin, text, reply_markup: buttons ? { inline_keyboard: buttons } : undefined, link_preview_options: { is_disabled: true } });
}
async function notifyCompany(code: string, text: string) {
  const r = (await prisma.$queryRaw<{ chat_id: string | null }[]>`SELECT chat_id FROM remit_listings WHERE code = ${code}`)[0];
  if (r?.chat_id) await siteBotCall("sendMessage", { chat_id: r.chat_id, text, link_preview_options: { is_disabled: true } });
}

export async function applyListing(input: ApplyInput) {
  const c = validateApplication(input);
  if (!c.ok) return c;
  await ensureRemitTables();
  const v = c.v;
  const dup = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM remit_listings WHERE lower(name) = lower(${v.name}) AND status IN ('PENDING_REVIEW','APPROVED','ACTIVE')`;
  if (Number(dup[0]?.n || 0) > 0) return { ok: false as const, error: "هذه الشركة مسجّلة أو قيد المراجعة. استخدم رابط متابعتها." };
  const code = `${REMIT_PREFIX}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const secret = crypto.randomBytes(12).toString("hex");
  const status = autoApprove() ? "APPROVED" : "PENDING_REVIEW";
  await prisma.$executeRaw`INSERT INTO remit_listings (code, secret, name, country, license, corridors, url, contact, plan, price, status, reviewed_at)
    VALUES (${code}, ${secret}, ${v.name}, ${v.country}, ${v.license}, ${v.corridors || null}, ${v.url || null}, ${v.contact}, ${v.plan}, ${PLANS[v.plan].price}, ${status}, ${status === "APPROVED" ? new Date() : null})`;
  const summary = `🏦 طلب إدراج في صفحة الحوالات (${code})\n${v.name} · ${v.country}\nالترخيص: ${v.license}\nالتحويل: ${v.corridors || "—"}\nالرابط: ${v.url || "—"} · ${v.contact}\nالباقة: ${v.plan} (${PLANS[v.plan].price}$)`;
  if (status === "PENDING_REVIEW") await notifyOwner(`${summary}\n\nبضغطة واحدة: الموافقة تتيح للشركة الدفع، ثم تظهر تلقائياً.`, [[{ text: "✅ موافقة", callback_data: `rmt_ok:${code}` }, { text: "❌ رفض", callback_data: `rmt_no:${code}` }]]);
  else await notifyOwner(`${summary}\n\n(موافقة تلقائية مفعّلة REMIT_AUTO_APPROVE=1)`, [[{ text: "⛔ إيقاف", callback_data: `rmt_no:${code}` }]]);
  return { ok: true as const, code, secret, status, link: listingUrl(code, secret) };
}

type Row = { code: string; secret: string; name: string; country: string; license: string; corridors: string | null; url: string | null; contact: string; plan: Plan; price: unknown; status: string; paid_via: string | null; starts_at: Date | null; ends_at: Date | null; clicks: number; chat_id: string | null; created_at: Date };
export async function listingByCode(code: string): Promise<(Omit<Row, "price"> & { price: number }) | null> {
  if (!CODE_RE.test(code)) return null;
  await ensureRemitTables();
  const r = (await prisma.$queryRaw<Row[]>`SELECT * FROM remit_listings WHERE code = ${code}`)[0];
  return r ? { ...r, price: Number(r.price), plan: isPlan(r.plan) ? r.plan : "BASIC" } : null;
}
/** Constant-time check of the private dashboard key. */
export function secretOk(row: { secret: string } | null, k: string): boolean {
  if (!row || !k) return false;
  const a = Buffer.from(row.secret), b = Buffer.from(String(k));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The owner's one tap. */
export async function reviewListing(code: string, approve: boolean): Promise<{ ok: boolean; text: string }> {
  const l = await listingByCode(code);
  if (!l) return { ok: false, text: "غير موجود" };
  if (approve) {
    const n = await prisma.$executeRaw`UPDATE remit_listings SET status = 'APPROVED', reviewed_at = now() WHERE code = ${code} AND status = 'PENDING_REVIEW'`;
    if (n === 1) await notifyCompany(code, `✅ قُبل طلب إدراج «${l.name}». ادفع من صفحة المتابعة ليظهر فوراً:\n${listingUrl(code, l.secret)}`);
    return { ok: n === 1, text: n === 1 ? "تمت الموافقة: الشركة تدفع وتظهر تلقائياً" : "عولج مسبقاً" };
  }
  const n = await prisma.$executeRaw`UPDATE remit_listings SET status = 'REJECTED', reviewed_at = now(), ends_at = LEAST(COALESCE(ends_at, now()), now()) WHERE code = ${code} AND status IN ('PENDING_REVIEW','APPROVED','ACTIVE')`;
  return { ok: n === 1, text: n === 1 ? "رُفض / أُوقف" : "عولج مسبقاً" };
}

/** Paid → live for the plan's days, extending from the current end when renewing early. Idempotent per payment reference. */
export async function markListingPaid(code: string, via: string, amountUsd?: number, db: { $executeRaw: typeof prisma.$executeRaw } = prisma): Promise<{ ok: boolean; first: boolean }> {
  const l = await listingByCode(code);
  if (!l || !["APPROVED", "ACTIVE", "EXPIRED"].includes(l.status)) return { ok: false, first: false };
  if (amountUsd != null && Number.isFinite(amountUsd) && amountUsd + 0.01 < l.price) return { ok: false, first: false };
  const ref = via.slice(0, 120);
  // each payment (Stars charge, NOWPayments order, on-chain hash) extends the listing exactly once
  const fresh = await db.$executeRaw`INSERT INTO remit_payments (ref, code) VALUES (${ref}, ${code}) ON CONFLICT (ref) DO NOTHING`;
  if (fresh !== 1) return { ok: true, first: false };
  const days = PLANS[l.plan].days;
  const n = await db.$executeRaw`
    UPDATE remit_listings SET status = 'ACTIVE', paid_via = ${ref}, reminded_at = NULL,
      starts_at = CASE WHEN status = 'ACTIVE' AND ends_at > now() THEN starts_at ELSE now() END,
      ends_at = CASE WHEN status = 'ACTIVE' AND ends_at > now() THEN ends_at ELSE now() END + make_interval(days => ${days})
    WHERE code = ${code} AND status IN ('APPROVED','ACTIVE','EXPIRED')`;
  if (n === 1) {
    await notifyOwner(`💵 إدراج مدفوع تلقائياً: ${l.name} · ${l.price}$ · ${code} · ${ref}`);
    await notifyCompany(code, `✅ وصل الدفع. «${l.name}» ظاهر الآن في ${SITE_URL}/remit لمدة ${days} يوماً.`);
  }
  return { ok: true, first: n === 1 };
}

export async function payListing(code: string, k: string, method: "usdt" | "nowpayments" | "stars") {
  const l = await listingByCode(code);
  if (!l || !secretOk(l, k)) return { ok: false as const, error: "الرابط غير صحيح." };
  if (!["APPROVED", "ACTIVE", "EXPIRED"].includes(l.status)) return { ok: false as const, error: l.status === "PENDING_REVIEW" ? "الطلب قيد المراجعة. يصلك إشعار فور الموافقة." : "الطلب غير متاح للدفع." };
  const conf = PLANS[l.plan];
  if (method === "usdt") {
    const q = await usdtQuote(`remit:${code}`, l.price);
    if (!q.ok) return { ok: false as const, error: q.error };
    return { ...q, note: `حوّل ${q.amount} USDT بالضبط على شبكة TRC20 خلال ${q.expiresInMin} دقيقة. يتفعّل الإدراج تلقائياً عند وصول التحويل.` };
  }
  if (method === "stars") {
    if (!siteAdStarsEnabled()) return { ok: false as const, error: "الدفع بالنجوم غير مفعّل بعد." };
    const bot = await findSiteBot();
    if (!bot) return { ok: false as const, error: "بوت الدفع غير متاح." };
    await bindSiteBot().catch(() => null);
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/createInvoiceLink`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: conf.title, description: `${conf.what}: ${l.name} (${code})`.slice(0, 255), payload: `${REMIT_STARS_PREFIX}${code}`, currency: "XTR", prices: [{ label: code, amount: adStars(l.price) }] }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    return data?.ok && data.result ? { ok: true as const, invoiceUrl: String(data.result) } : { ok: false as const, error: "تعذّر إنشاء فاتورة النجوم." };
  }
  if (!isNowPaymentsConfigured()) return { ok: false as const, error: "فاتورة العملات غير مفعّلة. اختر USDT." };
  const back = listingUrl(code, l.secret);
  // a fresh order id per invoice so a renewal is a new payment (the IPN strips the suffix)
  const r = await createInvoice({ priceAmount: l.price, orderId: `${code}-${Date.now().toString(36).toUpperCase()}`, orderDescription: `Sham AI remittance listing ${code}`, ipnCallbackUrl: `${site()}/api/ads/ipn`, successUrl: back, cancelUrl: back });
  return r.ok ? { ok: true as const, invoiceUrl: r.invoiceUrl } : { ok: false as const, error: r.error || "تعذّر إنشاء الفاتورة" };
}

export async function checkListingUsdt(code: string): Promise<boolean> {
  const r = await usdtCheck(`remit:${code}`, async (tx, p) => {
    const m = await markListingPaid(code, `USDT TRC20 ${p.hash.slice(0, 16)}`, p.usd, tx);
    if (!m.first) throw new Error("not payable");
  });
  return r.paid;
}

/** Live listings for /remit: featured first, then newest. */
export async function activeListings() {
  await ensureRemitTables();
  return prisma.$queryRaw<{ code: string; name: string; country: string; license: string; corridors: string | null; url: string | null; contact: string; plan: string; ends_at: Date }[]>`
    SELECT code, name, country, license, corridors, url, contact, plan, ends_at FROM remit_listings WHERE status = 'ACTIVE' AND ends_at > now() ORDER BY (plan = 'FEATURED') DESC, starts_at DESC LIMIT 50`;
}

/** Counts a click (per day) and returns where to send the visitor. */
export async function clickTarget(code: string, count = true): Promise<string | null> {
  if (!CODE_RE.test(code)) return null;
  await ensureRemitTables();
  const r = (await prisma.$queryRaw<{ url: string | null; contact: string }[]>`SELECT url, contact FROM remit_listings WHERE code = ${code} AND status = 'ACTIVE' AND ends_at > now()`)[0];
  if (!r) return null;
  if (!count) return r.url || `https://t.me/${r.contact.replace(/^@/, "")}`;
  await prisma.$executeRaw`UPDATE remit_listings SET clicks = clicks + 1 WHERE code = ${code}`;
  await prisma.$executeRaw`INSERT INTO remit_clicks (code, day, n) VALUES (${code}, CURRENT_DATE, 1) ON CONFLICT (code, day) DO UPDATE SET n = remit_clicks.n + 1`;
  return r.url || `https://t.me/${r.contact.replace(/^@/, "")}`;
}
export async function clicksByDay(code: string) {
  await ensureRemitTables();
  return prisma.$queryRaw<{ day: Date; n: number }[]>`SELECT day, n FROM remit_clicks WHERE code = ${code} AND day > CURRENT_DATE - 30 ORDER BY day DESC`;
}

/** Site bot /start rmt_<code>_<secret>: links the company's chat for approval, payment and renewal messages. */
export async function linkCompanyChat(payload: string, chatId: string): Promise<string | null> {
  const m = /^rmt_(RMT-[0-9A-F]{8})_([0-9a-f]{24})$/.exec(payload);
  if (!m) return null;
  const l = await listingByCode(m[1]);
  if (!l || !secretOk(l, m[2])) return "الرابط غير صحيح.";
  await prisma.$executeRaw`UPDATE remit_listings SET chat_id = ${chatId} WHERE code = ${l.code}`;
  return `✅ ربطنا «${l.name}» بهذه المحادثة: تصلك هنا الموافقة وتأكيد الدفع وتذكير التجديد قبل ${REMIND_DAYS} أيام من الانتهاء.\nصفحة المتابعة: ${listingUrl(l.code, l.secret)}`;
}

/** Scheduled: USDT sweep, expiry, renewal reminders. */
export async function remitSweep(): Promise<{ paid: number; expired: number; reminded: number }> {
  await ensureRemitTables();
  let paid = 0;
  for (const ref of await openPayers("remit:")) if (await checkListingUsdt(ref.slice("remit:".length)).catch(() => false)) paid++;
  const expired = await prisma.$queryRaw<{ code: string; name: string; secret: string }[]>`UPDATE remit_listings SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND ends_at <= now() RETURNING code, name, secret`;
  for (const e of expired) await notifyCompany(e.code, `⌛ انتهى إدراج «${e.name}» في صفحة الحوالات. جدّد بضغطة ليرجع فوراً:\n${listingUrl(e.code, e.secret)}`);
  const due = await prisma.$queryRaw<{ code: string; name: string; secret: string; ends_at: Date }[]>`
    UPDATE remit_listings SET reminded_at = now() WHERE status = 'ACTIVE' AND reminded_at IS NULL AND ends_at <= now() + make_interval(days => ${REMIND_DAYS}) RETURNING code, name, secret, ends_at`;
  for (const d of due) await notifyCompany(d.code, `⏰ إدراج «${d.name}» ينتهي ${d.ends_at.toISOString().slice(0, 10)}. جدّد الآن (تُضاف المدة لنهاية الحالية):\n${listingUrl(d.code, d.secret)}`);
  return { paid, expired: expired.length, reminded: due.length };
}

export async function adminListings() {
  await ensureRemitTables();
  return prisma.$queryRaw<{ code: string; name: string; status: string; plan: string; clicks: number; ends_at: Date | null }[]>`SELECT code, name, status, plan, clicks, ends_at FROM remit_listings ORDER BY created_at DESC LIMIT 100`;
}
