import { Bot as TelegramBot, Keyboard, InlineKeyboard } from "grammy";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * «نبض» — instant blood bank inside MEDICAL_BOT (owner request, 2026-09-25).
 *
 * Someone who needs blood posts a request (recipient's type, units, where,
 * a phone number). Every registered, available donor whose type is
 * compatible, who is outside the rest period since their last donation and
 * whose saved location is within BLOOD_RADIUS_KM is notified at once with a
 * one-tap "I can donate". Volunteering hands the donor the place + phone,
 * and tells the requester a compatible donor is on the way.
 *
 * The bot is only the matchmaker: every string says the donation itself
 * happens at a hospital / blood bank under medical supervision, which also
 * does the real cross-match — the compatibility table below only narrows
 * who gets asked.
 */

export const BLOOD_MENU_LABEL = "🩸 نبض — بنك الدم";
const NEED_LABEL = "🆘 أحتاج دماً الآن";
const NEARBY_LABEL = "🔎 طلبات قريبة تحتاجني";
const DONOR_LABEL = "🩸 ملفي كمتبرع";
const MINE_LABEL = "📋 طلباتي للدم";
const SKIP_LABEL = "⏭ تخطّي";
const BACK_LABEL = "◀️ رجوع";
const MY_NUMBER_LABEL = "📱 إرسال رقمي";

const BLOOD_TYPES = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"] as const;
type BloodType = (typeof BLOOD_TYPES)[number];

// Red-cell compatibility: donor type → recipient types it can give to.
const GIVES_TO: Record<BloodType, BloodType[]> = {
  "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "O+": ["O+", "A+", "B+", "AB+"],
  "A-": ["A-", "A+", "AB-", "AB+"],
  "A+": ["A+", "AB+"],
  "B-": ["B-", "B+", "AB-", "AB+"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"],
};

const BLOOD_RADIUS_KM = 50;
const MAX_NOTIFY = 40;
const REQUEST_TTL_HOURS = 72;
const MAX_OPEN_REQUESTS = 2;
// Common whole-blood guidance is 8–12 weeks between donations; 90 days is
// the conservative end, and the donor is told to follow their blood bank.
const REST_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BloodReqStep = "type" | "units" | "place" | "phone" | "note";
export type BloodReqDraft = { bloodType?: string; units?: number; place?: string; phone?: string; note?: string };
export type BloodPending =
  | { mode: "blood_req"; step: BloodReqStep; data: BloodReqDraft }
  | { mode: "blood_req_confirm"; data: BloodReqDraft }
  | { mode: "blood_donor_type"; thenRequestId?: string };

type Ctx = {
  bot: TelegramBot;
  chatId: number;
  userId: string;
  role: string; // MedUser.role
  home: Keyboard; // role's main menu, to return to
};

function isBloodType(v: string): v is BloodType {
  return (BLOOD_TYPES as readonly string[]).includes(v);
}
function canGive(donor: string, recipient: string): boolean {
  return isBloodType(donor) && isBloodType(recipient) && GIVES_TO[donor].includes(recipient);
}
function donorTypesFor(recipient: string): BloodType[] {
  return BLOOD_TYPES.filter((d) => GIVES_TO[d].includes(recipient as BloodType));
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function restDaysLeft(lastDonationAt: Date | null): number {
  if (!lastDonationAt) return 0;
  return Math.max(0, Math.ceil((lastDonationAt.getTime() + REST_DAYS * DAY_MS - Date.now()) / DAY_MS));
}
function hoursLeft(d: Date): number {
  return Math.max(0, Math.round((d.getTime() - Date.now()) / 3_600_000));
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function donorBadge(count: number): string {
  if (count >= 10) return "🏆 بطل نبض";
  if (count >= 5) return "🥇 منقذ دائم";
  if (count >= 2) return "🥈 متبرع وفي";
  if (count >= 1) return "🥉 متبرع";
  return "🌱 متبرع جديد";
}

async function setPending(userId: string, action: unknown) {
  await prisma.medUser.update({ where: { id: userId }, data: { pendingAction: (action ?? Prisma.DbNull) as any } });
}

// The tables ship in prisma/migration_35 — until the owner has run it,
// answer politely instead of failing the whole update.
async function guarded(bot: TelegramBot, chatId: number, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      await bot.api.sendMessage(chatId, "⏳ خدمة «نبض» قيد التفعيل من الإدارة، جرّبها لاحقاً.").catch(() => null);
      return;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------
function bloodMenu(role: string): Keyboard {
  if (role === "HOSPITAL") {
    return new Keyboard().text(NEED_LABEL).text(MINE_LABEL).row().text(BACK_LABEL).resized();
  }
  return new Keyboard()
    .text(NEED_LABEL).text(NEARBY_LABEL).row()
    .text(DONOR_LABEL).text(MINE_LABEL).row()
    .text(BACK_LABEL)
    .resized();
}
function typeMenu(): Keyboard {
  const kb = new Keyboard();
  BLOOD_TYPES.forEach((t, i) => {
    kb.text(t);
    if (i % 4 === 3) kb.row();
  });
  return kb.text(BACK_LABEL).resized();
}
function unitsMenu(): Keyboard {
  return new Keyboard().text("1").text("2").text("3").text("4").row().text(BACK_LABEL).resized();
}
function skipMenu(): Keyboard {
  return new Keyboard().text(SKIP_LABEL).row().text(BACK_LABEL).resized();
}
function phoneMenu(): Keyboard {
  return new Keyboard().requestContact(MY_NUMBER_LABEL).row().text(BACK_LABEL).resized();
}
function backMenu(): Keyboard {
  return new Keyboard().text(BACK_LABEL).resized();
}

const MENU_TEXTS = new Set([BLOOD_MENU_LABEL, NEED_LABEL, NEARBY_LABEL, DONOR_LABEL, MINE_LABEL]);
export function isBloodMenuText(text: string): boolean {
  return MENU_TEXTS.has(text);
}
export function isBloodPending(p: any): p is BloodPending {
  return !!p && typeof p.mode === "string" && p.mode.startsWith("blood_");
}

// ---------------------------------------------------------------------
// Main-menu buttons
// ---------------------------------------------------------------------
export async function handleBloodMenu(ctx: Ctx, text: string) {
  const { bot, chatId } = ctx;
  await guarded(bot, chatId, async () => {
    if (text === BLOOD_MENU_LABEL) {
      await bot.api.sendMessage(
        chatId,
        "🩸 نبض — بنك الدم الفوري\n\n" +
          "• تحتاج دماً؟ انشر طلباً فيُبلَّغ فوراً كل متبرع متوافق قريب منك.\n" +
          "• تستطيع التبرع؟ سجّل فصيلتك لتصلك النداءات القريبة فقط.\n\n" +
          "ℹ️ البوت وسيط تواصل فقط؛ التبرع وفحص التوافق يتمّان في المستشفى أو بنك الدم.",
        { reply_markup: bloodMenu(ctx.role) }
      );
      return;
    }
    if (text === NEED_LABEL) return startRequest(ctx);
    if (text === NEARBY_LABEL) return sendNearby(ctx);
    if (text === DONOR_LABEL) return sendDonorCard(ctx);
    if (text === MINE_LABEL) return sendMyRequests(ctx);
  });
}

// ---------------------------------------------------------------------
// Request wizard
// ---------------------------------------------------------------------
async function startRequest(ctx: Ctx) {
  const { bot, chatId, userId } = ctx;
  const open = await prisma.medBloodRequest.count({ where: { requesterId: userId, status: "OPEN", expiresAt: { gt: new Date() } } });
  if (open >= MAX_OPEN_REQUESTS) {
    await bot.api.sendMessage(chatId, `⚠️ لديك ${open} طلبات مفتوحة. أغلق أحدها من «${MINE_LABEL}» قبل نشر طلب جديد.`, { reply_markup: bloodMenu(ctx.role) });
    return;
  }
  const origin = await requesterOrigin(ctx);
  if (!origin) return;
  await setPending(userId, { mode: "blood_req", step: "type", data: {} } satisfies BloodPending);
  await bot.api.sendMessage(chatId, "🩸 ما فصيلة دم المريض؟", { reply_markup: typeMenu() });
}

// Where the request is anchored (donors are searched around it) and, for a
// hospital account, the place/phone it already has on file.
async function requesterOrigin(ctx: Ctx): Promise<{ lat: number; lng: number; place?: string; phone?: string } | null> {
  if (ctx.role === "HOSPITAL") {
    const f = await prisma.medFacility.findUnique({ where: { ownerId: ctx.userId } });
    if (f) return { lat: f.latitude, lng: f.longitude, place: `${f.name} — ${f.area || f.city}`, phone: f.phone };
  } else {
    const p = await prisma.medPatientProfile.findUnique({ where: { userId: ctx.userId } });
    if (p) return { lat: p.latitude, lng: p.longitude };
  }
  await ctx.bot.api.sendMessage(ctx.chatId, "⚠️ يجب إكمال تسجيل حسابك أولاً. اضغط /start.");
  return null;
}

export async function handleBloodPending(ctx: Ctx, pending: BloodPending, text: string, contactPhone?: string) {
  const { bot, chatId, userId } = ctx;
  await guarded(bot, chatId, async () => {
    if (pending.mode === "blood_donor_type") {
      if (!isBloodType(text)) {
        await bot.api.sendMessage(chatId, "اختر فصيلتك من الأزرار.", { reply_markup: typeMenu() });
        return;
      }
      await prisma.medBloodDonor.upsert({ where: { userId }, update: { bloodType: text }, create: { userId, bloodType: text } });
      await setPending(userId, null);
      await bot.api.sendMessage(chatId, `✅ سُجّلت متبرعاً بفصيلة ${text}. ستصلك نداءات الطلبات القريبة المتوافقة فقط. شكراً لك ❤️`, {
        reply_markup: bloodMenu(ctx.role),
      });
      if (pending.thenRequestId) await volunteer(ctx, pending.thenRequestId);
      return;
    }

    if (pending.mode === "blood_req_confirm") {
      await bot.api.sendMessage(chatId, "اضغط «✅ نشر الطلب» أعلاه، أو «◀️ رجوع» للإلغاء.");
      return;
    }

    const d = pending.data;
    const origin = await requesterOrigin(ctx);
    if (!origin) return;
    const go = async (step: BloodReqStep) => {
      await setPending(userId, { mode: "blood_req", step, data: d } satisfies BloodPending);
      if (step === "units") await bot.api.sendMessage(chatId, "كم وحدة (كيس) مطلوبة؟", { reply_markup: unitsMenu() });
      if (step === "place") await bot.api.sendMessage(chatId, "🏥 اكتب اسم المستشفى أو بنك الدم والمنطقة:", { reply_markup: backMenu() });
      if (step === "phone") await bot.api.sendMessage(chatId, "📞 رقم هاتف للتواصل (اضغط الزر لإرسال رقمك، أو اكتب رقماً آخر):", { reply_markup: phoneMenu() });
      if (step === "note") await bot.api.sendMessage(chatId, "📝 ملاحظة إضافية؟ (مثلاً: عملية صباح الغد، اسأل عن قسم الطوارئ) أو اضغط تخطّي:", { reply_markup: skipMenu() });
    };

    if (pending.step === "type") {
      if (!isBloodType(text)) {
        await bot.api.sendMessage(chatId, "اختر الفصيلة من الأزرار. إن لم تكن معروفة، اسأل المستشفى أولاً — الفصيلة ضرورية لإبلاغ المتبرعين المناسبين.", { reply_markup: typeMenu() });
        return;
      }
      d.bloodType = text;
      return go("units");
    }
    if (pending.step === "units") {
      const n = parseInt(text.replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        await bot.api.sendMessage(chatId, "أرسل رقماً من 1 إلى 10.", { reply_markup: unitsMenu() });
        return;
      }
      d.units = n;
      if (origin.place && origin.phone) {
        d.place = origin.place;
        d.phone = origin.phone;
        return go("note");
      }
      return go("place");
    }
    if (pending.step === "place") {
      if (text.length < 3 || text.length > 200) {
        await bot.api.sendMessage(chatId, "اكتب اسم المكان بوضوح (3–200 حرف).", { reply_markup: backMenu() });
        return;
      }
      d.place = text;
      return go("phone");
    }
    if (pending.step === "phone") {
      const raw = contactPhone || text;
      const digits = raw.replace(/[^0-9+]/g, "");
      if (digits.replace(/\D/g, "").length < 7) {
        await bot.api.sendMessage(chatId, "أرسل رقم هاتف صحيحاً.", { reply_markup: phoneMenu() });
        return;
      }
      d.phone = digits.startsWith("+") || !contactPhone ? digits : `+${digits}`;
      return go("note");
    }
    if (pending.step === "note") {
      d.note = text === SKIP_LABEL ? undefined : text.slice(0, 300);
      await setPending(userId, { mode: "blood_req_confirm", data: d } satisfies BloodPending);
      await bot.api.sendMessage(chatId, `راجع الطلب قبل النشر:\n\n${requestText(d)}`, {
        reply_markup: new InlineKeyboard().text("✅ نشر الطلب", "bld|pub").text("✖️ إلغاء", "bld|abort"),
      });
    }
  });
}

function requestText(
  d: { bloodType?: string | null; units?: number | null; place?: string | null; phone?: string | null; contactPhone?: string | null; note?: string | null },
  withPhone = true
): string {
  const phone = d.phone ?? d.contactPhone;
  return (
    `🩸 مطلوب دم فصيلة ${d.bloodType}\n` +
    `🧪 الكمية: ${d.units} وحدة\n` +
    `🏥 المكان: ${d.place}\n` +
    (withPhone ? `📞 التواصل: ${phone}\n` : "") +
    (d.note ? `📝 ${d.note}\n` : "")
  );
}

async function publishRequest(ctx: Ctx, d: BloodReqDraft) {
  const { bot, chatId, userId } = ctx;
  const origin = await requesterOrigin(ctx);
  if (!origin) return;
  if (!d.bloodType || !d.units || !d.place || !d.phone) {
    await setPending(userId, null);
    await bot.api.sendMessage(chatId, "انتهت صلاحية المسودة، ابدأ من جديد.", { reply_markup: bloodMenu(ctx.role) });
    return;
  }
  const open = await prisma.medBloodRequest.count({ where: { requesterId: userId, status: "OPEN", expiresAt: { gt: new Date() } } });
  if (open >= MAX_OPEN_REQUESTS) {
    await setPending(userId, null);
    await bot.api.sendMessage(chatId, `⚠️ لديك ${open} طلبات مفتوحة بالفعل.`, { reply_markup: bloodMenu(ctx.role) });
    return;
  }
  const req = await prisma.medBloodRequest.create({
    data: {
      requesterId: userId,
      bloodType: d.bloodType,
      units: d.units,
      place: d.place,
      contactPhone: d.phone,
      note: d.note || null,
      latitude: origin.lat,
      longitude: origin.lng,
      expiresAt: new Date(Date.now() + REQUEST_TTL_HOURS * 3_600_000),
    },
  });
  await setPending(userId, null);

  // Compatible, available, rested donors with a saved location nearby.
  const restCutoff = new Date(Date.now() - REST_DAYS * DAY_MS);
  const donors = await prisma.medBloodDonor.findMany({
    where: {
      isAvailable: true,
      bloodType: { in: donorTypesFor(d.bloodType) },
      userId: { not: userId },
      OR: [{ lastDonationAt: null }, { lastDonationAt: { lt: restCutoff } }],
      user: { isBanned: false, patientProfile: { isNot: null } },
    },
    include: { user: { include: { patientProfile: true } } },
  });
  const nearby = donors
    .map((x) => ({ x, km: haversineKm(origin.lat, origin.lng, x.user.patientProfile!.latitude, x.user.patientProfile!.longitude) }))
    .filter((r) => r.km <= BLOOD_RADIUS_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_NOTIFY);

  let sent = 0;
  for (const { x, km } of nearby) {
    const ok = await bot.api
      .sendMessage(
        Number(x.userId),
        `🚨 نداء تبرع قريب منك (~${Math.max(1, Math.round(km))} كم)\n\n${requestText(req, false)}\nفصيلتك ${x.bloodType} متوافقة. هل تستطيع المساعدة؟`,
        { reply_markup: new InlineKeyboard().text("🩸 أستطيع التبرع", `bld|yes|${req.id}`).text("🙏 ليس الآن", `bld|no|${req.id}`) }
      )
      .then(() => true)
      .catch(() => false);
    if (ok) sent++;
  }
  await prisma.medBloodRequest.update({ where: { id: req.id }, data: { notifiedCount: sent } });

  const link = await shareLink(bot, req.id);
  await bot.api.sendMessage(
    chatId,
    (sent > 0
      ? `✅ نُشر الطلب وأُبلغ ${sent} متبرعاً متوافقاً ضمن ${BLOOD_RADIUS_KM} كم. سيصلك إشعار فور استعداد أي متبرع.`
      : "✅ نُشر الطلب. لا يوجد متبرعون متوافقون مسجّلون قربك حالياً — شارك الرابط أدناه في مجموعات منطقتك ليصل لمن يستطيع المساعدة.") +
      `\n\n🔗 رابط الطلب للمشاركة:\n${link}\n\nالطلب صالح ${REQUEST_TTL_HOURS} ساعة. عند تأمين الدم أغلقه من «${MINE_LABEL}».`,
    { reply_markup: bloodMenu(ctx.role) }
  );
}

async function shareLink(bot: TelegramBot, requestId: string): Promise<string> {
  const me = await bot.api.getMe();
  return `https://t.me/${me.username}?start=bld_${requestId}`;
}

// ---------------------------------------------------------------------
// Donor side
// ---------------------------------------------------------------------
async function sendDonorCard(ctx: Ctx) {
  const { bot, chatId, userId } = ctx;
  const donor = await prisma.medBloodDonor.findUnique({ where: { userId } });
  if (!donor) {
    await setPending(userId, { mode: "blood_donor_type" } satisfies BloodPending);
    await bot.api.sendMessage(
      chatId,
      "🩸 سجّل كمتبرع — لن تصلك إلا نداءات قريبة منك ومتوافقة مع فصيلتك، ويمكنك إيقافها متى شئت.\n\nما فصيلة دمك؟",
      { reply_markup: typeMenu() }
    );
    return;
  }
  const left = restDaysLeft(donor.lastDonationAt);
  const kb = new InlineKeyboard()
    .text(donor.isAvailable ? "⏸ إيقاف استقبال النداءات" : "▶️ استقبال النداءات", "bld|avail").row()
    .text("✅ تبرعت اليوم", "bld|donated").text("🔄 تغيير الفصيلة", "bld|retype");
  await bot.api.sendMessage(
    chatId,
    `🩸 ملفك كمتبرع\n\n` +
      `الفصيلة: ${donor.bloodType}\n` +
      `الحالة: ${donor.isAvailable ? "🟢 تستقبل النداءات" : "⏸ متوقف"}\n` +
      `عدد تبرعاتك: ${donor.donationsCount} — ${donorBadge(donor.donationsCount)}\n` +
      (left > 0 ? `⏳ فترة راحة: متبقٍ ${left} يوماً قبل تلقي النداءات مجدداً.\n` : "✅ جاهز للتبرع.\n") +
      `\nتستطيع التبرع لـ: ${GIVES_TO[donor.bloodType as BloodType]?.join("، ") || "—"}`,
    { reply_markup: kb }
  );
}

async function sendNearby(ctx: Ctx) {
  const { bot, chatId, userId } = ctx;
  const profile = await prisma.medPatientProfile.findUnique({ where: { userId } });
  if (!profile) {
    await bot.api.sendMessage(chatId, "⚠️ يجب إكمال تسجيل ملفك أولاً. اضغط /start.");
    return;
  }
  const donor = await prisma.medBloodDonor.findUnique({ where: { userId } });
  const open = await prisma.medBloodRequest.findMany({
    where: {
      status: "OPEN",
      expiresAt: { gt: new Date() },
      requesterId: { not: userId },
      ...(donor ? { bloodType: { in: GIVES_TO[donor.bloodType as BloodType] || [] } } : {}),
    },
    orderBy: { created_at: "desc" },
    take: 200,
  });
  const near = open
    .map((r) => ({ r, km: haversineKm(profile.latitude, profile.longitude, r.latitude, r.longitude) }))
    .filter((x) => x.km <= BLOOD_RADIUS_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, 5);
  if (near.length === 0) {
    await bot.api.sendMessage(
      chatId,
      donor ? "💚 لا توجد طلبات متوافقة مع فصيلتك قربك الآن. سيصلك إشعار فور نشر أي طلب." : "💚 لا توجد طلبات دم مفتوحة قربك الآن.",
      { reply_markup: bloodMenu(ctx.role) }
    );
    return;
  }
  for (const { r, km } of near) {
    await bot.api.sendMessage(chatId, `📍 ~${Math.max(1, Math.round(km))} كم — ينتهي خلال ${hoursLeft(r.expiresAt)} ساعة\n\n${requestText(r, false)}`, {
      reply_markup: new InlineKeyboard().text("🩸 أستطيع التبرع", `bld|yes|${r.id}`),
    });
  }
  if (!donor) {
    await bot.api.sendMessage(chatId, `💡 سجّل فصيلتك من «${DONOR_LABEL}» لتصلك النداءات المتوافقة تلقائياً.`, { reply_markup: bloodMenu(ctx.role) });
  }
}

async function volunteer(ctx: Ctx, requestId: string, fromMessage?: { chatId: number; messageId: number }) {
  const { bot, chatId, userId } = ctx;
  const req = await prisma.medBloodRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== "OPEN" || req.expiresAt <= new Date()) {
    await bot.api.sendMessage(chatId, "💚 هذا الطلب أُغلق أو انتهت صلاحيته — شكراً لاستعدادك.");
    return;
  }
  if (req.requesterId === userId) {
    await bot.api.sendMessage(chatId, "هذا طلبك أنت.");
    return;
  }
  const donor = await prisma.medBloodDonor.findUnique({ where: { userId } });
  if (!donor) {
    await setPending(userId, { mode: "blood_donor_type", thenRequestId: requestId } satisfies BloodPending);
    await bot.api.sendMessage(chatId, "🩸 قبل المتابعة: ما فصيلة دمك؟", { reply_markup: typeMenu() });
    return;
  }
  if (!canGive(donor.bloodType, req.bloodType)) {
    await bot.api.sendMessage(chatId, `❤️ شكراً لك، لكن فصيلتك ${donor.bloodType} لا تناسب مريضاً فصيلته ${req.bloodType}. شارك الطلب مع من تعرف.\n${await shareLink(bot, req.id)}`);
    return;
  }
  const left = restDaysLeft(donor.lastDonationAt);
  if (left > 0) {
    await bot.api.sendMessage(chatId, `⏳ تبرعت مؤخراً — يُنصح بالانتظار ${left} يوماً آخر (أو حسب توجيه بنك الدم). يمكنك مشاركة الطلب:\n${await shareLink(bot, req.id)}`);
    return;
  }
  try {
    await prisma.medBloodResponse.create({ data: { requestId, donorId: userId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await bot.api.sendMessage(chatId, `سجّلت استعدادك لهذا الطلب مسبقاً ✅\n\n${requestText(req)}`);
      return;
    }
    throw e;
  }
  if (fromMessage) await bot.api.editMessageReplyMarkup(fromMessage.chatId, fromMessage.messageId).catch(() => null);

  await bot.api.sendMessage(
    chatId,
    `❤️ شكراً لك! تفاصيل الطلب:\n\n${requestText(req)}\n` +
      "تواصل مع الرقم أعلاه لتنسيق الوقت، واذهب إلى المستشفى أو بنك الدم حيث يُجرى الفحص والتبرع تحت إشراف طبي.\n" +
      "بعد التبرع اضغط «✅ تبرعت اليوم» من ملفك كمتبرع.",
    { reply_markup: bloodMenu(ctx.role) }
  );
  const count = await prisma.medBloodResponse.count({ where: { requestId } });
  const who = `<a href="tg://user?id=${userId}">متبرع</a>`;
  await bot.api
    .sendMessage(
      Number(req.requesterId),
      `🩸 ${who} بفصيلة ${escapeHtml(donor.bloodType)} مستعد للتبرع لطلبك (${escapeHtml(req.bloodType)} — ${escapeHtml(req.place)}).\n` +
        `أُرسل له رقم التواصل وسيتصل بك. عدد المستعدين حتى الآن: ${count}.\n\nعند تأمين الكمية أغلق الطلب من «${MINE_LABEL}».`,
      { parse_mode: "HTML" }
    )
    .catch(() => null);
}

// ---------------------------------------------------------------------
// Requester's list
// ---------------------------------------------------------------------
async function sendMyRequests(ctx: Ctx) {
  const { bot, chatId, userId } = ctx;
  const rows = await prisma.medBloodRequest.findMany({
    where: { requesterId: userId },
    orderBy: { created_at: "desc" },
    take: 5,
    include: { _count: { select: { responses: true } } },
  });
  if (rows.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد طلبات دم سابقة.", { reply_markup: bloodMenu(ctx.role) });
    return;
  }
  for (const r of rows) {
    const live = r.status === "OPEN" && r.expiresAt > new Date();
    const state = live ? `🟢 مفتوح — ينتهي خلال ${hoursLeft(r.expiresAt)} ساعة` : r.status === "FULFILLED" ? "✅ تم التأمين" : r.status === "CANCELLED" ? "✖️ ملغى" : "⌛ منتهي";
    const kb = new InlineKeyboard();
    if (live) kb.text("✅ تم تأمين الدم", `bld|done|${r.id}`).text("🗑 إلغاء", `bld|cancel|${r.id}`).row().text("🔗 رابط المشاركة", `bld|share|${r.id}`);
    await bot.api.sendMessage(
      chatId,
      `${requestText(r)}\n${state}\n📣 أُبلغ: ${r.notifiedCount} | 🙋 مستعدون: ${r._count.responses}`,
      live ? { reply_markup: kb } : {}
    );
  }
}

async function closeRequest(ctx: Ctx, requestId: string, status: "FULFILLED" | "CANCELLED") {
  const { bot, chatId, userId } = ctx;
  const res = await prisma.medBloodRequest.updateMany({ where: { id: requestId, requesterId: userId, status: "OPEN" }, data: { status } });
  if (res.count === 0) {
    await bot.api.sendMessage(chatId, "هذا الطلب مغلق مسبقاً.");
    return;
  }
  const responders = await prisma.medBloodResponse.findMany({ where: { requestId }, select: { donorId: true } });
  const note = status === "FULFILLED" ? "💚 تم تأمين الدم لهذا الطلب — شكراً لاستعدادك، لقد صنعت فرقاً." : "ℹ️ ألغى صاحب الطلب طلبه، لا حاجة للتوجه. شكراً لاستعدادك.";
  for (const r of responders) await bot.api.sendMessage(Number(r.donorId), note).catch(() => null);
  await bot.api.sendMessage(chatId, status === "FULFILLED" ? "✅ أُغلق الطلب. نتمنى الشفاء العاجل 🤍" : "✖️ أُلغي الطلب.", { reply_markup: bloodMenu(ctx.role) });
}

// ---------------------------------------------------------------------
// Callbacks (prefix "bld|")
// ---------------------------------------------------------------------
export async function handleBloodCallback(ctx: Ctx, cq: any, pending: unknown) {
  const { bot, chatId, userId } = ctx;
  const [, action, id] = String(cq.data || "").split("|");
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
  await guarded(bot, chatId, async () => {
    if (action === "pub") {
      const p = pending as BloodPending | null;
      if (p?.mode !== "blood_req_confirm") {
        await bot.api.sendMessage(chatId, "انتهت صلاحية المسودة، ابدأ من جديد.", { reply_markup: bloodMenu(ctx.role) });
        return;
      }
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id).catch(() => null);
      await publishRequest(ctx, p.data);
      return;
    }
    if (action === "abort") {
      await setPending(userId, null);
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id).catch(() => null);
      await bot.api.sendMessage(chatId, "✖️ أُلغيت المسودة.", { reply_markup: bloodMenu(ctx.role) });
      return;
    }
    if (action === "yes" && id) return volunteer(ctx, id, { chatId, messageId: cq.message.message_id });
    if (action === "no") {
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id).catch(() => null);
      await bot.api.sendMessage(chatId, "🙏 لا بأس، شكراً لك. ستصلك النداءات القادمة.");
      return;
    }
    if (action === "done" && id) return closeRequest(ctx, id, "FULFILLED");
    if (action === "cancel" && id) return closeRequest(ctx, id, "CANCELLED");
    if (action === "share" && id) {
      const req = await prisma.medBloodRequest.findFirst({ where: { id, requesterId: userId } });
      if (!req) return;
      await bot.api.sendMessage(chatId, `انسخ الرسالة وشاركها:\n\n${requestText(req, false)}\n🩸 للتبرع اضغط: ${await shareLink(bot, id)}`);
      return;
    }
    if (action === "avail") {
      const d = await prisma.medBloodDonor.findUnique({ where: { userId } });
      if (!d) return;
      await prisma.medBloodDonor.update({ where: { userId }, data: { isAvailable: !d.isAvailable } });
      return sendDonorCard(ctx);
    }
    if (action === "donated") {
      const d = await prisma.medBloodDonor.findUnique({ where: { userId } });
      if (!d) return;
      if (restDaysLeft(d.lastDonationAt) > 0) {
        await bot.api.sendMessage(chatId, "سُجّل تبرعك الأخير مسبقاً ✅");
        return;
      }
      const u = await prisma.medBloodDonor.update({ where: { userId }, data: { lastDonationAt: new Date(), donationsCount: { increment: 1 } } });
      await bot.api.sendMessage(chatId, `🎉 بارك الله فيك! تبرعك رقم ${u.donationsCount} — ${donorBadge(u.donationsCount)}\nسنوقف النداءات عنك ${REST_DAYS} يوماً لترتاح.`);
      return;
    }
    if (action === "retype") {
      await setPending(userId, { mode: "blood_donor_type" } satisfies BloodPending);
      await bot.api.sendMessage(chatId, "اختر فصيلتك:", { reply_markup: typeMenu() });
      return;
    }
  });
}

// Deep link from a shared request: /start bld_<id>
export async function showSharedRequest(ctx: Ctx, requestId: string) {
  const { bot, chatId } = ctx;
  await guarded(bot, chatId, async () => {
    const req = await prisma.medBloodRequest.findUnique({ where: { id: requestId } });
    if (!req || req.status !== "OPEN" || req.expiresAt <= new Date()) {
      await bot.api.sendMessage(chatId, "💚 هذا الطلب أُغلق أو انتهت صلاحيته.");
      return;
    }
    await bot.api.sendMessage(chatId, `${requestText(req, false)}\nينتهي خلال ${hoursLeft(req.expiresAt)} ساعة.`, {
      reply_markup: new InlineKeyboard().text("🩸 أستطيع التبرع", `bld|yes|${req.id}`),
    });
  });
}

export async function bloodStatsLine(): Promise<string> {
  try {
    const [donors, open, fulfilled, responses] = await Promise.all([
      prisma.medBloodDonor.count(),
      prisma.medBloodRequest.count({ where: { status: "OPEN", expiresAt: { gt: new Date() } } }),
      prisma.medBloodRequest.count({ where: { status: "FULFILLED" } }),
      prisma.medBloodResponse.count(),
    ]);
    return `\n\n🩸 نبض: ${donors} متبرع | ${open} طلب مفتوح | ${fulfilled} طلب مؤمَّن | ${responses} استجابة`;
  } catch {
    return "\n\n🩸 نبض: بانتظار تشغيل migration_35";
  }
}
