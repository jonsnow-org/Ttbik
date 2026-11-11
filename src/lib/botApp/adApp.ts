/**
 * The ads & earn bots' own Mini App (AD_BOT template: the builder's owner bot and every supervisor bot), server side.
 * Every action runs for the Telegram user proven by initData signed with THIS bot's token (checked by the route before
 * anything here). The money rules are the bot's own (src/lib/adBotLogic.ts cores: payoutTask, launchAdCore, cancelAdCore,
 * topupAdCore, requestUserWithdrawalCore): nothing here pays, charges or splits money differently from the chat.
 * Remittances (src/lib/remit/office.ts, ChangeNOW partner fee) and the channels & groups exchange (src/lib/channels/exchange.ts,
 * 15% escrow commission) earn 100% for the platform: no supervisor or user share is created for them here.
 */
import { publicSiteUrl } from "@/lib/siteUrl";
import { Bot as TelegramBot, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { t, type Lang } from "@/lib/i18n";
import {
  AD_TYPES, MIN_CPC_BY_TYPE, MIN_WITHDRAWAL, MYADS_DELETABLE_STATUSES, MYADS_LIST_STATUSES, REFERRAL_CONTEST_TARGET, TYPE_LABEL, WATCH_TIMER_SECONDS,
  applyChainDeposit, buildAdQueue, cancelAdCore, checkAndMarkContestWinner, countAdClicks, countReferrals, ensureUser, isAdVerifiedByUser, isBotHandle,
  isChannelMember, isOwnPlatformBotChatId, isPrivateBot, launchAdCore, mintAdClick, normalizeChannelHandle, payoutTask, reportAdCore,
  requestUserWithdrawalCore, round2, sendCampaignEndedReport, shortId, topupAdCore, userWithdrawalAdminText, type AdTypeStr, type CreateAdCollected,
} from "@/lib/adBotLogic";
import { timedClickStatus } from "@/lib/watchTarget";
import { socialStartUrl, hasSocialLink, type SocialPlatform } from "@/lib/socialProof";
import { hasYoutubeLink, youtubeStartUrl } from "@/lib/youtubeLink";
import { STAR_DEPOSIT_TIERS, starsPayload, usdForStars } from "@/lib/starsPayment";
import { createWalletDepositInvoice } from "@/lib/walletDepositInvoice";
import { isNowPaymentsConfigured } from "@/lib/nowpayments";
import { availableChains, checkUserDeposits, createDepositRequest, CHAIN_LABEL, MIN_USD, MAX_USD, type Chain } from "@/lib/chainDeposits";
import { getMasterHotWalletAddress, getOrCreateTonMemo, isNativeTonConfigured } from "@/services/ton-service";
import { apiKey as remitKey, createTransferRecord, deleteRecipient, fmt as rfmt, FROM_COUNTRIES, parseAmount, quoteAmount, savedRecipients, syncTransferStatus, TO_COUNTRIES, transferByTrack, transfersOf, type Transfer } from "@/lib/remit/office";
import { coinById, FINAL, PAY_COINS, RECEIVE, STATUS_AR } from "@/lib/remit/changenow";
import { createAdDeal, createBadgeOrder, dealByCode, dealsForAdvertiser, dealsForChannel, listingByToken, listingTokensForOwner, payDeal, publicListings, requestListing, submitPost, verifyListing } from "@/lib/channels/exchange";
import { assetIdentityForUser, assetVerifierBotNames, createAssetListing, createAssetSale, publicAssetListings, myAssetListings, myAssetSales, assetSaleDetails, reportAssetTransfer, confirmAssetReceipt, upsertAssetIdentity } from "@/lib/channels/assetMarket";
import { BADGE_PRICE_USD, COMMISSION_RATE, MAX_DEAL_USD, MIN_DEAL_USD } from "@/lib/channels/auditRules";
import { isValidTronPayoutAddress } from "@/lib/channels/payoutAddress";
import { rateLimit, type TgWebAppUser } from "@/lib/match/inline";

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const site = () => publicSiteUrl();
const SOCIAL: Record<string, SocialPlatform> = { TWITTER: "twitter", TIKTOK: "tiktok", FACEBOOK: "facebook", INSTAGRAM: "instagram", LINK: "link" };

export type AppResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; code?: string; [k: string]: unknown };
const fail = (error: string, code?: string, extra: Record<string, unknown> = {}): AppResult => ({ ok: false, error, ...(code ? { code } : {}), ...extra });
const isType = (v: unknown): v is AdTypeStr => typeof v === "string" && (AD_TYPES as string[]).includes(v);
const num = (v: unknown) => Number(String(v ?? "").replace(/[^0-9.]/g, ""));

// Required-channel gate (the bot asks for it on /start; the app asks too, for every user who is not the platform or the bot's supervisor).
const gateCache = new Map<string, { at: number; ok: boolean }>();
async function passesChannelGate(bot: TelegramBot, botRow: BotRow, tgId: string, fresh = false): Promise<boolean> {
  if (!botRow.requiredChannel || tgId === SUPER_ADMIN_ID || tgId === botRow.ownerId) return true;
  const key = `${botRow.id}:${tgId}`;
  const hit = gateCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
  const ok = await isChannelMember(bot, botRow.requiredChannel, tgId);
  gateCache.set(key, { at: Date.now(), ok });
  return ok;
}

/** The ad as the earn list shows it; the link to open is only handed out by earn_open (which starts the anti-cheat clock). */
function earnCard(ad: any, lang: Lang) {
  const type = ad.type as AdTypeStr;
  const handle = type === "TELEGRAM" ? normalizeChannelHandle(String(ad.content)) : null;
  const botTarget = handle !== null && isBotHandle(handle);
  return {
    id: ad.id, short: shortId(ad.id), type, platform: TYPE_LABEL[type][lang],
    description: ad.description ? String(ad.description) : null,
    forced: Number(ad.cpc) === 0, reward: Number(ad.workerCut),
    kind: handle !== null && !botTarget ? "join" : botTarget ? "bot" : "visit",
    timer: type !== "TELEGRAM" || botTarget ? WATCH_TIMER_SECONDS : 0,
  };
}

/** Same pool rule as the chat's carousel (buildAdQueue): this bot's targeted campaigns + the global pool, active, funded, not done. */
async function eligibleAd(tgId: string, botId: string, adId: string) {
  const ad = await prisma.ad.findUnique({ where: { id: adId } });
  if (!ad || ad.status !== "ACTIVE") return null;
  if (!(ad.scope === "GLOBAL" || (ad.scope === "TARGETED" && ad.botId === botId))) return null;
  if (!String(ad.content || "").trim()) return null;
  if (Number(ad.cpc) > 0 && (ad.userId === tgId || Number(ad.remaining) < Number(ad.cpc))) return null;
  return ad;
}

function phoneKeyboard(lang: Lang): Keyboard {
  return new Keyboard().requestContact(t(lang, "btnSharePhone")).row().text(t(lang, "btnBack")).resized();
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

export async function handleAdAppAction(botRow: BotRow, tg: TgWebAppUser, action: string, body: any): Promise<AppResult> {
  const tgId = tg.id;
  if (tgId !== SUPER_ADMIN_ID && (await isPrivateBot(botRow.id))) return fail("🔒 هذا البوت خاص بإدارة المنصة.", "private");
  const bot = new TelegramBot(botRow.token);
  const user = await ensureUser(botRow.id, tgId, botRow);
  await upsertAssetIdentity({ id: tgId, firstName: tg.firstName || "", lastName: tg.lastName || null, username: tg.username || null, phoneNumber: user.phoneNumber || null, phoneVerified: !!user.phoneVerified }).catch(() => null);
  const lang: Lang = user.language === "en" ? "en" : "ar";

  if (action === "init" || action === "gate_check") {
    const joined = await passesChannelGate(bot, botRow, tgId, action === "gate_check");
    const me = await bot.api.getMe().catch(() => null);
    return {
      ok: true,
      gate: joined ? null : { channel: normalizeChannelHandle(botRow.requiredChannel || "") },
      user: { id: tgId, firstName: tg.firstName || "", username: tg.username || "", lang, balance: Number(user.balance || 0), phoneVerified: !!user.phoneVerified },
      bot: { username: me?.username || "" },
      config: {
        types: AD_TYPES.map((k) => ({ type: k, ar: TYPE_LABEL[k].ar, en: TYPE_LABEL[k].en, minCpc: MIN_CPC_BY_TYPE[k] })),
        minWithdrawal: MIN_WITHDRAWAL, timer: WATCH_TIMER_SECONDS, contestTarget: REFERRAL_CONTEST_TARGET,
        stars: STAR_DEPOSIT_TIERS.map((s) => ({ stars: s, usd: round2(usdForStars(s)) })),
        crypto: isNowPaymentsConfigured(), ton: isNativeTonConfigured(),
        chains: availableChains().map((c) => ({ chain: c, label: CHAIN_LABEL[c] })), chainMin: MIN_USD, chainMax: MAX_USD,
      },
    };
  }
  if (action === "lang") {
    const next: Lang = body?.lang === "en" ? "en" : "ar";
    await prisma.user.update({ where: { id: tgId }, data: { language: next } });
    return { ok: true, lang: next };
  }
  if (!(await passesChannelGate(bot, botRow, tgId))) return fail("انضم إلى قناة البوت أولاً.", "gate");

  switch (action) {
    // ------------------------------------------------------------------ 👀 شاهد واربح
    case "earn_list": {
      if (!isType(body?.type)) return fail("اختر المنصة.");
      const ids = await buildAdQueue(tgId, body.type, botRow.id);
      const ads = ids.length ? await prisma.ad.findMany({ where: { id: { in: ids } } }) : [];
      const byId = new Map(ads.map((a) => [a.id, a]));
      return { ok: true, ads: ids.map((id) => byId.get(id)).filter(Boolean).map((a) => earnCard(a, lang)) };
    }
    case "earn_open": {
      const ad = await eligibleAd(tgId, botRow.id, String(body?.adId || ""));
      if (!ad) return fail(t(lang, "taskGone"), "gone");
      const type = ad.type as AdTypeStr;
      const handle = type === "TELEGRAM" ? normalizeChannelHandle(String(ad.content)) : null;
      if (handle !== null && !isBotHandle(handle)) {
        return { ok: true, url: `https://t.me/${handle}`, telegram: true, timer: 0 };
      }
      const click = await mintAdClick(ad.id, tgId, botRow.id);
      if (handle !== null) {
        const target = await bot.api.getChat(`@${handle}`).catch(() => null);
        const ownPlatformBot = !!target && await isOwnPlatformBotChatId(target.id);
        if (ownPlatformBot) {
          return { ok: true, url: `https://t.me/${handle}?start=adv_${click.id}`, telegram: true, timer: 0 };
        }
      }
      // Open the watch page first. Only its explicit POST /open click starts
      // the authoritative server timer; the miniapp's own clock is cosmetic.
      return { ok: true, url: `${site()}/watch/${click.id}`, telegram: false, timer: WATCH_TIMER_SECONDS };
    }
    case "earn_status": {
      const ad = await eligibleAd(tgId, botRow.id, String(body?.adId || ""));
      if (!ad) return fail(t(lang, "taskGone"), "gone");
      const click = await prisma.adClick.findUnique({
        where: { adId_userId: { adId: ad.id, userId: tgId } },
        select: { issuedAt: true, verified: true },
      });
      return { ok: true, ...timedClickStatus(click, Date.now(), WATCH_TIMER_SECONDS) };
    }
    case "earn_verify": {
      if (!user.phoneVerified) return fail(t(lang, "phoneRequiredAlert"), "phone");
      if (user.multiAccountFlag) return fail(t(lang, "accountFlaggedAlert"), "flagged");
      const ad = await eligibleAd(tgId, botRow.id, String(body?.adId || ""));
      if (!ad) return fail(t(lang, "taskGone"), "gone");
      if (Number(ad.cpc) === 0) return fail(t(lang, "taskGone"), "gone"); // forced platform ads carry no reward (no verify button in the chat either)
      if (ad.userId === tgId) return fail(t(lang, "taskOwnCampaign"), "own");
      const verified = await isAdVerifiedByUser(bot, ad, tgId);
      if (!verified) {
        return fail(t(lang, "carouselNotDoneAlert"), "not_done");
      }
      const r = await payoutTask(tgId, ad.id, botRow.id);
      if (!r.ok) {
        const msg = r.reason === "already_claimed" ? t(lang, "taskAlreadyClaimed") : r.reason === "own" ? t(lang, "taskOwnCampaign") : r.reason === "flagged" ? t(lang, "accountFlaggedAlert") : t(lang, "taskGone");
        return fail(msg, r.reason);
      }
      if (r.adExpired) {
        const owner = await prisma.user.findUnique({ where: { id: ad.userId }, select: { language: true } });
        await sendCampaignEndedReport(bot, ad, owner?.language === "en" ? "en" : "ar");
      }
      return { ok: true, reward: r.workerCut, balance: r.newBalance };
    }
    case "earn_report": {
      const ad = await prisma.ad.findUnique({ where: { id: String(body?.adId || "") } });
      if (!ad) return fail(t(lang, "taskGone"), "gone");
      const r = await reportAdCore(bot, ad.id, tgId);
      return r === "already" ? fail(t(lang, "reportAlready"), "already") : { ok: true, message: t(lang, "reportReceived") };
    }
    case "phone_prompt": {
      // The chat's own «share phone» keyboard: the contact it sends is verified by the bot exactly as before.
      await bot.api.sendMessage(Number(tgId), t(lang, "phoneVerifyPrompt"), { reply_markup: phoneKeyboard(lang) }).catch(() => null);
      return { ok: true };
    }
    case "accounts": {
      const plats: SocialPlatform[] = ["twitter", "tiktok", "facebook", "instagram", "link"];
      const linked = Object.fromEntries(await Promise.all(plats.map(async (p) => [p, await hasSocialLink(tgId, p)] as const)));
      return { ok: true, linked: { ...linked, youtube: await hasYoutubeLink(tgId).catch(() => false) } };
    }
    case "link_account": {
      // The account-link page is sent into the chat (same message as «🔗 حساباتي»), so the app itself never opens the site.
      const p = String(body?.platform || "");
      const link = p === "youtube" ? youtubeStartUrl(site(), tgId) : (["twitter", "tiktok", "facebook", "instagram", "link"] as string[]).includes(p) ? socialStartUrl(site(), tgId, p as SocialPlatform) : null;
      if (!link) return fail(p === "youtube" ? t(lang, "youtubeLinkUnconfigured") : "منصة غير معروفة.");
      await bot.api.sendMessage(Number(tgId), t(lang, "youtubeLinkPrompt", { link })).catch(() => null);
      return { ok: true };
    }

    // ------------------------------------------------------------------ ➕ ضع إعلانك
    case "ad_check_target": {
      if (!isType(body?.type)) return fail("اختر المنصة.");
      const target = String(body?.target || "").trim();
      if (!target) return fail(t(lang, "adTargetEmptyError"));
      if (body.type !== "TELEGRAM") return { ok: true };
      const raw = normalizeChannelHandle(target);
      const handle = `@${raw}`;
      const chat = await bot.api.getChat(handle).catch(() => null);
      if (!chat) return fail(t(lang, "adTelegramChannelNotFound", { handle }), "not_found");
      if (isBotHandle(raw)) return { ok: true, note: t(lang, (await isOwnPlatformBotChatId(chat.id)) ? "adTelegramBotTargetOwnPlatform" : "adTelegramBotTargetExternal", { handle }) };
      const me = await bot.api.getMe();
      const m = await bot.api.getChatMember(handle, me.id).catch(() => null);
      return { ok: true, note: !m || !["administrator", "creator"].includes(m.status) ? t(lang, "adTelegramBotNotAdminWarning", { handle }) : null };
    }
    case "ad_create": {
      if (!rateLimit(`adapp-create:${tgId}`, 10, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      if (!isType(body?.type)) return fail("اختر المنصة.");
      const type = body.type as AdTypeStr;
      const c: CreateAdCollected = {
        scope: body.scope === "GLOBAL" ? "GLOBAL" : "TARGETED",
        description: String(body.description || "").trim().slice(0, 600),
        target: String(body.target || "").trim().slice(0, 500),
        budget: num(body.budget), cpc: num(body.cpc),
      };
      if (!c.description) return fail(t(lang, "adDescriptionEmptyError"));
      if (!c.target) return fail(t(lang, "adTargetEmptyError"));
      if (type === "TELEGRAM" && !(await bot.api.getChat(`@${normalizeChannelHandle(c.target)}`).catch(() => null))) return fail(t(lang, "adTelegramChannelNotFound", { handle: `@${normalizeChannelHandle(c.target)}` }));
      if (!Number.isFinite(c.budget) || !(c.budget! > 0)) return fail(t(lang, "adBudgetError"));
      const min = MIN_CPC_BY_TYPE[type];
      if (!Number.isFinite(c.cpc) || c.cpc! < min) return fail(t(lang, "adCpcMinError", { platform: TYPE_LABEL[type][lang], min }));
      if (c.cpc! > c.budget!) return fail(t(lang, "adCpcOverBudgetError"));
      const r = await launchAdCore(tgId, type, c, botRow.id);
      if (!r.ok && r.reason === "insufficient") return fail(`رصيدك ${r.balance.toFixed(2)}$ لا يكفي ميزانية ${r.budget.toFixed(2)}$. اشحن محفظتك ثم أكّد.`, "insufficient", { balance: r.balance, budget: r.budget });
      if (!r.ok) return fail(t(lang, "adAutoRejected"), "rejected");
      return { ok: true, budget: r.budget };
    }

    // ------------------------------------------------------------------ 📢 إعلاناتي
    case "my_ads": {
      const ads = await prisma.ad.findMany({ where: { userId: tgId, status: { in: MYADS_LIST_STATUSES as any } }, orderBy: { created_at: "desc" }, take: 30 });
      const rows = await Promise.all(ads.map(async (a) => ({
        id: a.id, short: shortId(a.id), type: a.type, platform: TYPE_LABEL[a.type as AdTypeStr][lang], status: a.status, description: a.description, content: a.content,
        cpc: Number(a.cpc), total: Number(a.totalBudget), remaining: Number(a.remaining), spent: round2(Number(a.totalBudget) - Number(a.remaining)), clicks: await countAdClicks(a.id),
        scope: a.scope,
      })));
      return { ok: true, ads: rows };
    }
    case "ad_op": {
      const ad = await prisma.ad.findUnique({ where: { id: String(body?.adId || "") } });
      if (!ad || ad.userId !== tgId) return fail(t(lang, "myAdNotFound"), "gone");
      const op = String(body?.op || "");
      if (op === "pause" && ad.status === "ACTIVE") { await prisma.ad.update({ where: { id: ad.id }, data: { status: "PAUSED" } }); return { ok: true, message: t(lang, "myAdPaused") }; }
      if (op === "resume" && ad.status === "PAUSED") { await prisma.ad.update({ where: { id: ad.id }, data: { status: "ACTIVE" } }); return { ok: true, message: t(lang, "myAdResumed") }; }
      const open = ad.status === "ACTIVE" || ad.status === "PAUSED" || ad.status === "EXPIRED";
      if (op === "topup" && open) {
        const amount = round2(Number(String(body?.amount ?? "").trim().replace(",", ".")));
        if (!Number.isFinite(amount) || amount <= 0) return fail(t(lang, "myAdTopupInvalid"));
        const fresh = await prisma.user.findUnique({ where: { id: tgId } });
        if (amount > Number(fresh?.balance || 0) || !(await topupAdCore(tgId, ad, amount))) return fail(`رصيدك ${Number(fresh?.balance || 0).toFixed(2)}$ لا يكفي ${amount.toFixed(2)}$.`, "insufficient");
        return { ok: true, message: t(lang, "myAdTopupDone", { amount: `$${amount.toFixed(2)}`, remaining: `$${round2(Number(ad.remaining) + amount).toFixed(2)}` }) };
      }
      if (op === "cancel" && open) {
        if (!(await cancelAdCore(tgId, ad))) return fail(t(lang, "myAdNotFound"), "gone");
        return { ok: true, message: t(lang, "myAdCancelledOk", { amount: `$${Number(ad.remaining).toFixed(2)}` }) };
      }
      if (op === "delete" && MYADS_DELETABLE_STATUSES.includes(ad.status)) { await prisma.ad.delete({ where: { id: ad.id } }); return { ok: true, message: t(lang, "myAdDeletedOk") }; }
      return fail("هذا الإجراء غير متاح لهذه الحملة الآن.");
    }

    // ------------------------------------------------------------------ 📊 / 🙌 / 💰
    case "stats": {
      const [ads, spent, earned, tasks] = await Promise.all([
        prisma.ad.count({ where: { userId: tgId } }),
        prisma.transaction.aggregate({ where: { userId: tgId, type: "AD_PAYMENT" }, _sum: { amount: true } }),
        prisma.transaction.aggregate({ where: { userId: tgId, type: "TASK_REWARD" }, _sum: { amount: true } }),
        prisma.transaction.count({ where: { userId: tgId, type: "TASK_REWARD" } }),
      ]);
      return { ok: true, ads, spent: Number(spent._sum.amount || 0), earned: Number(earned._sum.amount || 0), tasks };
    }
    case "referrals": {
      const me = await bot.api.getMe().catch(() => null);
      const count = await countReferrals(tgId);
      const won = await checkAndMarkContestWinner(bot, botRow, user, count);
      return { ok: true, count, won, full: !won && count >= REFERRAL_CONTEST_TARGET, target: REFERRAL_CONTEST_TARGET, link: me?.username ? `https://t.me/${me.username}?start=${tgId}` : "" };
    }
    case "wallet": {
      const [fresh, txs] = await Promise.all([
        prisma.user.findUnique({ where: { id: tgId } }),
        prisma.transaction.findMany({ where: { userId: tgId }, orderBy: { created_at: "desc" }, take: 15, select: { id: true, amount: true, type: true, status: true, created_at: true, currency: true } }),
      ]);
      return { ok: true, balance: Number(fresh?.balance || 0), txs: txs.map((x) => ({ id: shortId(x.id), amount: Number(x.amount), type: x.type, status: x.status, at: x.created_at.toISOString() })) };
    }
    case "deposit_stars": {
      const stars = Number(body?.stars);
      if (!(STAR_DEPOSIT_TIERS as readonly number[]).includes(stars)) return fail("اختر باقة نجوم.");
      const usd = usdForStars(stars).toFixed(2);
      const title = (lang === "ar" ? "شحن رصيد المحفظة" : "Wallet top-up").slice(0, 32);
      const description = (lang === "ar" ? `شحن ${usd}$ في رصيدك عبر نجوم تيليجرام` : `Add $${usd} to your balance via Telegram Stars`).slice(0, 255);
      try {
        // Same payload as the chat's invoice: the bot's successful_payment handler credits it (idempotent on the charge id).
        const link = await bot.api.createInvoiceLink(title, description, starsPayload("ADBOT_DEPOSIT", tgId), "", "XTR", [{ label: title, amount: stars }]);
        return { ok: true, link };
      } catch (e) {
        console.error("bot-app createInvoiceLink failed", (e as Error)?.message);
        return fail("تعذّر إنشاء فاتورة النجوم الآن.");
      }
    }
    case "deposit_crypto": {
      const r = await createWalletDepositInvoice(tgId, body?.amount);
      return r.ok ? { ok: true, url: r.invoiceUrl } : fail(r.error);
    }
    case "deposit_ton": {
      if (!isNativeTonConfigured()) return fail("إيداع TON غير متاح حالياً.");
      return { ok: true, address: getMasterHotWalletAddress(), memo: await getOrCreateTonMemo(tgId) };
    }
    case "deposit_chain": {
      const chain = String(body?.chain || "") as Chain;
      if (!availableChains().includes(chain)) return fail("هذه العملة غير متاحة حالياً.");
      const r = await createDepositRequest(tgId, chain, num(body?.usd));
      if (!r.ok) {
        const why: Record<string, string> = { range: `المبلغ يجب أن يكون بين ${MIN_USD}$ و${MAX_USD}$.`, too_many: "لديك طلبات إيداع مفتوحة كثيرة. أكمل أحدها أو انتظر انتهاءها.", price: "تعذّر الحصول على سعر موثوق الآن، حاول بعد قليل.", busy: "ازدحام مؤقت، أعد المحاولة.", no_address: "هذه العملة غير متاحة حالياً." };
        return fail(why[r.reason] || "تعذّر إنشاء الطلب.");
      }
      return { ok: true, request: { address: r.address, amount: r.amount, asset: r.asset, usd: r.usd, expiresInMin: r.expiresInMin, chain } };
    }
    case "deposit_chain_check": {
      const r = await checkUserDeposits(tgId, applyChainDeposit);
      const fresh = await prisma.user.findUnique({ where: { id: tgId } });
      return { ok: true, credited: r.credited.reduce((a, c) => a + c.usd, 0), pending: r.pending, readFailed: r.readFailed, balance: Number(fresh?.balance || 0) };
    }
    case "withdraw": {
      if (!rateLimit(`adapp-wd:${tgId}`, 5, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const address = String(body?.address || "").trim();
      if (address.length < 10) return fail(t(lang, "withdrawAddressError"));
      const amount = num(body?.amount);
      const r = await requestUserWithdrawalCore(tgId, address, amount);
      if (!r.ok) return fail(r.reason === "min" ? t(lang, "withdrawMinError", { min: MIN_WITHDRAWAL }) : t(lang, "withdrawInsufficient", { balance: `$${r.balance.toFixed(2)}` }));
      if (SUPER_ADMIN_ID) await bot.api.sendMessage(Number(SUPER_ADMIN_ID), userWithdrawalAdminText(tgId, amount, address, r.isAudit, r.id)).catch(() => null);
      return { ok: true, message: t(lang, "withdrawSent", { amount: `$${amount.toFixed(2)}` }) };
    }

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
      if (!rateLimit(`adapp-rq:${tgId}`, 40, 60_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const q = await quoteAmount(c, amount, key);
      if (!q.ok) return fail(q.reason === "min" ? `أقل مبلغ لهذه العملة الآن ${rfmt(q.min || 0)} ${c.label}.` : "تعذّر حساب السعر الآن. جرّب مبلغاً آخر أو بعد قليل.", q.reason, { min: q.min });
      return { ok: true, quote: q.quote, min: q.min };
    }
    case "remit_create": {
      if (!rateLimit(`adapp-rc:${tgId}`, 6, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
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
          rules: { commissionPct: 0, minPrice: 10, phoneRequired: true } };
      } catch {
        return fail("تعذّر تحميل سوق الأصول حالياً. أعد المحاولة.");
      }
    }
    case "ex_asset_create": {
      if (!rateLimit(`adapp-asset-create:${tgId}`, 4, 600_000)) return fail("طلبات كثيرة. حاول بعد دقائق.");
      const r = await createAssetListing({
        assetType: String(body?.assetType || "").toUpperCase() as any,
        identifier: String(body?.identifier || ""), title: String(body?.title || ""),
        description: String(body?.description || ""), price: Number(body?.price),
        payoutAddress: String(body?.payoutAddress || ""),
      }, tgId);
      return r.ok ? { ok: true, id: r.id, status: r.status, verificationMode: r.verificationMode } : fail(r.error);
    }
    case "ex_asset_buy": {
      if (!rateLimit(`adapp-asset-buy:${tgId}`, 5, 600_000)) return fail("طلبات شراء كثيرة. تمهّل قليلاً.");
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
      if (!rateLimit(`adapp-exd:${tgId}`, 10, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
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
      if (!rateLimit(`adapp-exl:${tgId}`, 6, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await requestListing({ channel: String(body?.channel || ""), ownerContact: String(body?.ownerContact || ""), payoutAddress: String(body?.payoutAddress || ""), price: Number(body?.price), ownerTgId: tgId });
      return r.ok ? { ok: true, username: r.username, verifyCode: r.verifyCode, token: r.manageUrl.split("/").pop() } : fail(r.error);
    }
    case "ex_list_verify": {
      if (!rateLimit(`adapp-exv:${tgId}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
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
      if (!rateLimit(`adapp-exp:${tgId}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r: any = await submitPost(String(body?.token || ""), String(body?.code || "").toUpperCase(), String(body?.link || ""), tgId);
      return r.ok ? { ok: true, verified: !!r.verified } : fail(r.error);
    }
    case "ex_badge": {
      const r: any = await createBadgeOrder(String(body?.token || ""), tgId);
      return r.ok ? { ok: true, code: r.code, price: r.price } : fail(r.error);
    }
  }
  return fail("طلب غير معروف.");
}
