/**
 * «بورصة القنوات» (2026-11-10): free shareable channel audit + ad deals between advertisers and
 * Arabic Telegram channels, paid on the existing rails (Stars through the site bot, NOWPayments,
 * USDT confirmed by the admin) and tracked by the platform until the post is verified and the payout is recorded.
 * Ad payment is tracked per deal. After successful delivery review, 85% is due to the channel and 15% is the platform commission.
 * Own tables (created on first use); no prisma schema change.
 */
import { publicSiteUrl } from "@/lib/siteUrl";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { adStars, bindSiteBot, findSiteBot, siteAdStarsEnabled } from "@/lib/siteAds";
import { gateUrl } from "@/lib/hostingOps";
import { usdtAddress, usdtNetwork } from "@/lib/usdtWallet";
import { verifyTrc20UsdtPayment } from "@/lib/usdtVerify";
import {
  BADGE_DAYS, BADGE_PRICE_USD, auditChannel, canMove, makeDealCode, normalizeChannel, parseChannelPage, parsePostLink, postMatchesDeal,
  splitDeal, validDealPrice, type AuditReport,
} from "@/lib/channels/auditRules";
import { detectChannelPayoutNetwork, isValidTronTransactionHash } from "@/lib/channels/payoutAddress";
import { ensureAssetMarketTables, onAssetSalePaid, adminAssetMarketData, adminAssetMarketAction, assetSalePaymentIsAvailable } from "@/lib/channels/assetMarket";

export const CHANNEL_STARS_PREFIX = "CHDEAL:";
const UA = "Mozilla/5.0 (compatible; ShamAI-ChannelAudit/1.0)";
const site = () => publicSiteUrl();

let ready: Promise<void> | null = null;
export function ensureChannelTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS channel_audits (username TEXT PRIMARY KEY, report JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        `CREATE TABLE IF NOT EXISTS channel_listings (username TEXT PRIMARY KEY, title TEXT NOT NULL, owner_contact TEXT NOT NULL, payout_address TEXT NOT NULL, price NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_VERIFY', verify_code TEXT NOT NULL, manage_token TEXT NOT NULL UNIQUE, verified_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        `CREATE TABLE IF NOT EXISTS channel_deals (code TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'AD', channel TEXT NOT NULL, ad_text TEXT, target_url TEXT, advertiser_contact TEXT, price NUMERIC NOT NULL, commission NUMERIC NOT NULL, payout NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT', paid_via TEXT, post_link TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ, posted_at TIMESTAMPTZ, closed_at TIMESTAMPTZ)`,
        `ALTER TABLE channel_listings ADD COLUMN IF NOT EXISTS pending JSONB`,
        `ALTER TABLE channel_listings ADD COLUMN IF NOT EXISTS owner_tg_id TEXT`,
        `ALTER TABLE channel_listings ADD COLUMN IF NOT EXISTS payout_network TEXT`,
        `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS advertiser_tg_id TEXT`,
        `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS settlement_reference TEXT`,
        `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS payment_reference TEXT`,
        `CREATE UNIQUE INDEX IF NOT EXISTS channel_deals_payment_reference_unique ON channel_deals (lower(payment_reference)) WHERE payment_reference IS NOT NULL`,
        `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ`,
        `CREATE INDEX IF NOT EXISTS channel_listings_owner_idx ON channel_listings (owner_tg_id)`,
        `CREATE INDEX IF NOT EXISTS channel_deals_advertiser_idx ON channel_deals (advertiser_tg_id, created_at DESC)`,
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
export type Listing = { username: string; title: string; price: number; status: string; verifiedUntil: string | null; subscribers: number | null; medianViews: number; reachPct: number | null; grade: string; postsSampled: number; auditedAt: string | null };

export async function publicListings(): Promise<Listing[]> {
  await ensureChannelTables();
  const rows = await prisma.$queryRaw<{ username: string; title: string; price: unknown; status: string; verified_until: Date | null; report: any; audited_at: Date | null }[]>`
    SELECT l.username, l.title, l.price, l.status, l.verified_until, a.report, a.at AS audited_at FROM channel_listings l LEFT JOIN channel_audits a ON a.username = lower(l.username)
    WHERE l.status = 'LISTED' ORDER BY (l.verified_until > now()) DESC NULLS LAST, l.updated_at DESC LIMIT 200`;
  return rows.map((r) => {
    const rep = r.report?.report as AuditReport | undefined;
    return {
      username: r.username, title: r.title, price: Number(r.price), status: r.status,
      verifiedUntil: r.verified_until && r.verified_until > new Date() ? r.verified_until.toISOString() : null,
      subscribers: rep?.subscribers ?? null, medianViews: rep?.medianViews ?? 0, reachPct: rep?.reachPct ?? null, grade: rep?.grade ?? "unknown", postsSampled: rep?.postsSampled ?? 0, auditedAt: r.audited_at?.toISOString() || null,
    };
  });
}

const contactOk = (s: string) => /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s.trim());
// Wallet addresses are validated against the network encoding and checksum below.

/** Starts (or restarts) a listing. Ownership is proven by putting verify_code in the channel description or a post. */
export async function requestListing(input: { channel: string; ownerContact: string; payoutAddress: string; price: number; ownerTgId?: string }) {
  const username = normalizeChannel(input.channel);
  if (!username) return { ok: false as const, error: "معرّف القناة غير صحيح." };
  if (!contactOk(input.ownerContact)) return { ok: false as const, error: "اكتب معرّفك على تيليجرام (@username) للتواصل بخصوص الصفقات." };
  const payoutNetwork = detectChannelPayoutNetwork(input.payoutAddress);
  if (!payoutNetwork) return { ok: false as const, error: "عنوان المحفظة غير صالح. استخدم عنوان USDT-TRC20 أو TON صالحاً مع التحقق من checksum." };
  const ownerTgId = String(input.ownerTgId || "").trim() || null;
  if (ownerTgId && !/^\d{1,20}$/.test(ownerTgId)) return { ok: false as const, error: "تعذّر ربط القناة بحساب تيليجرام." };
  if (!validDealPrice(input.price)) return { ok: false as const, error: "السعر بين 5$ و2000$ للمنشور." };
  const audit = await auditByUsername(username, true);
  if (!audit.ok) return { ok: false as const, error: audit.error };
  const verifyCode = `SHAM-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const token = crypto.randomBytes(18).toString("base64url");
  const contact = input.ownerContact.trim().replace(/^@?/, "@");
  const title = audit.report.title.slice(0, 120);
  const existing = (await prisma.$queryRaw<{ status: string }[]>`SELECT status FROM channel_listings WHERE username = ${username}`)[0];
  if (existing?.status === "LISTED") {
    // Keep the current listing live until the new owner proves control. Persist the identity and wallet network
    // with the pending change so the management link can be recovered on another device.
    const pending = JSON.stringify({ token, code: verifyCode, contact, payout: input.payoutAddress.trim(), payoutNetwork, ownerTgId, price: input.price });
    await prisma.$executeRaw`UPDATE channel_listings SET pending = ${pending}::jsonb, updated_at = now() WHERE username = ${username}`;
  } else {
    await prisma.$executeRaw`
      INSERT INTO channel_listings (username, title, owner_contact, payout_address, payout_network, owner_tg_id, price, verify_code, manage_token)
      VALUES (${username}, ${title}, ${contact}, ${input.payoutAddress.trim()}, ${payoutNetwork}, ${ownerTgId}, ${input.price}, ${verifyCode}, ${token})
      ON CONFLICT (username) DO UPDATE SET verify_code = EXCLUDED.verify_code, manage_token = EXCLUDED.manage_token, owner_contact = EXCLUDED.owner_contact,
        payout_address = EXCLUDED.payout_address, payout_network = EXCLUDED.payout_network, owner_tg_id = EXCLUDED.owner_tg_id,
        price = EXCLUDED.price, title = EXCLUDED.title, status = 'PENDING_VERIFY', pending = NULL, updated_at = now()`;
  }
  return { ok: true as const, username, verifyCode, manageUrl: `${site()}/channels/manage/${token}` };
}
type ListingRow = { username: string; title: string; owner_contact: string; payout_address: string; payout_network: string | null; owner_tg_id: string | null; price: number; status: string; verify_code: string; verified_until: Date | null; viaPending: boolean };
export async function listingByToken(token: string): Promise<ListingRow | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  await ensureChannelTables();
  const r = await prisma.$queryRaw<{ username: string; title: string; owner_contact: string; payout_address: string; payout_network: string | null; owner_tg_id: string | null; price: unknown; status: string; verify_code: string; verified_until: Date | null; manage_token: string; pending: any }[]>`
    SELECT username, title, owner_contact, payout_address, payout_network, owner_tg_id, price, status, verify_code, verified_until, manage_token, pending FROM channel_listings
    WHERE manage_token = ${token} OR pending->>'token' = ${token} LIMIT 1`;
  const x = r[0];
  if (!x) return null;
  if (x.manage_token === token) return { username: x.username, title: x.title, owner_contact: x.owner_contact, payout_address: x.payout_address, payout_network: x.payout_network || null, owner_tg_id: x.owner_tg_id || null, price: Number(x.price), status: x.status, verify_code: x.verify_code, verified_until: x.verified_until, viaPending: false };
  const p = x.pending || {};
  return { username: x.username, title: x.title, owner_contact: String(p.contact), payout_address: String(p.payout), payout_network: String(p.payoutNetwork || "") || null, owner_tg_id: String(p.ownerTgId || "") || null, price: Number(p.price), status: "PENDING_VERIFY", verify_code: String(p.code), verified_until: x.verified_until, viaPending: true };
}

/** Checks the channel's public page for the verify code; on success the channel is LISTED. */
export async function verifyListing(token: string, actorTgId?: string) {
  const l = await listingByToken(token);
  if (!l) return { ok: false as const, error: "رابط الإدارة غير صحيح." };
  if (actorTgId && l.owner_tg_id && l.owner_tg_id !== actorTgId) return { ok: false as const, error: "رابط الإدارة لا يخص حساب تيليجرام هذا." };
  if (l.status === "LISTED") return { ok: true as const, already: true };
  const html = await fetchText(`https://t.me/s/${l.username}`);
  if (!html) return { ok: false as const, error: "تعذّر الوصول إلى تيليجرام الآن." };
  if (!html.includes(l.verify_code)) return { ok: false as const, error: `لم نجد الكود ${l.verify_code} في وصف القناة أو آخر منشوراتها. ضعه ثم أعد المحاولة (يمكنك حذفه بعد التوثيق).` };
  if (l.viaPending) {
    await prisma.$executeRaw`UPDATE channel_listings SET manage_token = pending->>'token', verify_code = pending->>'code', owner_contact = pending->>'contact',
      payout_address = pending->>'payout', payout_network = pending->>'payoutNetwork', owner_tg_id = pending->>'ownerTgId', price = (pending->>'price')::numeric, pending = NULL, status = 'LISTED', updated_at = now() WHERE pending->>'token' = ${token}`;
  } else {
    await prisma.$executeRaw`UPDATE channel_listings SET status = 'LISTED', updated_at = now() WHERE manage_token = ${token}`;
  }
  await auditByUsername(l.username, true).catch(() => null);
  return { ok: true as const, already: false };
}

// ---------------------------------------------------------------------------
// Ad deals and the featured-listing badge
// ---------------------------------------------------------------------------
export type DealRow = { code: string; kind: string; channel: string; ad_text: string | null; target_url: string | null; advertiser_contact: string | null; advertiser_tg_id?: string | null; payment_reference?: string | null; settlement_reference?: string | null; settled_at?: Date | null; price: number; commission: number; payout: number; status: string; paid_via: string | null; post_link: string | null; created_at: Date; paid_at: Date | null; posted_at: Date | null };

export async function dealByCode(code: string): Promise<DealRow | null> {
  if (!/^CH[DBM]-[A-Z0-9]{8}$/.test(code)) return null;
  await ensureChannelTables();
  const r = await prisma.$queryRaw<any[]>`SELECT * FROM channel_deals WHERE code = ${code}`;
  if (!r[0]) return null;
  return { ...r[0], price: Number(r[0].price), commission: Number(r[0].commission), payout: Number(r[0].payout) };
}

const urlOk = (u: string) => /^https?:\/\/[^\s<>"]{3,300}$/i.test(u.trim());

export async function createAdDeal(input: { channel: string; adText: string; targetUrl: string; contact: string; advertiserTgId?: string }) {
  const username = normalizeChannel(input.channel);
  await ensureChannelTables();
  const l = username ? (await prisma.$queryRaw<{ username: string; price: unknown; status: string }[]>`SELECT username, price, status FROM channel_listings WHERE username = ${username}`)[0] : null;
  if (!l || l.status !== "LISTED") return { ok: false as const, error: "هذه القناة غير معروضة في البورصة." };
  const adText = String(input.adText || "").trim();
  if (adText.length < 20 || adText.length > 1500) return { ok: false as const, error: "نص الإعلان بين 20 و1500 حرف." };
  if (!urlOk(input.targetUrl)) return { ok: false as const, error: "رابط الإعلان يجب أن يبدأ بـ https://" };
  if (!contactOk(input.contact)) return { ok: false as const, error: "اكتب معرّفك على تيليجرام (@username) لنتواصل معك." };
  const advertiserTgId = String(input.advertiserTgId || "").trim() || null;
  if (advertiserTgId && !/^\d{1,20}$/.test(advertiserTgId)) return { ok: false as const, error: "تعذّر ربط الطلب بحسابك." };
  const s = splitDeal(Number(l.price));
  const code = makeDealCode("CHD", crypto.randomBytes(8));
  await prisma.$executeRaw`
    INSERT INTO channel_deals (code, kind, channel, ad_text, target_url, advertiser_contact, advertiser_tg_id, price, commission, payout)
    VALUES (${code}, 'AD', ${l.username}, ${adText}, ${input.targetUrl.trim()}, ${input.contact.trim().replace(/^@?/, "@")}, ${advertiserTgId}, ${s.price}, ${s.commission}, ${s.payout})`;
  return { ok: true as const, code, price: s.price };
}

export async function createBadgeOrder(token: string, actorTgId?: string) {
  const l = await listingByToken(token);
  if (!l || l.status !== "LISTED") return { ok: false as const, error: "وثّق ملكية القناة أولاً." };
  if (actorTgId && l.owner_tg_id && l.owner_tg_id !== actorTgId) return { ok: false as const, error: "هذه القناة لا تخص حساب تيليجرام هذا." };
  const code = makeDealCode("CHB", crypto.randomBytes(8));
  await prisma.$executeRaw`INSERT INTO channel_deals (code, kind, channel, price, commission, payout) VALUES (${code}, 'BADGE', ${l.username}, ${BADGE_PRICE_USD}, ${BADGE_PRICE_USD}, 0)`;
  return { ok: true as const, code, price: BADGE_PRICE_USD };
}

async function siteBotSend(text: string) {
  const bot = await findSiteBot();
  const chat = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (!bot || !chat) return;
  await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900) }),
  }).catch(() => null);
}

/** Payment link for a deal or badge: Stars (site bot invoice link), NOWPayments invoice, or USDT details for a manual check. */
export async function payDeal(code: string, method: "stars" | "nowpayments" | "usdt", actorTgId?: string) {
  const d = await dealByCode(code);
  if (!d) return { ok: false as const, error: "الكود غير موجود." };
  if (actorTgId && d.advertiser_tg_id && d.advertiser_tg_id !== actorTgId) return { ok: false as const, error: "هذا الطلب لا يخص حساب تيليجرام هذا." };
  if (d.kind === "ASSET_SALE" && !(await assetSalePaymentIsAvailable(code))) return { ok: false as const, error: "انتهت مهلة حجز الأصل أو لم يعد العرض محجوزاً لهذه الصفقة. أنشئ حجزاً جديداً قبل الدفع." };
  if (d.status !== "PENDING_PAYMENT") return { ok: false as const, error: "هذا الطلب مدفوع أو مغلق." };
  if (method === "usdt") {
    return { ok: true as const, manual: true, amount: d.price, usdt: usdtAddress(), network: usdtNetwork(), note: `حوّل المبلغ واكتب الكود ${code} في ملاحظة التحويل. يؤكده الأدمن يدوياً.` };
  }
  if (method === "stars") {
    if (!siteAdStarsEnabled()) return { ok: false as const, error: "الدفع بالنجوم غير مفعّل بعد." };
    const bot = await findSiteBot();
    if (!bot) return { ok: false as const, error: "بوت الدفع غير متاح." };
    await bindSiteBot().catch(() => null);
    const stars = adStars(d.price);
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/createInvoiceLink`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: (d.kind === "BADGE" ? `توثيق @${d.channel}` : d.kind === "ASSET_SALE" ? `شراء أصل ${d.channel}` : `إعلان في @${d.channel}`).slice(0, 32),
        description: (d.kind === "BADGE" ? `☑️ شارة قناة موثّقة لمدة سنة في بورصة القنوات (${code})` : d.kind === "ASSET_SALE" ? `شراء أصل تيليجرام ${d.channel} — الصفقة ${code}. لا يُصرف المبلغ قبل التحقق من نقل الملكية.` : `طلب إعلان في @${d.channel}. تم تسجيل الدفع؛ أكمل صاحب القناة النشر ثم تابع التحقق والتسوية من صفحة الطلب (${code}).`).slice(0, 255),
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
export async function markDealPaid(code: string, via: string, amountUsd?: number, paymentReference?: string): Promise<{ ok: boolean; first: boolean }> {
  const d = await dealByCode(code);
  if (!d) return { ok: false, first: false };
  if (amountUsd != null && (!Number.isFinite(amountUsd) || amountUsd + 0.01 < d.price)) return { ok: false, first: false };
  const paymentRef = String(paymentReference || "").trim().slice(0, 160) || null;
  let n = 0;
  try {
    n = await prisma.$executeRaw`UPDATE channel_deals SET status = 'PAID', paid_via = ${via.slice(0, 120)}, payment_reference = ${paymentRef}, paid_at = now() WHERE code = ${code} AND status = 'PENDING_PAYMENT'`;
  } catch {
    // The partial unique index rejects reusing one TRON TXID for two paid orders.
    return { ok: false, first: false };
  }
  if (n !== 1 && d.kind === "ASSET_SALE") {
    // An invoice can be paid after an owner/admin closed the unpaid reservation.
    // Record the real incoming payment so it is surfaced for refund review instead of disappearing.
    try {
      n = await prisma.$executeRaw`UPDATE channel_deals SET status = 'PAID', paid_via = ${via.slice(0, 120)},
        payment_reference = ${paymentRef}, paid_at = now() WHERE code = ${code} AND status = 'CANCELLED'`;
    } catch {
      return { ok: false, first: false };
    }
  }
  if (n !== 1) return { ok: true, first: false };
  if (d.kind === "ASSET_SALE") {
    await ensureAssetMarketTables();
    await onAssetSalePaid(code);
    await siteBotSend(`🛍️ دفع صفقة أصل تيليجرام ${code}\n${d.channel} — ${d.price}$ (مستحق البائع ${d.payout}$، عمولة ${d.commission}$)\nلا تصرف قبل اعتماد نقل الملكية.`);
  } else if (d.kind === "BADGE") {
    await prisma.$executeRaw`UPDATE channel_deals SET status = 'RELEASED', closed_at = now() WHERE code = ${code}`;
    await prisma.$executeRaw`UPDATE channel_listings SET verified_until = GREATEST(COALESCE(verified_until, now()), now()) + make_interval(days => ${BADGE_DAYS}), updated_at = now() WHERE username = ${d.channel}`;
    await siteBotSend(`☑️ دُفعت شارة توثيق @${d.channel} (${code}) — ${d.price}$ عبر ${via}`);
  } else {
    await siteBotSend(`📣 صفقة قناة مدفوعة ${code}\n@${d.channel} — ${d.price}$ (للقناة ${d.payout}$، عمولة ${d.commission}$)\nالمعلن: ${d.advertiser_contact}\nالرابط: ${d.target_url}\nعبر: ${via}\n\nأرسل نص الإعلان لصاحب القناة أو اطلب منه فتح رابط الإدارة.`);
  }
  return { ok: true, first: true };
}

export async function dealsForAdvertiser(tgUserId: string): Promise<string[]> {
  if (!/^\d{1,20}$/.test(tgUserId)) return [];
  await ensureChannelTables();
  const rows = await prisma.$queryRaw<{ code: string }[]>`SELECT code FROM channel_deals WHERE advertiser_tg_id = ${tgUserId} ORDER BY created_at DESC LIMIT 50`;
  return rows.map((row) => row.code);
}

export async function listingTokensForOwner(tgUserId: string): Promise<string[]> {
  if (!/^\d{1,20}$/.test(tgUserId)) return [];
  await ensureChannelTables();
  const rows = await prisma.$queryRaw<{ token: string }[]>`SELECT manage_token AS token FROM channel_listings WHERE owner_tg_id = ${tgUserId}
    UNION ALL SELECT pending->>'token' AS token FROM channel_listings WHERE pending->>'ownerTgId' = ${tgUserId}`;
  return [...new Set(rows.map((row) => row.token).filter(Boolean))];
}
export async function dealsForChannel(username: string) {
  await ensureChannelTables();
  const r = await prisma.$queryRaw<any[]>`SELECT code, ad_text, target_url, price, payout, status, post_link, payment_reference, settlement_reference, settled_at, created_at FROM channel_deals WHERE channel = ${username} AND kind = 'AD' AND status <> 'PENDING_PAYMENT' ORDER BY created_at DESC LIMIT 50`;
  return r.map((x) => ({ ...x, price: Number(x.price), payout: Number(x.payout) }));
}

/** The channel owner reports the post; we fetch it publicly and check it carries the advertiser's link or the deal code. */
export async function submitPost(token: string, code: string, link: string, actorTgId?: string) {
  const l = await listingByToken(token);
  const d = await dealByCode(code);
  if (actorTgId && l?.owner_tg_id && l.owner_tg_id !== actorTgId) return { ok: false as const, error: "هذه القناة لا تخص حساب تيليجرام هذا." };
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
  await siteBotSend(`${ok ? "✅ تحقق آلي" : "🟡 بحاجة مراجعة يدوية"}: منشور الصفقة ${code} في @${l.username}\nhttps://t.me/${l.username}/${postId}`);
  return { ok: true as const, verified: ok };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export async function adminDeals() {
  await ensureChannelTables();
  await ensureAssetMarketTables();
  const assetMarket = await adminAssetMarketData();
  const deals = await prisma.$queryRaw<any[]>`SELECT d.*, l.payout_address, l.payout_network, l.owner_contact FROM channel_deals d LEFT JOIN channel_listings l ON l.username = d.channel ORDER BY d.created_at DESC LIMIT 200`;
  const listings = await prisma.$queryRaw<any[]>`SELECT username, title, owner_contact, price, status, verified_until, created_at FROM channel_listings ORDER BY created_at DESC LIMIT 200`;
  const num = (x: any) => ({ ...x, price: Number(x.price), commission: x.commission != null ? Number(x.commission) : undefined, payout: x.payout != null ? Number(x.payout) : undefined });
  const held = deals.filter((d) => ["AD", "ASSET_SALE"].includes(d.kind) && ["PAID", "POSTED", "VERIFIED"].includes(d.status)).reduce((s, d) => s + Number(d.price), 0);
  const earned = deals.filter((d) => ["AD", "ASSET_SALE"].includes(d.kind) && d.status === "RELEASED").reduce((s, d) => s + Number(d.commission), 0);
  return { deals: deals.map(num), listings: listings.map(num), assetListings: assetMarket.listings, assetSales: assetMarket.sales, heldUsd: Math.round(held * 100) / 100, commissionUsd: Math.round(earned * 100) / 100 };
}

/** Admin moves: confirm a USDT payment, verify a post by hand, release (after paying the channel) or refund (after paying back). */
export async function adminDealAction(code: string, action: "confirm_paid" | "verify" | "release" | "refund" | "cancel", reference?: string) {
  const d = await dealByCode(code);
  if (!d) return { ok: false, error: "غير موجود" };
  if (action === "confirm_paid") {
    if (d.status !== "PENDING_PAYMENT" && !(d.kind === "ASSET_SALE" && d.status === "CANCELLED")) return { ok: false, error: "هذا الطلب ليس بانتظار الدفع أو مراجعة دفعة متأخرة." };
    const txHash = String(reference || "").trim();
    if (!isValidTronTransactionHash(txHash)) return { ok: false, error: "أدخل TXID صحيحاً من 64 خانة hex لشبكة TRC20." };
    const chain = await verifyTrc20UsdtPayment(txHash, usdtAddress(), Number(d.price));
    if (!chain.ok) return { ok: false, error: `لم يُعتمد الدفع: تعذّر التحقق من المعاملة على TRON (${chain.reason}). تحقق من TXID والعنوان والمبلغ وحاول التحديث بعد تأكيد الشبكة.` };
    const r = await markDealPaid(code, "USDT TRC20 (تحقق آلي عبر TronGrid)", undefined, txHash);
    return { ok: r.ok && r.first, error: r.ok && r.first ? undefined : "لم يتغير؛ ربما استُخدم TXID مسبقاً أو أُغلقت الصفقة." };
  }
  if (d.kind === "ASSET_SALE" && action === "verify") {
    const reviewed = await adminAssetMarketAction(code, "verify_bot_sale", String(reference || ""));
    return { ok: reviewed.ok, error: reviewed.error };
  }
  if (d.kind === "ASSET_SALE" && action === "refund" && d.status === "VERIFIED") {
    return { ok: false, error: "لا يمكن استرداد صفقة بعد إثبات انتقال الملكية. افتح نزاعاً إدارياً بدلاً من عكس الصفقة تلقائياً." };
  }
  const to = action === "verify" ? "VERIFIED" : action === "release" ? "RELEASED" : action === "refund" ? "REFUNDED" : "CANCELLED";
  if (!canMove(d.status, to)) return { ok: false, error: `لا يمكن الانتقال من ${d.status} إلى ${to}` };
  const ref = String(reference || "").trim().slice(0, 160);
  if ((to === "RELEASED" || to === "REFUNDED") && ref.length < 8) return { ok: false, error: "أدخل مرجع التحويل أو الاسترداد (8 أحرف على الأقل) قبل إغلاق الصفقة." };
  const n = await prisma.$executeRaw`UPDATE channel_deals SET status = ${to},
    settlement_reference = CASE WHEN ${to} IN ('RELEASED','REFUNDED') THEN ${ref} ELSE settlement_reference END,
    settled_at = CASE WHEN ${to} IN ('RELEASED','REFUNDED') THEN now() ELSE settled_at END,
    closed_at = CASE WHEN ${to} IN ('RELEASED','REFUNDED','CANCELLED') THEN now() ELSE closed_at END
    WHERE code = ${code} AND status = ${d.status}`;
  if (n === 1 && d.kind === "ASSET_SALE") {
    await ensureAssetMarketTables();
    await prisma.$executeRaw`UPDATE telegram_asset_sales SET status = ${to}, updated_at = now() WHERE code = ${code}`;
    if (to === "REFUNDED" || to === "CANCELLED") {
      await prisma.$executeRaw`UPDATE telegram_asset_listings l SET status = 'LISTED', updated_at = now()
        WHERE l.id = (SELECT listing_id FROM telegram_asset_sales WHERE code = ${code}) AND l.status = 'RESERVED'
          AND NOT EXISTS (SELECT 1 FROM telegram_asset_sales active WHERE active.listing_id = l.id
            AND active.status NOT IN ('RELEASED','REFUNDED','CANCELLED'))`;
    }
  }
  return { ok: n === 1, error: n === 1 ? undefined : "تغيّرت الحالة، أعد التحميل" };
}
export async function channelExchangeRevenue(): Promise<{ commissionUsd: number; badgesUsd: number; heldUsd: number }> {
  await ensureChannelTables();
  const r = await prisma.$queryRaw<{ c: unknown; b: unknown; h: unknown }[]>`
    SELECT COALESCE(SUM(commission) FILTER (WHERE kind IN ('AD','ASSET_SALE') AND status='RELEASED'),0) c,
           COALESCE(SUM(price) FILTER (WHERE kind='BADGE' AND status='RELEASED'),0) b,
           COALESCE(SUM(price) FILTER (WHERE kind IN ('AD','ASSET_SALE') AND status IN ('PAID','POSTED','VERIFIED')),0) h FROM channel_deals`;
  return { commissionUsd: Number(r[0]?.c || 0), badgesUsd: Number(r[0]?.b || 0), heldUsd: Number(r[0]?.h || 0) };
}
