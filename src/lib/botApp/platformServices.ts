/**
 * Platform services shared by the AD_BOT and JOBS_BOT Mini Apps.
 *
 * These actions are deliberately separated from either bot's own wallet/ledger. The current
 * Mini App's bot token is used for Telegram messages and identity is always the user proven by
 * that bot's signed WebApp initData. Remittance and channel-exchange payments stay on the
 * platform's existing payment rails and accounting.
 */
import { Bot as TelegramBot, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import {
  apiKey as remitKey, createTransferRecord, deleteRecipient, fmt as rfmt, FROM_COUNTRIES, parseAmount,
  quoteAmount, savedRecipients, syncTransferStatus, TO_COUNTRIES, transferByTrack, transfersOf, type Transfer,
} from "@/lib/remit/office";
import { coinById, FINAL, PAY_COINS, RECEIVE, STATUS_AR } from "@/lib/remit/changenow";
import {
  createAdDeal, createBadgeOrder, dealByCode, dealsForAdvertiser, dealsForChannel, listingByToken,
  listingTokensForOwner, payDeal, publicListings, requestListing, submitPost, verifyListing,
} from "@/lib/channels/exchange";
import {
  assetIdentityForUser, assetVerifierBotNames, createAssetListing, createAssetSale, publicAssetListings,
  myAssetListings, myAssetSales, assetSaleDetails, reportAssetTransfer, confirmAssetReceipt, upsertAssetIdentity,
} from "@/lib/channels/assetMarket";
import { BADGE_PRICE_USD, COMMISSION_RATE, MAX_DEAL_USD, MIN_DEAL_USD } from "@/lib/channels/auditRules";
import { isValidTronPayoutAddress } from "@/lib/channels/payoutAddress";
import { rateLimit, type TgWebAppUser } from "@/lib/match/inline";

export type PlatformIdentity = {
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  phoneNumber?: string | null;
  phoneVerified: boolean;
};
export type PlatformServiceResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; code?: string; [k: string]: unknown } | null;
const fail = (error: string, code?: string, extra: Record<string, unknown> = {}): Exclude<PlatformServiceResult, null> =>
  ({ ok: false, error, ...(code ? { code } : {}), ...extra });

const PLATFORM_SERVICE_ACTIONS = new Set<string>([
  "remit_home",
  "remit_quote",
  "remit_create",
  "remit_status",
  "remit_del_recipient",
  "remit_recv_link",
  "ex_asset_identity_request",
  "ex_asset_list",
  "ex_asset_create",
  "ex_asset_buy",
  "ex_asset_sale",
  "ex_asset_transfer",
  "ex_asset_receive",
  "ex_list",
  "ex_deal_create",
  "ex_pay",
  "ex_deal",
  "ex_list_request",
  "ex_list_verify",
  "ex_manage",
  "ex_post",
  "ex_badge"
]);
export function isPlatformServiceAction(action: string): boolean {
  return PLATFORM_SERVICE_ACTIONS.has(action);
}

function transferView(x: Transfer) {
  const c = coinById(x.coin);
  return {
    track: x.track, status: x.status, statusLabel: STATUS_AR[x.status] || x.status, final: (FINAL as string[]).includes(x.status),
    coin: x.coin, coinLabel: c?.label || x.coin, fromAmount: x.from_amount, toAmount: x.to_amount, address: x.address, recipient: x.recipient,
    fromCountry: x.from_country, toCountry: x.to_country, payin: x.payin, payinExtra: x.payin_extra, payoutHash: x.payout_hash,
    createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at),
  };
}

export async function handlePlatformServiceAction(
  botRow: BotRow, tg: TgWebAppUser, action: string, body: any, identity?: PlatformIdentity,
): Promise<PlatformServiceResult> {
  if (!isPlatformServiceAction(action)) return null;
  const tgId = tg.id;
  const bot = new TelegramBot(botRow.token);
  // The asset market uses a shared ID-first identity table. Synchronize only the self-verified
  // contact already recorded by the current bot; never infer/accept a phone from the request body.
  if (action.startsWith("ex_asset_") && identity) {
    await upsertAssetIdentity({ id: tgId, ...identity }).catch(() => null);
  }
  switch (action) {
    // ------------------------------------------------------------------ 💸 الحوالات (100% platform: the partner's fee)
    case "remit_home": {
      const key = await remitKey();
      const [rows, book] = await Promise.all([transfersOf(tgId, 20).catch(() => []), savedRecipients(tgId).catch(() => [])]);
      return {
        ok: true, configured: !!key, transfers: rows.map(transferView), recipients: book,
        coins: PAY_COINS.map((c) => ({ id: c.id, label: c.label })), receive: RECEIVE.label,
        to: TO_COUNTRIES.map(([id, label]) => ({ id, label })), from: FROM_COUNTRIES.map(([id, label]) => ({ id, label })),
      };
    }
    case "remit_quote": {
      const key = await remitKey();
      if (!key) return fail("الحوالات تُفعَّل قريباً.", "off");
      const c = coinById(String(body?.coin || ""));
      if (!c) return fail("اختر العملة.");
      const amount = parseAmount(String(body?.amount ?? ""));
      if (!amount) {
        const q = await quoteAmount(c, 0, key).catch(() => null);
        return fail("اكتب المبلغ بالأرقام فقط، مثل 100 أو 0.005", "amount", { min: q?.min ?? null });
      }
      if (!rateLimit(`platform:${botRow.id}:rq:${tgId}`, 40, 60_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const q = await quoteAmount(c, amount, key);
      if (!q.ok) return fail(q.reason === "min" ? `أقل مبلغ لهذه العملة الآن ${rfmt(q.min || 0)} ${c.label}.` : "تعذّر حساب السعر الآن. جرّب مبلغاً آخر أو بعد قليل.", q.reason, { min: q.min });
      return { ok: true, quote: q.quote, min: q.min };
    }
    case "remit_create": {
      if (!rateLimit(`platform:${botRow.id}:rc:${tgId}`, 6, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const key = await remitKey();
      if (!key) return fail("الحوالات تُفعَّل قريباً.", "off");
      const c = coinById(String(body?.coin || ""));
      const amount = parseAmount(String(body?.amount ?? ""));
      const addr = String(body?.addr || "").trim();
      if (!c || !amount) return fail("أكمل العملة والمبلغ.");
      if (!isValidTronPayoutAddress(addr)) return fail("⚠️ عنوان TRC20 غير صحيح أو checksum غير صالح. راجع العنوان من محفظتك.");
      const q = await quoteAmount(c, amount, key);
      if (!q.ok) return fail(q.reason === "min" ? `أقل مبلغ لهذه العملة الآن ${rfmt(q.min || 0)} ${c.label}.` : "تعذّر حساب السعر الآن.", q.reason);
      const to = TO_COUNTRIES.some(([id]) => id === body?.to) ? String(body.to) : "xx";
      const from = FROM_COUNTRIES.some(([id]) => id === body?.from) ? String(body.from) : "xx";
      try {
        const created = await createTransferRecord(tgId, { step: "confirm", to, from, coin: c.id, amount, quote: q.quote, addr, name: String(body?.name || "").trim().slice(0, 30) || undefined }, key);
        if (!created) return fail("أكمل بيانات الحوالة.");
        const x = await transferByTrack(created.track);
        return { ok: true, transfer: x ? transferView(x) : null };
      } catch (e) {
        return fail(`⚠️ تعذّر إنشاء الحوالة الآن (${String((e as Error).message || "").slice(0, 80)}). جرّب بعد قليل أو بمبلغ آخر.`);
      }
    }
    case "remit_status": {
      const x = await transferByTrack(String(body?.track || "").toUpperCase());
      if (!x || x.chat_id !== tgId) return fail("الحوالة غير موجودة.");
      const key = await remitKey();
      if (key && !(FINAL as string[]).includes(x.status)) {
        const r = await syncTransferStatus(x, key).catch(() => null);
        if (r?.changed) {
          // The status change is pushed into THIS bot's chat too (the cron pushes through the site bot).
          await bot.api.sendMessage(Number(tgId), `🔔 تحديث الحوالة ${x.track}\n${STATUS_AR[r.transfer.status] || r.transfer.status}`).catch(() => null);
        }
        if (r) return { ok: true, transfer: transferView(r.transfer) };
      }
      return { ok: true, transfer: transferView(x) };
    }
    case "remit_del_recipient": {
      const a = String(body?.address || "").trim();
      if (!a) return fail("عنوان المستلم غير موجود.");
      // Allow removing legacy saved addresses even if they fail the new checksum validation.
      await deleteRecipient(tgId, a);
      return { ok: true };
    }
    case "remit_recv_link": {
      const a = String(body?.address || "").trim();
      if (!isValidTronPayoutAddress(a)) return fail("⚠️ عنوان TRC20 غير صحيح أو checksum غير صالح.");
      const me = await bot.api.getMe().catch(() => null);
      return { ok: true, link: me?.username ? `https://t.me/${me.username}?start=pay_${a}` : "", address: a };
    }

    // ------------------------------------------------------------------ 🛍️ سوق ملكية أصول تيليجرام (ID-first identity + verified handover)
    case "ex_asset_identity_request": {
      try {
        await bot.api.sendMessage(Number(tgId), "لإكمال هوية البائع والمشتري، شارك رقم هاتفك عبر زر تيليجرام الرسمي أدناه. لا ترسل الرقم كتابةً أو في رسالة عادية.", {
          reply_markup: new Keyboard().requestContact("📱 مشاركة رقم هاتفي").resized(),
        });
        const me = await bot.api.getMe().catch(() => null);
        return { ok: true, sent: true, link: me?.username ? `https://t.me/${me.username}` : null };
      } catch {
        return fail("افتح محادثة هذا البوت واضغط Start أولاً، ثم أعد طلب مشاركة رقم الهاتف.");
      }
    }
    case "ex_asset_list": {
      try {
        const [listings, myListings, mySales, identity, verifierBots] = await Promise.all([
          publicAssetListings(), myAssetListings(tgId), myAssetSales(tgId), assetIdentityForUser(tgId), assetVerifierBotNames(),
        ]);
        return { ok: true, listings, myListings, mySales, identity, verifierBots,
          rules: { commissionPct: 0, phoneRequired: true } };
      } catch {
        return fail("تعذّر تحميل سوق الأصول حالياً. أعد المحاولة.");
      }
    }
    case "ex_asset_create": {
      if (!rateLimit(`platform:${botRow.id}:asset-create:${tgId}`, 4, 600_000)) return fail("طلبات كثيرة. حاول بعد دقائق.");
      const r = await createAssetListing({
        assetType: String(body?.assetType || "").toUpperCase() as any,
        identifier: String(body?.identifier || ""), title: String(body?.title || ""),
        description: String(body?.description || ""), price: Number(body?.price),
        payoutAddress: String(body?.payoutAddress || ""),
      }, tgId);
      return r.ok ? { ok: true, id: r.id, status: r.status, verificationMode: r.verificationMode } : fail(r.error);
    }
    case "ex_asset_buy": {
      if (!rateLimit(`platform:${botRow.id}:asset-buy:${tgId}`, 5, 600_000)) return fail("طلبات شراء كثيرة. تمهّل قليلاً.");
      const r = await createAssetSale(String(body?.listingId || ""), tgId);
      return r.ok ? { ...r } : fail(r.error);
    }
    case "ex_asset_sale": {
      const code = String(body?.code || "").toUpperCase();
      const sale = await assetSaleDetails(code, tgId);
      return sale ? { ok: true, sale } : fail("الصفقة غير موجودة لهذا الحساب.");
    }
    case "ex_asset_transfer": {
      const r = await reportAssetTransfer(String(body?.code || "").toUpperCase(), tgId, String(body?.evidence || ""));
      return r.ok ? { ok: true, status: r.status } : fail(r.error);
    }
    case "ex_asset_receive": {
      const r = await confirmAssetReceipt(String(body?.code || "").toUpperCase(), tgId);
      return r.ok ? { ok: true, verified: r.verified, manualReview: !!r.manualReview } : fail(r.error);
    }
    // ------------------------------------------------------------------ 📣 بورصة القنوات والجروبات (15% escrow commission, 100% platform)
    case "ex_list": {
      try {
        const [listings, myDeals, myChannels] = await Promise.all([
          publicListings(), dealsForAdvertiser(tgId), listingTokensForOwner(tgId),
        ]);
        return { ok: true, listings, myDeals, myChannels, rules: { commissionPct: Math.round(COMMISSION_RATE * 100), minPrice: MIN_DEAL_USD, maxPrice: MAX_DEAL_USD, badgePrice: BADGE_PRICE_USD } };
      } catch {
        return fail("تعذّر تحميل البورصة الآن. احتفظ بطلباتك وحاول التحديث بعد قليل.");
      }
    }
    case "ex_deal_create": {
      if (!rateLimit(`platform:${botRow.id}:exd:${tgId}`, 10, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await createAdDeal({ channel: String(body?.channel || ""), adText: String(body?.adText || ""), targetUrl: String(body?.targetUrl || ""), contact: String(body?.contact || ""), advertiserTgId: tgId });
      return r.ok ? { ok: true, code: r.code, price: r.price } : fail(r.error);
    }
    case "ex_pay": {
      const m = ["stars", "nowpayments", "usdt"].includes(body?.method) ? body.method : "usdt";
      const r: any = await payDeal(String(body?.code || "").toUpperCase(), m, tgId);
      if (!r.ok) return fail(r.error);
      if (r.manual) return { ok: true, manual: true, amount: r.amount, usdt: r.usdt, network: r.network, note: `حوّل المبلغ واكتب الكود ${String(body?.code || "").toUpperCase()} في ملاحظة التحويل. تؤكده المنصة ثم تبدأ الصفقة.` };
      return { ok: true, url: r.invoiceUrl, stars: r.stars ?? null };
    }
    case "ex_deal": {
      const d = await dealByCode(String(body?.code || "").toUpperCase());
      if (!d || (d.advertiser_tg_id && d.advertiser_tg_id !== tgId)) return fail("الطلب غير موجود لهذا الحساب.");
      return { ok: true, deal: { code: d.code, kind: d.kind, channel: d.channel, price: d.price, status: d.status, postLink: d.post_link, paymentReference: d.payment_reference || null, settlementReference: d.settlement_reference || null, createdAt: d.created_at } };
    }
    case "ex_list_request": {
      if (!rateLimit(`platform:${botRow.id}:exl:${tgId}`, 6, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await requestListing({ channel: String(body?.channel || ""), ownerContact: String(body?.ownerContact || ""), payoutAddress: String(body?.payoutAddress || ""), price: Number(body?.price), ownerTgId: tgId });
      return r.ok ? { ok: true, username: r.username, verifyCode: r.verifyCode, token: r.manageUrl.split("/").pop() } : fail(r.error);
    }
    case "ex_list_verify": {
      if (!rateLimit(`platform:${botRow.id}:exv:${tgId}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r: any = await verifyListing(String(body?.token || ""), tgId);
      return r.ok ? { ok: true, already: !!r.already } : fail(r.error);
    }
    case "ex_manage": {
      const l = await listingByToken(String(body?.token || ""));
      if (!l || (l.owner_tg_id && l.owner_tg_id !== tgId)) return fail("القناة غير موجودة لهذا الحساب.");
      const deals = l.viaPending || l.status !== "LISTED" ? [] : await dealsForChannel(l.username).catch(() => []);
      return {
        ok: true,
        listing: { username: l.username, title: l.title, price: l.price, status: l.status, verifyCode: l.status === "LISTED" ? null : l.verify_code, verifiedUntil: l.verified_until && l.verified_until > new Date() ? l.verified_until.toISOString() : null },
        deals,
      };
    }
    case "ex_post": {
      if (!rateLimit(`platform:${botRow.id}:exp:${tgId}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r: any = await submitPost(String(body?.token || ""), String(body?.code || "").toUpperCase(), String(body?.link || ""), tgId);
      return r.ok ? { ok: true, verified: !!r.verified } : fail(r.error);
    }
    case "ex_badge": {
      const r: any = await createBadgeOrder(String(body?.token || ""), tgId);
      return r.ok ? { ok: true, code: r.code, price: r.price } : fail(r.error);
    }

  }
  return null;
}
