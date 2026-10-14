/**
 * MARRIAGE_BOT paid features — the SINGLE source of truth shared by the bot
 * (matchBotLogic.ts) and the Mini App (/api/match-app). Prices, durations,
 * entitlement checks and the purchase steps live here only. Moved verbatim
 * from matchBotLogic.ts (owner spec, 2026-09-05); bot behaviour unchanged.
 *
 * Money model: every feature is paid from MatchUser.balance (USD-equivalent),
 * topped up by Telegram Stars (payload MATCH_DEPOSIT:<uid>), NOWPayments
 * (/pay/marriage?uid=) or native TON/USDT with a memo. Every charge writes a
 * MatchTransaction row in the same DB transaction.
 */
import type { MatchProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables, extendAnonPaidUntilAtomic, getAnonFilterRow } from "@/lib/match/appStore";
import { pgRateLimit } from "@/lib/match/rateLimitPg";

export * from "@/lib/match/entitlementRules";
import { BOOST_HOURS, PRICE_ADVANCED_FILTERS, PRICE_BOOST_24H, PRICE_EXTRA_PHOTOS, PRICE_PROFILE_VISITORS, PRICE_SUPER_LIKE, PRICE_VIP_30D, VIP_DAYS, PRICE_ANON_FILTERS, ANON_FILTERS_DAYS, hasAnonFilters, hasAdvancedFilters, hasExtraPhotos, hasProfileVisitors, isVipActive, DISCOUNTABLE_TYPES, discountedPrice, PRICE_REWIND, type BuyNowKey, PRICE_CARD_GENDER, CARD_GENDER_DAYS, hasCardGenderFilter } from "@/lib/match/entitlementRules";

// Deducts `amount` from the user's MARRIAGE_BOT balance and logs a
// MatchTransaction — atomically, so a crash between the two is
// impossible. Returns ok:false (charging nothing) if the balance is too
// low; the caller is responsible for showing insufficientBalanceText.
export async function chargeMatchUser(userId: string, amount: number, type: string): Promise<{ ok: boolean; balance: number; charged?: number; discounted?: boolean }> {
  // Shared (cross-instance) purchase limiter: 20 charges / minute / user.
  if (!(await pgRateLimit(`charge:${userId}`, 20, 60))) {
    const u = await prisma.matchUser.findUnique({ where: { id: userId }, select: { balance: true } });
    return { ok: false, balance: Number(u?.balance || 0) };
  }
  const discountable = (DISCOUNTABLE_TYPES as readonly string[]).includes(type);
  if (discountable) await ensureMatchAppTables().catch(() => null);
  // Atomic: conditional decrement (balance >= amount) + ledger row in ONE
  // transaction; zero rows updated → nothing charged, no negative balance.
  // First-purchase discount (once per user): claimed inside the same transaction,
  // so a failed charge never burns it and two parallel charges can't both use it.
  let usedDiscount = false;
  let price = amount;
  const charged = await prisma.$transaction(async (tx) => {
    if (discountable && (await firstPurchaseEligibleTx(tx, userId))) {
      const claimed = await tx.$executeRaw`INSERT INTO match_first_discount (user_id, charge_type) VALUES (${userId}, ${type}) ON CONFLICT DO NOTHING`;
      if (claimed === 1) { usedDiscount = true; price = discountedPrice(amount, true); }
    }
    const n = await tx.matchUser.updateMany({ where: { id: userId, balance: { gte: price } }, data: { balance: { decrement: price } } });
    if (n.count !== 1) {
      if (usedDiscount) throw new NotCharged(); // roll back the discount claim too
      return false;
    }
    await tx.matchTransaction.create({ data: { userId, amount: price, currency: "internal", type: usedDiscount ? `${type}_FIRST20` : type, status: "COMPLETED" } });
    return true;
  }).catch((e) => { if (e instanceof NotCharged) return false; throw e; });
  if (!charged) { usedDiscount = false; price = amount; }
  const after = await prisma.matchUser.findUnique({ where: { id: userId }, select: { balance: true } });
  return { ok: charged, balance: Number(after?.balance || 0), charged: charged ? price : 0, discounted: usedDiscount };
}
class NotCharged extends Error {}

/** Eligible = never bought anything from balance AND never claimed the discount. */
async function firstPurchaseEligibleTx(tx: any, userId: string): Promise<boolean> {
  const prior = await tx.matchTransaction.count({ where: { userId, currency: "internal" } });
  if (prior > 0) return false;
  const used = await tx.$queryRaw`SELECT 1 FROM match_first_discount WHERE user_id = ${userId}`.catch(() => [] as unknown[]);
  return !(used as unknown[]).length;
}
export async function firstPurchaseEligible(userId: string): Promise<boolean> {
  await ensureMatchAppTables().catch(() => null);
  return firstPurchaseEligibleTx(prisma, userId).catch(() => false);
}
/** Price this user would pay now for a discountable upgrade (server-side truth). */
export async function effectivePrice(userId: string, price: number, type: string): Promise<number> {
  if (!(DISCOUNTABLE_TYPES as readonly string[]).includes(type)) return price;
  return discountedPrice(price, await firstPurchaseEligible(userId));
}

/** One-tap purchase by key (shared by the app's buy flow and the bot's Stars buy-now handler). */
export async function purchaseByKey(userId: string, key: BuyNowKey): Promise<{ ok: true; message: string } | { ok: false; reason: string; needed?: number; balance?: number }> {
  const done = (m: string) => ({ ok: true as const, message: m });
  if (key === "boost") { const r = await purchaseBoost(userId); return r.ok ? done(`🚀 تم رفع ملفك حتى ${r.boostedUntil.toLocaleString("ar")}`) : r; }
  if (key === "vip") { const r = await purchaseVip(userId); return r.ok ? done(`👑 تم تفعيل العضوية الذهبية حتى ${r.vipUntil.toLocaleString("ar")}`) : r; }
  if (key === "visitors") { const r = await unlockProfileVisitors(userId); return r.ok ? done("👀 تم تفعيل «من زار ملفي»") : r; }
  if (key === "filters") { const r = await unlockAdvancedFilters(userId); return r.ok ? done("🎯 الفلاتر المتقدمة مفعّلة") : r; }
  if (key === "cardGender") { const r = await purchaseCardGender(userId); return r.ok ? done(r.viaVip ? "👑 فلتر جنس البطاقات مشمول في عضويتك الذهبية" : `🚻 تم تفعيل فلتر جنس البطاقات حتى ${r.until?.toLocaleDateString("ar")}`) : r; }
  const r = await purchaseAnonFilters(userId);
  return r.ok ? done(r.viaVip ? "👑 فلاتر الدردشة مشمولة في عضويتك الذهبية" : `🎛 تم تفعيل فلاتر الدردشة العشوائية حتى ${r.until?.toLocaleDateString("ar")}`) : r;
}

/** ↩️ استرجاع آخر ملف تخطّيته — $0.5. Pops the pass first (atomic), refunds the pop if the charge fails. */
export async function purchaseRewind(userId: string): Promise<{ ok: true; targetId: string } | { ok: false; reason: "no_pass" } | { ok: false; reason: "insufficient"; needed: number; balance: number }> {
  await ensureMatchAppTables();
  const popped = await prisma.$queryRaw<{ target_id: string; created_at: Date }[]>`
    DELETE FROM match_app_passes_log WHERE id = (SELECT id FROM match_app_passes_log WHERE user_id = ${userId} ORDER BY id DESC LIMIT 1)
    RETURNING target_id, created_at`;
  const row = popped[0];
  if (!row) return { ok: false, reason: "no_pass" };
  const charge = await chargeMatchUser(userId, PRICE_REWIND, "REWIND");
  if (!charge.ok) {
    await prisma.$executeRaw`INSERT INTO match_app_passes_log (user_id, target_id, created_at) VALUES (${userId}, ${row.target_id}, ${row.created_at})`;
    return insufficient(PRICE_REWIND, charge.balance);
  }
  return { ok: true, targetId: row.target_id };
}
/** Record a skip (bot «➡️ الملف التالي» / app ✖️) so it can be rewound. Keeps the last 20. */
export async function recordPass(userId: string, targetId: string): Promise<void> {
  if (!targetId || targetId === userId) return;
  await ensureMatchAppTables();
  await prisma.$executeRaw`INSERT INTO match_app_passes_log (user_id, target_id) VALUES (${userId}, ${targetId})`;
  await prisma.$executeRaw`DELETE FROM match_app_passes_log WHERE user_id = ${userId} AND id NOT IN (SELECT id FROM match_app_passes_log WHERE user_id = ${userId} ORDER BY id DESC LIMIT 20)`;
}

// ---- purchase steps (shared by bot buttons and Mini App) -----------------------
export type Purchase<T = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: "no_profile" | "no_pref" | "vip_included" | "not_vip" | "no_user" }
  | { ok: false; reason: "insufficient"; needed: number; balance: number };

const insufficient = (needed: number, balance: number) => ({ ok: false as const, reason: "insufficient" as const, needed, balance });

/** 🚀 رفع ملفي — $2 / 24h; VIP already includes a continuous boost. */
export async function purchaseBoost(userId: string): Promise<Purchase<{ boostedUntil: Date }>> {
  const profile = await prisma.matchProfile.findUnique({ where: { userId } });
  if (!profile) return { ok: false, reason: "no_profile" };
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  if (dbUser && isVipActive(dbUser)) return { ok: false, reason: "vip_included" };
  const charge = await chargeMatchUser(userId, PRICE_BOOST_24H, "BOOST");
  if (!charge.ok) return insufficient(PRICE_BOOST_24H, charge.balance);
  const boostedUntil = new Date(Date.now() + BOOST_HOURS * 3600 * 1000);
  await prisma.matchProfile.update({ where: { userId }, data: { boostedUntil } });
  return { ok: true, boostedUntil };
}

/** 👑 العضوية الذهبية — $8 / 30 days, stacks on an active membership. */
export async function purchaseVip(userId: string): Promise<Purchase<{ vipUntil: Date }>> {
  const charge = await chargeMatchUser(userId, PRICE_VIP_30D, "VIP_MEMBERSHIP");
  if (!charge.ok) return insufficient(PRICE_VIP_30D, charge.balance);
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  const base = dbUser?.vipUntil && dbUser.vipUntil > new Date() ? dbUser.vipUntil : new Date();
  const vipUntil = new Date(base.getTime() + VIP_DAYS * 24 * 3600 * 1000);
  await prisma.matchUser.update({ where: { id: userId }, data: { vipUntil } });
  return { ok: true, vipUntil };
}

/** 👀 من زار ملفي — $2 one-time permanent unlock (free while VIP). */
export async function unlockProfileVisitors(userId: string): Promise<Purchase<{ charged: boolean }>> {
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  if (!dbUser) return { ok: false, reason: "no_user" };
  if (hasProfileVisitors(dbUser)) return { ok: true, charged: false };
  const charge = await chargeMatchUser(userId, PRICE_PROFILE_VISITORS, "PROFILE_VISITORS");
  if (!charge.ok) return insufficient(PRICE_PROFILE_VISITORS, charge.balance);
  await prisma.matchUser.update({ where: { id: userId }, data: { profileVisitorsUnlocked: true } });
  return { ok: true, charged: true };
}

/** 🎯 فلاتر متقدمة — $2 one-time (free while VIP); needs basic partner specs first. */
export async function unlockAdvancedFilters(userId: string): Promise<Purchase<{ charged: boolean }>> {
  const pref = await prisma.partnerPreference.findUnique({ where: { userId } });
  if (!pref) return { ok: false, reason: "no_pref" };
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  if (!dbUser) return { ok: false, reason: "no_user" };
  if (hasAdvancedFilters(dbUser)) return { ok: true, charged: false };
  const charge = await chargeMatchUser(userId, PRICE_ADVANCED_FILTERS, "ADVANCED_FILTERS");
  if (!charge.ok) return insufficient(PRICE_ADVANCED_FILTERS, charge.balance);
  await prisma.matchUser.update({ where: { id: userId }, data: { advancedFiltersUnlocked: true } });
  return { ok: true, charged: true };
}

/** 🖼 صور إضافية — $2 one-time (free while VIP); upload itself happens in the bot. */
export async function unlockExtraPhotos(userId: string): Promise<Purchase<{ profile: MatchProfile; charged: boolean }>> {
  const profile = await prisma.matchProfile.findUnique({ where: { userId } });
  if (!profile) return { ok: false, reason: "no_profile" };
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  if (dbUser && hasExtraPhotos(dbUser)) return { ok: true, profile, charged: false };
  const charge = await chargeMatchUser(userId, PRICE_EXTRA_PHOTOS, "EXTRA_PHOTOS");
  if (!charge.ok) return insufficient(PRICE_EXTRA_PHOTOS, charge.balance);
  await prisma.matchUser.update({ where: { id: userId }, data: { extraPhotosUnlocked: true } });
  return { ok: true, profile, charged: true };
}

/** 🕶 وضع التخفي — VIP only, toggles MatchProfile.isIncognito. */
export async function toggleIncognito(userId: string, force?: boolean): Promise<Purchase<{ on: boolean }>> {
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  if (!dbUser || !isVipActive(dbUser)) return { ok: false, reason: "not_vip" };
  const profile = await prisma.matchProfile.findUnique({ where: { userId } });
  if (!profile) return { ok: false, reason: "no_profile" };
  const on = force ?? !profile.isIncognito;
  await prisma.matchProfile.update({ where: { userId }, data: { isIncognito: on } });
  return { ok: true, on };
}

/** ⭐ إعجاب مميز — $1 each, carries a short note (same as the bot's superlike_note step). */
export async function chargeSuperLike(userId: string, targetUserId: string, note: string): Promise<Purchase> {
  const charge = await chargeMatchUser(userId, PRICE_SUPER_LIKE, "SUPER_LIKE");
  if (!charge.ok) return insufficient(PRICE_SUPER_LIKE, charge.balance);
  await prisma.matchLike
    .upsert({
      where: { fromUserId_toUserId: { fromUserId: userId, toUserId: targetUserId } },
      update: { note },
      create: { fromUserId: userId, toUserId: targetUserId, note },
    })
    .catch(() => null);
  return { ok: true };
}


/** 🎛 فلاتر الدردشة العشوائية — $2 / 30 يوماً (تتراكم)، مشمولة في الذهبية بلا خصم. */
export async function purchaseAnonFilters(userId: string): Promise<Purchase<{ charged: boolean; until: Date | null; viaVip: boolean }>> {
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  if (!dbUser) return { ok: false, reason: "no_user" };
  if (isVipActive(dbUser)) return { ok: true, charged: false, until: dbUser.vipUntil, viaVip: true };
  const charge = await chargeMatchUser(userId, PRICE_ANON_FILTERS, "ANON_FILTERS");
  if (!charge.ok) return insufficient(PRICE_ANON_FILTERS, charge.balance);
  const until = await extendAnonPaidUntilAtomic(userId, ANON_FILTERS_DAYS);
  return { ok: true, charged: true, until, viaVip: false };
}
export async function anonFiltersStatus(userId: string): Promise<{ owned: boolean; until: Date | null; viaVip: boolean; filter: any }> {
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId }, select: { vipUntil: true } });
  const row = await getAnonFilterRow(userId);
  const viaVip = !!dbUser?.vipUntil && dbUser.vipUntil > new Date();
  return { owned: hasAnonFilters({ vipUntil: dbUser?.vipUntil ?? null }, row?.paid_until), until: viaVip ? dbUser!.vipUntil : row?.paid_until ?? null, viaVip, filter: row?.filter ?? {} };
}

// ---- 🚻 card gender filter (Mini App discovery) ------------------------------------------------
export async function cardGenderStatus(userId: string): Promise<{ owned: boolean; until: Date | null; viaVip: boolean; gender: "MALE" | "FEMALE" | null }> {
  await ensureMatchAppTables();
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId }, select: { vipUntil: true } });
  const rows = await prisma.$queryRaw<{ gender: string | null; paid_until: Date | null }[]>`SELECT gender, paid_until FROM match_card_filter WHERE user_id = ${userId}`;
  const row = rows[0];
  const viaVip = isVipActive({ vipUntil: dbUser?.vipUntil ?? null });
  const owned = hasCardGenderFilter({ vipUntil: dbUser?.vipUntil ?? null }, row?.paid_until);
  const g = row?.gender === "MALE" || row?.gender === "FEMALE" ? row.gender : null;
  return { owned, until: viaVip ? dbUser!.vipUntil : row?.paid_until ?? null, viaVip, gender: owned ? g : null };
}
export async function setCardGender(userId: string, gender: "MALE" | "FEMALE" | null): Promise<boolean> {
  const st = await cardGenderStatus(userId);
  if (gender && !st.owned) return false;
  await prisma.$executeRaw`INSERT INTO match_card_filter (user_id, gender) VALUES (${userId}, ${gender}) ON CONFLICT (user_id) DO UPDATE SET gender = ${gender}`;
  return true;
}
export async function purchaseCardGender(userId: string): Promise<Purchase<{ charged: boolean; until: Date | null; viaVip: boolean }>> {
  const dbUser = await prisma.matchUser.findUnique({ where: { id: userId } });
  if (!dbUser) return { ok: false, reason: "no_user" };
  if (isVipActive(dbUser)) return { ok: true, charged: false, until: dbUser.vipUntil, viaVip: true };
  const charge = await chargeMatchUser(userId, PRICE_CARD_GENDER, "CARD_GENDER_FILTER");
  if (!charge.ok) return insufficient(PRICE_CARD_GENDER, charge.balance);
  await ensureMatchAppTables();
  const r = await prisma.$queryRaw<{ paid_until: Date }[]>`
    INSERT INTO match_card_filter (user_id, paid_until) VALUES (${userId}, now() + make_interval(days => ${CARD_GENDER_DAYS}::int))
    ON CONFLICT (user_id) DO UPDATE SET paid_until = GREATEST(COALESCE(match_card_filter.paid_until, now()), now()) + make_interval(days => ${CARD_GENDER_DAYS}::int)
    RETURNING paid_until`;
  return { ok: true, charged: true, until: r[0].paid_until, viaVip: false };
}
