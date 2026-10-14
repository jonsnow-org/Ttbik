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

export * from "@/lib/match/entitlementRules";
import { BOOST_HOURS, PRICE_ADVANCED_FILTERS, PRICE_BOOST_24H, PRICE_EXTRA_PHOTOS, PRICE_PROFILE_VISITORS, PRICE_SUPER_LIKE, PRICE_VIP_30D, VIP_DAYS, hasAdvancedFilters, hasExtraPhotos, hasProfileVisitors, isVipActive } from "@/lib/match/entitlementRules";

// Deducts `amount` from the user's MARRIAGE_BOT balance and logs a
// MatchTransaction — atomically, so a crash between the two is
// impossible. Returns ok:false (charging nothing) if the balance is too
// low; the caller is responsible for showing insufficientBalanceText.
export async function chargeMatchUser(userId: string, amount: number, type: string): Promise<{ ok: boolean; balance: number }> {
  const user = await prisma.matchUser.findUnique({ where: { id: userId } });
  const balance = Number(user?.balance || 0);
  if (balance < amount) return { ok: false, balance };
  await prisma.$transaction([
    prisma.matchUser.update({ where: { id: userId }, data: { balance: { decrement: amount } } }),
    prisma.matchTransaction.create({ data: { userId, amount, currency: "internal", type, status: "COMPLETED" } }),
  ]);
  return { ok: true, balance: balance - amount };
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

