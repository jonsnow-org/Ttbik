import { Bot as TelegramBot, Keyboard, InlineKeyboard } from "grammy";
import { Prisma } from "@prisma/client";
import type { JobsProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * «اطلب وهم يتنافسون» — reverse auction inside JOBS_BOT (owner request,
 * 2026-09-25).
 *
 * Instead of searching and messaging providers one by one, anyone posts
 * what they need once — a service (plumber, designer, …) or a product —
 * and the matching professionals (same trade + same area) or traders
 * (same country, own governorate first) are notified straight away and
 * send a quote: price + what it includes. Quotes are sealed: a bidder only
 * sees how many competitors there are, never their prices, so everyone
 * sends their best number. The requester compares all quotes side by
 * side, picks one, and only then do both sides get each other's contact.
 * The deal itself happens between them — no money moves through here.
 */

export const TENDER_MENU_LABEL = "🏷 اطلب وهم يتنافسون";
const NEED_SERVICE = "🔨 أحتاج خدمة";
const NEED_PRODUCT = "📦 أحتاج منتجاً";
const MY_TENDERS = "📋 طلباتي وعروضها";
const INBOX = "📥 طلبات تنتظر عرضي";
const BACK_LABEL = "◀️ رجوع";
const SKIP_LABEL = "⏭ تخطّي";
const OTHER_LABEL = "✏️ أخرى (اكتبها)";
const DURATIONS: Record<string, number> = { "⏱ 24 ساعة": 24, "⏱ 3 أيام": 72, "⏱ 7 أيام": 168 };

const MAX_OPEN_TENDERS = 3;
const MAX_NOTIFY = 40;
const MAX_SHOWN_BIDS = 10;

type Kind = "SERVICE" | "PRODUCT";
type WizardStep = "category" | "categoryOther" | "details" | "budget" | "duration";
type TenderDraft = { kind: Kind; category?: string; details?: string; budget?: number | null; hours?: number };
export type TenderPending =
  | { mode: "tender_wizard"; step: WizardStep; data: TenderDraft }
  | { mode: "tender_confirm"; data: TenderDraft }
  | { mode: "tender_bid"; step: "price" | "note"; tenderId: string; price?: number };

type Ctx = { bot: TelegramBot; chatId: number; userId: string; home: Keyboard; categories: string[] };

const MENU_TEXTS = new Set([TENDER_MENU_LABEL, NEED_SERVICE, NEED_PRODUCT, MY_TENDERS, INBOX]);
export function isTenderMenuText(text: string): boolean {
  return MENU_TEXTS.has(text);
}
export function isTenderPending(p: any): p is TenderPending {
  return !!p && typeof p.mode === "string" && p.mode.startsWith("tender_");
}

function tenderMenu(): Keyboard {
  return new Keyboard()
    .text(NEED_SERVICE).text(NEED_PRODUCT).row()
    .text(MY_TENDERS).text(INBOX).row()
    .text(BACK_LABEL)
    .resized();
}
function backMenu(): Keyboard {
  return new Keyboard().text(BACK_LABEL).resized();
}
function skipMenu(): Keyboard {
  return new Keyboard().text(SKIP_LABEL).row().text(BACK_LABEL).resized();
}
function durationMenu(): Keyboard {
  const kb = new Keyboard();
  for (const k of Object.keys(DURATIONS)) kb.text(k);
  return kb.row().text(BACK_LABEL).resized();
}
function categoryMenu(categories: string[]): Keyboard {
  const kb = new Keyboard();
  for (let i = 0; i < categories.length; i += 2) {
    kb.text(categories[i]);
    if (categories[i + 1]) kb.text(categories[i + 1]);
    kb.row();
  }
  return kb.text(OTHER_LABEL).row().text(BACK_LABEL).resized();
}

async function setPending(userId: string, action: TenderPending | null) {
  await prisma.jobsUser.update({ where: { id: userId }, data: { pendingAction: (action ?? Prisma.DbNull) as any } });
}
async function blockedPeerIds(userId: string): Promise<string[]> {
  const rows = await prisma.jobsBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
  return rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId));
}
function contactUrl(p: Pick<JobsProfile, "contactMethod" | "contactValue">): string {
  return p.contactMethod === "TELEGRAM" ? `https://t.me/${p.contactValue.replace(/^@/, "")}` : `https://wa.me/${p.contactValue.replace(/[^0-9]/g, "")}`;
}
function money(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}
function hoursLeft(d: Date): string {
  const h = Math.max(0, Math.round((d.getTime() - Date.now()) / 3_600_000));
  return h >= 48 ? `${Math.round(h / 24)} أيام` : `${h} ساعة`;
}
function parsePrice(text: string): number | null {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
}
// Loose both-ways match, same spirit as the professional search elsewhere
// in this bot ("سباك" ↔ "سباك وتمديدات").
function sameTrade(mine: string | null | undefined, wanted: string): boolean {
  const a = (mine || "").trim().toLowerCase();
  const b = wanted.trim().toLowerCase();
  return !!a && !!b && (a.includes(b) || b.includes(a));
}
function kindIcon(kind: string): string {
  return kind === "SERVICE" ? "🔨" : "📦";
}
function tenderCard(t: { kind: string; category: string; details: string; budget: number | null; governorate: string; city: string }): string {
  return (
    `${kindIcon(t.kind)} ${t.kind === "SERVICE" ? "مطلوب خدمة" : "مطلوب منتج"}: ${t.category}\n` +
    `📝 ${t.details}\n` +
    `📍 ${t.governorate}، ${t.city}\n` +
    (t.budget ? `💰 الميزانية التقريبية: ${money(t.budget)}\n` : "")
  );
}

// Tables ship in prisma/migration_36 — answer politely until it has run.
async function guarded(bot: TelegramBot, chatId: number, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
      await bot.api.sendMessage(chatId, "⏳ هذه الخدمة قيد التفعيل من الإدارة، جرّبها لاحقاً.").catch(() => null);
      return;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------
// Menu buttons
// ---------------------------------------------------------------------
export async function handleTenderMenu(ctx: Ctx, profile: JobsProfile, text: string) {
  const { bot, chatId, userId } = ctx;
  await guarded(bot, chatId, async () => {
    if (text === TENDER_MENU_LABEL) {
      await bot.api.sendMessage(
        chatId,
        "🏷 اطلب وهم يتنافسون\n\n" +
          "اكتب ما تحتاجه مرة واحدة، فيصل فوراً للمهنيين أو التجار المناسبين في منطقتك، ويرسل كل منهم عرض سعره.\n" +
          "🔒 العروض سرية: لا يرى أي مقدّم عرض أسعار منافسيه، فيقدّم كلٌّ أفضل ما لديه.\n" +
          "🏆 تقارن العروض وتختار الأنسب، وعندها فقط تُتبادل وسائل التواصل.",
        { reply_markup: tenderMenu() }
      );
      return;
    }
    if (text === NEED_SERVICE || text === NEED_PRODUCT) {
      const open = await prisma.jobsTender.count({ where: { requesterId: userId, status: "OPEN", expiresAt: { gt: new Date() } } });
      if (open >= MAX_OPEN_TENDERS) {
        await bot.api.sendMessage(chatId, `⚠️ لديك ${open} طلبات مفتوحة. اختر عرضاً أو أغلق أحدها من «${MY_TENDERS}» أولاً.`, { reply_markup: tenderMenu() });
        return;
      }
      if (text === NEED_SERVICE) {
        await setPending(userId, { mode: "tender_wizard", step: "category", data: { kind: "SERVICE" } });
        await bot.api.sendMessage(chatId, "🔨 ما نوع الخدمة المطلوبة؟", { reply_markup: categoryMenu(ctx.categories) });
      } else {
        await setPending(userId, { mode: "tender_wizard", step: "category", data: { kind: "PRODUCT" } });
        await bot.api.sendMessage(chatId, "📦 ما المنتج الذي تبحث عنه؟ (اسم قصير، مثال: لابتوب للألعاب)", { reply_markup: backMenu() });
      }
      return;
    }
    if (text === MY_TENDERS) return sendMyTenders(ctx);
    if (text === INBOX) return sendInbox(ctx, profile);
  });
}

// ---------------------------------------------------------------------
// Pending steps (wizard + bid)
// ---------------------------------------------------------------------
export async function handleTenderPending(ctx: Ctx, profile: JobsProfile, pending: TenderPending, text: string) {
  const { bot, chatId, userId } = ctx;
  await guarded(bot, chatId, async () => {
    if (pending.mode === "tender_confirm") {
      await bot.api.sendMessage(chatId, "اضغط «✅ نشر الطلب» أعلاه، أو «◀️ رجوع» للإلغاء.");
      return;
    }
    if (pending.mode === "tender_bid") return consumeBidStep(ctx, pending, text);

    const d = pending.data;
    const go = async (step: WizardStep) => {
      await setPending(userId, { mode: "tender_wizard", step, data: d });
      if (step === "categoryOther") await bot.api.sendMessage(chatId, "اكتب نوع الخدمة:", { reply_markup: backMenu() });
      if (step === "details")
        await bot.api.sendMessage(
          chatId,
          d.kind === "SERVICE"
            ? "📝 صف ما تحتاجه بدقة (الحجم، المكان، الموعد المناسب) — كلما وضح الطلب جاءت العروض أدق:"
            : "📝 صف المواصفات المطلوبة (جديد/مستعمل، الماركة، أي تفاصيل مهمة):",
          { reply_markup: backMenu() }
        );
      if (step === "budget") await bot.api.sendMessage(chatId, "💰 ميزانيتك التقريبية بالدولار؟ (اختياري — اضغط تخطّي لترك الأسعار مفتوحة)", { reply_markup: skipMenu() });
      if (step === "duration") await bot.api.sendMessage(chatId, "⏳ كم تنتظر وصول العروض؟", { reply_markup: durationMenu() });
    };

    if (pending.step === "category") {
      if (d.kind === "SERVICE") {
        if (text === OTHER_LABEL) return go("categoryOther");
        if (!ctx.categories.includes(text)) {
          await bot.api.sendMessage(chatId, "اختر من القائمة، أو «أخرى».", { reply_markup: categoryMenu(ctx.categories) });
          return;
        }
      }
      if (text.length < 2 || text.length > 60) {
        await bot.api.sendMessage(chatId, "اكتب اسماً قصيراً (2–60 حرفاً).", { reply_markup: backMenu() });
        return;
      }
      d.category = text;
      return go("details");
    }
    if (pending.step === "categoryOther") {
      if (text.length < 2 || text.length > 60) {
        await bot.api.sendMessage(chatId, "اكتب اسماً قصيراً (2–60 حرفاً).", { reply_markup: backMenu() });
        return;
      }
      d.category = text;
      return go("details");
    }
    if (pending.step === "details") {
      if (text.length < 10 || text.length > 800) {
        await bot.api.sendMessage(chatId, "الوصف قصير جداً أو طويل جداً (10–800 حرف).", { reply_markup: backMenu() });
        return;
      }
      d.details = text;
      return go("budget");
    }
    if (pending.step === "budget") {
      if (text === SKIP_LABEL) d.budget = null;
      else {
        const b = parsePrice(text);
        if (b === null) {
          await bot.api.sendMessage(chatId, "أرسل رقماً، أو اضغط تخطّي.", { reply_markup: skipMenu() });
          return;
        }
        d.budget = b;
      }
      return go("duration");
    }
    if (pending.step === "duration") {
      const hours = DURATIONS[text];
      if (!hours) {
        await bot.api.sendMessage(chatId, "اختر مدة من الأزرار.", { reply_markup: durationMenu() });
        return;
      }
      d.hours = hours;
      await setPending(userId, { mode: "tender_confirm", data: d });
      await bot.api.sendMessage(
        chatId,
        `راجع طلبك:\n\n${tenderCard({ kind: d.kind, category: d.category!, details: d.details!, budget: d.budget ?? null, governorate: profile.governorate, city: profile.city })}⏳ مدة استقبال العروض: ${text.replace("⏱ ", "")}`,
        { reply_markup: new InlineKeyboard().text("✅ نشر الطلب", "jtn_pub").text("✖️ إلغاء", "jtn_abort") }
      );
    }
  });
}

async function publishTender(ctx: Ctx, profile: JobsProfile, d: TenderDraft) {
  const { bot, chatId, userId } = ctx;
  if (!d.category || !d.details || !d.hours) {
    await setPending(userId, null);
    await bot.api.sendMessage(chatId, "انتهت صلاحية المسودة، ابدأ من جديد.", { reply_markup: tenderMenu() });
    return;
  }
  const open = await prisma.jobsTender.count({ where: { requesterId: userId, status: "OPEN", expiresAt: { gt: new Date() } } });
  if (open >= MAX_OPEN_TENDERS) {
    await setPending(userId, null);
    await bot.api.sendMessage(chatId, `⚠️ لديك ${open} طلبات مفتوحة بالفعل.`, { reply_markup: tenderMenu() });
    return;
  }
  const t = await prisma.jobsTender.create({
    data: {
      requesterId: userId,
      kind: d.kind,
      category: d.category,
      details: d.details,
      budget: d.budget ?? null,
      governorate: profile.governorate,
      city: profile.city,
      expiresAt: new Date(Date.now() + d.hours * 3_600_000),
    },
  });
  await setPending(userId, null);

  const recipients = await matchingProviders(userId, t);
  let sent = 0;
  for (const r of recipients) {
    const ok = await bot.api
      .sendMessage(
        Number(r.userId),
        `🏷 طلب عروض جديد يناسبك\n\n${tenderCard(t)}⏳ يُغلق خلال ${hoursLeft(t.expiresAt)}\n\n🔒 عرضك سري — لا يراه أي منافس.`,
        { reply_markup: new InlineKeyboard().text("💸 قدّم عرضك", `jtn_bid|${t.id}`) }
      )
      .then(() => true)
      .catch(() => false);
    if (ok) sent++;
  }
  await prisma.jobsTender.update({ where: { id: t.id }, data: { notifiedCount: sent } });
  await bot.api.sendMessage(
    chatId,
    sent > 0
      ? `✅ نُشر طلبك ووصل إلى ${sent} ${t.kind === "SERVICE" ? "مهنياً" : "تاجراً"} مناسباً. سيصلك إشعار مع كل عرض جديد، وتقارن العروض من «${MY_TENDERS}».`
      : `✅ نُشر طلبك. لا يوجد ${t.kind === "SERVICE" ? "مهنيون من هذا التخصص في منطقتك" : "تجار في دولتك"} حالياً — سيظهر الطلب لكل من يتصفح «${INBOX}» حتى انتهاء مدته.`,
    { reply_markup: tenderMenu() }
  );
}

// Who is asked to quote: same trade + same governorate/city for services;
// traders in the same country (own governorate first) for products.
async function matchingProviders(requesterId: string, t: { kind: string; category: string; governorate: string; city: string }) {
  const blocked = await blockedPeerIds(requesterId);
  const base = { isPaused: false, userId: { notIn: [requesterId, ...blocked] }, user: { isBanned: false } };
  if (t.kind === "SERVICE") {
    return prisma.jobsProfile.findMany({
      where: {
        ...base,
        roleType: "PROFESSIONAL",
        professionalCategory: { contains: t.category, mode: "insensitive" },
        OR: [{ governorate: { equals: t.governorate, mode: "insensitive" } }, { city: { equals: t.city, mode: "insensitive" } }],
      },
      orderBy: { user: { lastActiveAt: "desc" } },
      take: MAX_NOTIFY,
      select: { userId: true },
    });
  }
  const requester = await prisma.jobsProfile.findUnique({ where: { userId: requesterId }, select: { country: true } });
  const sameGov = await prisma.jobsProfile.findMany({
    where: { ...base, roleType: "TRADER", governorate: { equals: t.governorate, mode: "insensitive" } },
    orderBy: { user: { lastActiveAt: "desc" } },
    take: MAX_NOTIFY,
    select: { userId: true },
  });
  if (sameGov.length >= MAX_NOTIFY || !requester) return sameGov;
  const rest = await prisma.jobsProfile.findMany({
    where: {
      ...base,
      roleType: "TRADER",
      country: { equals: requester.country, mode: "insensitive" },
      userId: { notIn: [requesterId, ...blocked, ...sameGov.map((x) => x.userId)] },
    },
    orderBy: { user: { lastActiveAt: "desc" } },
    take: MAX_NOTIFY - sameGov.length,
    select: { userId: true },
  });
  return [...sameGov, ...rest];
}

// ---------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------
async function openTender(id: string) {
  const t = await prisma.jobsTender.findUnique({ where: { id } });
  return t && t.status === "OPEN" && t.expiresAt > new Date() ? t : null;
}

async function startBid(ctx: Ctx, profile: JobsProfile | null, tenderId: string) {
  const { bot, chatId, userId } = ctx;
  const t = await openTender(tenderId);
  if (!t) {
    await bot.api.sendMessage(chatId, "⌛ هذا الطلب أُغلق أو انتهت مدته.");
    return;
  }
  if (t.requesterId === userId) {
    await bot.api.sendMessage(chatId, "هذا طلبك أنت.");
    return;
  }
  const wanted = t.kind === "SERVICE" ? "PROFESSIONAL" : "TRADER";
  if (!profile || profile.roleType !== wanted) {
    await bot.api.sendMessage(chatId, t.kind === "SERVICE" ? "⚠️ تقديم العروض على طلبات الخدمات متاح لملفات «مهني»." : "⚠️ تقديم العروض على طلبات المنتجات متاح لملفات «تاجر».");
    return;
  }
  if (t.kind === "SERVICE" && !sameTrade(profile.professionalCategory, t.category)) {
    await bot.api.sendMessage(chatId, `⚠️ هذا الطلب لتخصص «${t.category}»، وتخصصك المسجّل «${profile.professionalCategory || "—"}».`);
    return;
  }
  if ((await blockedPeerIds(userId)).includes(t.requesterId)) {
    await bot.api.sendMessage(chatId, "🚫 غير متاح.");
    return;
  }
  const mine = await prisma.jobsTenderBid.findUnique({ where: { tenderId_bidderId: { tenderId, bidderId: userId } } });
  const competitors = await prisma.jobsTenderBid.count({ where: { tenderId, bidderId: { not: userId } } });
  await setPending(userId, { mode: "tender_bid", step: "price", tenderId });
  await bot.api.sendMessage(
    chatId,
    `${tenderCard(t)}\n👥 عروض منافسة حتى الآن: ${competitors}\n` +
      (mine ? `📌 عرضك الحالي: ${money(mine.price)} — أرسل سعراً جديداً لتعديله.\n` : "") +
      "\n💵 أرسل سعرك الإجمالي بالدولار:",
    { reply_markup: backMenu() }
  );
}

async function consumeBidStep(ctx: Ctx, pending: Extract<TenderPending, { mode: "tender_bid" }>, text: string) {
  const { bot, chatId, userId } = ctx;
  if (pending.step === "price") {
    const price = parsePrice(text);
    if (price === null) {
      await bot.api.sendMessage(chatId, "أرسل السعر رقماً.", { reply_markup: backMenu() });
      return;
    }
    await setPending(userId, { mode: "tender_bid", step: "note", tenderId: pending.tenderId, price });
    await bot.api.sendMessage(chatId, "📝 ماذا يشمل عرضك ومتى تستطيع التنفيذ/التسليم؟ (سطر أو سطران — هذا ما يميّزك عن المنافسين)", { reply_markup: backMenu() });
    return;
  }
  if (text.length < 5 || text.length > 400) {
    await bot.api.sendMessage(chatId, "اكتب وصفاً مختصراً (5–400 حرف).", { reply_markup: backMenu() });
    return;
  }
  const t = await openTender(pending.tenderId);
  await setPending(userId, null);
  if (!t) {
    await bot.api.sendMessage(chatId, "⌛ أُغلق الطلب قبل إرسال عرضك.", { reply_markup: ctx.home });
    return;
  }
  const existed = await prisma.jobsTenderBid.findUnique({ where: { tenderId_bidderId: { tenderId: t.id, bidderId: userId } } });
  await prisma.jobsTenderBid.upsert({
    where: { tenderId_bidderId: { tenderId: t.id, bidderId: userId } },
    update: { price: pending.price!, note: text },
    create: { tenderId: t.id, bidderId: userId, price: pending.price!, note: text },
  });
  const total = await prisma.jobsTenderBid.count({ where: { tenderId: t.id } });
  await bot.api.sendMessage(chatId, `✅ ${existed ? "عُدّل" : "أُرسل"} عرضك (${money(pending.price!)}). عدد العروض على هذا الطلب: ${total}. سيصلك إشعار إن اختارك صاحب الطلب.`, {
    reply_markup: ctx.home,
  });
  await bot.api
    .sendMessage(
      Number(t.requesterId),
      `💸 ${existed ? "عرض معدَّل" : "عرض جديد"} على طلبك «${t.category}»: ${money(pending.price!)}\n📊 عدد العروض: ${total}`,
      { reply_markup: new InlineKeyboard().text("📊 قارن العروض", `jtn_cmp|${t.id}`) }
    )
    .catch(() => null);
}

// ---------------------------------------------------------------------
// Requester: list, compare, award, close
// ---------------------------------------------------------------------
async function sendMyTenders(ctx: Ctx) {
  const { bot, chatId, userId } = ctx;
  const rows = await prisma.jobsTender.findMany({
    where: { requesterId: userId },
    orderBy: { created_at: "desc" },
    take: 5,
    include: { _count: { select: { bids: true } } },
  });
  if (rows.length === 0) {
    await bot.api.sendMessage(chatId, "لم تنشر أي طلب بعد.", { reply_markup: tenderMenu() });
    return;
  }
  for (const t of rows) {
    const live = t.status === "OPEN" && t.expiresAt > new Date();
    const state = live ? `🟢 يستقبل العروض — يُغلق خلال ${hoursLeft(t.expiresAt)}` : t.status === "AWARDED" ? "🏆 تم اختيار عرض" : "🔒 مغلق";
    const kb = new InlineKeyboard();
    if (t._count.bids > 0 && t.status !== "CLOSED") kb.text("📊 قارن العروض", `jtn_cmp|${t.id}`);
    if (live) kb.text("🔒 إغلاق", `jtn_close|${t.id}`);
    await bot.api.sendMessage(chatId, `${tenderCard(t)}\n${state}\n📣 وصل إلى: ${t.notifiedCount} | 💸 عروض: ${t._count.bids}`, { reply_markup: kb });
  }
}

async function compareBids(ctx: Ctx, tenderId: string) {
  const { bot, chatId, userId } = ctx;
  const t = await prisma.jobsTender.findFirst({ where: { id: tenderId, requesterId: userId } });
  if (!t) return;
  const bids = await prisma.jobsTenderBid.findMany({ where: { tenderId }, orderBy: { price: "asc" }, take: MAX_SHOWN_BIDS });
  if (bids.length === 0) {
    await bot.api.sendMessage(chatId, "لا توجد عروض بعد — سيصلك إشعار مع أول عرض.");
    return;
  }
  const profiles = await prisma.jobsProfile.findMany({ where: { userId: { in: bids.map((b) => b.bidderId) } } });
  const byId = new Map(profiles.map((p) => [p.userId, p]));
  const kb = new InlineKeyboard();
  const lines = bids.map((b, i) => {
    const p = byId.get(b.bidderId);
    const tag = b.status === "WON" ? " 🏆" : "";
    if (t.status === "OPEN") kb.text(`🏆 اختيار العرض ${i + 1}`, `jtn_win|${b.id}`).row();
    return `${i + 1}. 💵 ${money(b.price)}${tag} — ${p?.name || "مقدّم عرض"} (${p?.city || "—"})\n    📝 ${b.note}`;
  });
  if (t.status === "OPEN") kb.text("🔒 إغلاق دون اختيار", `jtn_close|${t.id}`);
  const budgetLine = t.budget ? `\n💰 ميزانيتك: ${money(t.budget)}` : "";
  await bot.api.sendMessage(chatId, `📊 العروض على «${t.category}» (من الأرخص):${budgetLine}\n\n${lines.join("\n\n")}`, { reply_markup: kb });
}

async function awardBid(ctx: Ctx, bidId: string) {
  const { bot, chatId, userId } = ctx;
  const bid = await prisma.jobsTenderBid.findUnique({ where: { id: bidId }, include: { tender: true } });
  if (!bid || bid.tender.requesterId !== userId) return;
  const t = bid.tender;
  const claimed = await prisma.jobsTender.updateMany({ where: { id: t.id, status: "OPEN" }, data: { status: "AWARDED", awardedBidId: bid.id } });
  if (claimed.count === 0) {
    await bot.api.sendMessage(chatId, "تم اختيار عرض لهذا الطلب مسبقاً أو أُغلق.");
    return;
  }
  await prisma.$transaction([
    prisma.jobsTenderBid.update({ where: { id: bid.id }, data: { status: "WON" } }),
    prisma.jobsTenderBid.updateMany({ where: { tenderId: t.id, id: { not: bid.id } }, data: { status: "LOST" } }),
  ]);
  const [winner, requester] = await Promise.all([
    prisma.jobsProfile.findUnique({ where: { userId: bid.bidderId } }),
    prisma.jobsProfile.findUnique({ where: { userId } }),
  ]);
  const winnerKb = new InlineKeyboard();
  if (winner) winnerKb.url("💬 تواصل مع صاحب العرض", contactUrl(winner)).row();
  winnerKb.text("🚩 إبلاغ", `jreport|profile|${bid.bidderId}`);
  await bot.api.sendMessage(
    chatId,
    `🏆 اخترت عرض ${winner?.name || "مقدّم العرض"} بسعر ${money(bid.price)}.\n📝 ${bid.note}\n\nتواصل معه لإتمام الاتفاق — وصلته بيانات تواصلك أيضاً.\n⚠️ الاتفاق والدفع يتمّان بينكما مباشرة؛ لا تدفع مقدماً لمن لا تثق به.`,
    { reply_markup: winnerKb }
  );
  const reqKb = new InlineKeyboard();
  if (requester) reqKb.url("💬 تواصل مع صاحب الطلب", contactUrl(requester));
  await bot.api
    .sendMessage(
      Number(bid.bidderId),
      `🎉 فاز عرضك (${money(bid.price)}) على طلب «${t.category}»!\n📍 ${t.governorate}، ${t.city}\n\nتواصل مع صاحب الطلب ${requester?.name || ""} لإتمام العمل.`,
      { reply_markup: reqKb }
    )
    .catch(() => null);
  const losers = await prisma.jobsTenderBid.findMany({ where: { tenderId: t.id, id: { not: bid.id } }, select: { bidderId: true } });
  for (const l of losers) {
    await bot.api.sendMessage(Number(l.bidderId), `ℹ️ اختار صاحب طلب «${t.category}» عرضاً آخر هذه المرة. بالتوفيق في الطلبات القادمة 💪`).catch(() => null);
  }
}

async function closeTender(ctx: Ctx, tenderId: string) {
  const { bot, chatId, userId } = ctx;
  const res = await prisma.jobsTender.updateMany({ where: { id: tenderId, requesterId: userId, status: "OPEN" }, data: { status: "CLOSED" } });
  if (res.count === 0) {
    await bot.api.sendMessage(chatId, "هذا الطلب مغلق مسبقاً.");
    return;
  }
  const t = await prisma.jobsTender.findUnique({ where: { id: tenderId } });
  const bidders = await prisma.jobsTenderBid.findMany({ where: { tenderId }, select: { bidderId: true } });
  for (const b of bidders) await bot.api.sendMessage(Number(b.bidderId), `ℹ️ أغلق صاحب طلب «${t?.category}» طلبه دون اختيار عرض.`).catch(() => null);
  await bot.api.sendMessage(chatId, "🔒 أُغلق الطلب.", { reply_markup: tenderMenu() });
}

// ---------------------------------------------------------------------
// Provider inbox
// ---------------------------------------------------------------------
async function sendInbox(ctx: Ctx, profile: JobsProfile) {
  const { bot, chatId, userId } = ctx;
  if (profile.roleType !== "PROFESSIONAL" && profile.roleType !== "TRADER") {
    await bot.api.sendMessage(chatId, "📥 هذا القسم لمقدّمي العروض: ملفات «مهني» ترى طلبات الخدمات في منطقتها، وملفات «تاجر» ترى طلبات المنتجات في دولتها.", {
      reply_markup: tenderMenu(),
    });
    return;
  }
  const blocked = await blockedPeerIds(userId);
  const where: Prisma.JobsTenderWhereInput =
    profile.roleType === "PROFESSIONAL"
      ? {
          kind: "SERVICE",
          OR: [{ governorate: { equals: profile.governorate, mode: "insensitive" } }, { city: { equals: profile.city, mode: "insensitive" } }],
        }
      : { kind: "PRODUCT" };
  const rows = await prisma.jobsTender.findMany({
    where: { ...where, status: "OPEN", expiresAt: { gt: new Date() }, requesterId: { notIn: [userId, ...blocked] } },
    orderBy: { created_at: "desc" },
    take: 60,
  });
  let matches = rows;
  if (profile.roleType === "PROFESSIONAL") {
    matches = rows.filter((t) => sameTrade(profile.professionalCategory, t.category));
  } else {
    const requesters = await prisma.jobsProfile.findMany({ where: { userId: { in: rows.map((r) => r.requesterId) } }, select: { userId: true, country: true } });
    const sameCountry = new Set(requesters.filter((r) => r.country.trim().toLowerCase() === profile.country.trim().toLowerCase()).map((r) => r.userId));
    matches = rows.filter((t) => sameCountry.has(t.requesterId));
  }
  matches = matches.slice(0, 5);
  if (matches.length === 0) {
    await bot.api.sendMessage(chatId, "💤 لا توجد طلبات مفتوحة تناسبك الآن — سيصلك إشعار فور نشر طلب جديد.", { reply_markup: tenderMenu() });
    return;
  }
  const myBids = await prisma.jobsTenderBid.findMany({ where: { bidderId: userId, tenderId: { in: matches.map((m) => m.id) } } });
  const bidBy = new Map(myBids.map((b) => [b.tenderId, b]));
  for (const t of matches) {
    const mine = bidBy.get(t.id);
    await bot.api.sendMessage(chatId, `${tenderCard(t)}⏳ يُغلق خلال ${hoursLeft(t.expiresAt)}` + (mine ? `\n📌 عرضك: ${money(mine.price)}` : ""), {
      reply_markup: new InlineKeyboard().text(mine ? "✏️ تعديل عرضك" : "💸 قدّم عرضك", `jtn_bid|${t.id}`),
    });
  }
}

// ---------------------------------------------------------------------
// Callbacks (prefix "jtn_")
// ---------------------------------------------------------------------
export async function handleTenderCallback(ctx: Ctx, cq: any, pending: unknown) {
  const { bot, chatId, userId } = ctx;
  const data = String(cq.data || "");
  const [action, id] = data.split("|");
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
  await guarded(bot, chatId, async () => {
    const profile = await prisma.jobsProfile.findUnique({ where: { userId } });
    if (action === "jtn_pub") {
      const p = pending as TenderPending | null;
      if (p?.mode !== "tender_confirm" || !profile) {
        await bot.api.sendMessage(chatId, "انتهت صلاحية المسودة، ابدأ من جديد.", { reply_markup: tenderMenu() });
        return;
      }
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id).catch(() => null);
      return publishTender(ctx, profile, p.data);
    }
    if (action === "jtn_abort") {
      await setPending(userId, null);
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id).catch(() => null);
      await bot.api.sendMessage(chatId, "✖️ أُلغيت المسودة.", { reply_markup: tenderMenu() });
      return;
    }
    if (action === "jtn_bid" && id) return startBid(ctx, profile, id);
    if (action === "jtn_cmp" && id) return compareBids(ctx, id);
    if (action === "jtn_win" && id) return awardBid(ctx, id);
    if (action === "jtn_close" && id) return closeTender(ctx, id);
  });
}

export async function tenderStatsLine(): Promise<string> {
  try {
    const [open, awarded, bids] = await Promise.all([
      prisma.jobsTender.count({ where: { status: "OPEN", expiresAt: { gt: new Date() } } }),
      prisma.jobsTender.count({ where: { status: "AWARDED" } }),
      prisma.jobsTenderBid.count(),
    ]);
    return `\n\n🏷 اطلب وهم يتنافسون: ${open} طلب مفتوح | ${awarded} تم اختيار عرضه | ${bids} عرض مقدَّم`;
  } catch {
    return "\n\n🏷 اطلب وهم يتنافسون: بانتظار تشغيل migration_36";
  }
}
