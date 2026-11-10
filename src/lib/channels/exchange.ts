/**
 * «بورصة القنوات» (2026-11-10): free shareable channel audit + ad deals between advertisers and
 * Arabic Telegram channels, paid on the existing rails (Stars through the Admen bot, NOWPayments,
 * USDT confirmed by the admin) and held in escrow by the platform until the post is verified.
 * Escrow is strictly for these ad deals. 85% goes to the channel, 15% is the platform's commission.
 * Own tables (created on first use); no prisma schema change.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { adStars, bindAdmenBot, findAdmenBot, siteAdStarsEnabled } from "@/lib/siteAds";
import { gateUrl } from "@/lib/hostingOps";
import { usdtAddress, usdtNetwork } from "@/lib/usdtWallet";
import {
  BADGE_DAYS, BADGE_PRICE_USD, auditChannel, canMove, makeDealCode, normalizeChannel, parseChannelPage, parsePostLink, postMatchesDeal,
  splitDeal, validDealPrice, type AuditReport,
} from "@/lib/channels/auditRules";

export const CHANNEL_STARS_PREFIX = "CHDEAL:";
const UA = "Mozilla/5.0 (compatible; ShamAI-ChannelAudit/1.0)";
const site = () => (process.env.NEXT_PUBLIC_SITE_URL || gateUrl()).replace(/\/$/, "");

let ready: Promise<void> | null = null;
export function ensureChannelTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS channel_audits (username TEXT PRIMARY KEY, report JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        `CREATE TABLE IF NOT EXISTS channel_listings (username TEXT PRIMARY KEY, title TEXT NOT NULL, owner_contact TEXT NOT NULL, payout_address TEXT NOT NULL, price NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_VERIFY', verify_code TEXT NOT NULL, manage_token TEXT NOT NULL UNIQUE, verified_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        `CREATE TABLE IF NOT EXISTS channel_deals (code TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'AD', channel TEXT NOT NULL, ad_text TEXT, target_url TEXT, advertiser_contact TEXT, price NUMERIC NOT NULL, commission NUMERIC NOT NULL, payout NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT', paid_via TEXT, post_link TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ, posted_at TIMESTAMPTZ, closed_at TIMESTAMPTZ)`,
        `ALTER TABLE channel_listings ADD COLUMN IF NOT EXISTS pending JSONB`,
        `CREATE INDEX IF NOT EXISTS channel_deals_channel_idx ON channel_deals (channel, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS channel_deals_status_idx ON channel_deals (status, created_at DESC)`,
      ];
      for (const q of ddl) await prisma.$executeRawUnsafe(q);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ar,en" }, signal: AbortSignal.timeout(9000), cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return null;
  const t = await res.text().catch(() => "");
  return t.length > 3_000_000 ? t.slice(0, 3_000_000) : t;
}

export type AuditResult = { ok: true; report: AuditReport; description: string; cached: boolean } | { ok: false; error: string };
const AUDIT_TTL_MS = 6 * 3600_000;

/** Public audit of a public channel; cached 6 h per channel so a shared link never hammers t.me. */
export async function auditByUsername(input: string, fresh = false): Promise<AuditResult> {
  const username = normalizeChannel(input);
  if (!username) return { ok: false, error: "اكتب معرّف قناة عامة صحيح، مثل @channel" };
  await ensureChannelTables();
  const key = username.toLowerCase();
  if (!fresh) {
    const row = await prisma.$queryRaw<{ report: any; at: Date }[]>`SELECT report, at FROM channel_audits WHERE username = ${key}`;
    if (row[0] && Date.now() - row[0].at.getTime() < AUDIT_TTL_MS) return { ok: true, report: row[0].report.report, description: row[0].report.description || "", cached: true };
  }
  const html = await fetchText(`https://t.me/s/${username}`);
  if (!html) return { ok: false, error: "تعذّر الوصول إلى تيليجرام الآن. حاول بعد قليل." };
  const parsed = parseChannelPage(username, html);
  if (!parsed) return { ok: false, error: "هذه ليست قناة عامة (أو المعاينة العامة مغلقة)." };
  const report = auditChannel(parsed);
  const payload = JSON.stringify({ report, description: parsed.description.slice(0, 600) });
  await prisma.$executeRaw`INSERT INTO channel_audits (username, report, at) VALUES (${key}, ${payload}::jsonb, now()) ON CONFLICT (username) DO UPDATE SET report = EXCLUDED.report, at = now()`;
  return { ok: true, report, description: parsed.description, cached: false };
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------
export type Listing = { username: string; title: string; price: number; status: string; verifiedUntil: string | null; subscribers: number | null; medianViews: number; reachPct: number | null; grade: string };

export async function publicListings(): Promise<Listing[]> {
  await ensureChannelTables();
  const rows = await prisma.$queryRaw<{ username: string; title: string; price: unknown; status: string; verified_until: Date | null; report: any }[]>`
    SELECT l.username, l.title, l.price, l.status, l.verified_until, a.report FROM channel_listings l LEFT JOIN channel_audits a ON a.username = lower(l.username)
    WHERE l.status = 'LISTED' ORDER BY (l.verified_until > now()) DESC NULLS LAST, l.updated_at DESC LIMIT 200`;
  return rows.map((r) => {
    const rep = r.report?.report as AuditReport | undefined;
    return {
      username: r.username, title: r.title, price: Number(r.price), status: r.status,
      verifiedUntil: r.verified_until && r.verified_until > new Date() ? r.verified_until.toISOString() : null,
      subscribers: rep?.subscribers ?? null, medianViews: rep?.medianViews ?? 0, reachPct: rep?.reachPct ?? null, grade: rep?.grade ?? "unknown",
    };
  });
}

const contactOk = (s: string) => /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s.trim());
const payoutOk = (s: string) => /^[A-Za-z0-9:_-]{20,100}$/.test(s.trim()); // public wallet address (USDT/TON); never a secret

/** Starts (or restarts) a listing. Ownership is proven by putting verify_code in the channel description or a post. */
export async function requestListing(input: { channel: string; ownerContact: string; payoutAddress: string; price: number }) {
  const username = normalizeChannel(input.channel);
  if (!username) return { ok: false as const, error: "معرّف القناة غير صحيح." };
  if (!contactOk(input.ownerContact)) return { ok: false as const, error: "اكتب معرّفك على تيليجرام (@username) للتواصل بخصوص الصفقات." };
  if (!payoutOk(input.payoutAddress)) return { ok: false as const, error: "اكتب عنوان محفظة USDT (TRC20) أو TON العام لاستلام أرباحك." };
  if (!validDealPrice(input.price)) return { ok: false as const, error: "السعر بين 5$ و2000$ للمنشور." };
  const audit = await auditByUsername(username, true);
  if (!audit.ok) return { ok: false as const, error: audit.error };
  const verifyCode = `SHAM-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const token = crypto.randomBytes(18).toString("base64url");
  const contact = input.ownerContact.trim().replace(/^@?/, "@");
  const title = audit.report.title.slice(0, 120);
  const existing = (await prisma.$queryRaw<{ status: string }[]>`SELECT status FROM channel_listings WHERE username = ${username}`)[0];
  if (existing?.status === "LISTED") {
    // Already listed: the new details wait in "pending" and only replace the live ones (payout address included)
    // once the requester proves ownership with the new code. A stranger can't delist a channel or redirect its payouts.
    const pending = JSON.stringify({ token, code: verifyCode, contact, payout: input.payoutAddress.trim(), price: input.price });
    await prisma.$executeRaw`UPDATE channel_listings SET pending = ${pending}::jsonb, updated_at = now() WHERE username = ${username}`;
  } else {
    await prisma.$executeRaw`
      INSERT INTO channel_listings (username, title, owner_contact, payout_address, price, verify_code, manage_token)
      VALUES (${username}, ${title}, ${contact}, ${input.payoutAddress.trim()}, ${input.price}, ${verifyCode}, ${token})
      ON CONFLICT (username) DO UPDATE SET verify_code = EXCLUDED.verify_code, manage_token = EXCLUDED.manage_token, owner_contact = EXCLUDED.owner_contact,
        payout_address = EXCLUDED.payout_address, price = EXCLUDED.price, title = EXCLUDED.title, status = 'PENDING_VERIFY', updated_at = now()`;
  }
  return { ok: true as const, username, verifyCode, manageUrl: `${site()}/channels/manage/${token}` };
}

type ListingRow = { username: string; title: string; owner_contact: string; payout_address: string; price: number; status: string; verify_code: string; verified_until: Date | null; viaPending: boolean };
export async function listingByToken(token: string): Promise<ListingRow | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  await ensureChannelTables();
  const r = await prisma.$queryRaw<{ username: string; title: string; owner_contact: string; payout_address: string; price: unknown; status: string; verify_code: string; verified_until: Date | null; manage_token: string; pending: any }[]>`
    SELECT username, title, owner_contact, payout_address, price, status, verify_code, verified_until, manage_token, pending FROM channel_listings
    WHERE manage_token = ${token} OR pending->>'token' = ${token} LIMIT 1`;
  const x = r[0];
  if (!x) return null;
  if (x.manage_token === token) return { username: x.username, title: x.title, owner_contact: x.owner_contact, payout_address: x.payout_address, price: Number(x.price), status: x.status, verify_code: x.verify_code, verified_until: x.verified_until, viaPending: false };
  const p = x.pending || {};
  return { username: x.username, title: x.title, owner_contact: String(p.contact), payout_address: String(p.payout), price: Number(p.price), status: "PENDING_VERIFY", verify_code: String(p.code), verified_until: x.verified_until, viaPending: true };
}

/** Checks the channel's public page for the verify code; on success the channel is LISTED. */
export async function verifyListing(token: string) {
  const l = await listingByToken(token);
  if (!l) return { ok: false as const, error: "رابط الإدارة غير صحيح." };
  if (l.status === "LISTED") return { ok: true as const, already: true };
  const html = await fetchText(`https://t.me/s/${l.username}`);
  if (!html) return { ok: false as const, error: "تعذّر الوصول إلى تيليجرام الآن." };
  if (!html.includes(l.verify_code)) return { ok: false as const, error: `لم نجد الكود ${l.verify_code} في وصف القناة أو آخر منشوراتها. ضعه ثم أعد المحاولة (يمكنك حذفه بعد التوثيق).` };
  if (l.viaPending) {
    await prisma.$executeRaw`UPDATE channel_listings SET manage_token = pending->>'token', verify_code = pending->>'code', owner_contact = pending->>'contact',
      payout_address = pending->>'payout', price = (pending->>'price')::numeric, pending = NULL, status = 'LISTED', updated_at = now() WHERE pending->>'token' = ${token}`;
  } else {
    await prisma.$executeRaw`UPDATE channel_listings SET status = 'LISTED', updated_at = now() WHERE manage_token = ${token}`;
  }
  await auditByUsername(l.username, true).catch(() => null);
  return { ok: true as const, already: false };
}

// ---------------------------------------------------------------------------
// Deals (escrow) and the ☑️ badge
// ---------------------------------------------------------------------------
export type DealRow = { code: string; kind: string; channel: string; ad_text: string | null; target_url: string | null; advertiser_contact: string | null; price: number; commission: number; payout: number; status: string; paid_via: string | null; post_link: string | null; created_at: Date; paid_at: Date | null; posted_at: Date | null };

export async function dealByCode(code: string): Promise<DealRow | null> {
  if (!/^CH[DB]-[A-Z0-9]{8}$/.test(code)) return null;
  await ensureChannelTables();
  const r = await prisma.$queryRaw<any[]>`SELECT * FROM channel_deals WHERE code = ${code}`;
  if (!r[0]) return null;
  return { ...r[0], price: Number(r[0].price), commission: Number(r[0].commission), payout: Number(r[0].payout) };
}

const urlOk = (u: string) => /^https?:\/\/[^\s<>"]{3,300}$/i.test(u.trim());

export async function createAdDeal(input: { channel: string; adText: string; targetUrl: string; contact: string }) {
  const username = normalizeChannel(input.channel);
  await ensureChannelTables();
  const l = username ? (await prisma.$queryRaw<{ username: string; price: unknown; status: string }[]>`SELECT username, price, status FROM channel_listings WHERE username = ${username}`)[0] : null;
  if (!l || l.status !== "LISTED") return { ok: false as const, error: "هذه القناة غير معروضة في البورصة." };
  const adText = String(input.adText || "").trim();
  if (adText.length < 20 || adText.length > 1500) return { ok: false as const, error: "نص الإعلان بين 20 و1500 حرف." };
  if (!urlOk(input.targetUrl)) return { ok: false as const, error: "رابط الإعلان يجب أن يبدأ بـ https://" };
  if (!contactOk(input.contact)) return { ok: false as const, error: "اكتب معرّفك على تيليجرام (@username) لنتواصل معك." };
  const s = splitDeal(Number(l.price));
  const code = makeDealCode("CHD", crypto.randomBytes(8));
  await prisma.$executeRaw`
    INSERT INTO channel_deals (code, kind, channel, ad_text, target_url, advertiser_contact, price, commission, payout)
    VALUES (${code}, 'AD', ${l.username}, ${adText}, ${input.targetUrl.trim()}, ${input.contact.trim().replace(/^@?/, "@")}, ${s.price}, ${s.commission}, ${s.payout})`;
  return { ok: true as const, code, price: s.price };
}

export async function createBadgeOrder(token: string) {
  const l = await listingByToken(token);
  if (!l || l.status !== "LISTED") return { ok: false as const, error: "وثّق ملكية القناة أولاً." };
  const code = makeDealCode("CHB", crypto.randomBytes(8));
  await prisma.$executeRaw`INSERT INTO channel_deals (code, kind, channel, price, commission, payout) VALUES (${code}, 'BADGE', ${l.username}, ${BADGE_PRICE_USD}, ${BADGE_PRICE_USD}, 0)`;
  return { ok: true as const, code, price: BADGE_PRICE_USD };
}

async function admenSend(text: string) {
  const bot = await findAdmenBot();
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (!bot || !chat) return;
  await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900) }),
  }).catch(() => null);
}

/** Payment link for a deal or badge: Stars (Admen invoice link), NOWPayments invoice, or USDT details for a manual check. */
export async function payDeal(code: string, method: "stars" | "nowpayments" | "usdt") {
  const d = await dealByCode(code);
  if (!d) return { ok: false as const, error: "الكود غير موجود." };
  if (d.status !== "PENDING_PAYMENT") return { ok: false as const, error: "هذا الطلب مدفوع أو مغلق." };
  if (method === "usdt") {
    return { ok: true as const, manual: true, amount: d.price, usdt: usdtAddress(), network: usdtNetwork(), note: `حوّل المبلغ واكتب الكود ${code} في ملاحظة التحويل. يؤكده الأدمن يدوياً.` };
  }
  if (method === "stars") {
    if (!siteAdStarsEnabled()) return { ok: false as const, error: "الدفع بالنجوم غير مفعّل بعد." };
    const bot = await findAdmenBot();
    if (!bot) return { ok: false as const, error: "بوت الدفع غير متاح." };
    await bindAdmenBot().catch(() => null);
    const stars = adStars(d.price);
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/createInvoiceLink`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: (d.kind === "BADGE" ? `توثيق @${d.channel}` : `إعلان في @${d.channel}`).slice(0, 32),
        description: (d.kind === "BADGE" ? `☑️ شارة قناة موثّقة لمدة سنة في بورصة القنوات (${code})` : `منشور إعلاني في @${d.channel}. المبلغ محفوظ لدى المنصة حتى التحقق من النشر (${code}).`).slice(0, 255),
        payload: `${CHANNEL_STARS_PREFIX}${code}`, currency: "XTR", prices: [{ label: code, amount: stars }],
      }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!data?.ok || !data.result) return { ok: false as const, error: "تعذّر إنشاء فاتورة النجوم." };
    return { ok: true as const, invoiceUrl: String(data.result), stars };
  }
  if (!isNowPaymentsConfigured()) return { ok: false as const, error: "فاتورة العملات غير مفعّلة. اختر USDT أو النجوم." };
  const r = await createInvoice({
    priceAmount: d.price, orderId: code, orderDescription: `Sham AI channel ${d.kind === "BADGE" ? "badge" : "ad"} ${code}`,
    ipnCallbackUrl: `${site()}/api/ads/ipn`, successUrl: `${site()}/channels/deal/${code}?paid=1`, cancelUrl: `${site()}/channels/deal/${code}`,
  });
  if (!r.ok) return { ok: false as const, error: r.error || "تعذّر إنشاء الفاتورة" };
  return { ok: true as const, invoiceUrl: r.invoiceUrl };
}

/** The single "money arrived" transition (Stars, NOWPayments IPN, or the admin confirming a USDT transfer). Idempotent. */
export async function markDealPaid(code: string, via: string, amountUsd?: number): Promise<{ ok: boolean; first: boolean }> {
  const d = await dealByCode(code);
  if (!d) return { ok: false, first: false };
  if (amountUsd != null && Number.isFinite(amountUsd) && amountUsd + 0.01 < d.price) return { ok: false, first: false };
  const n = await prisma.$executeRaw`UPDATE channel_deals SET status = 'PAID', paid_via = ${via.slice(0, 120)}, paid_at = now() WHERE code = ${code} AND status = 'PENDING_PAYMENT'`;
  if (n !== 1) return { ok: true, first: false };
  if (d.kind === "BADGE") {
    await prisma.$executeRaw`UPDATE channel_deals SET status = 'RELEASED', closed_at = now() WHERE code = ${code}`;
    await prisma.$executeRaw`UPDATE channel_listings SET verified_until = GREATEST(COALESCE(verified_until, now()), now()) + make_interval(days => ${BADGE_DAYS}), updated_at = now() WHERE username = ${d.channel}`;
    await admenSend(`☑️ دُفعت شارة توثيق @${d.channel} (${code}) — ${d.price}$ عبر ${via}`);
  } else {
    await admenSend(`📣 صفقة قناة مدفوعة ${code}\n@${d.channel} — ${d.price}$ (للقناة ${d.payout}$، عمولة ${d.commission}$)\nالمعلن: ${d.advertiser_contact}\nالرابط: ${d.target_url}\nعبر: ${via}\n\nأرسل نص الإعلان لصاحب القناة أو اطلب منه فتح رابط الإدارة.`);
  }
  return { ok: true, first: true };
}

export async function dealsForChannel(username: string) {
  await ensureChannelTables();
  const r = await prisma.$queryRaw<any[]>`SELECT code, ad_text, target_url, price, payout, status, post_link, created_at FROM channel_deals WHERE channel = ${username} AND kind = 'AD' AND status <> 'PENDING_PAYMENT' ORDER BY created_at DESC LIMIT 50`;
  return r.map((x) => ({ ...x, price: Number(x.price), payout: Number(x.payout) }));
}

/** The channel owner reports the post; we fetch it publicly and check it carries the advertiser's link or the deal code. */
export async function submitPost(token: string, code: string, link: string) {
  const l = await listingByToken(token);
  const d = await dealByCode(code);
  if (!l || l.viaPending || l.status !== "LISTED" || !d || d.channel !== l.username || d.kind !== "AD") return { ok: false as const, error: "الصفقة غير موجودة لهذه القناة." };
  if (d.status !== "PAID" && d.status !== "POSTED") return { ok: false as const, error: "لا يمكن تسجيل منشور لهذه الصفقة الآن." };
  const postId = parsePostLink(link, l.username);
  if (!postId) return { ok: false as const, error: `الرابط يجب أن يكون منشوراً في @${l.username} مثل https://t.me/${l.username}/123` };
  const html = await fetchText(`https://t.me/${l.username}/${postId}?embed=1&mode=tme`);
  const text = html ? (html.match(/tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "").replace(/<a [^>]*href="([^"]+)"[^>]*>/g, " $1 ").replace(/<[^>]+>/g, " ") : "";
  const ok = !!text && postMatchesDeal(text, d.target_url || "", code);
  const next = ok ? "VERIFIED" : "POSTED";
  if (!canMove(d.status, next) && d.status !== next) return { ok: false as const, error: "حالة الصفقة لا تسمح." };
  await prisma.$executeRaw`UPDATE channel_deals SET status = ${next}, post_link = ${`https://t.me/${l.username}/${postId}`}, posted_at = COALESCE(posted_at, now()) WHERE code = ${code} AND status IN ('PAID','POSTED')`;
  await admenSend(`${ok ? "✅ تحقق آلي" : "🟡 بحاجة مراجعة يدوية"}: منشور الصفقة ${code} في @${l.username}\nhttps://t.me/${l.username}/${postId}`);
  return { ok: true as const, verified: ok };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export async function adminDeals() {
  await ensureChannelTables();
  const deals = await prisma.$queryRaw<any[]>`SELECT d.*, l.payout_address, l.owner_contact FROM channel_deals d LEFT JOIN channel_listings l ON l.username = d.channel ORDER BY d.created_at DESC LIMIT 200`;
  const listings = await prisma.$queryRaw<any[]>`SELECT username, title, owner_contact, price, status, verified_until, created_at FROM channel_listings ORDER BY created_at DESC LIMIT 200`;
  const num = (x: any) => ({ ...x, price: Number(x.price), commission: x.commission != null ? Number(x.commission) : undefined, payout: x.payout != null ? Number(x.payout) : undefined });
  const held = deals.filter((d) => d.kind === "AD" && ["PAID", "POSTED", "VERIFIED"].includes(d.status)).reduce((s, d) => s + Number(d.price), 0);
  const earned = deals.filter((d) => d.status === "RELEASED").reduce((s, d) => s + Number(d.commission), 0);
  return { deals: deals.map(num), listings: listings.map(num), heldUsd: Math.round(held * 100) / 100, commissionUsd: Math.round(earned * 100) / 100 };
}

/** Admin moves: confirm a USDT payment, verify a post by hand, release (after paying the channel) or refund (after paying back). */
export async function adminDealAction(code: string, action: "confirm_paid" | "verify" | "release" | "refund" | "cancel") {
  const d = await dealByCode(code);
  if (!d) return { ok: false, error: "غير موجود" };
  if (action === "confirm_paid") return markDealPaid(code, "USDT (تأكيد الأدمن)").then((r) => ({ ok: r.ok, error: r.ok ? undefined : "لم يتغير" }));
  const to = action === "verify" ? "VERIFIED" : action === "release" ? "RELEASED" : action === "refund" ? "REFUNDED" : "CANCELLED";
  if (!canMove(d.status, to)) return { ok: false, error: `لا يمكن الانتقال من ${d.status} إلى ${to}` };
  const n = await prisma.$executeRaw`UPDATE channel_deals SET status = ${to}, closed_at = CASE WHEN ${to} IN ('RELEASED','REFUNDED','CANCELLED') THEN now() ELSE closed_at END WHERE code = ${code} AND status = ${d.status}`;
  return { ok: n === 1, error: n === 1 ? undefined : "تغيّرت الحالة، أعد التحميل" };
}

export async function channelExchangeRevenue(): Promise<{ commissionUsd: number; badgesUsd: number; heldUsd: number }> {
  await ensureChannelTables();
  const r = await prisma.$queryRaw<{ c: unknown; b: unknown; h: unknown }[]>`
    SELECT COALESCE(SUM(commission) FILTER (WHERE kind='AD' AND status='RELEASED'),0) c,
           COALESCE(SUM(price) FILTER (WHERE kind='BADGE' AND status='RELEASED'),0) b,
           COALESCE(SUM(price) FILTER (WHERE kind='AD' AND status IN ('PAID','POSTED','VERIFIED')),0) h FROM channel_deals`;
  return { commissionUsd: Number(r[0]?.c || 0), badgesUsd: Number(r[0]?.b || 0), heldUsd: Number(r[0]?.h || 0) };
}
