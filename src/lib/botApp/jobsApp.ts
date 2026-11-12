/**
 * The jobs/store bot's own Mini App (JOBS_BOT, @Saragptbotbot), server side. Every action runs for the Telegram user proven by
 * initData signed with THIS bot's token (checked by /api/bot-app/[botId]). The rules are the chat's own (src/lib/jobs/core.ts,
 * src/lib/jobsTenders.ts, src/lib/jobs/shop.ts): the same gates (ban, mute, required channel, verified phone, profile), the same
 * roles, the same escrow, offers, disputes, featured listings and tenders. Chat notifications go out through src/lib/jobs/notify.ts.
 */
import { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow, JobsProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeRequiredChannel, requiredChannelChatId } from "@/lib/telegramChannel";
import { rateLimit, type TgWebAppUser } from "@/lib/match/inline";
import {
  PROFESSIONAL_CATEGORIES, ROLES, acceptOfferCore, adminMessageCore, blockUser, chargeJobsUser, confirmReceivedCore, contactUrlOf, counterOfferCore,
  createJobPostingCore, createOfferCore, deleteListingCore, deleteWantedCore, isBlocked, openDisputeCore, otherPartyOf, rejectOfferCore, reportCore,
  saveListingCore, saveProfileCore, saveWantedCore, searchJobPostings, searchListings, searchProfessionals, searchWanted, submitDisputeCore,
  toggleListingCore, toggleProfilePause, toggleWantedCore, type StoreFilters,
} from "@/lib/jobs/core";
import {
  appLink, notifyAcceptOutcome, notifyAdminMessage, notifyDisputeOpened, notifyDisputeReady, notifyOfferRejected, notifyOfferToOtherParty, notifyReceived,
} from "@/lib/jobs/notify";
import { featureListing, featuredListingIds, featuredUntil, listShops, sellerBySlug, shopSlugFor } from "@/lib/jobs/shop";
import { FEATURE_DAYS, FEATURE_PRICE_USD, botLink, itemStart, isListingId, shopShareText, shopStart } from "@/lib/jobs/shopRules";
import {
  MAX_SHOWN_BIDS, TENDER_DURATIONS, TENDER_MAX_OPEN, awardBidCore, bidEligibility, closeTenderCore, inboxTenders, publishTenderCore, submitBidCore, validateTenderDraft,
} from "@/lib/jobsTenders";
import { STAR_DEPOSIT_TIERS, STARS_PER_USD, starsPayload, usdForStars } from "@/lib/starsPayment";
import { getMasterHotWalletAddress, isNativeTonConfigured } from "@/services/ton-service";
import { getOrCreateJobsTonMemo } from "@/services/jobsTonService";

export type AppResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; code?: string; [k: string]: unknown };
const fail = (error: string, code?: string): AppResult => ({ ok: false, error, ...(code ? { code } : {}) });
const SUPER_ADMIN_ID = () => process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const ID = /^[0-9a-f-]{36}$/i;
const id = (v: unknown) => (ID.test(String(v || "")) ? String(v) : "");
const PAGE = 20;

const gateCache = new Map<string, { at: number; ok: boolean }>();
async function passesChannelGate(bot: TelegramBot, botRow: BotRow, tgId: string, fresh = false): Promise<boolean> {
  if (!botRow.requiredChannel || tgId === SUPER_ADMIN_ID()) return true;
  const key = `${botRow.id}:${tgId}`;
  const hit = gateCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
  // Same rule as the chat: fail open when the channel or the bot's admin rights are misconfigured.
  const channel = normalizeRequiredChannel(botRow.requiredChannel);
  if (!channel) return false;
  const m = await bot.api.getChatMember(requiredChannelChatId(channel) as any, Number(tgId)).catch(() => null);
  const ok = !m || ["creator", "administrator", "member"].includes(m.status);
  gateCache.set(key, { at: Date.now(), ok });
  return ok;
}

const usernames = new Map<string, string>();
async function botUsername(bot: TelegramBot, botId: string) {
  const hit = usernames.get(botId);
  if (hit) return hit;
  const me = await bot.api.getMe().catch(() => null);
  if (me?.username) usernames.set(botId, me.username);
  return me?.username || "";
}
const photosOf = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);
const roleLabel = (r: string) => (r === "SEEKER" ? "👷 باحث عن عمل" : r === "EMPLOYER" ? "🏢 معلن وظيفة" : r === "PROFESSIONAL" ? "🔨 مهني مقدّم خدمة" : "🛒 تاجر");
function profileView(p: JobsProfile | null) {
  if (!p) return null;
  return {
    name: p.name, age: p.age, country: p.country, governorate: p.governorate, city: p.city, contactMethod: p.contactMethod, contactValue: p.contactValue,
    roleType: p.roleType, roleLabel: roleLabel(p.roleType), seekerProfession: p.seekerProfession, employerBusinessName: p.employerBusinessName,
    professionalCategory: p.professionalCategory, professionalDescription: p.professionalDescription, isPaused: p.isPaused,
  };
}
type ListingRow = { id: string; sellerId: string; title: string; description: string | null; price: number; photoFileIds: unknown; deliveryMethod: string; paymentMethod: string; status: string; created_at: Date };
function listingView(l: ListingRow, uid: string, featured: Set<string>, names?: Map<string, string>) {
  return {
    id: l.id, title: l.title, description: l.description || "", price: l.price, photos: photosOf(l.photoFileIds), shipping: l.deliveryMethod === "SHIPPING",
    escrow: l.paymentMethod === "ESCROW", status: l.status, featured: featured.has(l.id), mine: l.sellerId === uid, at: l.created_at.toISOString(),
    seller: names?.get(l.sellerId) || null,
  };
}
async function namesOf(ids: string[]) {
  const ps = ids.length ? await prisma.jobsProfile.findMany({ where: { userId: { in: Array.from(new Set(ids)) } }, select: { userId: true, name: true, city: true } }) : [];
  return new Map(ps.map((p) => [p.userId, `${p.name}${p.city ? ` · ${p.city}` : ""}`]));
}
function filtersOf(b: any): StoreFilters {
  const n = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
  return { min: n(b?.min), max: n(b?.max), escrow: !!b?.escrow, shipping: !!b?.shipping, sort: ["price_asc", "price_desc"].includes(b?.sort) ? b.sort : "new" };
}

export async function handleJobsAppAction(botRow: BotRow, tg: TgWebAppUser, action: string, body: any): Promise<AppResult> {
  const uid = tg.id;
  const bot = new TelegramBot(botRow.token);
  const user = await prisma.jobsUser.upsert({ where: { id: uid }, update: {}, create: { id: uid, botId: botRow.id } });
  if (user.isBanned) return fail("🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.", "banned");
  if (user.mutedUntil && user.mutedUntil > new Date()) return fail("🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.", "muted");
  const username = await botUsername(bot, botRow.id);

  if (action === "init" || action === "gate_check") {
    const joined = await passesChannelGate(bot, botRow, uid, action === "gate_check");
    await prisma.jobsUser.update({ where: { id: uid }, data: { lastActiveAt: new Date() } }).catch(() => null);
    const profile = await prisma.jobsProfile.findUnique({ where: { userId: uid } });
    const [offersWaiting, ordersOpen, active] = profile
      ? await Promise.all([
          prisma.storeOffer.findMany({ where: { status: "PENDING", OR: [{ buyerId: uid }, { sellerId: uid }] }, select: { lastOfferBy: true } }).then((r) => r.filter((o) => o.lastOfferBy !== uid).length),
          prisma.storeOrder.count({ where: { status: "ESCROWED", OR: [{ buyerId: uid }, { sellerId: uid }] } }),
          prisma.storeListing.count({ where: { sellerId: uid, status: "ACTIVE" } }),
        ])
      : [0, 0, 0];
    return {
      ok: true, gate: joined ? null : { channel: String(botRow.requiredChannel || "").replace(/^@/, "") }, phoneVerified: user.phoneVerified,
      user: { id: uid, firstName: tg.firstName || "", username: tg.username || "" }, bot: { username }, profile: profileView(profile),
      balance: user.balance, counts: { offersWaiting, ordersOpen, active }, categories: PROFESSIONAL_CATEGORIES, roles: ROLES.map((r) => ({ id: r, label: roleLabel(r) })),
      durations: Object.entries(TENDER_DURATIONS).map(([label, hours]) => ({ label: label.replace("⏱ ", ""), hours })), maxOpenTenders: TENDER_MAX_OPEN,
      feature: { price: FEATURE_PRICE_USD, days: FEATURE_DAYS },
    };
  }
  if (!(await passesChannelGate(bot, botRow, uid))) return fail("انضم إلى قناة البوت أولاً.", "gate");
  // Same as the chat: verifying the phone number is mandatory before using the bot (shared from Telegram's own contact button).
  if (!user.phoneVerified) return fail("📱 التحقق من رقم الهاتف خطوة إلزامية قبل استخدام هذا البوت.", "phone");

  if (action === "profile_save") {
    if (!rateLimit(`japp-ps:${uid}`, 10, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
    const r = await saveProfileCore(uid, body?.profile || {});
    return r.ok ? { ok: true, profile: profileView(r.profile) } : fail(r.error);
  }
  if (action === "admin_msg") {
    if (!rateLimit(`japp-am:${uid}`, 5, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
    const suggestion = !!body?.suggestion;
    const r = await adminMessageCore(uid, body?.text, suggestion);
    if (!r.ok) return fail(r.error);
    await notifyAdminMessage(bot, uid, r.id, r.text, suggestion);
    return { ok: true };
  }
  // Same as the chat: everything else needs the short profile first.
  const profile = await prisma.jobsProfile.findUnique({ where: { userId: uid } });
  if (!profile) return fail("أكمل ملفك الشخصي أولاً (دقيقة واحدة).", "profile");

  switch (action) {
    case "profile_pause": {
      const r = await toggleProfilePause(uid);
      return r.ok ? { ok: true, isPaused: r.isPaused } : fail(r.error);
    }

    // ---------------------------------------------------------------- 🛒 المتجر
    case "store_list": {
      const offset = Math.max(0, Math.min(2000, Number(body?.offset) || 0));
      if (body?.tab === "buy") {
        const r = await searchWanted(uid, String(body?.q || ""), offset, PAGE);
        const names = await namesOf(r.rows.map((w) => w.buyerId));
        return { ok: true, more: r.more, items: r.rows.map((w) => ({ id: w.id, title: w.title, description: w.description || "", budget: w.budget, status: w.status, at: w.created_at.toISOString(), buyer: names.get(w.buyerId) || null })) };
      }
      const fids = await featuredListingIds().catch(() => [] as string[]);
      const r = await searchListings(uid, String(body?.q || ""), offset, fids, filtersOf(body?.filters), PAGE);
      const f = new Set(fids);
      const names = await namesOf([...r.rows, ...r.featured].map((l) => l.sellerId));
      const top = r.featured.slice(0, 3);
      const topIds = new Set(top.map((x) => x.id));
      const items = [...top, ...r.rows.filter((x) => !topIds.has(x.id))].map((l) => listingView(l, uid, f, names));
      return { ok: true, more: r.more, items };
    }
    case "listing_get": {
      const l = await prisma.storeListing.findUnique({ where: { id: id(body?.id) } });
      if (!l) return fail("هذا المنتج غير موجود.", "gone");
      const isOwner = l.sellerId === uid;
      if (!isOwner && (await isBlocked(uid, l.sellerId))) return fail("🚫 غير متاح.", "blocked");
      if (!isOwner && l.status !== "ACTIVE" && l.status !== "SOLD") return fail("لم يعد هذا المنتج متاحاً.", "gone");
      const [seller, fu, slugRow, pending] = await Promise.all([
        prisma.jobsProfile.findUnique({ where: { userId: l.sellerId } }),
        l.status === "ACTIVE" ? featuredUntil(l.id).catch(() => null) : Promise.resolve(null),
        prisma.$queryRaw<{ slug: string }[]>`SELECT slug FROM jobs_shops WHERE seller_id = ${l.sellerId}`.catch(() => [] as { slug: string }[]),
        isOwner ? Promise.resolve(0) : prisma.storeOffer.count({ where: { listingId: l.id, buyerId: uid, status: "PENDING" } }),
      ]);
      return {
        ok: true, listing: { ...listingView(l, uid, new Set(fu ? [l.id] : [])), featuredUntil: fu ? fu.toISOString() : null },
        seller: { id: isOwner ? null : l.sellerId, name: seller?.name || "تاجر", place: [seller?.city, seller?.governorate].filter(Boolean).join("، "), shop: slugRow[0]?.slug || null },
        myPendingOffers: pending, share: username ? botLink(username, itemStart(l.id)) : null,
      };
    }
    case "wanted_get": {
      const w = await prisma.storeWantedListing.findUnique({ where: { id: id(body?.id) } });
      if (!w) return fail("هذا الطلب غير موجود.", "gone");
      const isOwner = w.buyerId === uid;
      if (!isOwner && (await isBlocked(uid, w.buyerId))) return fail("🚫 غير متاح.", "blocked");
      if (!isOwner && w.status !== "ACTIVE") return fail("لم يعد هذا الطلب متاحاً.", "gone");
      const buyer = await prisma.jobsProfile.findUnique({ where: { userId: w.buyerId } });
      return { ok: true, wanted: { id: w.id, title: w.title, description: w.description || "", budget: w.budget, status: w.status, mine: isOwner, at: w.created_at.toISOString() }, buyer: { id: isOwner ? null : w.buyerId, name: buyer?.name || "", place: [buyer?.city, buyer?.governorate].filter(Boolean).join("، "), contact: isOwner ? null : contactUrlOf(buyer) } };
    }
    case "listing_save": {
      if (!rateLimit(`japp-ls:${uid}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await saveListingCore(uid, body?.listing || {}, body?.id ? id(body.id) || "x" : null);
      return r.ok ? { ok: true, id: r.id, created: r.created } : fail(r.error);
    }
    case "listing_toggle": { const r = await toggleListingCore(uid, id(body?.id)); return r.ok ? { ok: true, status: r.status } : fail(r.error); }
    case "listing_delete": { const r = await deleteListingCore(uid, id(body?.id)); return r.ok ? { ok: true } : fail(r.error); }
    case "listing_feature": {
      if (!rateLimit(`japp-lf:${uid}`, 10, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const lid = String(body?.id || "");
      if (!isListingId(lid)) return fail("منتج غير صالح.");
      const r = await featureListing(uid, lid, chargeJobsUser);
      if (r.ok) return { ok: true, until: r.until.toISOString() };
      if (r.reason === "balance") return { ok: false, error: `💰 رصيدك $${Number(r.balance || 0).toFixed(2)} لا يكفي. اشحن رصيدك ثم ميّز المنتج.`, code: "balance" };
      return fail(r.reason === "not_owner" ? "هذا ليس منتجك." : "فعّل المنتج أولاً ثم ميّزه.");
    }
    case "wanted_save": {
      if (!rateLimit(`japp-ws:${uid}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await saveWantedCore(uid, body?.wanted || {}, body?.id ? id(body.id) || "x" : null);
      return r.ok ? { ok: true, id: r.id, created: r.created } : fail(r.error);
    }
    case "wanted_toggle": { const r = await toggleWantedCore(uid, id(body?.id)); return r.ok ? { ok: true, status: r.status } : fail(r.error); }
    case "wanted_delete": { const r = await deleteWantedCore(uid, id(body?.id)); return r.ok ? { ok: true } : fail(r.error); }
    case "my_items": {
      const [ls, ws, fids] = await Promise.all([
        prisma.storeListing.findMany({ where: { sellerId: uid, status: { not: "REMOVED" } }, orderBy: { created_at: "desc" }, take: 100 }),
        prisma.storeWantedListing.findMany({ where: { buyerId: uid, status: { not: "REMOVED" } }, orderBy: { created_at: "desc" }, take: 100 }),
        featuredListingIds().catch(() => [] as string[]),
      ]);
      const f = new Set(fids);
      return { ok: true, listings: ls.map((l) => listingView(l, uid, f)), wanted: ws.map((w) => ({ id: w.id, title: w.title, description: w.description || "", budget: w.budget, status: w.status, at: w.created_at.toISOString() })) };
    }

    // ---------------------------------------------------------------- 💬 العروض (تفاوض السعر)
    case "offer_create": {
      if (!rateLimit(`japp-oc:${uid}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const kind = body?.kind === "WANTED" ? "WANTED" : "LISTING";
      const r = await createOfferCore(uid, kind, id(body?.id), body?.price);
      if (!r.ok) return fail(r.error);
      await notifyOfferToOtherParty(bot, r.offer, botRow.id);
      return { ok: true, offerId: r.offer.id, price: r.offer.price };
    }
    case "offers": {
      const rows = await prisma.storeOffer.findMany({ where: { OR: [{ buyerId: uid }, { sellerId: uid }] }, orderBy: { updated_at: "desc" }, take: 60 });
      const lids = rows.map((o) => o.listingId).filter(Boolean) as string[];
      const wids = rows.map((o) => o.wantedId).filter(Boolean) as string[];
      const [ls, ws, names] = await Promise.all([
        lids.length ? prisma.storeListing.findMany({ where: { id: { in: lids } }, select: { id: true, title: true, price: true, photoFileIds: true, paymentMethod: true } }) : [],
        wids.length ? prisma.storeWantedListing.findMany({ where: { id: { in: wids } }, select: { id: true, title: true, budget: true } }) : [],
        namesOf(rows.map((o) => (o.buyerId === uid ? o.sellerId : o.buyerId))),
      ]);
      const lm = new Map(ls.map((l) => [l.id, l]));
      const wm = new Map(ws.map((w) => [w.id, w]));
      return {
        ok: true,
        offers: rows.map((o) => {
          const l = o.listingId ? lm.get(o.listingId) : null;
          const w = o.wantedId ? wm.get(o.wantedId) : null;
          return {
            id: o.id, kind: o.kind, price: o.price, status: o.status, role: o.buyerId === uid ? "buyer" : "seller", myTurn: o.status === "PENDING" && otherPartyOf(o) === uid,
            title: l?.title || w?.title || "—", photo: l ? photosOf(l.photoFileIds)[0] || null : null, asked: l?.price ?? w?.budget ?? null, escrow: l ? l.paymentMethod === "ESCROW" : true,
            targetId: o.listingId || o.wantedId, other: names.get(o.buyerId === uid ? o.sellerId : o.buyerId) || null, at: o.updated_at.toISOString(),
          };
        }),
      };
    }
    case "offer_accept": {
      if (!rateLimit(`japp-oa:${uid}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await acceptOfferCore(uid, id(body?.id));
      if (!r.ok && (r.reason === "gone" || r.reason === "not_allowed")) return fail(r.error);
      await notifyAcceptOutcome(bot, r, botRow.id);
      if (!r.ok) return fail(r.error, r.reason);
      return { ok: true, mode: r.mode, orderId: r.mode === "escrow" ? r.orderId : null };
    }
    case "offer_reject": {
      const r = await rejectOfferCore(uid, id(body?.id));
      if (!r.ok) return fail(r.error);
      await notifyOfferRejected(bot, r.offer);
      return { ok: true };
    }
    case "offer_counter": {
      if (!rateLimit(`japp-on:${uid}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await counterOfferCore(uid, id(body?.id), body?.price);
      if (!r.ok) return fail(r.error);
      await notifyOfferToOtherParty(bot, r.offer, botRow.id);
      return { ok: true, price: r.offer.price };
    }

    // ---------------------------------------------------------------- 📂 طلباتي (orders, buyer and seller)
    case "orders": {
      const rows = await prisma.storeOrder.findMany({ where: { OR: [{ buyerId: uid }, { sellerId: uid }] }, orderBy: { created_at: "desc" }, take: 60 });
      const [ls, ds, ps] = await Promise.all([
        rows.length ? prisma.storeListing.findMany({ where: { id: { in: rows.map((o) => o.listingId) } }, select: { id: true, title: true, photoFileIds: true } }) : [],
        rows.length ? prisma.jobsDispute.findMany({ where: { orderId: { in: rows.map((o) => o.id) } } }) : [],
        rows.length ? prisma.jobsProfile.findMany({ where: { userId: { in: rows.map((o) => (o.buyerId === uid ? o.sellerId : o.buyerId)) } } }) : [],
      ]);
      const lm = new Map(ls.map((l) => [l.id, l]));
      const dm = new Map(ds.map((d) => [d.orderId, d]));
      const pm = new Map(ps.map((p) => [p.userId, p]));
      return {
        ok: true, autoReleaseDays: 7,
        orders: rows.map((o) => {
          const l = lm.get(o.listingId);
          const d = dm.get(o.id);
          const role = o.buyerId === uid ? "buyer" : "seller";
          const other = pm.get(role === "buyer" ? o.sellerId : o.buyerId);
          const myStatement = d ? (role === "buyer" ? d.buyerStatement : d.sellerStatement) : null;
          return {
            id: o.id, short: o.id.slice(-6), role, amount: o.amount, status: o.status, shipping: o.deliveryMethod === "SHIPPING", title: l?.title || "—", photo: l ? photosOf(l.photoFileIds)[0] || null : null,
            at: o.created_at.toISOString(), escrowedAt: o.escrowedAt?.toISOString() || null, releasedAt: o.releasedAt?.toISOString() || null,
            other: other ? { name: other.name, city: other.city, contact: o.status === "ESCROWED" ? contactUrlOf(other) : null } : null,
            dispute: d ? { status: d.status, resolution: d.resolution, mine: !!myStatement, opener: d.openedBy === uid } : null,
          };
        }),
      };
    }
    case "order_received": {
      if (!rateLimit(`japp-or:${uid}`, 10, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await confirmReceivedCore(uid, id(body?.id));
      if (!r.ok) return fail(r.error);
      await notifyReceived(bot, r.order);
      return { ok: true };
    }
    case "order_dispute": {
      if (!rateLimit(`japp-od:${uid}`, 6, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const oid = id(body?.id);
      const statement = String(body?.statement || "").trim();
      if (!statement) return fail("اكتب إفادتك (ما حدث بالتفصيل).");
      const o = await openDisputeCore(uid, oid);
      if (!o.ok) return fail(o.error);
      if (o.opened) await notifyDisputeOpened(bot, oid, o.otherSide, o.order.amount, botRow.id);
      const s = await submitDisputeCore(uid, oid, statement, body?.photo ? String(body.photo) : null);
      if (!s.ok) return fail(s.error);
      if (s.bothIn) await notifyDisputeReady(bot, oid, s.order, s.dispute);
      return { ok: true, bothIn: s.bothIn };
    }

    // ---------------------------------------------------------------- 🛍 متاجر البائعين
    case "shops": {
      const q = String(body?.q || "").trim().toLowerCase().slice(0, 40);
      const all = await listShops(200).catch(() => []);
      const blocked = new Set((await prisma.jobsBlock.findMany({ where: { OR: [{ blockerId: uid }, { blockedId: uid }] } })).map((b) => (b.blockerId === uid ? b.blockedId : b.blockerId)));
      const sellers = all.length ? await prisma.$queryRaw<{ slug: string; seller_id: string }[]>`SELECT slug, seller_id FROM jobs_shops WHERE slug = ANY(${all.map((s) => s.slug)})` : [];
      const sm = new Map(sellers.map((x) => [x.slug, x.seller_id]));
      const shops = all.filter((s) => !blocked.has(sm.get(s.slug) || "") && (!q || s.name.toLowerCase().includes(q) || s.place.toLowerCase().includes(q))).slice(0, 60)
        .map((s) => ({ ...s, mine: sm.get(s.slug) === uid }));
      return { ok: true, shops };
    }
    case "shop": {
      const slug = String(body?.slug || "");
      const sellerId = await sellerBySlug(slug).catch(() => null);
      if (!sellerId) return fail("هذا المتجر غير موجود.", "gone");
      if (sellerId !== uid && (await isBlocked(uid, sellerId))) return fail("🚫 غير متاح.", "blocked");
      const [p, ls, fids] = await Promise.all([
        prisma.jobsProfile.findUnique({ where: { userId: sellerId } }),
        prisma.storeListing.findMany({ where: { sellerId, status: "ACTIVE" }, orderBy: { created_at: "desc" }, take: 100 }),
        featuredListingIds().catch(() => [] as string[]),
      ]);
      const f = new Set(fids);
      const items = ls.map((l) => listingView(l, uid, f)).sort((a, b) => Number(b.featured) - Number(a.featured));
      return { ok: true, shop: { slug, name: p?.name || "متجر", place: [p?.city, p?.governorate, p?.country].filter(Boolean).join("، "), mine: sellerId === uid, share: username ? botLink(username, shopStart(slug)) : null }, items };
    }
    case "my_shop": {
      const count = await prisma.storeListing.count({ where: { sellerId: uid, status: "ACTIVE" } });
      if (!count) return { ok: true, slug: null, count: 0, trader: profile.roleType === "TRADER" };
      const slug = await shopSlugFor(uid);
      const deep = username ? botLink(username, shopStart(slug)) : "";
      return { ok: true, slug, count, trader: profile.roleType === "TRADER", deep, shareText: shopShareText(profile.name, count) };
    }

    // ---------------------------------------------------------------- 💼 العمل
    case "jobs_search": {
      const q = String(body?.q || "").trim() || (profile.roleType === "SEEKER" ? profile.seekerProfession || "" : "");
      const r = await searchJobPostings(uid, q, Math.max(0, Number(body?.offset) || 0), PAGE);
      return { ok: true, q, more: r.more, items: r.rows.map((p) => ({ id: p.id, title: p.title, city: p.city, governorate: p.governorate, workers: p.workersCount, at: p.created_at.toISOString() })) };
    }
    case "job_get": {
      const p = await prisma.jobPosting.findUnique({ where: { id: id(body?.id) } });
      if (!p) return fail("هذه الوظيفة غير موجودة.", "gone");
      if (await isBlocked(uid, p.posterId)) return fail("🚫 غير متاح.", "blocked");
      const poster = await prisma.jobsProfile.findUnique({ where: { userId: p.posterId } });
      return { ok: true, job: { id: p.id, title: p.title, keywords: p.keywords, workers: p.workersCount, governorate: p.governorate, city: p.city, description: p.description || "", status: p.status, at: p.created_at.toISOString(), poster: poster?.employerBusinessName || poster?.name || "", posterId: p.posterId === uid ? null : p.posterId, contact: contactUrlOf(p), mine: p.posterId === uid } };
    }
    case "job_post": {
      if (!rateLimit(`japp-jp:${uid}`, 10, 3600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await createJobPostingCore(uid, body?.job || {});
      return r.ok ? { ok: true, id: r.id } : fail(r.error);
    }
    case "my_jobs": {
      const rows = await prisma.jobPosting.findMany({ where: { posterId: uid }, orderBy: { created_at: "desc" }, take: 50 });
      return { ok: true, items: rows.map((p) => ({ id: p.id, title: p.title, city: p.city, governorate: p.governorate, workers: p.workersCount, status: p.status, at: p.created_at.toISOString() })) };
    }
    case "pros_search": {
      const r = await searchProfessionals(uid, String(body?.category || ""), String(body?.region || ""), Math.max(0, Number(body?.offset) || 0), PAGE);
      return { ok: true, more: r.more, items: r.rows.map((p) => ({ id: p.userId === uid ? null : p.userId, mine: p.userId === uid, name: p.name, category: p.professionalCategory, city: p.city, governorate: p.governorate, description: p.professionalDescription || "" })) };
    }
    case "pro_get": {
      const pid = String(body?.id || "").replace(/[^0-9]/g, "");
      const p = pid ? await prisma.jobsProfile.findUnique({ where: { userId: pid } }) : null;
      if (!p || p.roleType !== "PROFESSIONAL") return fail("هذا الملف غير متاح.", "gone");
      if (await isBlocked(uid, pid)) return fail("🚫 غير متاح.", "blocked");
      return { ok: true, pro: { id: pid, name: p.name, category: p.professionalCategory, city: p.city, governorate: p.governorate, description: p.professionalDescription || "", contact: contactUrlOf(p) } };
    }
    case "report": {
      if (!rateLimit(`japp-rp:${uid}`, 8, 3600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await reportCore(uid, body?.kind, String(body?.target || "").replace(/[^0-9]/g, ""), body?.reason);
      return r.ok ? { ok: true } : fail(r.error);
    }
    case "block": {
      const target = String(body?.target || "").replace(/[^0-9]/g, "");
      if (!target || target === uid) return fail("غير صالح.");
      await blockUser(uid, target);
      return { ok: true };
    }

    // ---------------------------------------------------------------- 🏷 اطلب وهم يتنافسون
    case "tn_home": {
      const [mine, inbox] = await Promise.all([
        prisma.jobsTender.findMany({ where: { requesterId: uid }, orderBy: { created_at: "desc" }, take: 20, include: { _count: { select: { bids: true } } } }),
        inboxTenders(uid, profile, 30),
      ]);
      const myBids = inbox.length ? await prisma.jobsTenderBid.findMany({ where: { bidderId: uid, tenderId: { in: inbox.map((t) => t.id) } } }) : [];
      const bm = new Map(myBids.map((b) => [b.tenderId, b]));
      const now = Date.now();
      const view = (t: any) => ({ id: t.id, kind: t.kind, category: t.category, details: t.details, budget: t.budget, governorate: t.governorate, city: t.city, status: t.status, live: t.status === "OPEN" && t.expiresAt.getTime() > now, expiresAt: t.expiresAt.toISOString() });
      return {
        ok: true, provider: profile.roleType === "PROFESSIONAL" || profile.roleType === "TRADER",
        mine: mine.map((t) => ({ ...view(t), bids: t._count.bids, notified: t.notifiedCount })),
        inbox: inbox.map((t) => ({ ...view(t), myBid: bm.get(t.id) ? { price: bm.get(t.id)!.price, note: bm.get(t.id)!.note } : null })),
      };
    }
    case "tn_create": {
      if (!rateLimit(`japp-tc:${uid}`, 6, 3600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const v = validateTenderDraft(body?.tender || {}, PROFESSIONAL_CATEGORIES);
      if (!v.ok) return fail(v.error);
      const r = await publishTenderCore(bot, uid, profile, v.data, appLink(botRow.id, "tenders"));
      return r.ok ? { ok: true, id: r.tender.id, sent: r.sent } : fail(r.error);
    }
    case "tn_get": {
      const e = await bidEligibility(uid, profile, id(body?.id));
      if (!e.ok) return fail(e.error);
      const t = e.tender;
      return { ok: true, tender: { id: t.id, kind: t.kind, category: t.category, details: t.details, budget: t.budget, governorate: t.governorate, city: t.city, expiresAt: t.expiresAt.toISOString() }, competitors: e.competitors, mine: e.mine ? { price: e.mine.price, note: e.mine.note } : null };
    }
    case "tn_bid": {
      if (!rateLimit(`japp-tb:${uid}`, 20, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      const r = await submitBidCore(bot, uid, profile, id(body?.id), body?.price, body?.note, appLink(botRow.id, "tenders"));
      return r.ok ? { ok: true, existed: r.existed, total: r.total } : fail(r.error);
    }
    case "tn_bids": {
      const t = await prisma.jobsTender.findFirst({ where: { id: id(body?.id), requesterId: uid } });
      if (!t) return fail("غير مسموح.");
      const bids = await prisma.jobsTenderBid.findMany({ where: { tenderId: t.id }, orderBy: { price: "asc" }, take: MAX_SHOWN_BIDS });
      const ps = bids.length ? await prisma.jobsProfile.findMany({ where: { userId: { in: bids.map((b) => b.bidderId) } } }) : [];
      const pm = new Map(ps.map((p) => [p.userId, p]));
      return {
        ok: true, tender: { id: t.id, category: t.category, budget: t.budget, status: t.status, live: t.status === "OPEN" && t.expiresAt > new Date(), expiresAt: t.expiresAt.toISOString() },
        bids: bids.map((b) => {
          const p = pm.get(b.bidderId);
          return { id: b.id, price: b.price, note: b.note, status: b.status, name: p?.name || "مقدّم عرض", city: p?.city || "—", contact: b.status === "WON" ? contactUrlOf(p) : null, bidder: b.bidderId };
        }),
      };
    }
    case "tn_award": {
      const r = await awardBidCore(bot, uid, id(body?.id));
      return r.ok ? { ok: true, contact: r.winnerContact, name: r.winner?.name || "" } : fail(r.error);
    }
    case "tn_close": {
      const r = await closeTenderCore(bot, uid, id(body?.id));
      return r.ok ? { ok: true } : fail(r.error);
    }

    // ---------------------------------------------------------------- 💰 رصيدي وإيداع
    case "wallet": {
      const txs = await prisma.jobsTransaction.findMany({ where: { userId: uid }, orderBy: { created_at: "desc" }, take: 20 });
      const ton = isNativeTonConfigured() ? { address: getMasterHotWalletAddress(), memo: await getOrCreateJobsTonMemo(uid) } : null;
      return {
        ok: true, balance: user.balance, starsPerUsd: STARS_PER_USD, tiers: STAR_DEPOSIT_TIERS.map((s) => ({ stars: s, usd: usdForStars(s) })), ton,
        txs: txs.map((t) => ({ id: t.id, amount: t.amount, type: t.type, currency: t.currency, at: t.created_at.toISOString() })),
      };
    }
    case "stars_invoice": {
      const stars = Number(body?.stars);
      if (!(STAR_DEPOSIT_TIERS as readonly number[]).includes(stars)) return fail("اختر باقة.");
      if (!rateLimit(`japp-si:${uid}`, 10, 600_000)) return fail("طلبات كثيرة، تمهّل قليلاً.");
      try {
        // Same payload as the chat's «⭐» buttons: the bot's successful_payment handler credits it once (keyed on Telegram's charge id).
        const link = await bot.api.createInvoiceLink("شحن رصيد بوت فرص العمل", `شحن $${usdForStars(stars).toFixed(2)} في رصيدك عبر نجوم تيليجرام`, starsPayload("JOBS_DEPOSIT", uid), "", "XTR", [{ label: "شحن رصيد بوت فرص العمل", amount: stars }]);
        return { ok: true, link };
      } catch (e) {
        console.error("jobs-app stars invoice failed", (e as Error)?.message);
        return fail("تعذّر إنشاء فاتورة النجوم الآن.");
      }
    }
  }
  return fail("طلب غير معروف.");
}
