import { Bot as TelegramBot, Keyboard, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";

/**
 * MEDICAL_BOT template (owner spec, 2026-09-04, refined over several
 * planning rounds — see docs/agent-outbox.md/agent-state.json for the
 * confirmed plan table). A private, owner-only bot, same governance model
 * as MARRIAGE_BOT/JOBS_BOT. Fully independent from every other bot — no
 * shared tables, no shared logic files.
 *
 * Scope (deliberately limited to what the owner actually asked for):
 * - Four roles: PATIENT (auto), CLINIC (an independent specialist doctor
 *   running their own clinic — the account IS the doctor), HOSPITAL (has
 *   departments, each with its own doctors), PHARMACY (on-duty toggle +
 *   answers patient prescription questions). CLINIC/HOSPITAL/PHARMACY
 *   accounts are created only by redeeming a MedActivationCode minted by
 *   the SUPER_ADMIN inside the bot.
 * - No blood bank, no lab reports, no separate ambulance-dispatcher role —
 *   explicitly ruled out by the owner.
 * - "Map" = Telegram's own native sendVenue message (a real interactive
 *   map bubble in-chat) — no Mini App, no external maps SDK.
 * - "طوارئ" = nearest-hospitals directory + a phone number to call
 *   directly. This is NOT a real ambulance dispatch integration — there is
 *   no emergency service on the other end automatically receiving these
 *   taps. Framing it as automatic dispatch would be dangerous in a real
 *   emergency, so every user-facing string here says "اتصل مباشرة", never
 *   "تم إرسال نداء استغاثة".
 * - Appointment reminders: only the day-before reminder is implemented
 *   (see the medical-reminders cron) — every cron in this project runs
 *   once daily, which cannot deliver a meaningful "1 hour before"
 *   reminder; shipping one that silently never fires on time would be
 *   worse than not having it. A tighter cron schedule can be added later
 *   if the owner confirms the Vercel plan supports sub-daily crons.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const NEARBY_RESULTS = 5;
const EMERGENCY_RESULTS = 3;

const DAY_CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type DayCode = (typeof DAY_CODES)[number];
const DAY_LABELS: Record<DayCode, string> = {
  Sun: "الأحد",
  Mon: "الاثنين",
  Tue: "الثلاثاء",
  Wed: "الأربعاء",
  Thu: "الخميس",
  Fri: "الجمعة",
  Sat: "السبت",
};
const MONTH_LABELS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function isDayCode(v: string): v is DayCode {
  return (DAY_CODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------
// Geo / date helpers
// ---------------------------------------------------------------------
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Plain calendar next-occurrence of a weekday, including today — used
// only for the day-picker button label, where no time is known yet.
// Deliberately simple server-local time, no per-country timezone
// handling, matching the general simplicity level elsewhere in this
// project.
function nextOccurrenceDate(dayCode: DayCode): Date {
  const now = new Date();
  const targetDow = DAY_CODES.indexOf(dayCode);
  const diff = (targetDow - now.getDay() + 7) % 7;
  const result = new Date(now);
  result.setDate(now.getDate() + diff);
  return result;
}

// The real, final appointment date+time: same day as
// nextOccurrenceDate() unless that combined with the given time has
// already passed (only possible when "today" was picked and the entered
// time is earlier than now) — in that one case, roll forward a full
// week. Keeping this as a single combine-then-check step (rather than
// deciding "today vs next week" before a time is known, as an earlier
// version of this function did) avoids the day-picker button showing one
// date while the actually-booked slot silently lands on a different one.
function resolveAppointmentDateTime(dayCode: DayCode, hour: number, minute: number): Date {
  const result = nextOccurrenceDate(dayCode);
  result.setHours(hour, minute, 0, 0);
  if (result.getTime() <= Date.now()) {
    result.setDate(result.getDate() + 7);
  }
  return result;
}

function formatDate(d: Date): string {
  const code = DAY_CODES[d.getDay()];
  return `${DAY_LABELS[code]} ${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} — ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseTimeInput(text: string): { h: number; m: number } | null {
  const m = text.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

function parseHoursRange(text: string): { fromH: number; fromM: number; toH: number; toM: number } | null {
  const m = text.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)-([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { fromH: parseInt(m[1], 10), fromM: parseInt(m[2], 10), toH: parseInt(m[3], 10), toM: parseInt(m[4], 10) };
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type MedRoleStr = "PATIENT" | "CLINIC" | "HOSPITAL" | "PHARMACY";
type FacilityType = "CLINIC" | "HOSPITAL" | "PHARMACY";

type PatientRegStep = "fullName" | "gender" | "country" | "province" | "city" | "area" | "location";
type PatientRegDraft = {
  fullName?: string;
  gender?: string;
  country?: string;
  province?: string;
  city?: string;
  area?: string;
};

type FacilityRegStep =
  | "activationCode" | "name" | "phone" | "country" | "province" | "city" | "area" | "address" | "location"
  | "doctorSpecialty" | "doctorDays" | "doctorHours" | "doctorFee";
type FacilityRegDraft = {
  targetRole?: FacilityType;
  name?: string;
  phone?: string;
  country?: string;
  province?: string;
  city?: string;
  area?: string;
  address?: string;
  doctorSpecialty?: string;
  doctorDays?: string[];
  doctorHours?: string;
};

type DoctorAddStep = "name" | "specialty" | "days" | "hours" | "fee";
type DoctorAddDraft = {
  departmentId: string;
  name?: string;
  specialty?: string;
  days?: string[];
  hours?: string;
};

type PendingAction =
  | { mode: "role_pick" }
  | { mode: "patient_reg"; step: PatientRegStep; data: PatientRegDraft }
  | { mode: "facility_reg"; step: FacilityRegStep; data: FacilityRegDraft }
  | { mode: "dept_add" }
  | { mode: "doctor_add"; step: DoctorAddStep; data: DoctorAddDraft }
  | { mode: "clinic_edit_doctor"; step: "specialty" | "days" | "hours"; data: { specialty?: string; days?: string[] } }
  | { mode: "facility_edit_phone" }
  | { mode: "facility_edit_location" }
  | { mode: "booking_time"; doctorId: string; dayCode: DayCode }
  | { mode: "booking_confirm"; doctorId: string; appointmentAtIso: string }
  | { mode: "prescription_query"; facilityId: string }
  | { mode: "prescription_reply"; queryId: string };

// ---------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------
function backLabel(): string {
  return "◀️ رجوع";
}
function isBack(text: string): boolean {
  return text === backLabel();
}
function plainBackMenu(): Keyboard {
  return new Keyboard().text(backLabel()).resized();
}
function shareLocationMenu(): Keyboard {
  return new Keyboard().requestLocation("📍 مشاركة موقعي").row().text(backLabel()).resized();
}
const SKIP_LABEL = "⏭ تخطّي";
function skipMenu(): Keyboard {
  return new Keyboard().text(SKIP_LABEL).row().text(backLabel()).resized();
}
function genderMenu(): Keyboard {
  return new Keyboard().text("ذكر").text("أنثى").row().text(backLabel()).resized();
}
const DONE_DAYS_LABEL = "✅ تم اختيار الأيام";
function daysPickMenu(selected: string[]): Keyboard {
  const kb = new Keyboard();
  const codes = DAY_CODES;
  for (let i = 0; i < codes.length; i += 2) {
    const a = codes[i];
    const bCode = codes[i + 1];
    kb.text(`${selected.includes(a) ? "☑️" : "▫️"} ${DAY_LABELS[a]}`);
    if (bCode) kb.text(`${selected.includes(bCode) ? "☑️" : "▫️"} ${DAY_LABELS[bCode]}`);
    kb.row();
  }
  kb.text(DONE_DAYS_LABEL).row().text(backLabel());
  return kb.resized();
}
function dayLabelToCode(text: string): DayCode | null {
  const clean = text.replace(/^[☑️▫️]\s*/, "").trim();
  const found = (Object.entries(DAY_LABELS) as [DayCode, string][]).find(([, label]) => label === clean);
  return found ? found[0] : null;
}

function patientMainMenu(): Keyboard {
  return new Keyboard()
    .text("💊 صيدليات مناوبة قريبة").text("🏥 مستشفيات وعيادات")
    .row()
    .text("👨‍⚕️ حجز موعد طبيب").text("🚨 طوارئ")
    .row()
    .text("📅 حجوزاتي").text("ℹ️ معلومات")
    .resized();
}
function clinicMainMenu(): Keyboard {
  return new Keyboard()
    .text("📅 حجوزات اليوم").text("🗓 تحديث تخصصي وجدولي")
    .row()
    .text("📞 تحديث الهاتف").text("📍 تحديث الموقع")
    .row()
    .text("ℹ️ معلومات")
    .resized();
}
function hospitalMainMenu(): Keyboard {
  return new Keyboard()
    .text("📅 حجوزات اليوم").text("🏬 الأقسام والأطباء")
    .row()
    .text("📞 تحديث الهاتف").text("📍 تحديث الموقع")
    .row()
    .text("ℹ️ معلومات")
    .resized();
}
function pharmacyMainMenu(isDuty: boolean): Keyboard {
  return new Keyboard()
    .text(isDuty ? "🔴 إيقاف المناوبة" : "🟢 تفعيل المناوبة")
    .text("📩 أسئلة الروشتات")
    .row()
    .text("📞 تحديث الهاتف").text("📍 تحديث الموقع")
    .row()
    .text("ℹ️ معلومات")
    .resized();
}
function adminMenu(): Keyboard {
  return new Keyboard()
    .text("🎫 كود عيادة").text("🎫 كود مشفى").text("🎫 كود صيدلية")
    .row()
    .text("📊 إحصائيات")
    .resized();
}
function mainMenuFor(role: MedRoleStr, isDuty?: boolean): Keyboard {
  if (role === "CLINIC") return clinicMainMenu();
  if (role === "HOSPITAL") return hospitalMainMenu();
  if (role === "PHARMACY") return pharmacyMainMenu(!!isDuty);
  return patientMainMenu();
}
function roleFacilityLabel(role: FacilityType): string {
  if (role === "CLINIC") return "عيادة";
  if (role === "HOSPITAL") return "مشفى";
  return "صيدلية";
}

// ---------------------------------------------------------------------
// Core data helpers
// ---------------------------------------------------------------------
async function ensureMedUser(botId: string, tgUserId: string) {
  const existing = await prisma.medUser.findUnique({ where: { id: tgUserId } });
  if (existing) return existing;
  return prisma.medUser.create({ data: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.medUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}
function genCode(role: FacilityType): string {
  const prefix = role === "CLINIC" ? "CLN" : role === "HOSPITAL" ? "HOS" : "PHR";
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MED-${prefix}-${rand}`;
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------
export async function handleMedicalBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  if (update.callback_query) {
    await handleCallback(bot, botRow, update.callback_query);
    return;
  }
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  const text = String(msg.text || "").trim();

  // ---- SUPER_ADMIN gate (checked first, entirely separate menu tree) ----
  if (SUPER_ADMIN_ID && tgUserId === SUPER_ADMIN_ID) {
    await handleAdminMessage(bot, botRow, chatId, tgUserId, msg, text);
    return;
  }

  const user = await ensureMedUser(botRow.id, tgUserId);
  if (user.isBanned) return;
  const pending = user.pendingAction as PendingAction | null;

  if (text === "/start" || isBack(text)) {
    // Clearing here is safe even mid-wizard: routeStart re-derives the
    // correct next step from scratch (role picker / resume registration /
    // main menu) by checking profile & facility existence, not
    // pendingAction — so a stale wizard state never leaks into whatever
    // the user sends next.
    await setPending(tgUserId, null);
    await routeStart(bot, botRow, chatId, tgUserId, user);
    return;
  }

  // Location share (used both during patient registration and facility
  // location updates).
  if (msg.location) {
    await handleLocationMessage(bot, chatId, tgUserId, pending, msg.location);
    return;
  }

  // A location was expected but plain text arrived instead — reprompt
  // rather than silently doing nothing (every other wizard step at least
  // echoes back a "wrong format" message; these three deserve the same).
  if (
    (pending?.mode === "patient_reg" && pending.step === "location") ||
    (pending?.mode === "facility_reg" && pending.step === "location") ||
    pending?.mode === "facility_edit_location"
  ) {
    await bot.api.sendMessage(chatId, "📍 يرجى الضغط على زر مشاركة الموقع أدناه.", { reply_markup: shareLocationMenu() });
    return;
  }

  if (pending?.mode === "patient_reg") {
    await handlePatientRegStep(bot, chatId, tgUserId, pending, text);
    return;
  }
  if (pending?.mode === "facility_reg") {
    await handleFacilityRegStep(bot, botRow, chatId, tgUserId, pending, text);
    return;
  }
  if (pending?.mode === "dept_add") {
    await handleDeptAddStep(bot, chatId, tgUserId, text);
    return;
  }
  if (pending?.mode === "doctor_add") {
    await handleDoctorAddStep(bot, chatId, tgUserId, pending, text);
    return;
  }
  if (pending?.mode === "clinic_edit_doctor") {
    await handleClinicEditDoctorStep(bot, chatId, tgUserId, pending, text);
    return;
  }
  if (pending?.mode === "facility_edit_phone") {
    await handleFacilityEditPhone(bot, chatId, tgUserId, text);
    return;
  }
  if (pending?.mode === "booking_time") {
    await handleBookingTimeStep(bot, chatId, tgUserId, pending, text);
    return;
  }
  if (pending?.mode === "prescription_query") {
    await handlePrescriptionQueryMessage(bot, botRow, chatId, tgUserId, pending, msg);
    return;
  }
  if (pending?.mode === "prescription_reply") {
    await handlePrescriptionReplyStep(bot, botRow, chatId, tgUserId, pending, text);
    return;
  }

  // No active wizard — route by role's main-menu text.
  await routeMainMenuText(bot, botRow, chatId, tgUserId, user, text);
}

// ---------------------------------------------------------------------
// /start routing
// ---------------------------------------------------------------------
async function routeStart(bot: TelegramBot, botRow: BotRow, chatId: number, tgUserId: string, user: { role: string }) {
  const role = user.role as MedRoleStr;

  if (role === "PATIENT") {
    const profile = await prisma.medPatientProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      // Either never chosen a role, or chose PATIENT and didn't finish
      // registration — either way, (re)start at the role picker so a
      // returning-but-incomplete user isn't stuck.
      await setPending(tgUserId, { mode: "role_pick" });
      const kb = new InlineKeyboard()
        .text("👤 مريض", "medrole|PATIENT").row()
        .text("🩺 عيادة (طبيب مستقل)", "medrole|CLINIC").row()
        .text("🏥 مشفى", "medrole|HOSPITAL").row()
        .text("💊 صيدلية", "medrole|PHARMACY");
      await bot.api.sendMessage(
        chatId,
        "🏥 أهلاً بك في المساعد الطبي. يرجى اختيار نوع حسابك:",
        { reply_markup: kb }
      );
      return;
    }
    await bot.api.sendMessage(chatId, `🏠 القائمة الرئيسية:`, { reply_markup: patientMainMenu() });
    return;
  }

  // CLINIC / HOSPITAL / PHARMACY
  const facility = await prisma.medFacility.findUnique({ where: { ownerId: tgUserId } });
  if (!facility) {
    // Activation code accepted but registration wizard was abandoned —
    // resume it from the top rather than leaving them stuck.
    await setPending(tgUserId, { mode: "facility_reg", step: "name", data: { targetRole: role as FacilityType } });
    await bot.api.sendMessage(chatId, `🏷 أدخل اسم ${roleFacilityLabel(role as FacilityType)}:`, { reply_markup: plainBackMenu() });
    return;
  }
  await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenuFor(role, facility.isDuty) });
}

// ---------------------------------------------------------------------
// Role pick + registration wizards
// ---------------------------------------------------------------------
async function handleLocationMessage(
  bot: TelegramBot,
  chatId: number,
  tgUserId: string,
  pending: PendingAction | null,
  location: { latitude: number; longitude: number }
) {
  if (pending?.mode === "patient_reg" && pending.step === "location") {
    const d = pending.data;
    await prisma.medPatientProfile.create({
      data: {
        userId: tgUserId,
        gender: d.gender || "",
        country: d.country || "",
        province: d.province || "",
        city: d.city || "",
        area: d.area || "",
        latitude: location.latitude,
        longitude: location.longitude,
      },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إنشاء ملفك الطبي بنجاح!", { reply_markup: patientMainMenu() });
    return;
  }

  if (pending?.mode === "facility_reg" && pending.step === "location") {
    const d = pending.data;
    const role = d.targetRole as FacilityType;
    const facility = await prisma.medFacility.create({
      data: {
        ownerId: tgUserId,
        type: role,
        name: d.name || "",
        phone: d.phone || "",
        country: d.country || "",
        province: d.province || "",
        city: d.city || "",
        area: d.area || "",
        address: d.address || "",
        latitude: location.latitude,
        longitude: location.longitude,
      },
    });
    if (role === "CLINIC") {
      await setPending(tgUserId, { mode: "facility_reg", step: "doctorSpecialty", data: d });
      await bot.api.sendMessage(chatId, "🩺 أدخل تخصصك الطبي (مثال: عظمية):", { reply_markup: plainBackMenu() });
      return;
    }
    await setPending(tgUserId, null);
    await bot.api.sendMessage(
      chatId,
      `✅ تم تفعيل حساب ${roleFacilityLabel(role)} "${facility.name}" بنجاح!`,
      { reply_markup: mainMenuFor(role, facility.isDuty) }
    );
    return;
  }

  if (pending?.mode === "facility_edit_location") {
    const facility = await prisma.medFacility.update({
      where: { ownerId: tgUserId },
      data: { latitude: location.latitude, longitude: location.longitude },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم تحديث الموقع بنجاح.", {
      reply_markup: mainMenuFor(facility.type as MedRoleStr, facility.isDuty),
    });
    return;
  }
}

async function handlePatientRegStep(bot: TelegramBot, chatId: number, tgUserId: string, pending: Extract<PendingAction, { mode: "patient_reg" }>, text: string) {
  const { step, data } = pending;
  if (step === "fullName") {
    if (!text) {
      await bot.api.sendMessage(chatId, "أدخل اسمك الكامل:", { reply_markup: plainBackMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "patient_reg", step: "gender", data: { ...data, fullName: text } });
    await bot.api.sendMessage(chatId, "اختر جنسك:", { reply_markup: genderMenu() });
    return;
  }
  if (step === "gender") {
    if (text !== "ذكر" && text !== "أنثى") {
      await bot.api.sendMessage(chatId, "اختر من الأزرار: ذكر / أنثى", { reply_markup: genderMenu() });
      return;
    }
    await prisma.medUser.update({ where: { id: tgUserId }, data: { fullName: data.fullName } });
    await setPending(tgUserId, { mode: "patient_reg", step: "country", data: { ...data, gender: text } });
    await bot.api.sendMessage(chatId, "🌍 أدخل الدولة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "country") {
    if (!text) return;
    await setPending(tgUserId, { mode: "patient_reg", step: "province", data: { ...data, country: text } });
    await bot.api.sendMessage(chatId, "أدخل المحافظة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "province") {
    if (!text) return;
    await setPending(tgUserId, { mode: "patient_reg", step: "city", data: { ...data, province: text } });
    await bot.api.sendMessage(chatId, "أدخل المدينة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "city") {
    if (!text) return;
    await setPending(tgUserId, { mode: "patient_reg", step: "area", data: { ...data, city: text } });
    await bot.api.sendMessage(chatId, "أدخل المنطقة/الحي:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "area") {
    if (!text) return;
    await setPending(tgUserId, { mode: "patient_reg", step: "location", data: { ...data, area: text } });
    await bot.api.sendMessage(
      chatId,
      "📍 آخر خطوة — شارك موقعك الحالي كي نجد أقرب الصيدليات والمشافي إليك:",
      { reply_markup: shareLocationMenu() }
    );
    return;
  }
}

async function handleFacilityRegStep(
  bot: TelegramBot,
  botRow: BotRow,
  chatId: number,
  tgUserId: string,
  pending: Extract<PendingAction, { mode: "facility_reg" }>,
  text: string
) {
  const { step, data } = pending;

  if (step === "activationCode") {
    const code = text.trim().toUpperCase();
    if (!code) {
      await bot.api.sendMessage(chatId, "أرسل كود التفعيل:", { reply_markup: plainBackMenu() });
      return;
    }
    const found = await prisma.medActivationCode.findUnique({ where: { code } });
    if (!found || found.isRedeemed || found.role !== data.targetRole) {
      await bot.api.sendMessage(chatId, "❌ كود غير صالح أو غير مطابق لنوع الحساب. تأكد وأعد المحاولة، أو اطلب كوداً جديداً من مالك المنصة.", { reply_markup: plainBackMenu() });
      return;
    }
    await prisma.medActivationCode.update({ where: { id: found.id }, data: { isRedeemed: true, redeemedBy: tgUserId } });
    await prisma.medUser.update({ where: { id: tgUserId }, data: { role: data.targetRole! } });
    await setPending(tgUserId, { mode: "facility_reg", step: "name", data });
    await bot.api.sendMessage(chatId, `🏷 أدخل اسم ${roleFacilityLabel(data.targetRole!)}:`, { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "name") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "phone", data: { ...data, name: text } });
    await bot.api.sendMessage(chatId, "📞 أدخل رقم الهاتف للتواصل:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "phone") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "country", data: { ...data, phone: text } });
    await bot.api.sendMessage(chatId, "🌍 أدخل الدولة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "country") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "province", data: { ...data, country: text } });
    await bot.api.sendMessage(chatId, "أدخل المحافظة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "province") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "city", data: { ...data, province: text } });
    await bot.api.sendMessage(chatId, "أدخل المدينة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "city") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "area", data: { ...data, city: text } });
    await bot.api.sendMessage(chatId, "أدخل المنطقة/الحي:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "area") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "address", data: { ...data, area: text } });
    await bot.api.sendMessage(chatId, "أدخل العنوان التفصيلي (اسم الشارع، معلم قريب...):", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "address") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "location", data: { ...data, address: text } });
    await bot.api.sendMessage(chatId, "📍 شارك الموقع الحقيقي على الخريطة:", { reply_markup: shareLocationMenu() });
    return;
  }
  // "location" step is handled entirely in handleLocationMessage.
  if (step === "doctorSpecialty") {
    if (!text) return;
    await setPending(tgUserId, { mode: "facility_reg", step: "doctorDays", data: { ...data, doctorSpecialty: text, doctorDays: [] } });
    await bot.api.sendMessage(chatId, "🗓 اختر أيام الدوام (اضغط كل يوم، ثم «تم» عند الانتهاء):", { reply_markup: daysPickMenu([]) });
    return;
  }
  if (step === "doctorDays") {
    const selected = data.doctorDays || [];
    if (text === DONE_DAYS_LABEL) {
      if (selected.length === 0) {
        await bot.api.sendMessage(chatId, "اختر يوماً واحداً على الأقل قبل الضغط على «تم».", { reply_markup: daysPickMenu(selected) });
        return;
      }
      await setPending(tgUserId, { mode: "facility_reg", step: "doctorHours", data });
      await bot.api.sendMessage(chatId, "⏰ أدخل ساعات الدوام بالصيغة HH:MM-HH:MM، مثال: 09:00-15:00", { reply_markup: plainBackMenu() });
      return;
    }
    const code = dayLabelToCode(text);
    if (!code) {
      await bot.api.sendMessage(chatId, "اختر يوماً من الأزرار.", { reply_markup: daysPickMenu(selected) });
      return;
    }
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
    await setPending(tgUserId, { mode: "facility_reg", step: "doctorDays", data: { ...data, doctorDays: next } });
    await bot.api.sendMessage(chatId, "🗓 اختر أيام الدوام (اضغط كل يوم، ثم «تم» عند الانتهاء):", { reply_markup: daysPickMenu(next) });
    return;
  }
  if (step === "doctorHours") {
    const range = parseHoursRange(text);
    if (!range) {
      await bot.api.sendMessage(chatId, "صيغة غير صحيحة. أدخل بالشكل: 09:00-15:00", { reply_markup: plainBackMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "facility_reg", step: "doctorFee", data: { ...data, doctorHours: text.trim() } });
    await bot.api.sendMessage(chatId, "💵 أدخل سعر الكشفية بالدولار (أو اضغط تخطّي):", { reply_markup: skipMenu() });
    return;
  }
  if (step === "doctorFee") {
    const fee = text === SKIP_LABEL ? null : parseFloat(text);
    const facility = await prisma.medFacility.findUnique({ where: { ownerId: tgUserId } });
    if (!facility) return; // shouldn't happen — facility is created at the location step
    await prisma.medDoctor.create({
      data: {
        facilityId: facility.id,
        name: data.name || facility.name,
        specialty: data.doctorSpecialty || "",
        workingDays: (data.doctorDays || []).join(","),
        workingHours: data.doctorHours || "",
        feeUsd: fee && !isNaN(fee) ? fee : null,
      },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, `✅ تم تفعيل عيادتك "${facility.name}" بنجاح!`, { reply_markup: clinicMainMenu() });
    return;
  }
}

// ---------------------------------------------------------------------
// Main-menu text routing (per role)
// ---------------------------------------------------------------------
async function routeMainMenuText(bot: TelegramBot, botRow: BotRow, chatId: number, tgUserId: string, user: { role: string }, text: string) {
  const role = user.role as MedRoleStr;

  if (text === "ℹ️ معلومات") {
    const me = await bot.api.getMe();
    await bot.api.sendMessage(
      chatId,
      `🏥 المساعد الطبي\n\nدليل صيدليات مناوبة، مشافي وعيادات، وحجز مواعيد أطباء — بالإضافة لمراسلة الصيدلية مباشرة والسؤال عن روشتة.\n\n🔗 شارك البوت: https://t.me/${me.username}`,
      { reply_markup: mainMenuFor(role) }
    );
    return;
  }

  if (role === "PATIENT") {
    await routePatientMenu(bot, chatId, tgUserId, text);
    return;
  }
  if (role === "PHARMACY") {
    await routePharmacyMenu(bot, chatId, tgUserId, text);
    return;
  }
  if (role === "HOSPITAL") {
    await routeHospitalMenu(bot, chatId, tgUserId, text);
    return;
  }
  if (role === "CLINIC") {
    await routeClinicMenu(bot, chatId, tgUserId, text);
    return;
  }
}

// ---------------------------------------------------------------------
// PATIENT flows
// ---------------------------------------------------------------------
async function requirePatientLocation(bot: TelegramBot, chatId: number, tgUserId: string) {
  const profile = await prisma.medPatientProfile.findUnique({ where: { userId: tgUserId } });
  if (!profile) {
    await bot.api.sendMessage(chatId, "⚠️ يجب إكمال تسجيل ملفك الطبي أولاً. اضغط /start.");
    return null;
  }
  return profile;
}

async function routePatientMenu(bot: TelegramBot, chatId: number, tgUserId: string, text: string) {
  if (text === "💊 صيدليات مناوبة قريبة") {
    const profile = await requirePatientLocation(bot, chatId, tgUserId);
    if (!profile) return;
    await sendNearbyPharmacies(bot, chatId, profile.latitude, profile.longitude);
    return;
  }
  if (text === "🏥 مستشفيات وعيادات") {
    const profile = await requirePatientLocation(bot, chatId, tgUserId);
    if (!profile) return;
    await sendNearbyFacilities(bot, chatId, profile.latitude, profile.longitude, ["HOSPITAL", "CLINIC"]);
    return;
  }
  if (text === "👨‍⚕️ حجز موعد طبيب") {
    const profile = await requirePatientLocation(bot, chatId, tgUserId);
    if (!profile) return;
    await startBookingSearch(bot, chatId, profile.latitude, profile.longitude);
    return;
  }
  if (text === "🚨 طوارئ") {
    const profile = await requirePatientLocation(bot, chatId, tgUserId);
    if (!profile) return;
    await sendEmergencyPoints(bot, chatId, profile.latitude, profile.longitude);
    return;
  }
  if (text === "📅 حجوزاتي") {
    await sendPatientAppointments(bot, chatId, tgUserId);
    return;
  }
}

async function sendNearbyPharmacies(bot: TelegramBot, chatId: number, lat: number, lng: number) {
  const pharmacies = await prisma.medFacility.findMany({ where: { type: "PHARMACY" } });
  if (pharmacies.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد صيدليات مسجلة على المنصة بعد.");
    return;
  }
  const withDistance = pharmacies.map((p) => ({ p, dist: haversineKm(lat, lng, p.latitude, p.longitude) })).sort((a, b) => a.dist - b.dist);
  const onDuty = withDistance.filter((x) => x.p.isDuty).slice(0, NEARBY_RESULTS);
  const list = onDuty.length > 0 ? onDuty : withDistance.slice(0, NEARBY_RESULTS);

  await bot.api.sendMessage(
    chatId,
    onDuty.length > 0 ? `💊 أقرب الصيدليات المناوبة الآن (${onDuty.length}):` : "⚠️ لا توجد صيدلية مناوبة قريبة حالياً — إليك أقرب الصيدليات المسجلة:"
  );
  for (const { p, dist } of list) {
    await bot.api.sendVenue(chatId, p.latitude, p.longitude, p.name, p.address).catch(() => null);
    const kb = new InlineKeyboard().text("📩 اسأل عن روشتة", `medask|${p.id}`);
    await bot.api.sendMessage(
      chatId,
      `${p.isDuty ? "🟢 مناوبة الآن" : "⚪ غير مناوبة حالياً"} — 📏 ${dist.toFixed(1)} كم\n☎️ ${p.phone}`,
      { reply_markup: kb }
    );
  }
}

async function sendNearbyFacilities(bot: TelegramBot, chatId: number, lat: number, lng: number, types: FacilityType[]) {
  const facilities = await prisma.medFacility.findMany({ where: { type: { in: types } } });
  if (facilities.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد مشافي أو عيادات مسجلة بعد.");
    return;
  }
  const withDistance = facilities.map((f) => ({ f, dist: haversineKm(lat, lng, f.latitude, f.longitude) })).sort((a, b) => a.dist - b.dist).slice(0, NEARBY_RESULTS);
  await bot.api.sendMessage(chatId, `🏥 أقرب المشافي والعيادات (${withDistance.length}):`);
  for (const { f, dist } of withDistance) {
    await bot.api.sendVenue(chatId, f.latitude, f.longitude, f.name, f.address).catch(() => null);
    const kb = new InlineKeyboard().text("📅 احجز هنا", `medbookfac|${f.id}`);
    await bot.api.sendMessage(
      chatId,
      `${f.type === "HOSPITAL" ? "🏥 مشفى" : "🩺 عيادة"} — 📏 ${dist.toFixed(1)} كم\n☎️ ${f.phone}`,
      { reply_markup: kb }
    );
  }
}

async function sendEmergencyPoints(bot: TelegramBot, chatId: number, lat: number, lng: number) {
  const hospitals = await prisma.medFacility.findMany({ where: { type: "HOSPITAL" } });
  if (hospitals.length === 0) {
    await bot.api.sendMessage(chatId, "⚠️ لا توجد مشافي مسجلة على المنصة حالياً. في حالة الطوارئ الحقيقية اتصل بخدمة الإسعاف الرسمية في بلدك فوراً.");
    return;
  }
  const nearest = hospitals.map((f) => ({ f, dist: haversineKm(lat, lng, f.latitude, f.longitude) })).sort((a, b) => a.dist - b.dist).slice(0, EMERGENCY_RESULTS);
  await bot.api.sendMessage(
    chatId,
    "🚨 أقرب نقاط الطوارئ — هذا دليل توجيهي فقط، اتصل مباشرة بالرقم أدناه أو بخدمة الإسعاف الرسمية في حالة طارئة حقيقية:"
  );
  for (const { f, dist } of nearest) {
    await bot.api.sendVenue(chatId, f.latitude, f.longitude, f.name, f.address).catch(() => null);
    await bot.api.sendMessage(chatId, `📏 ${dist.toFixed(1)} كم\n☎️ اتصل مباشرة: ${f.phone}`);
  }
}

async function sendPatientAppointments(bot: TelegramBot, chatId: number, tgUserId: string) {
  const appts = await prisma.medAppointment.findMany({
    where: { patientId: tgUserId, status: { in: ["PENDING", "CONFIRMED"] } },
    include: { doctor: { include: { facility: true, department: { include: { facility: true } } } } },
    orderBy: { appointmentAt: "asc" },
  });
  if (appts.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد لديك حجوزات قادمة.");
    return;
  }
  for (const a of appts) {
    const facility = a.doctor.facility || a.doctor.department?.facility;
    const statusLabel = a.status === "CONFIRMED" ? "✅ مؤكد" : "🕓 بانتظار تأكيد المنشأة";
    const kb = new InlineKeyboard().text("❌ إلغاء الحجز", `medapptcancel|${a.id}`);
    await bot.api.sendMessage(
      chatId,
      `📅 ${facility?.name || ""} — د. ${a.doctor.name} (${a.doctor.specialty})\n🕐 ${formatDateTime(a.appointmentAt)}\nالحالة: ${statusLabel}`,
      { reply_markup: kb }
    );
  }
}

// ---------------------------------------------------------------------
// Booking flow
// ---------------------------------------------------------------------
async function startBookingSearch(bot: TelegramBot, chatId: number, lat: number, lng: number) {
  const facilities = await prisma.medFacility.findMany({ where: { type: { in: ["CLINIC", "HOSPITAL"] } } });
  if (facilities.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد عيادات أو مشافي مسجلة بعد.");
    return;
  }
  const withDistance = facilities.map((f) => ({ f, dist: haversineKm(lat, lng, f.latitude, f.longitude) })).sort((a, b) => a.dist - b.dist).slice(0, NEARBY_RESULTS);
  const kb = new InlineKeyboard();
  for (const { f, dist } of withDistance) {
    kb.text(`${f.type === "HOSPITAL" ? "🏥" : "🩺"} ${f.name} — ${dist.toFixed(1)} كم`, `medbookfac|${f.id}`).row();
  }
  await bot.api.sendMessage(chatId, "اختر عيادة أو مشفى لحجز موعد:", { reply_markup: kb });
}

async function showDepartmentsOrDoctor(bot: TelegramBot, chatId: number, facilityId: string) {
  const facility = await prisma.medFacility.findUnique({ where: { id: facilityId } });
  if (!facility) return;
  if (facility.type === "CLINIC") {
    const doctor = await prisma.medDoctor.findFirst({ where: { facilityId, isActive: true } });
    if (!doctor) {
      await bot.api.sendMessage(chatId, "لا يوجد طبيب متاح حالياً في هذه العيادة.");
      return;
    }
    await showDayPicker(bot, chatId, doctor.id);
    return;
  }
  const departments = await prisma.medDepartment.findMany({ where: { facilityId } });
  if (departments.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد أقسام مضافة لهذا المشفى بعد.");
    return;
  }
  const kb = new InlineKeyboard();
  for (const d of departments) kb.text(d.name, `meddept|${d.id}`).row();
  await bot.api.sendMessage(chatId, `🏥 ${facility.name} — اختر القسم:`, { reply_markup: kb });
}

async function showDoctorsInDepartment(bot: TelegramBot, chatId: number, departmentId: string) {
  const doctors = await prisma.medDoctor.findMany({ where: { departmentId, isActive: true } });
  if (doctors.length === 0) {
    await bot.api.sendMessage(chatId, "لا يوجد أطباء متاحون في هذا القسم حالياً.");
    return;
  }
  const kb = new InlineKeyboard();
  for (const d of doctors) kb.text(`د. ${d.name} — ${d.specialty}`, `meddoc|${d.id}`).row();
  await bot.api.sendMessage(chatId, "👨‍⚕️ اختر الطبيب:", { reply_markup: kb });
}

async function showDayPicker(bot: TelegramBot, chatId: number, doctorId: string) {
  const doctor = await prisma.medDoctor.findUnique({ where: { id: doctorId } });
  if (!doctor) return;
  const days = doctor.workingDays.split(",").map((s) => s.trim()).filter(isDayCode);
  if (days.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد أيام دوام محددة لهذا الطبيب.");
    return;
  }
  const kb = new InlineKeyboard();
  for (const code of days) {
    const date = nextOccurrenceDate(code);
    kb.text(formatDate(date), `medday|${doctorId}|${code}`).row();
  }
  await bot.api.sendMessage(
    chatId,
    `👨‍⚕️ د. ${doctor.name} — ${doctor.specialty}\n⏰ ساعات الدوام: ${doctor.workingHours}${doctor.feeUsd ? `\n💵 الكشفية: $${doctor.feeUsd}` : ""}\n\nاختر اليوم:`,
    { reply_markup: kb }
  );
}

async function handleBookingTimeStep(bot: TelegramBot, chatId: number, tgUserId: string, pending: Extract<PendingAction, { mode: "booking_time" }>, text: string) {
  const parsed = parseTimeInput(text);
  if (!parsed) {
    await bot.api.sendMessage(chatId, "صيغة غير صحيحة. أدخل الوقت بالشكل HH:MM، مثال: 10:30", { reply_markup: plainBackMenu() });
    return;
  }
  const doctor = await prisma.medDoctor.findUnique({ where: { id: pending.doctorId }, include: { facility: true, department: { include: { facility: true } } } });
  if (!doctor) return;

  const hours = parseHoursRange(doctor.workingHours);
  if (hours) {
    const minutesIn = parsed.h * 60 + parsed.m;
    const fromMinutes = hours.fromH * 60 + hours.fromM;
    const toMinutes = hours.toH * 60 + hours.toM;
    if (minutesIn < fromMinutes || minutesIn >= toMinutes) {
      await bot.api.sendMessage(chatId, `⚠️ خارج ساعات الدوام (${doctor.workingHours}). أدخل وقتاً ضمن هذا النطاق:`, { reply_markup: plainBackMenu() });
      return;
    }
  }

  const date = resolveAppointmentDateTime(pending.dayCode, parsed.h, parsed.m);
  const facility = doctor.facility || doctor.department?.facility;
  await setPending(tgUserId, { mode: "booking_confirm", doctorId: pending.doctorId, appointmentAtIso: date.toISOString() });
  const kb = new InlineKeyboard().text("✅ تأكيد الحجز", "medbookconfirm").row().text("❌ إلغاء", "medbookcancel");
  await bot.api.sendMessage(
    chatId,
    `📋 مراجعة الحجز:\n${facility?.name || ""} — د. ${doctor.name} (${doctor.specialty})\n🕐 ${formatDateTime(date)}`,
    { reply_markup: kb }
  );
}

// ---------------------------------------------------------------------
// PHARMACY flows
// ---------------------------------------------------------------------
async function routePharmacyMenu(bot: TelegramBot, chatId: number, tgUserId: string, text: string) {
  const facility = await prisma.medFacility.findUnique({ where: { ownerId: tgUserId } });
  if (!facility) return;

  if (text === "🟢 تفعيل المناوبة" || text === "🔴 إيقاف المناوبة") {
    const updated = await prisma.medFacility.update({ where: { id: facility.id }, data: { isDuty: !facility.isDuty } });
    await bot.api.sendMessage(chatId, updated.isDuty ? "🟢 تم تفعيل المناوبة — ستظهر صيدليتك الآن للمرضى القريبين." : "🔴 تم إيقاف المناوبة.", {
      reply_markup: pharmacyMainMenu(updated.isDuty),
    });
    return;
  }
  if (text === "📩 أسئلة الروشتات") {
    await sendPendingPrescriptionQueries(bot, chatId, facility.id);
    return;
  }
  if (text === "📞 تحديث الهاتف") {
    await setPending(tgUserId, { mode: "facility_edit_phone" });
    await bot.api.sendMessage(chatId, "أدخل رقم الهاتف الجديد:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === "📍 تحديث الموقع") {
    await setPending(tgUserId, { mode: "facility_edit_location" });
    await bot.api.sendMessage(chatId, "شارك الموقع الجديد:", { reply_markup: shareLocationMenu() });
    return;
  }
}

async function sendPendingPrescriptionQueries(bot: TelegramBot, chatId: number, facilityId: string) {
  const queries = await prisma.medPrescriptionQuery.findMany({ where: { facilityId, status: "PENDING" }, orderBy: { created_at: "asc" }, take: 20 });
  if (queries.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد أسئلة جديدة حالياً.");
    return;
  }
  for (const q of queries) {
    const kb = new InlineKeyboard().text("↩️ رد", `medreply|${q.id}`);
    if (q.patientMessage.startsWith("photo:")) {
      await bot.api.sendPhoto(chatId, q.patientMessage.slice("photo:".length), { caption: "📩 صورة روشتة", reply_markup: kb }).catch(() => null);
    } else {
      await bot.api.sendMessage(chatId, `📩 سؤال: ${q.patientMessage}`, { reply_markup: kb });
    }
  }
}

// ---------------------------------------------------------------------
// HOSPITAL flows
// ---------------------------------------------------------------------
async function routeHospitalMenu(bot: TelegramBot, chatId: number, tgUserId: string, text: string) {
  const facility = await prisma.medFacility.findUnique({ where: { ownerId: tgUserId } });
  if (!facility) return;

  if (text === "📅 حجوزات اليوم") {
    await sendTodayAppointmentsForFacility(bot, chatId, facility.id);
    return;
  }
  if (text === "🏬 الأقسام والأطباء") {
    await sendDepartmentsManagement(bot, chatId, facility.id);
    return;
  }
  if (text === "📞 تحديث الهاتف") {
    await setPending(tgUserId, { mode: "facility_edit_phone" });
    await bot.api.sendMessage(chatId, "أدخل رقم الهاتف الجديد:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === "📍 تحديث الموقع") {
    await setPending(tgUserId, { mode: "facility_edit_location" });
    await bot.api.sendMessage(chatId, "شارك الموقع الجديد:", { reply_markup: shareLocationMenu() });
    return;
  }
  if (text === "➕ إضافة قسم جديد") {
    await setPending(tgUserId, { mode: "dept_add" });
    await bot.api.sendMessage(chatId, "أدخل اسم القسم (مثال: عظمية):", { reply_markup: plainBackMenu() });
    return;
  }
}

async function sendDepartmentsManagement(bot: TelegramBot, chatId: number, facilityId: string) {
  const departments = await prisma.medDepartment.findMany({ where: { facilityId }, include: { doctors: true } });
  const kb = new Keyboard().text("➕ إضافة قسم جديد").row().text(backLabel()).resized();
  if (departments.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد أقسام بعد. أضف أول قسم:", { reply_markup: kb });
    return;
  }
  let msg = "🏬 الأقسام الحالية:\n\n";
  for (const d of departments) {
    msg += `📁 ${d.name} — ${d.doctors.length} طبيب\n`;
  }
  await bot.api.sendMessage(chatId, msg, { reply_markup: kb });
  for (const d of departments) {
    const addKb = new InlineKeyboard().text(`➕ إضافة طبيب لقسم ${d.name}`, `meddocadd|${d.id}`);
    await bot.api.sendMessage(chatId, `📁 ${d.name}`, { reply_markup: addKb });
  }
}

async function handleDeptAddStep(bot: TelegramBot, chatId: number, tgUserId: string, text: string) {
  if (!text) return;
  const facility = await prisma.medFacility.findUnique({ where: { ownerId: tgUserId } });
  if (!facility) return;
  await prisma.medDepartment.create({ data: { facilityId: facility.id, name: text } });
  await setPending(tgUserId, null);
  await bot.api.sendMessage(chatId, `✅ تم إضافة قسم "${text}".`, { reply_markup: hospitalMainMenu() });
}

async function handleDoctorAddStep(bot: TelegramBot, chatId: number, tgUserId: string, pending: Extract<PendingAction, { mode: "doctor_add" }>, text: string) {
  const { step, data } = pending;
  if (step === "name") {
    if (!text) return;
    await setPending(tgUserId, { mode: "doctor_add", step: "specialty", data: { ...data, name: text } });
    await bot.api.sendMessage(chatId, "🩺 أدخل التخصص:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "specialty") {
    if (!text) return;
    await setPending(tgUserId, { mode: "doctor_add", step: "days", data: { ...data, specialty: text, days: [] } });
    await bot.api.sendMessage(chatId, "🗓 اختر أيام الدوام، ثم «تم»:", { reply_markup: daysPickMenu([]) });
    return;
  }
  if (step === "days") {
    const selected = data.days || [];
    if (text === DONE_DAYS_LABEL) {
      if (selected.length === 0) {
        await bot.api.sendMessage(chatId, "اختر يوماً واحداً على الأقل.", { reply_markup: daysPickMenu(selected) });
        return;
      }
      await setPending(tgUserId, { mode: "doctor_add", step: "hours", data });
      await bot.api.sendMessage(chatId, "⏰ أدخل ساعات الدوام بالصيغة HH:MM-HH:MM:", { reply_markup: plainBackMenu() });
      return;
    }
    const code = dayLabelToCode(text);
    if (!code) {
      await bot.api.sendMessage(chatId, "اختر يوماً من الأزرار.", { reply_markup: daysPickMenu(selected) });
      return;
    }
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
    await setPending(tgUserId, { mode: "doctor_add", step: "days", data: { ...data, days: next } });
    await bot.api.sendMessage(chatId, "🗓 اختر أيام الدوام، ثم «تم»:", { reply_markup: daysPickMenu(next) });
    return;
  }
  if (step === "hours") {
    const range = parseHoursRange(text);
    if (!range) {
      await bot.api.sendMessage(chatId, "صيغة غير صحيحة. أدخل بالشكل: 09:00-15:00", { reply_markup: plainBackMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "doctor_add", step: "fee", data: { ...data, hours: text.trim() } });
    await bot.api.sendMessage(chatId, "💵 سعر الكشفية بالدولار (أو تخطّي):", { reply_markup: skipMenu() });
    return;
  }
  if (step === "fee") {
    const fee = text === SKIP_LABEL ? null : parseFloat(text);
    await prisma.medDoctor.create({
      data: {
        departmentId: data.departmentId,
        name: data.name || "",
        specialty: data.specialty || "",
        workingDays: (data.days || []).join(","),
        workingHours: data.hours || "",
        feeUsd: fee && !isNaN(fee) ? fee : null,
      },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إضافة الطبيب بنجاح.", { reply_markup: hospitalMainMenu() });
    return;
  }
}

// ---------------------------------------------------------------------
// CLINIC flows
// ---------------------------------------------------------------------
async function routeClinicMenu(bot: TelegramBot, chatId: number, tgUserId: string, text: string) {
  const facility = await prisma.medFacility.findUnique({ where: { ownerId: tgUserId } });
  if (!facility) return;

  if (text === "📅 حجوزات اليوم") {
    await sendTodayAppointmentsForFacility(bot, chatId, facility.id);
    return;
  }
  if (text === "🗓 تحديث تخصصي وجدولي") {
    await setPending(tgUserId, { mode: "clinic_edit_doctor", step: "specialty", data: {} });
    await bot.api.sendMessage(chatId, "🩺 أدخل تخصصك الطبي:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === "📞 تحديث الهاتف") {
    await setPending(tgUserId, { mode: "facility_edit_phone" });
    await bot.api.sendMessage(chatId, "أدخل رقم الهاتف الجديد:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === "📍 تحديث الموقع") {
    await setPending(tgUserId, { mode: "facility_edit_location" });
    await bot.api.sendMessage(chatId, "شارك الموقع الجديد:", { reply_markup: shareLocationMenu() });
    return;
  }
}

async function handleClinicEditDoctorStep(bot: TelegramBot, chatId: number, tgUserId: string, pending: Extract<PendingAction, { mode: "clinic_edit_doctor" }>, text: string) {
  const { step, data } = pending;
  if (step === "specialty") {
    if (!text) return;
    await setPending(tgUserId, { mode: "clinic_edit_doctor", step: "days", data: { ...data, specialty: text, days: [] } });
    await bot.api.sendMessage(chatId, "🗓 اختر أيام الدوام، ثم «تم»:", { reply_markup: daysPickMenu([]) });
    return;
  }
  if (step === "days") {
    const selected = data.days || [];
    if (text === DONE_DAYS_LABEL) {
      if (selected.length === 0) {
        await bot.api.sendMessage(chatId, "اختر يوماً واحداً على الأقل.", { reply_markup: daysPickMenu(selected) });
        return;
      }
      await setPending(tgUserId, { mode: "clinic_edit_doctor", step: "hours", data });
      await bot.api.sendMessage(chatId, "⏰ أدخل ساعات الدوام بالصيغة HH:MM-HH:MM:", { reply_markup: plainBackMenu() });
      return;
    }
    const code = dayLabelToCode(text);
    if (!code) {
      await bot.api.sendMessage(chatId, "اختر يوماً من الأزرار.", { reply_markup: daysPickMenu(selected) });
      return;
    }
    const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
    await setPending(tgUserId, { mode: "clinic_edit_doctor", step: "days", data: { ...data, days: next } });
    await bot.api.sendMessage(chatId, "🗓 اختر أيام الدوام، ثم «تم»:", { reply_markup: daysPickMenu(next) });
    return;
  }
  if (step === "hours") {
    const range = parseHoursRange(text);
    if (!range) {
      await bot.api.sendMessage(chatId, "صيغة غير صحيحة. أدخل بالشكل: 09:00-15:00", { reply_markup: plainBackMenu() });
      return;
    }
    const facility = await prisma.medFacility.findUnique({ where: { ownerId: tgUserId } });
    if (!facility) return;
    const doctor = await prisma.medDoctor.findFirst({ where: { facilityId: facility.id } });
    if (doctor) {
      await prisma.medDoctor.update({
        where: { id: doctor.id },
        data: { specialty: data.specialty || doctor.specialty, workingDays: (data.days || []).join(","), workingHours: text.trim() },
      });
    } else {
      await prisma.medDoctor.create({
        data: { facilityId: facility.id, name: facility.name, specialty: data.specialty || "", workingDays: (data.days || []).join(","), workingHours: text.trim() },
      });
    }
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم تحديث تخصصك وجدولك بنجاح.", { reply_markup: clinicMainMenu() });
    return;
  }
}

// ---------------------------------------------------------------------
// Shared facility flows: phone update, today's appointments
// ---------------------------------------------------------------------
async function handleFacilityEditPhone(bot: TelegramBot, chatId: number, tgUserId: string, text: string) {
  if (!text) return;
  const facility = await prisma.medFacility.update({ where: { ownerId: tgUserId }, data: { phone: text } });
  await setPending(tgUserId, null);
  await bot.api.sendMessage(chatId, "✅ تم تحديث رقم الهاتف.", { reply_markup: mainMenuFor(facility.type as MedRoleStr, facility.isDuty) });
}

async function sendTodayAppointmentsForFacility(bot: TelegramBot, chatId: number, facilityId: string) {
  const doctors = await prisma.medDoctor.findMany({ where: { OR: [{ facilityId }, { department: { facilityId } }] } });
  const doctorIds = doctors.map((d) => d.id);
  if (doctorIds.length === 0) {
    await bot.api.sendMessage(chatId, "لا يوجد أطباء مضافون بعد.");
    return;
  }
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const appts = await prisma.medAppointment.findMany({
    where: { doctorId: { in: doctorIds }, appointmentAt: { gte: startOfDay, lt: endOfDay }, status: { in: ["PENDING", "CONFIRMED"] } },
    include: { patient: true, doctor: true },
    orderBy: { appointmentAt: "asc" },
  });
  if (appts.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد حجوزات لهذا اليوم.");
    return;
  }
  for (const a of appts) {
    const statusLabel = a.status === "CONFIRMED" ? "✅ مؤكد" : "🕓 بانتظار التأكيد";
    const kb =
      a.status === "PENDING"
        ? new InlineKeyboard().text("✅ تأكيد", `medapptok|${a.id}`).text("❌ رفض", `medapptno|${a.id}`)
        : undefined;
    await bot.api.sendMessage(
      chatId,
      `👤 ${a.patient.fullName || a.patientId}\n👨‍⚕️ د. ${a.doctor.name}\n🕐 ${formatDateTime(a.appointmentAt)}\nالحالة: ${statusLabel}`,
      kb ? { reply_markup: kb } : undefined
    );
  }
}

// ---------------------------------------------------------------------
// Prescription query (patient -> pharmacy relay)
// ---------------------------------------------------------------------
async function handlePrescriptionQueryMessage(bot: TelegramBot, botRow: BotRow, chatId: number, tgUserId: string, pending: Extract<PendingAction, { mode: "prescription_query" }>, msg: any) {
  let content: string | null = null;
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    content = `photo:${msg.photo[msg.photo.length - 1].file_id}`;
  } else if (msg.text) {
    content = String(msg.text).trim();
  }
  if (!content) {
    await bot.api.sendMessage(chatId, "أرسل نص سؤالك أو صورة الروشتة.", { reply_markup: plainBackMenu() });
    return;
  }
  const facility = await prisma.medFacility.findUnique({ where: { id: pending.facilityId } });
  if (!facility) {
    await setPending(tgUserId, null);
    return;
  }
  await prisma.medPrescriptionQuery.create({ data: { patientId: tgUserId, facilityId: pending.facilityId, patientMessage: content } });
  await setPending(tgUserId, null);
  await bot.api.sendMessage(chatId, "✅ تم إرسال سؤالك للصيدلية، سيصلك الرد هنا.", { reply_markup: patientMainMenu() });

  await bot.api.sendMessage(Number(facility.ownerId), "📩 سؤال جديد من مريض عن روشتة — راجع «📩 أسئلة الروشتات» في القائمة الرئيسية.").catch(() => null);
}

async function handlePrescriptionReplyStep(bot: TelegramBot, botRow: BotRow, chatId: number, tgUserId: string, pending: Extract<PendingAction, { mode: "prescription_reply" }>, text: string) {
  if (!text) return;
  const query = await prisma.medPrescriptionQuery.update({ where: { id: pending.queryId }, data: { reply: text, status: "ANSWERED" } });
  await setPending(tgUserId, null);
  // Show the pharmacy's REAL duty status, not a hardcoded "on duty" — a
  // pharmacy that's currently off duty and answers a prescription
  // question would otherwise see a menu implying it's on duty, and
  // tapping the mislabeled toggle button would flip isDuty to true.
  const facility = await prisma.medFacility.findUnique({ where: { id: query.facilityId } });
  await bot.api.sendMessage(chatId, "✅ تم إرسال ردك للمريض.", { reply_markup: pharmacyMainMenu(!!facility?.isDuty) });
  await bot.api.sendMessage(Number(query.patientId), `💊 رد الصيدلية على سؤالك:\n\n${text}`).catch(() => null);
}

// ---------------------------------------------------------------------
// SUPER_ADMIN
// ---------------------------------------------------------------------
async function handleAdminMessage(bot: TelegramBot, botRow: BotRow, chatId: number, tgUserId: string, msg: any, text: string) {
  await ensureMedUser(botRow.id, tgUserId);

  if (text === "/start" || isBack(text)) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم البوت الطبي.", { reply_markup: adminMenu() });
    return;
  }

  if (text === "🎫 كود عيادة" || text === "🎫 كود مشفى" || text === "🎫 كود صيدلية") {
    const role: FacilityType = text === "🎫 كود عيادة" ? "CLINIC" : text === "🎫 كود مشفى" ? "HOSPITAL" : "PHARMACY";
    const code = genCode(role);
    await prisma.medActivationCode.create({ data: { code, role } });
    await bot.api.sendMessage(chatId, `✅ كود تفعيل ${roleFacilityLabel(role)} جديد:\n\n\`${code}\`\n\nأرسله لصاحب ${roleFacilityLabel(role)} ليدخله عند بدء استخدام البوت.`, {
      parse_mode: "Markdown",
      reply_markup: adminMenu(),
    });
    return;
  }
  if (text === "📊 إحصائيات") {
    const [patients, clinics, hospitals, pharmacies, appts] = await Promise.all([
      prisma.medUser.count({ where: { role: "PATIENT" } }),
      prisma.medFacility.count({ where: { type: "CLINIC" } }),
      prisma.medFacility.count({ where: { type: "HOSPITAL" } }),
      prisma.medFacility.count({ where: { type: "PHARMACY" } }),
      prisma.medAppointment.count(),
    ]);
    await bot.api.sendMessage(
      chatId,
      `📊 إحصائيات المنصة:\n👤 مرضى: ${patients}\n🩺 عيادات: ${clinics}\n🏥 مشافي: ${hospitals}\n💊 صيدليات: ${pharmacies}\n📅 إجمالي الحجوزات: ${appts}`,
      { reply_markup: adminMenu() }
    );
    return;
  }
}

// ---------------------------------------------------------------------
// Callback query handling
// ---------------------------------------------------------------------
async function handleCallback(bot: TelegramBot, botRow: BotRow, cq: any) {
  const chatId = cq.message?.chat?.id;
  const tgUserId = String(cq.from.id);
  const data = String(cq.data || "");
  if (!chatId) return;

  if (data.startsWith("medrole|")) {
    const role = data.split("|")[1] as MedRoleStr;
    await ensureMedUser(botRow.id, tgUserId);
    if (role === "PATIENT") {
      await setPending(tgUserId, { mode: "patient_reg", step: "fullName", data: {} });
      await bot.api.sendMessage(chatId, "أدخل اسمك الكامل:", { reply_markup: plainBackMenu() });
    } else {
      await setPending(tgUserId, { mode: "facility_reg", step: "activationCode", data: { targetRole: role as FacilityType } });
      await bot.api.sendMessage(chatId, `🎫 أدخل كود تفعيل ${roleFacilityLabel(role as FacilityType)} الذي حصلت عليه من مالك المنصة:`, { reply_markup: plainBackMenu() });
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  if (data.startsWith("medask|")) {
    const facilityId = data.split("|")[1];
    await ensureMedUser(botRow.id, tgUserId);
    await setPending(tgUserId, { mode: "prescription_query", facilityId });
    await bot.api.sendMessage(chatId, "أرسل نص سؤالك أو صورة الروشتة:", { reply_markup: plainBackMenu() });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  if (data.startsWith("medbookfac|")) {
    const facilityId = data.split("|")[1];
    await showDepartmentsOrDoctor(bot, chatId, facilityId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("meddept|")) {
    const deptId = data.split("|")[1];
    await showDoctorsInDepartment(bot, chatId, deptId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("meddoc|")) {
    const doctorId = data.split("|")[1];
    await showDayPicker(bot, chatId, doctorId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("medday|")) {
    const [, doctorId, dayCode] = data.split("|");
    if (!isDayCode(dayCode)) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    await setPending(tgUserId, { mode: "booking_time", doctorId, dayCode });
    await bot.api.sendMessage(chatId, "⏰ أدخل الوقت المفضل (HH:MM)، ضمن ساعات الدوام:", { reply_markup: plainBackMenu() });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data === "medbookconfirm") {
    const user = await prisma.medUser.findUnique({ where: { id: tgUserId } });
    const pending = user?.pendingAction as PendingAction | null;
    if (pending?.mode !== "booking_confirm") {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const doctor = await prisma.medDoctor.findUnique({ where: { id: pending.doctorId }, include: { facility: true, department: { include: { facility: true } } } });
    if (!doctor) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const facility = doctor.facility || doctor.department?.facility;
    const appt = await prisma.medAppointment.create({
      data: { patientId: tgUserId, doctorId: doctor.id, appointmentAt: new Date(pending.appointmentAtIso), status: "PENDING" },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إرسال طلب الحجز، بانتظار تأكيد المنشأة.", { reply_markup: patientMainMenu() });
    if (facility) {
      const patientUser = await prisma.medUser.findUnique({ where: { id: tgUserId } });
      const kb = new InlineKeyboard().text("✅ تأكيد", `medapptok|${appt.id}`).text("❌ رفض", `medapptno|${appt.id}`);
      await bot.api
        .sendMessage(
          Number(facility.ownerId),
          `📥 طلب حجز جديد\n👤 ${patientUser?.fullName || tgUserId}\n👨‍⚕️ د. ${doctor.name}\n🕐 ${formatDateTime(appt.appointmentAt)}`,
          { reply_markup: kb }
        )
        .catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id, { text: "✅ تم" }).catch(() => null);
    return;
  }
  if (data === "medbookcancel") {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "تم إلغاء الحجز.", { reply_markup: patientMainMenu() });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  if (data.startsWith("medapptcancel|")) {
    const apptId = data.split("|")[1];
    const appt = await prisma.medAppointment.findUnique({ where: { id: apptId } });
    if (appt && appt.patientId === tgUserId) {
      await prisma.medAppointment.update({ where: { id: apptId }, data: { status: "CANCELLED" } });
      await bot.api.answerCallbackQuery(cq.id, { text: "✅ تم إلغاء الحجز" }).catch(() => null);
    } else {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    }
    return;
  }

  if (data.startsWith("medapptok|") || data.startsWith("medapptno|")) {
    const [prefix, apptId] = data.split("|");
    const appt = await prisma.medAppointment.findUnique({
      where: { id: apptId },
      include: { doctor: { include: { facility: true, department: { include: { facility: true } } } } },
    });
    if (!appt) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const facility = appt.doctor.facility || appt.doctor.department?.facility;
    if (!facility || facility.ownerId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const newStatus = prefix === "medapptok" ? "CONFIRMED" : "CANCELLED";
    await prisma.medAppointment.update({ where: { id: apptId }, data: { status: newStatus } });
    await bot.api
      .sendMessage(
        Number(appt.patientId),
        newStatus === "CONFIRMED"
          ? `✅ تم تأكيد حجزك مع د. ${appt.doctor.name} بتاريخ ${formatDateTime(appt.appointmentAt)}.`
          : `❌ للأسف تعذّر تأكيد حجزك مع د. ${appt.doctor.name}. جرّب وقتاً آخر.`
      )
      .catch(() => null);
    await bot.api.answerCallbackQuery(cq.id, { text: "✅ تم" }).catch(() => null);
    return;
  }

  if (data.startsWith("meddocadd|")) {
    const departmentId = data.split("|")[1];
    const department = await prisma.medDepartment.findUnique({ where: { id: departmentId }, include: { facility: true } });
    if (!department || department.facility.ownerId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    await ensureMedUser(botRow.id, tgUserId);
    await setPending(tgUserId, { mode: "doctor_add", step: "name", data: { departmentId } });
    await bot.api.sendMessage(chatId, "👨‍⚕️ أدخل اسم الطبيب:", { reply_markup: plainBackMenu() });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  if (data.startsWith("medreply|")) {
    const queryId = data.split("|")[1];
    const query = await prisma.medPrescriptionQuery.findUnique({ where: { id: queryId } });
    if (!query) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const facility = await prisma.medFacility.findUnique({ where: { id: query.facilityId } });
    if (!facility || facility.ownerId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    await setPending(tgUserId, { mode: "prescription_reply", queryId });
    await bot.api.sendMessage(chatId, "اكتب ردك للمريض:", { reply_markup: plainBackMenu() });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
}
