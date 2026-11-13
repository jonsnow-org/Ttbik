/**
 * The jobs/store bot's (JOBS_BOT, @Saragptbotbot) rules as plain functions, shared by the chat (src/lib/jobsBotLogic.ts) and the
 * bot's own Mini App (src/lib/botApp/jobsApp.ts). Nothing here sends a Telegram message; callers notify (src/lib/jobs/notify.ts).
 *
 * Money moves only through these, each in one DB transaction:
 *  - chargeJobsUser: row-locked check-and-decrement (never negative).
 *  - acceptOfferCore: the offer (PENDING → ACCEPTED), the listing/request (ACTIVE → SOLD/FULFILLED), the buyer's escrow hold and the
 *    StoreOrder all succeed together or not at all, so a double tap or two offers accepted at once can never charge twice.
 *  - settleEscrow: only the caller that wins ESCROWED → RELEASED/REFUNDED pays.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const RESULTS_PAGE_SIZE = 5;
export const MAX_PHOTOS = 5;
export const MAX_PRICE = 10_000_000;
export const PROFESSIONAL_CATEGORIES = [
  "نجار", "حداد", "سباك", "كهربائي", "دهان", "ميكانيكي سيارات",
  "فني تكييف وتبريد", "بنّاء", "مبلّط", "فني جبس وديكور", "حداد ألمنيوم",
  "فني زجاج", "سائق", "بستاني", "عامل نظافة", "خياط",
  "حلاق ومصفف شعر", "فني كمبيوتر وموبايل", "مصوّر", "طباخ وشيف",
  "عامل مطعم", "حارس أمن", "عامل مستودع وتحميل",
];
export type RoleType = "SEEKER" | "EMPLOYER" | "TRADER" | "PROFESSIONAL";
export const ROLES: RoleType[] = ["SEEKER", "EMPLOYER", "PROFESSIONAL", "TRADER"];

export function contactUrlOf(p: { contactMethod: string; contactValue: string } | null | undefined): string | null {
  if (!p) return null;
  return p.contactMethod === "TELEGRAM" ? `https://t.me/${p.contactValue.replace(/^@/, "")}` : `https://wa.me/${p.contactValue.replace(/[^0-9]/g, "")}`;
}
/** Same parsing as the chat's price steps (digits and a dot), bounded. */
export function parsePrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 && n < MAX_PRICE ? Math.round(n * 100) / 100 : null;
}
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+\n/g, "\n").trim().slice(0, max);

// ---------------------------------------------------------------- balance & escrow
export async function chargeJobsUser(userId: string, amount: number, type: string): Promise<{ ok: boolean; balance: number }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.jobsUser.updateMany({ where: { id: userId, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
    const current = await tx.jobsUser.findUnique({ where: { id: userId } });
    const balance = Number(current?.balance || 0);
    if (result.count === 0) return { ok: false, balance };
    await tx.jobsTransaction.create({ data: { userId, amount, currency: "internal", type, status: "COMPLETED" } });
    return { ok: true, balance };
  });
}

export const DEFAULT_JOBS_STORE_COMMISSION_PERCENT = 10;
export function jobsStoreCommissionPercent(): number {
  const configured = Number(process.env.JOBS_STORE_COMMISSION_PERCENT ?? DEFAULT_JOBS_STORE_COMMISSION_PERCENT);
  return Number.isFinite(configured) && configured >= 0 && configured <= 30
    ? configured
    : DEFAULT_JOBS_STORE_COMMISSION_PERCENT;
}
const cents = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export function jobsStoreCommissionBreakdown(grossRaw: number) {
  const gross = cents(grossRaw);
  const percent = jobsStoreCommissionPercent();
  const commission = cents((gross * percent) / 100);
  return { gross, percent, commission, sellerNet: cents(gross - commission) };
}

export async function settleEscrow(orderId: string, finalStatus: "RELEASED" | "REFUNDED", payeeId: string, amount: number, ledgerType: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.storeOrder.findUnique({ where: { id: orderId } });
    if (!order || order.status !== "ESCROWED") return false;
    const gross = cents(Number(order.amount));
    if (Math.abs(cents(amount) - gross) > 0.001) throw new Error("Escrow settlement amount mismatch");
    const expectedPayee = finalStatus === "RELEASED" ? order.sellerId : order.buyerId;
    if (payeeId !== expectedPayee) throw new Error("Escrow settlement payee mismatch");

    const claim = await tx.storeOrder.updateMany({
      where: { id: orderId, status: "ESCROWED" },
      data: { status: finalStatus, releasedAt: new Date() },
    });
    if (claim.count !== 1) return false;

    // Refunds return the full held amount. A successful seller payout deducts
    // the platform fee from the seller's proceeds; the buyer pays no extra fee.
    if (finalStatus === "REFUNDED") {
      await tx.jobsUser.update({ where: { id: order.buyerId }, data: { balance: { increment: gross } } });
      await tx.jobsTransaction.create({
        data: { userId: order.buyerId, amount: gross, currency: "internal", type: ledgerType, status: "COMPLETED" },
      });
      return true;
    }

    const seller = await tx.jobsUser.findUnique({ where: { id: order.sellerId } });
    if (!seller) throw new Error("Escrow seller wallet is missing");
    const adminId = String(process.env.SUPER_ADMIN_TELEGRAM_ID || "").trim();
    const breakdown = jobsStoreCommissionBreakdown(gross);
    if (breakdown.commission > 0) {
      if (!adminId || adminId === order.sellerId || adminId === order.buyerId) {
        throw new Error("Configure a distinct SUPER_ADMIN_TELEGRAM_ID before releasing escrow with platform commission");
      }
      await tx.jobsUser.upsert({
        where: { id: adminId },
        update: { balance: { increment: breakdown.commission } },
        create: { id: adminId, botId: seller.botId, balance: breakdown.commission },
      });
      await tx.jobsTransaction.create({
        data: {
          userId: adminId,
          amount: breakdown.commission,
          currency: "internal",
          type: "PLATFORM_COMMISSION",
          status: "COMPLETED",
        },
      });
    }
    await tx.jobsUser.update({
      where: { id: order.sellerId },
      data: { balance: { increment: breakdown.sellerNet } },
    });
    await tx.jobsTransaction.create({
      data: {
        userId: order.sellerId,
        amount: breakdown.sellerNet,
        currency: "internal",
        type: ledgerType,
        status: "COMPLETED",
      },
    });
    return true;
  });
}

// ---------------------------------------------------------------- blocks
export async function isBlocked(aId: string, bId: string): Promise<boolean> {
  return !!(await prisma.jobsBlock.findFirst({ where: { OR: [{ blockerId: aId, blockedId: bId }, { blockerId: bId, blockedId: aId }] } }));
}
export async function blockedPeerIds(userId: string): Promise<string[]> {
  const rows = await prisma.jobsBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
  return Array.from(new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId))));
}
export async function blockUser(blockerId: string, blockedId: string) {
  if (!blockedId || blockedId === blockerId) return;
  await prisma.jobsBlock.upsert({ where: { blockerId_blockedId: { blockerId, blockedId } }, update: {}, create: { blockerId, blockedId } }).catch(() => null);
}

// ---------------------------------------------------------------- profile
export type ProfileInput = {
  name?: unknown; age?: unknown; country?: unknown; governorate?: unknown; city?: unknown; contactMethod?: unknown; contactValue?: unknown;
  roleType?: unknown; seekerProfession?: unknown; employerBusinessName?: unknown; professionalCategory?: unknown; professionalDescription?: unknown;
};
/** The chat's profile wizard as one validated form (same fields, same exclusive role, same normalising of the contact). */
export function validateProfile(d: ProfileInput): { ok: true; data: Record<string, string | number | null> } | { ok: false; error: string } {
  const name = clean(d.name, 60);
  if (!name) return { ok: false, error: "اكتب اسمك." };
  const age = Number(String(d.age ?? "").replace(/[^0-9]/g, ""));
  if (!Number.isFinite(age) || age < 16 || age > 90) return { ok: false, error: "أرسل عمراً صحيحاً (16 فأكثر)." };
  const country = clean(d.country, 60), governorate = clean(d.governorate, 60), city = clean(d.city, 60);
  if (!country || !governorate || !city) return { ok: false, error: "أكمل الدولة والمحافظة والمدينة." };
  const contactMethod = d.contactMethod === "WHATSAPP" ? "WHATSAPP" : d.contactMethod === "TELEGRAM" ? "TELEGRAM" : null;
  if (!contactMethod) return { ok: false, error: "اختر وسيلة التواصل." };
  const raw = clean(d.contactValue, 64);
  const contactValue = contactMethod === "WHATSAPP" ? raw.replace(/[^0-9+]/g, "") : raw.replace(/^@/, "");
  if (!contactValue) return { ok: false, error: contactMethod === "WHATSAPP" ? "أرسل رقم واتساب." : "أرسل معرّفك في تلجرام." };
  const roleType = ROLES.includes(d.roleType as RoleType) ? (d.roleType as RoleType) : null;
  if (!roleType) return { ok: false, error: "اختر نوع ملفك الشخصي." };
  let seekerProfession: string | null = null, employerBusinessName: string | null = null, professionalCategory: string | null = null, professionalDescription: string | null = null;
  if (roleType === "SEEKER") { seekerProfession = clean(d.seekerProfession, 80); if (!seekerProfession) return { ok: false, error: "اكتب المهنة التي تتقنها أو تبحث عنها." }; }
  if (roleType === "EMPLOYER") { employerBusinessName = clean(d.employerBusinessName, 80); if (!employerBusinessName) return { ok: false, error: "اكتب اسم عملك/شركتك/متجرك." }; }
  if (roleType === "PROFESSIONAL") {
    professionalCategory = clean(d.professionalCategory, 60);
    if (!professionalCategory) return { ok: false, error: "اختر الحرفة/الخدمة التي تقدّمها." };
    professionalDescription = clean(d.professionalDescription, 600) || null;
  }
  return { ok: true, data: { name, age, country, governorate, city, contactMethod, contactValue, roleType, seekerProfession, employerBusinessName, professionalCategory, professionalDescription } };
}
export async function saveProfileCore(userId: string, d: ProfileInput) {
  const v = validateProfile(d);
  if (!v.ok) return v;
  const profile = await prisma.jobsProfile.upsert({ where: { userId }, update: v.data as any, create: { userId, ...(v.data as any) } });
  return { ok: true as const, profile };
}
export async function toggleProfilePause(userId: string) {
  const p = await prisma.jobsProfile.findUnique({ where: { userId } });
  if (!p || p.roleType !== "PROFESSIONAL") return { ok: false as const, error: "هذا الخيار لملفات «مهني» فقط." };
  const isPaused = !p.isPaused;
  await prisma.jobsProfile.update({ where: { userId }, data: { isPaused } });
  return { ok: true as const, isPaused };
}

// ---------------------------------------------------------------- store listings (sell) and requests (buy)
export type ListingInput = { title?: unknown; description?: unknown; price?: unknown; photoFileIds?: unknown; deliveryMethod?: unknown; paymentMethod?: unknown };
export function validateListing(d: ListingInput) {
  const title = clean(d.title, 100);
  if (!title) return { ok: false as const, error: "اكتب عنوان المنتج." };
  const price = parsePrice(d.price);
  if (price === null) return { ok: false as const, error: "أرسل سعراً صحيحاً." };
  const deliveryMethod = d.deliveryMethod === "SHIPPING" ? "SHIPPING" : d.deliveryMethod === "PICKUP_MANUAL" ? "PICKUP_MANUAL" : null;
  if (!deliveryMethod) return { ok: false as const, error: "اختر طريقة التسليم." };
  // All store transactions now use platform escrow. Accept the legacy field
  // from older clients, but never create another off-platform/manual listing.
  const photos = Array.isArray(d.photoFileIds) ? d.photoFileIds.filter((x) => typeof x === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(x)).slice(0, MAX_PHOTOS) : [];
  return { ok: true as const, data: { title, description: clean(d.description, 1500) || null, price, photoFileIds: photos as string[], deliveryMethod, paymentMethod: "ESCROW" as const } };
}
/** «💰 أمر بيع» (create) or «✏️ تعديل» (edit). Selling is for «تاجر» profiles; only the owner edits, and only while ACTIVE/PAUSED. */
export async function saveListingCore(userId: string, d: ListingInput, editingId?: string | null) {
  const profile = await prisma.jobsProfile.findUnique({ where: { userId } });
  if (!profile || profile.roleType !== "TRADER") return { ok: false as const, error: "⚠️ البيع متاح فقط لملفات «تاجر»." };
  const v = validateListing(d);
  if (!v.ok) return v;
  if (editingId) {
    const n = await prisma.storeListing.updateMany({ where: { id: editingId, sellerId: userId, status: { in: ["ACTIVE", "PAUSED"] } }, data: { ...v.data, photoFileIds: v.data.photoFileIds as any } });
    if (n.count !== 1) return { ok: false as const, error: "لا يمكن تعديل هذا المنتج الآن." };
    return { ok: true as const, id: editingId, created: false };
  }
  const l = await prisma.storeListing.create({ data: { sellerId: userId, ...v.data, photoFileIds: v.data.photoFileIds as any } });
  return { ok: true as const, id: l.id, created: true };
}
async function setOwnedStatus(model: "storeListing" | "storeWantedListing", owner: "sellerId" | "buyerId", userId: string, id: string, to: "TOGGLE" | "REMOVED") {
  const row: any = await (prisma as any)[model].findUnique({ where: { id } });
  if (!row || row[owner] !== userId) return { ok: false as const, error: "غير مسموح." };
  if (row.status !== "ACTIVE" && row.status !== "PAUSED") return { ok: false as const, error: to === "REMOVED" ? "لا يمكن حذف هذا العنصر." : "لا يمكن تغيير حالة هذا العنصر." };
  const status = to === "REMOVED" ? "REMOVED" : row.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  const n = await (prisma as any)[model].updateMany({ where: { id, [owner]: userId, status: row.status }, data: { status } });
  if (n.count !== 1) return { ok: false as const, error: "تغيّرت الحالة للتو، حدّث الصفحة." };
  return { ok: true as const, status };
}
export const toggleListingCore = (userId: string, id: string) => setOwnedStatus("storeListing", "sellerId", userId, id, "TOGGLE");
export const deleteListingCore = (userId: string, id: string) => setOwnedStatus("storeListing", "sellerId", userId, id, "REMOVED");
export const toggleWantedCore = (userId: string, id: string) => setOwnedStatus("storeWantedListing", "buyerId", userId, id, "TOGGLE");
export const deleteWantedCore = (userId: string, id: string) => setOwnedStatus("storeWantedListing", "buyerId", userId, id, "REMOVED");

export async function saveWantedCore(userId: string, d: { title?: unknown; description?: unknown; budget?: unknown }, editingId?: string | null) {
  const profile = await prisma.jobsProfile.findUnique({ where: { userId } });
  if (!profile || profile.roleType !== "TRADER") return { ok: false as const, error: "⚠️ نشر طلب شراء متاح فقط لملفات «تاجر». يمكنك تصفح المتجر بحرية رغم ذلك." };
  const title = clean(d.title, 100);
  if (!title) return { ok: false as const, error: "اكتب ما تريد شراءه." };
  const fields = { title, description: clean(d.description, 1500) || null, budget: d.budget === null || d.budget === undefined || d.budget === "" ? null : parsePrice(d.budget) };
  if (editingId) {
    const n = await prisma.storeWantedListing.updateMany({ where: { id: editingId, buyerId: userId, status: { in: ["ACTIVE", "PAUSED"] } }, data: fields });
    if (n.count !== 1) return { ok: false as const, error: "لا يمكن تعديل هذا الطلب الآن." };
    return { ok: true as const, id: editingId, created: false };
  }
  const w = await prisma.storeWantedListing.create({ data: { buyerId: userId, ...fields } });
  return { ok: true as const, id: w.id, created: true };
}

export type StoreFilters = { min?: number | null; max?: number | null; escrow?: boolean; shipping?: boolean; sort?: "new" | "price_asc" | "price_desc" };
/** Public browse/search of sell listings: same visibility as the chat (ACTIVE, never the viewer's own, never a blocked peer; ⭐ featured lead page one). */
export async function searchListings(viewerId: string, keyword: string, offset: number, featuredIds: string[], f: StoreFilters = {}, take = 20) {
  const blocked = await blockedPeerIds(viewerId);
  const kw = clean(keyword, 60);
  const price: Prisma.FloatFilter = {};
  if (f.min && f.min > 0) price.gte = f.min;
  if (f.max && f.max > 0) price.lte = f.max;
  const where: Prisma.StoreListingWhereInput = {
    status: "ACTIVE",
    sellerId: { notIn: [...blocked, viewerId] },
    ...(kw ? { OR: [{ title: { contains: kw, mode: "insensitive" } }, { description: { contains: kw, mode: "insensitive" } }] } : {}),
    ...(Object.keys(price).length ? { price } : {}),
    // All active store listings are treated as escrow-only, including legacy MANUAL rows.
    ...(f.shipping ? { deliveryMethod: "SHIPPING" } : {}),
  };
  const orderBy: Prisma.StoreListingOrderByWithRelationInput = f.sort === "price_asc" ? { price: "asc" } : f.sort === "price_desc" ? { price: "desc" } : { created_at: "desc" };
  const rows = await prisma.storeListing.findMany({ where, orderBy, skip: offset, take: take + 1 });
  let featured: typeof rows = [];
  if (offset === 0 && featuredIds.length && (!f.sort || f.sort === "new")) {
    const fr = await prisma.storeListing.findMany({ where: { ...where, id: { in: featuredIds } } });
    featured = featuredIds.map((id) => fr.find((r) => r.id === id)).filter((r): r is (typeof fr)[number] => !!r);
  }
  return { rows: rows.slice(0, take), featured, more: rows.length > take };
}
export async function searchWanted(viewerId: string, keyword: string, offset: number, take = 20) {
  const blocked = await blockedPeerIds(viewerId);
  const kw = clean(keyword, 60);
  const rows = await prisma.storeWantedListing.findMany({
    where: { status: "ACTIVE", buyerId: { notIn: [...blocked, viewerId] }, ...(kw ? { OR: [{ title: { contains: kw, mode: "insensitive" } }, { description: { contains: kw, mode: "insensitive" } }] } : {}) },
    orderBy: { created_at: "desc" }, skip: offset, take: take + 1,
  });
  return { rows: rows.slice(0, take), more: rows.length > take };
}

// ---------------------------------------------------------------- offers (either side opens; accepting executes at the current price)
export type OfferRow = { id: string; kind: string; listingId: string | null; wantedId: string | null; buyerId: string; sellerId: string; price: number; lastOfferBy: string; status: string };
export const otherPartyOf = (o: Pick<OfferRow, "lastOfferBy" | "buyerId" | "sellerId">) => (o.lastOfferBy === o.buyerId ? o.sellerId : o.buyerId);

/** «🛍 شراء (عرض سعر)» on a listing or «💰 بيع (تقديم عرض)» on a buy request. */
export async function createOfferCore(initiatorId: string, kind: "LISTING" | "WANTED", targetId: string, rawPrice: unknown) {
  const price = parsePrice(rawPrice);
  if (price === null) return { ok: false as const, error: "أرسل سعراً صحيحاً." };
  if (kind === "LISTING") {
    const listing = await prisma.storeListing.findUnique({ where: { id: targetId } });
    if (!listing || listing.status !== "ACTIVE") return { ok: false as const, error: "لم يعد هذا المنتج متاحاً." };
    if (listing.sellerId === initiatorId) return { ok: false as const, error: "لا يمكنك تقديم عرض على منتجك الخاص." };
    if (await isBlocked(initiatorId, listing.sellerId)) return { ok: false as const, error: "🚫 لا يمكن إتمام هذا الطلب." };
    const offer = await prisma.storeOffer.create({ data: { kind: "LISTING", listingId: listing.id, buyerId: initiatorId, sellerId: listing.sellerId, price, lastOfferBy: initiatorId } });
    return { ok: true as const, offer, title: listing.title };
  }
  const wanted = await prisma.storeWantedListing.findUnique({ where: { id: targetId } });
  if (!wanted || wanted.status !== "ACTIVE") return { ok: false as const, error: "لم يعد هذا الطلب متاحاً." };
  if (wanted.buyerId === initiatorId) return { ok: false as const, error: "لا يمكنك تقديم عرض على طلبك الخاص." };
  if (await isBlocked(initiatorId, wanted.buyerId)) return { ok: false as const, error: "🚫 لا يمكن إتمام هذا الطلب." };
  const offer = await prisma.storeOffer.create({ data: { kind: "WANTED", wantedId: wanted.id, buyerId: wanted.buyerId, sellerId: initiatorId, price, lastOfferBy: initiatorId } });
  return { ok: true as const, offer, title: wanted.title };
}

async function pendingOfferFor(userId: string, offerId: string) {
  const offer = await prisma.storeOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.status !== "PENDING") return { ok: false as const, error: "هذا العرض لم يعد متاحاً." };
  if (otherPartyOf(offer) !== userId) return { ok: false as const, error: "ليس لديك صلاحية الرد على هذا العرض." };
  return { ok: true as const, offer };
}
export async function rejectOfferCore(userId: string, offerId: string) {
  const p = await pendingOfferFor(userId, offerId);
  if (!p.ok) return p;
  const n = await prisma.storeOffer.updateMany({ where: { id: offerId, status: "PENDING" }, data: { status: "REJECTED" } });
  if (n.count !== 1) return { ok: false as const, error: "هذا العرض لم يعد متاحاً." };
  return { ok: true as const, offer: p.offer };
}
/** «💬 تفاوض»: only the side whose turn it is; the swap is conditional on the turn, so two counters at once cannot both land. */
export async function counterOfferCore(userId: string, offerId: string, rawPrice: unknown) {
  const price = parsePrice(rawPrice);
  if (price === null) return { ok: false as const, error: "أرسل سعراً صحيحاً." };
  const p = await pendingOfferFor(userId, offerId);
  if (!p.ok) return { ok: false as const, error: p.error.replace("الرد على", "التفاوض على") };
  const n = await prisma.storeOffer.updateMany({ where: { id: offerId, status: "PENDING", lastOfferBy: p.offer.lastOfferBy }, data: { price, lastOfferBy: userId } });
  if (n.count !== 1) return { ok: false as const, error: "هذا العرض لم يعد متاحاً." };
  return { ok: true as const, offer: { ...p.offer, price, lastOfferBy: userId } };
}

class Abort extends Error { constructor(public why: "gone" | "unavailable" | "balance") { super(why); } }
export type AcceptOutcome =
  | { ok: true; mode: "escrow"; offer: OfferRow; title: string; orderId: string; wanted: boolean }
  | { ok: false; reason: "gone" | "not_allowed"; error: string }
  | { ok: false; reason: "unavailable"; error: string; offer: OfferRow; wanted: boolean }
  | { ok: false; reason: "balance"; error: string; offer: OfferRow; balance: number };

/**
 * «✅ قبول». Manual payment: the offer is accepted and both sides get each other's contact. Escrow: in ONE transaction the offer is
 * claimed (PENDING → ACCEPTED), the listing (ACTIVE → SOLD) or request (ACTIVE → FULFILLED) is claimed, the buyer's balance is held
 * and the StoreOrder is created; if any step fails nothing is written, then the offer is rejected as before.
 */
export async function acceptOfferCore(userId: string, offerId: string): Promise<AcceptOutcome> {
  const p = await pendingOfferFor(userId, offerId);
  if (!p.ok) return { ok: false, reason: p.error.includes("صلاحية") ? "not_allowed" : "gone", error: p.error };
  const offer = p.offer as OfferRow;
  const isWanted = offer.kind !== "LISTING";
  const rejectOffer = () => prisma.storeOffer.updateMany({ where: { id: offer.id, status: "PENDING" }, data: { status: "REJECTED" } });
  if (!isWanted) {
    const listing = await prisma.storeListing.findUnique({ where: { id: offer.listingId! } });
    if (!listing || listing.status !== "ACTIVE") { await rejectOffer(); return { ok: false, reason: "unavailable", error: "❌ لم يعد هذا الاتفاق ممكناً — المنتج لم يعد متاحاً.", offer, wanted: false }; }
    // Legacy MANUAL listings are migrated logically at purchase time: a sale
    // is never accepted unless the buyer's funds are held in the platform escrow.
    try {
      const orderId = await prisma.$transaction(async (tx) => {
        if ((await tx.storeOffer.updateMany({ where: { id: offer.id, status: "PENDING" }, data: { status: "ACCEPTED" } })).count !== 1) throw new Abort("gone");
        if ((await tx.storeListing.updateMany({ where: { id: listing.id, status: "ACTIVE" }, data: { status: "SOLD" } })).count !== 1) throw new Abort("unavailable");
        if ((await tx.jobsUser.updateMany({ where: { id: offer.buyerId, balance: { gte: offer.price } }, data: { balance: { decrement: offer.price } } })).count !== 1) throw new Abort("balance");
        await tx.jobsTransaction.create({ data: { userId: offer.buyerId, amount: offer.price, currency: "internal", type: "ESCROW_HOLD", status: "COMPLETED" } });
        const order = await tx.storeOrder.create({ data: { buyerId: offer.buyerId, sellerId: listing.sellerId, listingId: listing.id, amount: offer.price, deliveryMethod: listing.deliveryMethod, status: "ESCROWED", escrowedAt: new Date() } });
        return order.id;
      });
      return { ok: true, mode: "escrow", offer, title: listing.title, orderId, wanted: false };
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      return abortOutcome(e.why, offer, false, rejectOffer);
    }
  }
  const wanted = await prisma.storeWantedListing.findUnique({ where: { id: offer.wantedId! } });
  if (!wanted || wanted.status !== "ACTIVE") { await rejectOffer(); return { ok: false, reason: "unavailable", error: "❌ لم يعد هذا الاتفاق ممكناً — الطلب لم يعد متاحاً.", offer, wanted: true }; }
  try {
    const orderId = await prisma.$transaction(async (tx) => {
      if ((await tx.storeOffer.updateMany({ where: { id: offer.id, status: "PENDING" }, data: { status: "ACCEPTED" } })).count !== 1) throw new Abort("gone");
      if ((await tx.storeWantedListing.updateMany({ where: { id: wanted.id, status: "ACTIVE" }, data: { status: "FULFILLED" } })).count !== 1) throw new Abort("unavailable");
      if ((await tx.jobsUser.updateMany({ where: { id: offer.buyerId, balance: { gte: offer.price } }, data: { balance: { decrement: offer.price } } })).count !== 1) throw new Abort("balance");
      await tx.jobsTransaction.create({ data: { userId: offer.buyerId, amount: offer.price, currency: "internal", type: "ESCROW_HOLD", status: "COMPLETED" } });
      // No pre-existing StoreListing: one is synthesised (SOLD) so the escrow/dispute/auto-release pipeline keeps working unchanged.
      const listing = await tx.storeListing.create({ data: { sellerId: offer.sellerId, title: wanted.title, description: wanted.description, price: offer.price, photoFileIds: [], deliveryMethod: "PICKUP_MANUAL", paymentMethod: "ESCROW", status: "SOLD" } });
      const order = await tx.storeOrder.create({ data: { buyerId: offer.buyerId, sellerId: offer.sellerId, listingId: listing.id, amount: offer.price, deliveryMethod: "PICKUP_MANUAL", status: "ESCROWED", escrowedAt: new Date() } });
      return order.id;
    });
    return { ok: true, mode: "escrow", offer, title: wanted.title, orderId, wanted: true };
  } catch (e) {
    if (!(e instanceof Abort)) throw e;
    return abortOutcome(e.why, offer, true, rejectOffer);
  }
}
async function abortOutcome(why: Abort["why"], offer: OfferRow, wanted: boolean, rejectOffer: () => Promise<unknown>): Promise<AcceptOutcome> {
  if (why === "gone") return { ok: false, reason: "gone", error: "هذا العرض لم يعد متاحاً." };
  await rejectOffer();
  if (why === "unavailable") return { ok: false, reason: "unavailable", error: `❌ لم يعد هذا الاتفاق ممكناً — ${wanted ? "الطلب" : "المنتج"} لم يعد متاحاً.`, offer, wanted };
  const u = await prisma.jobsUser.findUnique({ where: { id: offer.buyerId } });
  return { ok: false, reason: "balance", error: "❌ لم يكتمل الاتفاق — رصيد المشتري غير كافٍ حالياً.", offer, balance: Number(u?.balance || 0) };
}

// ---------------------------------------------------------------- orders, receipt, disputes
export async function confirmReceivedCore(buyerId: string, orderId: string) {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order || order.buyerId !== buyerId || order.status !== "ESCROWED") return { ok: false as const, error: "هذا الطلب غير متاح لهذا الإجراء." };
  if (!(await settleEscrow(order.id, "RELEASED", order.sellerId, order.amount, "ESCROW_RELEASE"))) return { ok: false as const, error: "هذا الطلب غير متاح لهذا الإجراء." };
  // A dispute the buyer opened and then settled by confirming receipt no longer waits in the admin inbox.
  await prisma.jobsDispute.updateMany({ where: { orderId, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolution: "RELEASED_TO_SELLER", resolvedAt: new Date() } }).catch(() => null);
  return { ok: true as const, order };
}
export async function openDisputeCore(userId: string, orderId: string) {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "ESCROWED" || (order.buyerId !== userId && order.sellerId !== userId)) return { ok: false as const, error: "لا يمكن فتح نزاع على هذا الطلب." };
  const existing = await prisma.jobsDispute.findUnique({ where: { orderId } });
  await prisma.jobsDispute.upsert({ where: { orderId }, update: {}, create: { orderId, openedBy: userId } });
  const side = order.buyerId === userId ? ("buyer" as const) : ("seller" as const);
  return { ok: true as const, order, side, otherSide: side === "buyer" ? order.sellerId : order.buyerId, opened: !existing };
}
/** One side's statement (+ optional photo). The order must still be in escrow with an open dispute. */
export async function submitDisputeCore(userId: string, orderId: string, statementRaw: unknown, photoFileId: string | null) {
  const statement = clean(statementRaw, 2000);
  if (!statement) return { ok: false as const, error: "اكتب إفادتك." };
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order || (order.buyerId !== userId && order.sellerId !== userId)) return { ok: false as const, error: "لا يمكن تقديم إفادة على هذا الطلب." };
  const d = await prisma.jobsDispute.findUnique({ where: { orderId } });
  if (!d || d.status === "RESOLVED" || order.status !== "ESCROWED") return { ok: false as const, error: "لا يوجد نزاع مفتوح على هذا الطلب." };
  const side = order.buyerId === userId ? "buyer" : "seller";
  const photo = photoFileId && /^[A-Za-z0-9_-]{20,200}$/.test(photoFileId) ? [photoFileId] : [];
  const field = side === "buyer" ? { buyerStatement: statement, buyerEvidencePhotoIds: photo } : { sellerStatement: statement, sellerEvidencePhotoIds: photo };
  const dispute = await prisma.jobsDispute.update({ where: { orderId }, data: field as any });
  const bothIn = !!dispute.buyerStatement && !!dispute.sellerStatement;
  if (bothIn && dispute.status !== "BOTH_SUBMITTED") await prisma.jobsDispute.update({ where: { orderId }, data: { status: "BOTH_SUBMITTED" } });
  return { ok: true as const, order, dispute, bothIn };
}

// ---------------------------------------------------------------- reports, admin messages
export const REPORT_KINDS = ["profile", "posting", "listing", "wanted"] as const;
export async function reportCore(reporterId: string, targetKind: unknown, targetId: unknown, reasonRaw: unknown, photo: string | null = null) {
  const kind = REPORT_KINDS.includes(targetKind as any) ? (targetKind as (typeof REPORT_KINDS)[number]) : null;
  const reason = clean(reasonRaw, 800);
  const id = String(targetId || "").slice(0, 64);
  if (!kind || !id) return { ok: false as const, error: "بلاغ غير صالح." };
  if (!reason) return { ok: false as const, error: "اكتب سبب البلاغ." };
  await prisma.jobsReport.create({ data: { reporterId, targetId: id, targetKind: kind, reason, evidencePhotoFileId: photo } });
  return { ok: true as const };
}
export async function adminMessageCore(senderId: string, textRaw: unknown, suggestion: boolean) {
  const text = clean(textRaw, 2000);
  if (!text) return { ok: false as const, error: "اكتب رسالتك." };
  const saved = await prisma.jobsAdminMessage.create({ data: { senderId, text: suggestion ? `💡 اقتراح:\n${text}` : text } });
  return { ok: true as const, id: saved.id, text };
}

// ---------------------------------------------------------------- work section
export async function createJobPostingCore(userId: string, d: Record<string, unknown>) {
  const profile = await prisma.jobsProfile.findUnique({ where: { userId } });
  if (!profile || profile.roleType !== "EMPLOYER") return { ok: false as const, error: profile?.roleType === "PROFESSIONAL" ? "ملفك كمهني هو إعلانك — عدّله من «ملفي الشخصي»." : "⚠️ النشر متاح فقط لملفات «معلن وظيفة» و«مهني»." };
  const title = clean(d.title, 100), keywords = clean(d.keywords, 200), governorate = clean(d.governorate, 60), city = clean(d.city, 60);
  if (!title) return { ok: false as const, error: "ما مسمى الوظيفة؟" };
  if (!keywords) return { ok: false as const, error: "أضف كلمات مفتاحية تصف الوظيفة." };
  if (!governorate || !city) return { ok: false as const, error: "أكمل المحافظة والمدينة." };
  const contactMethod = d.contactMethod === "WHATSAPP" ? "WHATSAPP" : d.contactMethod === "TELEGRAM" ? "TELEGRAM" : null;
  if (!contactMethod) return { ok: false as const, error: "اختر وسيلة التواصل." };
  const raw = clean(d.contactValue, 64);
  const contactValue = contactMethod === "WHATSAPP" ? raw.replace(/[^0-9+]/g, "") : raw.replace(/^@/, "");
  if (!contactValue) return { ok: false as const, error: "أرسل معرّف تلجرام أو رقم واتساب." };
  const workersCount = Math.min(10_000, Math.max(1, Number(String(d.workersCount ?? "").replace(/[^0-9]/g, "")) || 1));
  const p = await prisma.jobPosting.create({ data: { posterId: userId, title, keywords, workersCount, governorate, city, description: clean(d.description, 1500) || null, contactMethod, contactValue } });
  return { ok: true as const, id: p.id };
}
export async function searchJobPostings(viewerId: string, keyword: string, offset: number, take = 20) {
  const kw = clean(keyword, 60);
  if (!kw) return { rows: [], more: false };
  const blocked = await blockedPeerIds(viewerId);
  const rows = await prisma.jobPosting.findMany({
    where: { status: "OPEN", posterId: { notIn: blocked }, OR: [{ title: { contains: kw, mode: "insensitive" } }, { keywords: { contains: kw, mode: "insensitive" } }] },
    orderBy: { created_at: "desc" }, skip: offset, take: take + 1,
  });
  return { rows: rows.slice(0, take), more: rows.length > take };
}
export async function searchProfessionals(viewerId: string, category: string, region: string, offset: number, take = 20) {
  const cat = clean(category, 60), reg = clean(region, 60);
  if (!cat) return { rows: [], more: false };
  const blocked = await blockedPeerIds(viewerId);
  const rows = await prisma.jobsProfile.findMany({
    where: {
      roleType: "PROFESSIONAL", isPaused: false, userId: { notIn: blocked },
      professionalCategory: { contains: cat, mode: "insensitive" },
      OR: reg ? [{ city: { contains: reg, mode: "insensitive" } }, { governorate: { contains: reg, mode: "insensitive" } }] : undefined,
    },
    orderBy: { created_at: "desc" }, skip: offset, take: take + 1,
  });
  return { rows: rows.slice(0, take), more: rows.length > take };
}
