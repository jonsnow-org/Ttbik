/**
 * MARRIAGE_BOT entitlement RULES (pure): prices, durations and who has what.
 * Single source of truth for the bot and the Mini App. DB side effects live
 * in entitlements.ts.
 */
import type { MatchProfile, MatchUser } from "@prisma/client";

export const PRICE_BOOST_24H = 2;
export const PRICE_VERIFIED_BADGE = 3;
export const PRICE_EXTRA_PHOTOS = 2;
export const PRICE_PROFILE_VISITORS = 2;
export const PRICE_ADVANCED_FILTERS = 2;
export const PRICE_SUPER_LIKE = 1;
export const PRICE_VIP_30D = 8;
export const VIP_DAYS = 30;
export const BOOST_HOURS = 24;

export function isVipActive(user: Pick<MatchUser, "vipUntil">): boolean {
  return !!user.vipUntil && user.vipUntil > new Date();
}
export function hasAdvancedFilters(user: Pick<MatchUser, "advancedFiltersUnlocked" | "vipUntil">): boolean {
  return user.advancedFiltersUnlocked || isVipActive(user);
}
export function hasProfileVisitors(user: Pick<MatchUser, "profileVisitorsUnlocked" | "vipUntil">): boolean {
  return user.profileVisitorsUnlocked || isVipActive(user);
}
export function hasExtraPhotos(user: Pick<MatchUser, "extraPhotosUnlocked" | "vipUntil">): boolean {
  return user.extraPhotosUnlocked || isVipActive(user);
}
export function isEffectivelyBoosted(profile: Pick<MatchProfile, "boostedUntil">, user: Pick<MatchUser, "vipUntil">): boolean {
  return (!!profile.boostedUntil && profile.boostedUntil > new Date()) || isVipActive(user);
}

export function depositLink(userId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  return `${base}/pay/marriage?uid=${userId}`;
}
export function insufficientBalanceText(userId: string, needed: number, have: number): string {
  return `❌ رصيدك الحالي $${have.toFixed(2)} لا يكفي (المطلوب $${needed.toFixed(2)}). أودِع من هنا:\n${depositLink(userId)}`;
}


export type EntitlementUser = Pick<MatchUser, "vipUntil" | "advancedFiltersUnlocked" | "profileVisitorsUnlocked" | "extraPhotosUnlocked" | "balance">;
export type EntitlementProfile = Pick<MatchProfile, "boostedUntil" | "isIncognito" | "verificationStatus"> | null;

/** What the app shows on the Upgrade screen — derived only from the bot's fields. */
export function entitlementSummary(user: EntitlementUser, profile: EntitlementProfile, now = new Date()) {
  const vip = !!user.vipUntil && user.vipUntil > now;
  return {
    balance: Number(user.balance || 0),
    vip,
    vipUntil: vip ? user.vipUntil : null,
    boosted: vip || (!!profile?.boostedUntil && profile.boostedUntil > now),
    boostedUntil: profile?.boostedUntil && profile.boostedUntil > now ? profile.boostedUntil : null,
    advancedFilters: user.advancedFiltersUnlocked || vip,
    profileVisitors: user.profileVisitorsUnlocked || vip,
    extraPhotos: user.extraPhotosUnlocked || vip,
    incognitoAvailable: vip,
    incognitoOn: vip && !!profile?.isIncognito,
    verification: profile?.verificationStatus ?? "NONE",
  };
}

/** Catalogue mirroring the bot's «⭐ الترقيات والمزايا» keyboard, for the app's Upgrade screen. */
export const UPGRADE_CATALOGUE = [
  { key: "boost", icon: "🚀", title: "رفع ملفي", price: PRICE_BOOST_24H, unit: "24 ساعة", desc: "يظهر ملفك أولاً في نتائج البحث لمدة 24 ساعة." },
  { key: "verify", icon: "☑️", title: "طلب التوثيق", price: PRICE_VERIFIED_BADGE, unit: "مرة واحدة", desc: "شارة ☑️ بعد مراجعة صورة هويتك (تُرسل داخل البوت، للإدارة فقط)." },
  { key: "photos", icon: "🖼", title: "صور إضافية", price: PRICE_EXTRA_PHOTOS, unit: "دائم", desc: "صورتان إضافيتان لملفك (الرفع داخل البوت)." },
  { key: "visitors", icon: "👀", title: "من زار ملفي", price: PRICE_PROFILE_VISITORS, unit: "دائم", desc: "اعرف من زار ملفك مؤخراً." },
  { key: "filters", icon: "🎯", title: "فلاتر متقدمة", price: PRICE_ADVANCED_FILTERS, unit: "دائم", desc: "المدينة والحالة الاجتماعية + البحث الدقيق." },
  { key: "vip", icon: "👑", title: "العضوية الذهبية", price: PRICE_VIP_30D, unit: `${VIP_DAYS} يوماً`, desc: "رفع مستمر، فلاتر متقدمة، من زار ملفي، صور إضافية، ووضع التخفي." },
] as const;
