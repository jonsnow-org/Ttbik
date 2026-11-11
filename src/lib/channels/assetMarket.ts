/**
 * Telegram asset marketplace: channels, groups and bots.
 * Identity is keyed by Telegram numeric ID. Names/usernames are snapshots and phone numbers
 * are accepted only from a self-shared Telegram contact (contact.user_id === sender ID).
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { ownerBot } from "@/lib/builderOwnerBot";
import { findSiteBot } from "@/lib/siteAds";
import { detectChannelPayoutNetwork } from "@/lib/channels/payoutAddress";
import {
  ASSET_MARKET_MAX_PRICE, ASSET_MARKET_MIN_PRICE, assetIdentityProblem, assetIdentitySnapshot,
  normalizeAssetIdentifier, normalizeAssetPhone, splitAssetSale, type AssetIdentityInput, type AssetIdentitySnapshot, type TelegramAssetType,
} from "@/lib/channels/assetMarketRules";

let ready: Promise<void> | null = null;

export async function ensureAssetMarketTables(): Promise<void> {
  if (!ready) ready = (async () => {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS channel_deals (code TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'AD', channel TEXT NOT NULL, ad_text TEXT, target_url TEXT, advertiser_contact TEXT, price NUMERIC NOT NULL, commission NUMERIC NOT NULL, payout NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT', paid_via TEXT, post_link TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ, posted_at TIMESTAMPTZ, closed_at TIMESTAMPTZ)`,
      `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS advertiser_tg_id TEXT`,
      `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS settlement_reference TEXT`,
      `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS payment_reference TEXT`,
      `ALTER TABLE channel_deals ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ`,
      `CREATE UNIQUE INDEX IF NOT EXISTS channel_deals_payment_reference_unique ON channel_deals (lower(payment_reference)) WHERE payment_reference IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS telegram_asset_identities (
        telegram_id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT, username TEXT NOT NULL,
        phone_number TEXT, phone_verified BOOLEAN NOT NULL DEFAULT FALSE, phone_verified_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS telegram_asset_identity_username_idx ON telegram_asset_identities (lower(username))`,
      `CREATE TABLE IF NOT EXISTS telegram_asset_listings (
        id TEXT PRIMARY KEY, asset_type TEXT NOT NULL CHECK (asset_type IN ('CHANNEL','GROUP','BOT')),
        identifier TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, asking_price NUMERIC NOT NULL,
        payout_address TEXT NOT NULL, payout_network TEXT NOT NULL, seller_telegram_id TEXT NOT NULL REFERENCES telegram_asset_identities(telegram_id),
        seller_snapshot JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_VERIFY', verifier_bot TEXT,
        verification_mode TEXT NOT NULL, review_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS telegram_asset_active_identifier_unique ON telegram_asset_listings (asset_type, lower(identifier))
        WHERE status IN ('PENDING_VERIFY','PENDING_REVIEW','LISTED','RESERVED')`,
      `CREATE INDEX IF NOT EXISTS telegram_asset_listings_status_idx ON telegram_asset_listings (status, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS telegram_asset_listings_seller_idx ON telegram_asset_listings (seller_telegram_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS telegram_asset_sales (
        code TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES telegram_asset_listings(id),
        seller_telegram_id TEXT NOT NULL, buyer_telegram_id TEXT NOT NULL,
        seller_snapshot JSONB NOT NULL, buyer_snapshot JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
        seller_confirmed BOOLEAN NOT NULL DEFAULT FALSE, buyer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
        transfer_evidence TEXT, verification_bot TEXT, verification_reference TEXT, payment_late BOOLEAN NOT NULL DEFAULT FALSE, expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS telegram_asset_one_open_sale_idx ON telegram_asset_sales (listing_id)
        WHERE status NOT IN ('RELEASED','REFUNDED','CANCELLED')`,
      `CREATE INDEX IF NOT EXISTS telegram_asset_sales_buyer_idx ON telegram_asset_sales (buyer_telegram_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS telegram_asset_sales_seller_idx ON telegram_asset_sales (seller_telegram_id, created_at DESC)`,
    ];
    for (const q of ddl) await prisma.$executeRawUnsafe(q);
    await prisma.$executeRawUnsafe("ALTER TABLE telegram_asset_sales ADD COLUMN IF NOT EXISTS payment_late BOOLEAN NOT NULL DEFAULT FALSE");
    const security = [
      "ALTER TABLE telegram_asset_identities ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE telegram_asset_listings ENABLE ROW LEVEL SECURITY",
      "ALTER TABLE telegram_asset_sales ENABLE ROW LEVEL SECURITY",
      "REVOKE ALL ON TABLE telegram_asset_identities, telegram_asset_listings, telegram_asset_sales FROM anon, authenticated",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE telegram_asset_identities, telegram_asset_listings, telegram_asset_sales TO service_role",
    ];
    for (const q of security) await prisma.$executeRawUnsafe(q);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function upsertAssetIdentity(input: AssetIdentityInput): Promise<void> {
  const id = String(input.id || "").trim();
  if (!/^\d{5,20}$/.test(id)) return;
  await ensureAssetMarketTables();
  const first = String(input.firstName || "").trim().slice(0, 64) || "Telegram user";
  const last = String(input.lastName || "").trim().slice(0, 64) || null;
  const username = String(input.username || "").replace(/^@/, "").trim().slice(0, 32) || "unknown";
  const phone = input.phoneVerified ? normalizeAssetPhone(input.phoneNumber) : null;
  await prisma.$executeRaw`
    INSERT INTO telegram_asset_identities (telegram_id, first_name, last_name, username, phone_number, phone_verified, phone_verified_at)
    VALUES (${id}, ${first}, ${last}, ${username}, ${phone}, ${!!phone}, CASE WHEN ${!!phone} THEN now() ELSE NULL END)
    ON CONFLICT (telegram_id) DO UPDATE SET
      first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, username = EXCLUDED.username,
      phone_number = COALESCE(EXCLUDED.phone_number, telegram_asset_identities.phone_number),
      phone_verified = telegram_asset_identities.phone_verified OR EXCLUDED.phone_verified,
      phone_verified_at = COALESCE(telegram_asset_identities.phone_verified_at, EXCLUDED.phone_verified_at),
      last_seen_at = now(), updated_at = now()
  `;
}

export async function recordAssetPhoneContact(input: {
  telegramId: string; contactUserId: string; phoneNumber: string; firstName: string; lastName?: string | null; username?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.telegramId || input.telegramId !== input.contactUserId) return { ok: false, error: "يجب مشاركة رقم هاتفك أنت من حسابك نفسه." };
  const phone = normalizeAssetPhone(input.phoneNumber);
  if (!phone) return { ok: false, error: "رقم الهاتف المرسل غير صالح. أعد مشاركته من تيليجرام." };
  await upsertAssetIdentity({ id: input.telegramId, firstName: input.firstName, lastName: input.lastName, username: input.username, phoneNumber: phone, phoneVerified: true });
  return { ok: true };
}

export async function assetIdentityForUser(telegramId: string) {
  await ensureAssetMarketTables();
  const rows = await prisma.$queryRaw<any[]>`SELECT telegram_id, first_name, last_name, username, phone_number, phone_verified, phone_verified_at
    FROM telegram_asset_identities WHERE telegram_id = ${telegramId} LIMIT 1`;
  const r = rows[0];
  return r ? {
    telegramId: String(r.telegram_id), firstName: String(r.first_name || ""), lastName: r.last_name || null,
    username: String(r.username || ""), phoneNumber: r.phone_number || null, phoneVerified: !!r.phone_verified,
    phoneVerifiedAt: r.phone_verified_at ? new Date(r.phone_verified_at).toISOString() : null,
  } : null;
}

async function requireVerifiedIdentity(telegramId: string): Promise<AssetIdentitySnapshot> {
  const r = await assetIdentityForUser(telegramId);
  if (!r) throw new Error("لم يتم تسجيل هويتك بعد. حدّث الشاشة ثم أعد المحاولة.");
  const snapshot = assetIdentitySnapshot({
    id: r.telegramId, firstName: r.firstName, lastName: r.lastName, username: r.username,
    phoneNumber: r.phoneNumber, phoneVerified: r.phoneVerified,
  });
  const problem = assetIdentityProblem({
    id: r.telegramId, firstName: r.firstName, lastName: r.lastName, username: r.username,
    phoneNumber: r.phoneNumber, phoneVerified: r.phoneVerified,
  });
  if (!snapshot || problem) throw new Error(problem || "بيانات الهوية غير مكتملة.");
  return snapshot;
}

type Verifier = { token: string; username: string; id: string; source: string };
async function verifierBots(): Promise<Verifier[]> {
  const found: Verifier[] = [];
  const [owner, site] = await Promise.all([ownerBot().catch(() => null), findSiteBot().catch(() => null)]);
  const candidates = [
    owner ? { token: owner.token, username: owner.username, source: "builder-owner" } : null,
    site ? { token: site.token, username: "", source: "site-owner" } : null,
  ].filter((x): x is { token: string; username: string; source: string } => !!x);
  for (const c of candidates) {
    if (found.some((x) => x.token === c.token)) continue;
    try {
      const res = await fetch(`https://api.telegram.org/bot${c.token}/getMe`, { signal: AbortSignal.timeout(7000) });
      const data: any = await res.json();
      if (data?.ok && data.result?.id) found.push({ token: c.token, username: String(data.result.username || c.username || ""), id: String(data.result.id), source: c.source });
    } catch { /* try the other owner bot */ }
  }
  return found;
}

export async function assetVerifierBotNames(): Promise<string[]> {
  return (await verifierBots()).map((b) => b.username ? `@${b.username}` : b.source);
}

async function telegramCall<T = any>(token: string, method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const data: any = await res.json();
    return data?.ok ? data.result as T : null;
  } catch { return null; }
}

async function verifyChatOwner(type: "CHANNEL" | "GROUP", identifier: string, telegramId: string) {
  const bots = await verifierBots();
  let sawChat = false;
  let sawAdminBot = false;
  for (const verifier of bots) {
    const chat: any = await telegramCall(verifier.token, "getChat", { chat_id: identifier.startsWith("-") ? identifier : `@${identifier.replace(/^@/, "")}` });
    if (!chat?.id || !chat?.type) continue;
    sawChat = true;
    const expected = type === "CHANNEL" ? chat.type === "channel" : ["group", "supergroup"].includes(String(chat.type));
    if (!expected) continue;
    const botMember: any = await telegramCall(verifier.token, "getChatMember", { chat_id: chat.id, user_id: Number(verifier.id) });
    if (!botMember || !["administrator", "creator"].includes(String(botMember.status))) continue;
    sawAdminBot = true;
    const owner: any = await telegramCall(verifier.token, "getChatMember", { chat_id: chat.id, user_id: Number(telegramId) });
    if (owner?.status === "creator") return { ok: true as const, chatId: String(chat.id), title: String(chat.title || identifier), verifierBot: verifier.username || verifier.source };
  }
  if (!bots.length) return { ok: false as const, error: "لا يوجد بوت تحقق متاح حالياً. تحقق من إعداد بوت المالك وبوت الموقع." };
  if (!sawChat) return { ok: false as const, error: "تعذّر الوصول إلى القناة أو المجموعة. تأكد من المعرّف وأن أحد بوتي التحقق موجود فيها." };
  if (!sawAdminBot) return { ok: false as const, error: "أضف أحد بوتي المنصة مشرفاً في القناة أو المجموعة مع صلاحية رؤية الأعضاء، ثم أعد التحقق." };
  return { ok: false as const, error: "الحساب الحالي ليس مالكاً أصلياً (creator) لهذا الأصل، لذلك لم يُقبل العرض." };
}

async function releaseExpiredReservations() {
  await ensureAssetMarketTables();
  // Close expired reservations atomically. Never unlock a newer reservation on the same listing.
  await prisma.$executeRaw`
    WITH expired AS (
      UPDATE telegram_asset_sales SET status = 'CANCELLED', updated_at = now()
      WHERE status = 'PENDING_PAYMENT' AND expires_at < now()
      RETURNING listing_id
    )
    UPDATE telegram_asset_listings l SET status = 'LISTED', updated_at = now()
    FROM (SELECT DISTINCT listing_id FROM expired) e
    WHERE l.id = e.listing_id AND l.status = 'RESERVED'
      AND NOT EXISTS (
        SELECT 1 FROM telegram_asset_sales active
        WHERE active.listing_id = l.id AND active.status NOT IN ('RELEASED','REFUNDED','CANCELLED')
      )
  `;
}

export async function assetSalePaymentIsAvailable(code: string): Promise<boolean> {
  await releaseExpiredReservations();
  const rows = await prisma.$queryRaw<any[]>`
    SELECT s.status, s.expires_at, l.status AS listing_status
    FROM telegram_asset_sales s JOIN telegram_asset_listings l ON l.id = s.listing_id
    WHERE s.code = ${code} LIMIT 1
  `;
  const row = rows[0];
  return !!row && row.status === "PENDING_PAYMENT" && new Date(row.expires_at).getTime() > Date.now() && row.listing_status === "RESERVED";
}
export async function publicAssetListings() {
  await releaseExpiredReservations();
  const rows = await prisma.$queryRaw<any[]>`SELECT id, asset_type, identifier, title, description, asking_price, seller_snapshot, verification_mode, created_at
    FROM telegram_asset_listings WHERE status = 'LISTED' ORDER BY created_at DESC LIMIT 150`;
  return rows.map((r) => ({
    id: String(r.id), assetType: r.asset_type as TelegramAssetType, identifier: String(r.identifier),
    title: String(r.title), description: String(r.description), price: Number(r.asking_price),
    seller: { firstName: String(r.seller_snapshot?.firstName || ""), lastName: r.seller_snapshot?.lastName || null, username: String(r.seller_snapshot?.username || "") }, verificationMode: String(r.verification_mode), createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function myAssetListings(telegramId: string) {
  await ensureAssetMarketTables();
  const rows = await prisma.$queryRaw<any[]>`SELECT id, asset_type, identifier, title, asking_price, status, created_at
    FROM telegram_asset_listings WHERE seller_telegram_id = ${telegramId} ORDER BY created_at DESC LIMIT 50`;
  return rows.map((r) => ({ id: r.id, assetType: r.asset_type, identifier: r.identifier, title: r.title, price: Number(r.asking_price), status: r.status, createdAt: new Date(r.created_at).toISOString() }));
}

export async function myAssetSales(telegramId: string): Promise<string[]> {
  await ensureAssetMarketTables();
  const rows = await prisma.$queryRaw<{ code: string }[]>`SELECT code FROM telegram_asset_sales
    WHERE buyer_telegram_id = ${telegramId} OR seller_telegram_id = ${telegramId} ORDER BY created_at DESC LIMIT 50`;
  return rows.map((r) => r.code);
}

export async function createAssetListing(input: {
  assetType: TelegramAssetType; identifier: string; title: string; description: string; price: number; payoutAddress: string;
}, sellerTelegramId: string) {
  try {
    await ensureAssetMarketTables();
    const seller = await requireVerifiedIdentity(sellerTelegramId);
    const identifier = normalizeAssetIdentifier(input.assetType, input.identifier);
    if (!identifier) return { ok: false as const, error: "معرّف القناة أو المجموعة أو البوت غير صالح." };
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < ASSET_MARKET_MIN_PRICE || price > ASSET_MARKET_MAX_PRICE) return { ok: false as const, error: `السعر يجب أن يكون بين ${ASSET_MARKET_MIN_PRICE}$ و${ASSET_MARKET_MAX_PRICE}$.` };
    const payoutNetwork = detectChannelPayoutNetwork(input.payoutAddress);
    if (!payoutNetwork) return { ok: false as const, error: "عنوان استلام المستحقات غير صالح. استخدم عنوان USDT-TRC20 أو TON صحيحاً." };
    const titleInput = String(input.title || "").trim().slice(0, 120);
    const description = String(input.description || "").trim().slice(0, 1800);
    if (description.length < 30) return { ok: false as const, error: "أضف وصفاً حقيقياً لا يقل عن 30 حرفاً." };

    let title = titleInput;
    let status = "PENDING_REVIEW";
    let verificationMode = "MANUAL_BOTFATHER_REVIEW";
    let verifierBot: string | null = null;
    if (input.assetType === "CHANNEL" || input.assetType === "GROUP") {
      const checked = await verifyChatOwner(input.assetType, identifier, sellerTelegramId);
      if (!checked.ok) return { ok: false as const, error: checked.error };
      title = title || checked.title;
      status = "LISTED";
      verificationMode = "TELEGRAM_CREATOR_CHECK";
      verifierBot = checked.verifierBot;
    } else {
      if (!title) return { ok: false as const, error: "اكتب اسم البوت ومجاله بوضوح." };
    }
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO telegram_asset_listings
        (id, asset_type, identifier, title, description, asking_price, payout_address, payout_network, seller_telegram_id, seller_snapshot, status, verifier_bot, verification_mode)
      VALUES
        (${id}, ${input.assetType}, ${identifier}, ${title}, ${description}, ${price}, ${input.payoutAddress.trim()}, ${payoutNetwork},
         ${sellerTelegramId}, ${JSON.stringify(seller)}::jsonb, ${status}, ${verifierBot}, ${verificationMode})
    `;
    if (input.assetType === "BOT") await notifyMarketAdmin(`🤖 عرض بوت بانتظار المراجعة اليدوية\n${title} · @${identifier}\nالسعر: ${price}$\nالبائع: ${seller.firstName} (@${seller.username}) · ID ${seller.telegramId}\nرقم الهاتف: ${seller.phoneNumber}\nيجب فحص إثبات ملكية BotFather يدوياً قبل إتاحة العرض.\nمعرّف العرض: ${id}`);
    return { ok: true as const, id, status, verificationMode };
  } catch (e) {
    const msg = String((e as Error)?.message || "");
    if (/duplicate|unique/i.test(msg)) return { ok: false as const, error: "هذا الأصل موجود بالفعل أو لديه عرض/حجز نشط." };
    return { ok: false as const, error: "تعذّر إنشاء العرض حالياً. تحقق من الهوية والبيانات ثم أعد المحاولة." };
  }
}

async function notifyMarketAdmin(message: string) {
  const admin = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID || "");
  if (!admin) return;
  for (const b of await verifierBots()) {
    const ok = await telegramCall(b.token, "sendMessage", { chat_id: admin, text: message, disable_web_page_preview: true });
    if (ok) return;
  }
}

async function notifySaleParties(code: string, message: string) {
  const rows = await prisma.$queryRaw<any[]>`SELECT buyer_telegram_id, seller_telegram_id FROM telegram_asset_sales WHERE code = ${code} LIMIT 1`;
  if (!rows[0]) return;
  const bots = await verifierBots();
  for (const b of bots) {
    await telegramCall(b.token, "sendMessage", { chat_id: String(rows[0].buyer_telegram_id), text: message, disable_web_page_preview: true });
    await telegramCall(b.token, "sendMessage", { chat_id: String(rows[0].seller_telegram_id), text: message, disable_web_page_preview: true });
  }
}

export async function createAssetSale(listingId: string, buyerTelegramId: string) {
  await releaseExpiredReservations();
  const buyer = await requireVerifiedIdentity(buyerTelegramId).catch((e) => null);
  if (!buyer) return { ok: false as const, error: "يجب إكمال هويتك وتوثيق رقم هاتفك قبل الشراء." };
  const code = `CHM-${crypto.randomBytes(8).toString("hex").toUpperCase().slice(0, 8)}`;
  try {
    const out = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<any[]>`SELECT * FROM telegram_asset_listings WHERE id = ${listingId} AND status = 'LISTED' FOR UPDATE`;
      const l = rows[0];
      if (!l) return { ok: false as const, error: "العرض غير متاح أو تم حجزه من مشترٍ آخر." };
      if (String(l.seller_telegram_id) === buyerTelegramId) return { ok: false as const, error: "لا يمكنك شراء الأصل المعروض من حسابك." };
      const split = splitAssetSale(Number(l.asking_price));
      const updated = await tx.$executeRaw`UPDATE telegram_asset_listings SET status = 'RESERVED', updated_at = now() WHERE id = ${listingId} AND status = 'LISTED'`;
      if (updated !== 1) return { ok: false as const, error: "سبق أن حجز مشتري آخر هذا العرض." };
      await tx.$executeRaw`
        INSERT INTO channel_deals (code, kind, channel, advertiser_contact, advertiser_tg_id, price, commission, payout, status)
        VALUES (${code}, 'ASSET_SALE', ${String(l.identifier)}, ${`@${buyer.username}`}, ${buyerTelegramId}, ${split.price}, ${split.commission}, ${split.payout}, 'PENDING_PAYMENT')
      `;
      await tx.$executeRaw`
        INSERT INTO telegram_asset_sales (code, listing_id, seller_telegram_id, buyer_telegram_id, seller_snapshot, buyer_snapshot, status, expires_at)
        VALUES (${code}, ${listingId}, ${String(l.seller_telegram_id)}, ${buyerTelegramId}, ${JSON.stringify(l.seller_snapshot)}::jsonb,
          ${JSON.stringify(buyer)}::jsonb, 'PENDING_PAYMENT', now() + interval '30 minutes')
      `;
      return { ok: true as const, code, price: split.price, commission: split.commission, payout: split.payout, assetType: String(l.asset_type), identifier: String(l.identifier), title: String(l.title) };
    });
    if (out.ok) await notifySaleParties(code, `🛒 تم حجز عرض ${out.title} (${out.identifier})\nالصفقة: ${code}\nالمبلغ: ${out.price}$\nعمولة المنصة 15% · مستحق البائع ${out.payout}$\nأكمل الدفع خلال 30 دقيقة. لا ترسل المال مباشرة للبائع.`);
    return out;
  } catch (e) {
    const msg = String((e as Error)?.message || "");
    if (/duplicate|unique/i.test(msg)) return { ok: false as const, error: "هذا العرض محجوز بالفعل. اختر عرضاً آخر." };
    return { ok: false as const, error: "تعذّر إنشاء الصفقة. حدّث العروض ثم حاول مجدداً." };
  }
}

export async function assetSaleDetails(code: string, actorTelegramId: string) {
  await ensureAssetMarketTables();
  const rows = await prisma.$queryRaw<any[]>`SELECT s.code, s.status, s.seller_telegram_id, s.buyer_telegram_id, s.seller_snapshot, s.buyer_snapshot,
      s.seller_confirmed, s.buyer_confirmed, s.transfer_evidence, s.payment_late, s.verification_bot, s.verification_reference,
      l.asset_type, l.identifier, l.title, l.asking_price, d.price, d.commission, d.payout, d.payment_reference, d.settlement_reference, d.created_at
    FROM telegram_asset_sales s JOIN telegram_asset_listings l ON l.id = s.listing_id
    JOIN channel_deals d ON d.code = s.code WHERE s.code = ${code} LIMIT 1`;
  const x = rows[0];
  if (!x || (x.seller_telegram_id !== actorTelegramId && x.buyer_telegram_id !== actorTelegramId && actorTelegramId !== String(process.env.SUPER_ADMIN_TELEGRAM_ID || ""))) return null;
  return {
    code: String(x.code), status: String(x.status), sellerTelegramId: String(x.seller_telegram_id), buyerTelegramId: String(x.buyer_telegram_id),
    seller: x.seller_snapshot as AssetIdentitySnapshot, buyer: x.buyer_snapshot as AssetIdentitySnapshot, sellerConfirmed: !!x.seller_confirmed,
    buyerConfirmed: !!x.buyer_confirmed, paymentLate: !!x.payment_late, transferEvidence: x.transfer_evidence || null, verifierBot: x.verification_bot || null,
    verificationReference: x.verification_reference || null, assetType: x.asset_type as TelegramAssetType, identifier: String(x.identifier),
    title: String(x.title), price: Number(x.price), commission: Number(x.commission), sellerAmount: Number(x.payout),
    paymentReference: x.payment_reference || null, settlementReference: x.settlement_reference || null, createdAt: new Date(x.created_at).toISOString(),
  };
}

export async function myAssetSaleCodes(telegramId: string) { return myAssetSales(telegramId); }

export async function reportAssetTransfer(code: string, sellerTelegramId: string, evidence: string) {
  const detail = await assetSaleDetails(code, sellerTelegramId);
  if (!detail || detail.sellerTelegramId !== sellerTelegramId) return { ok: false as const, error: "هذه الصفقة ليست مسجلة باسم حسابك." };
  if (!["PAID", "POSTED"].includes(detail.status)) return { ok: false as const, error: "لا يمكن تسجيل التسليم قبل تأكيد الدفع." };
  const proof = String(evidence || "").trim().slice(0, 500);
  if (detail.assetType === "BOT" && !/^https:\/\//i.test(proof)) return { ok: false as const, error: "صفقة البوت تتطلب رابط دليل HTTPS لنقل الملكية من BotFather." };
  await prisma.$executeRaw`UPDATE telegram_asset_sales SET seller_confirmed = TRUE, transfer_evidence = COALESCE(NULLIF(${proof}, ''), transfer_evidence),
    status = 'POSTED', updated_at = now() WHERE code = ${code} AND seller_telegram_id = ${sellerTelegramId} AND status IN ('PAID','POSTED')`;
  await prisma.$executeRaw`UPDATE channel_deals SET status = 'POSTED', post_link = NULL, posted_at = COALESCE(posted_at, now()) WHERE code = ${code} AND status IN ('PAID','POSTED')`;
  await notifySaleParties(code, detail.assetType === "BOT"
    ? `📦 أعلن البائع أنه نقل البوت في BotFather. الصفقة ${code}. على المشتري تأكيد استلام السيطرة، ثم تراجع الإدارة دليل النقل قبل اعتمادها. لا يُصرف المبلغ الآن.`
    : `📦 أعلن البائع أنه نقل ${detail.assetType === "CHANNEL" ? "القناة" : "المجموعة"} ${detail.identifier}. على المشتري فتح الصفقة والضغط على «تحقق من الملكية». لن يُصرف المبلغ قبل رؤية حساب المشتري بصفة creator.`);
  return { ok: true as const, status: "POSTED" };
}

export async function confirmAssetReceipt(code: string, buyerTelegramId: string) {
  const detail = await assetSaleDetails(code, buyerTelegramId);
  if (!detail || detail.buyerTelegramId !== buyerTelegramId) return { ok: false as const, error: "هذه الصفقة ليست مسجلة باسم حسابك كمشترٍ." };
  if (detail.status !== "POSTED" || !detail.sellerConfirmed) return { ok: false as const, error: "لم يسجل البائع التسليم بعد." };
  if (detail.assetType === "BOT") {
    await prisma.$executeRaw`UPDATE telegram_asset_sales SET buyer_confirmed = TRUE, updated_at = now() WHERE code = ${code} AND buyer_telegram_id = ${buyerTelegramId} AND status = 'POSTED'`;
    await notifyMarketAdmin(`🤖 تأكيد طرفي تسليم بوت\nالصفقة ${code}\nالبائع ID ${detail.sellerTelegramId} · @${detail.seller.username}\nالمشتري ID ${detail.buyerTelegramId} · @${detail.buyer.username}\nالدليل: ${detail.transferEvidence || "لا يوجد"}\nراجع BotFather يدوياً، ثم استخدم مراجعة الصفقة في لوحة الإدارة. لا تصرف قبل الاعتماد.`);
    await notifySaleParties(code, `✅ أكدت استلام البوت. الصفقة ${code} قيد مراجعة الإدارة اليدوية. لا تُغلق الصفقة أو يُصرف المبلغ حتى اعتماد النقل.`);
    return { ok: true as const, verified: false, manualReview: true };
  }
  const checked = await verifyChatOwner(detail.assetType as "CHANNEL" | "GROUP", detail.identifier, buyerTelegramId);
  if (!checked.ok) return { ok: false as const, error: `لم نثبت ملكيتك بعد: ${checked.error}` };
  await prisma.$executeRaw`UPDATE telegram_asset_sales SET buyer_confirmed = TRUE, status = 'VERIFIED', verification_bot = ${checked.verifierBot}, updated_at = now()
    WHERE code = ${code} AND buyer_telegram_id = ${buyerTelegramId} AND status = 'POSTED'`;
  await prisma.$executeRaw`UPDATE channel_deals SET status = 'VERIFIED' WHERE code = ${code} AND status IN ('PAID','POSTED')`;
  await prisma.$executeRaw`UPDATE telegram_asset_listings SET status = 'SOLD', updated_at = now() WHERE id = (SELECT listing_id FROM telegram_asset_sales WHERE code = ${code})`;
  await notifySaleParties(code, `✅ ثبت نقل الملكية بنجاح. أصبح حساب المشتري ID ${buyerTelegramId} هو creator في تيليجرام. الصفقة ${code} وصلت لمراجعة التسوية؛ لا يعني هذا أن المبلغ صُرف قبل تسجيل مرجع التحويل.`);
  return { ok: true as const, verified: true };
}

export async function onAssetSalePaid(code: string) {
  await ensureAssetMarketTables();
  const accepted = await prisma.$executeRaw`UPDATE telegram_asset_sales
    SET status = 'PAID', updated_at = now()
    WHERE code = ${code} AND status = 'PENDING_PAYMENT' AND expires_at >= now()`;
  if (accepted === 1) {
    await notifySaleParties(code, `💳 تأكد دفع الصفقة ${code}. يستطيع البائع الآن بدء التسليم. احتفظا بمرجع الصفقة، ولا ترسلا أي رموز دخول أو كلمات مرور.`);
    return;
  }
  const late = await prisma.$executeRaw`UPDATE telegram_asset_sales SET status = 'CANCELLED', payment_late = TRUE, updated_at = now()
    WHERE code = ${code} AND status IN ('PENDING_PAYMENT','CANCELLED') AND expires_at < now()`;
  if (late === 1) {
    // Release only this expired reservation. If another buyer already reserved the listing, keep it reserved.
    await prisma.$executeRaw`UPDATE telegram_asset_listings l SET status = 'LISTED', updated_at = now()
      WHERE l.id = (SELECT listing_id FROM telegram_asset_sales WHERE code = ${code}) AND l.status = 'RESERVED'
        AND NOT EXISTS (SELECT 1 FROM telegram_asset_sales active WHERE active.listing_id = l.id
          AND active.status NOT IN ('RELEASED','REFUNDED','CANCELLED'))`;
    const rows = await prisma.$queryRaw<any[]>`SELECT s.seller_telegram_id, s.buyer_telegram_id, s.seller_snapshot, s.buyer_snapshot,
      l.title, l.identifier FROM telegram_asset_sales s JOIN telegram_asset_listings l ON l.id=s.listing_id
      WHERE s.code = ${code} LIMIT 1`;
    const x = rows[0] || {};
    await notifyMarketAdmin(`⚠️ وصلت دفعة بعد انتهاء حجز أصل تيليجرام
الصفقة: ${code}
الأصل: ${x.title || ""} · ${x.identifier || ""}
المشتري: ${x.buyer_snapshot?.firstName || ""} (@${x.buyer_snapshot?.username || ""}) · ID ${x.buyer_telegram_id || ""}
البائع: ${x.seller_snapshot?.firstName || ""} (@${x.seller_snapshot?.username || ""}) · ID ${x.seller_telegram_id || ""}
لا تبدأوا التسليم؛ يجب على الإدارة مراجعة الاسترداد.`);
    await notifySaleParties(code, `⚠️ وصلت دفعة الصفقة ${code} بعد انتهاء الحجز. لم تُعتمد الصفقة ولم يبدأ التسليم؛ ستراجع الإدارة عملية الاسترداد. لا تنقلوا الأصل بناءً على هذه الدفعة.`);
  }
}

export async function adminAssetMarketData() {
  await ensureAssetMarketTables();
  const listings = await prisma.$queryRaw<any[]>`SELECT id, asset_type, identifier, title, asking_price, payout_address, payout_network, status, seller_telegram_id, seller_snapshot, verification_mode, review_reference, created_at
    FROM telegram_asset_listings WHERE status IN ('PENDING_REVIEW','LISTED','RESERVED') ORDER BY created_at DESC LIMIT 100`;
  const sales = await prisma.$queryRaw<any[]>`SELECT s.code, s.status, s.seller_telegram_id, s.buyer_telegram_id, s.seller_snapshot, s.buyer_snapshot, s.seller_confirmed, s.buyer_confirmed,
      s.transfer_evidence, s.payment_late, l.asset_type, l.identifier, l.title, l.payout_address, l.payout_network, d.price, d.payout, d.payment_reference, d.settlement_reference
    FROM telegram_asset_sales s JOIN telegram_asset_listings l ON l.id=s.listing_id JOIN channel_deals d ON d.code=s.code
    WHERE s.status NOT IN ('RELEASED','REFUNDED','CANCELLED') OR s.payment_late = TRUE ORDER BY s.created_at DESC LIMIT 100`;
  return {
    listings: listings.map((x) => ({ ...x, asking_price: Number(x.asking_price) })),
    sales: sales.map((x) => ({ ...x, price: Number(x.price), payout: Number(x.payout) })),
  };
}

export async function adminAssetMarketAction(idOrCode: string, action: "approve_listing" | "reject_listing" | "verify_bot_sale", reference: string) {
  await ensureAssetMarketTables();
  const ref = String(reference || "").trim().slice(0, 500);
  if (action === "approve_listing") {
    if (ref.length < 8) return { ok: false, error: "أدخل مرجع/ملاحظة دليل مراجعة BotFather قبل نشر العرض." };
    const n = await prisma.$executeRaw`UPDATE telegram_asset_listings SET status='LISTED', review_reference=${ref}, updated_at=now()
      WHERE id=${idOrCode} AND asset_type='BOT' AND status='PENDING_REVIEW'`;
    return { ok: n === 1, error: n === 1 ? undefined : "العرض غير موجود أو ليس بانتظار المراجعة." };
  }
  if (action === "reject_listing") {
    const n = await prisma.$executeRaw`UPDATE telegram_asset_listings SET status='REJECTED', review_reference=${ref}, updated_at=now()
      WHERE id=${idOrCode} AND status IN ('PENDING_REVIEW','LISTED')`;
    return { ok: n === 1, error: n === 1 ? undefined : "تعذّر رفض العرض." };
  }
  const sale = await assetSaleDetails(idOrCode, String(process.env.SUPER_ADMIN_TELEGRAM_ID || ""));
  if (!sale || sale.assetType !== "BOT" || !sale.sellerConfirmed || !sale.buyerConfirmed || sale.status !== "POSTED") {
    return { ok: false, error: "يتطلب اعتماد بوت أن يؤكد البائع النقل والمشتري الاستلام، وأن تكون الصفقة قيد المراجعة." };
  }
  if (ref.length < 8) return { ok: false, error: "أدخل مرجع مراجعة BotFather قبل اعتماد النقل." };
  const n = await prisma.$executeRaw`UPDATE channel_deals SET status='VERIFIED' WHERE code=${idOrCode} AND status='POSTED'`;
  if (n !== 1) return { ok: false, error: "حالة الدفع لا تسمح باعتماد التسليم." };
  await prisma.$executeRaw`UPDATE telegram_asset_sales SET status='VERIFIED', verification_reference=${ref}, updated_at=now() WHERE code=${idOrCode} AND status='POSTED'`;
  await prisma.$executeRaw`UPDATE telegram_asset_listings SET status='SOLD', review_reference=${ref}, updated_at=now()
    WHERE id=(SELECT listing_id FROM telegram_asset_sales WHERE code=${idOrCode})`;
  await notifySaleParties(idOrCode, `✅ اعتمدت الإدارة نقل ملكية البوت في الصفقة ${idOrCode}. انتقلت الصفقة إلى التسوية.`);
  return { ok: true };
}
