/**
 * «زواج بثقة» (2026-11-10, additive): the member's own shareable anonymous card and the paid
 * human matchmaker («💍 خاطبة شخصية»). Own table only (match_matchmaker, created on first use like
 * appStore.ts); bot tables are read, and the balance moves only through chargeMatchUser / a
 * refund row in MatchTransaction. Pure rules live in trustRules.ts (unit-tested).
 */
import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargeMatchUser } from "@/lib/match/entitlements";
import { containsContactInfo } from "@/lib/match/contactGuard";
import { botUsername, publicCardKeyboard } from "@/lib/match/hybrid";
import { publicCardText, toPublicProfile } from "@/lib/match/inline";
import { trackFunnel } from "@/lib/match/growth";
import { sendStarsInvoice, starsPayload } from "@/lib/starsPayment";
import {
  CARD_INLINE_QUERY, MATCHMAKER_INTRO, MATCHMAKER_NOTE_MAX, MATCHMAKER_SLA_HOURS, MATCHMAKER_STARS_KIND, PRICE_MATCHMAKER,
  MATCHMAKER_CANDIDATES, cardLink, cardShareText, checkMatchmakerNote, parseCardStart, rankMatchmakerCandidates, shortfallStars, suggestCallback,
} from "@/lib/match/trustRules";

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik-gate.jonsnowx1r.workers.dev").replace(/\/$/, "");

let ready: Promise<void> | null = null;
export function ensureTrustTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS match_matchmaker (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'AWAITING_NOTE', note TEXT, paid NUMERIC NOT NULL, replies INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ)`
      );
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS match_matchmaker_status_idx ON match_matchmaker (status, created_at DESC)`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS match_matchmaker_user_idx ON match_matchmaker (user_id, created_at DESC)`);
      // Profiles already suggested for a request, so the same one is never sent twice.
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS match_matchmaker_sent (req_id BIGINT NOT NULL, profile_id TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (req_id, profile_id))`
      );
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

async function approvedProfile(userId: string) {
  const p = await prisma.matchProfile.findUnique({ where: { userId }, include: { user: { select: { botId: true, isBanned: true } } } });
  return p && p.status === "APPROVED" && !p.user.isBanned ? p : null;
}

// ---------------------------------------------------------------------------
// 🪪 Own card
// ---------------------------------------------------------------------------
export async function sendOwnCard(bot: TelegramBot, botRow: BotRow, chatId: number, userId: string): Promise<void> {
  const p = await approvedProfile(userId);
  if (!p) {
    await bot.api.sendMessage(chatId, "🪪 بطاقتك تظهر بعد إنشاء ملفك واعتماده. اضغط «👤 ملفي الشخصي» لإنشائه (دقيقتان).").catch(() => null);
    return;
  }
  const username = (await botUsername(bot, botRow.id)) || "";
  const card = publicCardText(toPublicProfile(p));
  const kb = new InlineKeyboard();
  if (username) kb.url("💍 تعرّف عليّ عبر البوت 🔒", cardLink(username, p.id)).row();
  kb.switchInline("📤 أرسل بطاقتي إلى محادثة", CARD_INLINE_QUERY);
  await bot.api.sendMessage(chatId, "🪪 هذه بطاقتك المجهولة (بلا اسم ولا صورة ولا وسيلة تواصل). أعد توجيهها لمن تثق بهم، أو أرسلها بالزر. كل من يدخل البوت منها ويُعتمد ملفه يمنحك يوماً ذهبياً 👑.").catch(() => null);
  await bot.api.sendMessage(chatId, cardShareText(card), { reply_markup: kb }).catch(() => null);
  void trackFunnel(userId, "card_share", undefined, "bot");
}

/** Inline result for «بطاقتي»: the member's own card, with the c_ link that credits them. Empty when not approved. */
export async function ownCardInlineResults(bot: TelegramBot, botRow: BotRow, userId: string) {
  const p = await approvedProfile(userId);
  const username = (await botUsername(bot, botRow.id)) || "";
  if (!p || !username) return [];
  const pub = toPublicProfile(p);
  return [{
    type: "article" as const,
    id: `card_${pub.shortId}`.slice(0, 64),
    title: `🪪 بطاقتي #${pub.shortId}`,
    description: "أرسل بطاقتك المجهولة للتعارف بغرض الزواج",
    thumbnail_url: `${SITE}/img/match-avatar-${pub.gender === "FEMALE" ? "f" : "m"}.jpg`,
    input_message_content: { message_text: cardShareText(publicCardText(pub)) },
    reply_markup: { inline_keyboard: [[{ text: "💍 تعرّف عليّ عبر البوت 🔒", url: cardLink(username, p.id) }]] },
  }];
}

/** Telegram id of the member whose own card (c_<profile>) brought this /start, or undefined. */
export async function cardReferrer(payload: string | null | undefined): Promise<string | undefined> {
  const ref = parseCardStart(payload);
  if (!ref) return undefined;
  const p = await prisma.matchProfile.findUnique({ where: { id: ref }, select: { userId: true } }).catch(() => null);
  return p?.userId;
}
export { parseCardStart };

// ---------------------------------------------------------------------------
// 💍 Human matchmaker
// ---------------------------------------------------------------------------
export async function showMatchmaker(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.api.sendMessage(chatId, MATCHMAKER_INTRO, {
    reply_markup: new InlineKeyboard().text(`✅ اطلب الخاطبة ($${PRICE_MATCHMAKER})`, "mm_buy"),
  }).catch(() => null);
}

async function openRequestFor(userId: string): Promise<{ id: string; status: string } | null> {
  await ensureTrustTables();
  const r = await prisma.$queryRaw<{ id: bigint; status: string }[]>`
    SELECT id, status FROM match_matchmaker WHERE user_id = ${userId} AND status IN ('AWAITING_NOTE','OPEN') ORDER BY id DESC LIMIT 1`;
  return r[0] ? { id: String(r[0].id), status: r[0].status } : null;
}

async function setUserPending(userId: string, action: Record<string, unknown> | null) {
  await prisma.matchUser.update({ where: { id: userId }, data: { pendingAction: action as any } }).catch(() => null);
}

async function askForNote(bot: TelegramBot, chatId: number, userId: string, reqId: string) {
  await setUserPending(userId, { mode: "mm_note", reqId });
  await bot.api.sendMessage(chatId,
    `✍️ اكتب في رسالة واحدة ما تبحث عنه (العمر، الدولة، المدينة، الالتزام، الحالة الاجتماعية، وأي شيء مهم لك). حتى ${MATCHMAKER_NOTE_MAX} حرف، وبلا أرقام أو حسابات تواصل.`
  ).catch(() => null);
}

/** «✅ اطلب الخاطبة»: charge the balance, or send a Stars invoice for the shortfall (MATCH_MM:<uid>). */
export async function buyMatchmaker(bot: TelegramBot, botRow: BotRow, chatId: number, userId: string): Promise<void> {
  if (!(await approvedProfile(userId))) {
    await bot.api.sendMessage(chatId, "⚠️ الخاطبة تحتاج ملفاً معتمداً حتى تعرف من تقترح له. أنشئ ملفك من «👤 ملفي الشخصي».").catch(() => null);
    return;
  }
  const open = await openRequestFor(userId);
  if (open) {
    if (open.status === "AWAITING_NOTE") await askForNote(bot, chatId, userId, open.id);
    else await bot.api.sendMessage(chatId, `⏳ عندك طلب خاطبة مفتوح (#${open.id}). سيصلك الرد خلال ${MATCHMAKER_SLA_HOURS} ساعة.`).catch(() => null);
    return;
  }
  void trackFunnel(userId, "purchase_attempt", "matchmaker", "bot");
  const charge = await chargeMatchUser(userId, PRICE_MATCHMAKER, "MATCHMAKER");
  if (!charge.ok) {
    await sendStarsInvoice(bot, chatId, {
      title: "💍 خاطبة شخصية",
      description: `إنسان من الفريق يقترح لك حتى 3 ملفات مناسبة خلال ${MATCHMAKER_SLA_HOURS} ساعة. يُعاد المبلغ إن لم نجد ملفاً مناسباً.`,
      payload: starsPayload(MATCHMAKER_STARS_KIND, userId),
      stars: shortfallStars(PRICE_MATCHMAKER, charge.balance),
    });
    return;
  }
  await ensureTrustTables();
  const paid = charge.charged ?? PRICE_MATCHMAKER;
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    INSERT INTO match_matchmaker (user_id, bot_id, paid) VALUES (${userId}, ${botRow.id}, ${paid}) RETURNING id`;
  void trackFunnel(userId, "purchase_success", "matchmaker", "bot");
  await askForNote(bot, chatId, userId, String(rows[0].id));
}

/** The member's note (pending mode mm_note). Returns true when the message was consumed. */
export async function consumeMatchmakerNote(bot: TelegramBot, chatId: number, userId: string, reqId: string, text: string): Promise<boolean> {
  const check = checkMatchmakerNote(text, containsContactInfo);
  if (!check.ok) {
    const why = check.reason === "contact" ? "⚠️ لا تضع أرقاماً أو حسابات تواصل في الطلب." : check.reason === "long" ? `⚠️ الحد ${MATCHMAKER_NOTE_MAX} حرف.` : "⚠️ اكتب وصفاً أوضح (10 أحرف على الأقل).";
    await bot.api.sendMessage(chatId, why).catch(() => null);
    return true;
  }
  await ensureTrustTables();
  await prisma.$executeRaw`UPDATE match_matchmaker SET note = ${check.note}, status = 'OPEN' WHERE id = ${BigInt(reqId)} AND user_id = ${userId} AND status = 'AWAITING_NOTE'`;
  await setUserPending(userId, null);
  await bot.api.sendMessage(chatId, `✅ وصل طلبك (#${reqId}). ستصلك اقتراحات الخاطبة هنا خلال ${MATCHMAKER_SLA_HOURS} ساعة.`).catch(() => null);
  if (SUPER_ADMIN_ID) {
    const p = await prisma.matchProfile.findUnique({ where: { userId } });
    const card = p ? publicCardText(toPublicProfile(p)) : `#${userId.slice(-6)}`;
    await bot.api.sendMessage(Number(SUPER_ADMIN_ID), `💍 طلب خاطبة جديد #${reqId}\n\n${card}\n\n📝 يبحث عن:\n${check.note}`, { reply_markup: adminKeyboard(reqId) }).catch(() => null);
    await sendCandidates(bot, Number(SUPER_ADMIN_ID), reqId);
  }
  return true;
}

function adminKeyboard(reqId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔎 ملفات مقترحة", `mm_cand|${reqId}`).row()
    .text("📨 أرسل رسالة نصية", `mm_msg|${reqId}`).row()
    .text("✅ أُنجز", `mm_done|${reqId}`).text("↩️ استرداد", `mm_ref|${reqId}`);
}

async function requestRow(reqId: string) {
  await ensureTrustTables();
  const r = await prisma.$queryRaw<{ id: bigint; user_id: string; status: string; paid: unknown; note: string | null }[]>`
    SELECT id, user_id, status, paid, note FROM match_matchmaker WHERE id = ${BigInt(reqId)}`;
  return r[0] ?? null;
}

/**
 * The best approved profiles for one request (opposite gender, same bot, visible, not banned, no block either way,
 * not already suggested), ranked by the requester's partner preferences, the note and recent activity.
 */
export async function findMatchmakerCandidates(reqId: string) {
  const row = await requestRow(reqId);
  if (!row) return null;
  const me = await prisma.matchProfile.findUnique({ where: { userId: row.user_id }, include: { user: { select: { botId: true } } } });
  if (!me) return { row, list: [] };
  const want = me.gender === "MALE" ? "FEMALE" : "MALE";
  const [pref, pool, blocks, sent] = await Promise.all([
    prisma.partnerPreference.findUnique({ where: { userId: row.user_id } }),
    prisma.matchProfile.findMany({
      where: { status: "APPROVED", isHidden: false, gender: want, userId: { not: row.user_id }, user: { botId: me.user.botId, isBanned: false } },
      include: { user: { select: { lastActiveAt: true } } },
      orderBy: { user: { lastActiveAt: "desc" } },
      take: 300,
    }),
    prisma.matchBlock.findMany({ where: { OR: [{ blockerId: row.user_id }, { blockedId: row.user_id }] }, select: { blockerId: true, blockedId: true } }),
    prisma.$queryRaw<{ profile_id: string }[]>`SELECT profile_id FROM match_matchmaker_sent WHERE req_id = ${BigInt(reqId)}`,
  ]);
  const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
  const done = new Set(sent.map((x) => x.profile_id));
  const fresh = pool.filter((p) => !blocked.has(p.userId) && !done.has(p.id));
  const ranked = rankMatchmakerCandidates(
    { userId: row.user_id, gender: me.gender, pref, note: row.note },
    fresh.map((p) => ({ ...p, lastActiveAt: p.user.lastActiveAt })),
  );
  const byId = new Map(fresh.map((p) => [p.id, p]));
  return { row, list: ranked.map((c) => byId.get(c.id)!).filter(Boolean), alreadySent: done.size };
}

/** Admin: the ranked candidates as cards, each with a one-tap «📤 اقترح» that sends it to the requester. */
export async function sendCandidates(bot: TelegramBot, adminChatId: number, reqId: string): Promise<void> {
  const found = await findMatchmakerCandidates(reqId).catch(() => null);
  if (!found) {
    await bot.api.sendMessage(adminChatId, "هذا الطلب غير موجود.").catch(() => null);
    return;
  }
  if (!found.list.length) {
    await bot.api.sendMessage(adminChatId,
      `⚠️ لا يوجد الآن أي ملف معتمد مناسب لطلب #${reqId}${found.alreadySent ? ` (أُرسل له ${found.alreadySent} من قبل)` : ""}.\nإن لم تجد يدوياً، اضغط «↩️ استرداد» ليعود المبلغ لرصيده.`,
      { reply_markup: adminKeyboard(reqId) }).catch(() => null);
    return;
  }
  await bot.api.sendMessage(adminChatId, `🔎 أفضل ${found.list.length} ملفات لطلب #${reqId} (حسب مواصفاته وطلبه ونشاط الملف). اضغط «📤 اقترح» تحت الملف ليصل إليه فوراً:`).catch(() => null);
  for (const p of found.list.slice(0, MATCHMAKER_CANDIDATES)) {
    const days = p.user.lastActiveAt ? Math.floor((Date.now() - p.user.lastActiveAt.getTime()) / 86400_000) : null;
    const active = days === null ? "" : days <= 0 ? "\n🟢 نشط اليوم" : `\n🕒 آخر نشاط قبل ${days} يوم`;
    await bot.api.sendMessage(adminChatId, `${publicCardText(toPublicProfile(p))}${active}`, {
      reply_markup: new InlineKeyboard().text(`📤 اقترح هذا الملف لطلب #${reqId}`, suggestCallback(reqId, p.id)),
    }).catch(() => null);
  }
}

/** Admin tapped «📤 اقترح»: send that profile's anonymous card (with like / chat-request buttons) to the requester, once. */
export async function sendSuggestion(bot: TelegramBot, botRow: BotRow, reqId: string, profileId: string): Promise<"sent" | "closed" | "gone" | "dup" | "failed"> {
  const row = await requestRow(reqId);
  if (!row || row.status !== "OPEN") return "closed";
  const p = await prisma.matchProfile.findUnique({ where: { id: profileId }, include: { user: { select: { botId: true, isBanned: true } } } });
  if (!p || p.status !== "APPROVED" || p.isHidden || p.user.isBanned || p.user.botId !== botRow.id || p.userId === row.user_id) return "gone";
  const n = await prisma.$executeRaw`INSERT INTO match_matchmaker_sent (req_id, profile_id) VALUES (${BigInt(reqId)}, ${profileId}) ON CONFLICT DO NOTHING`;
  if (n !== 1) return "dup";
  const sent = await bot.api.sendMessage(Number(row.user_id), `💍 اقتراح من الخاطبة (طلب #${reqId}):\n\n${publicCardText(toPublicProfile(p))}\n\nإن أعجبك، اطلب دردشة مجهولة أو أرسل إعجاباً من الأزرار.`, {
    reply_markup: publicCardKeyboard(p.userId),
  }).catch(() => null);
  if (!sent) {
    await prisma.$executeRaw`DELETE FROM match_matchmaker_sent WHERE req_id = ${BigInt(reqId)} AND profile_id = ${profileId}`.catch(() => null);
    return "failed";
  }
  await prisma.$executeRaw`UPDATE match_matchmaker SET replies = replies + 1 WHERE id = ${BigInt(reqId)}`;
  return "sent";
}

/** Admin text after «📨 أرسل اقتراحاً» (admin pending mode mm_reply). */
export async function sendMatchmakerReply(bot: TelegramBot, adminChatId: number, reqId: string, text: string): Promise<void> {
  const row = await requestRow(reqId);
  if (!row || row.status !== "OPEN") {
    await bot.api.sendMessage(adminChatId, "هذا الطلب مغلق أو غير موجود.").catch(() => null);
    return;
  }
  const sent = await bot.api.sendMessage(Number(row.user_id), `💍 رسالة من الخاطبة (طلب #${reqId}):\n\n${text.slice(0, 3500)}`).catch(() => null);
  if (sent) await prisma.$executeRaw`UPDATE match_matchmaker SET replies = replies + 1 WHERE id = ${BigInt(reqId)}`;
  await bot.api.sendMessage(adminChatId, sent ? "✅ وصل الاقتراح." : "❌ تعذّر الإرسال (ربما أوقف المستخدم البوت).", { reply_markup: adminKeyboard(reqId) }).catch(() => null);
}

/** Lists open requests for the admin (command «💍 طلبات الخاطبة»). */
export async function listMatchmakerRequests(bot: TelegramBot, chatId: number): Promise<void> {
  await ensureTrustTables();
  const rows = await prisma.$queryRaw<{ id: bigint; note: string | null; created_at: Date }[]>`
    SELECT id, note, created_at FROM match_matchmaker WHERE status = 'OPEN' ORDER BY id ASC LIMIT 20`;
  if (!rows.length) {
    await bot.api.sendMessage(chatId, "لا توجد طلبات خاطبة مفتوحة.").catch(() => null);
    return;
  }
  for (const r of rows) {
    await bot.api.sendMessage(chatId, `💍 #${r.id} — ${r.created_at.toISOString().slice(0, 16).replace("T", " ")} UTC\n${(r.note || "").slice(0, 600)}`, { reply_markup: adminKeyboard(String(r.id)) }).catch(() => null);
  }
}

/** mm_* callbacks. Returns true when handled. */
export async function handleTrustCallback(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const data = String(cq.data || "");
  if (!data.startsWith("mm_")) return false;
  const userId = String(cq.from.id);
  const chatId = Number(cq.message?.chat?.id ?? userId);
  const [kind, reqId, extra] = data.split("|");
  const ack = (text?: string) => bot.api.answerCallbackQuery(cq.id, text ? { text } : undefined).catch(() => null);
  if (kind === "mm_buy") {
    await ack();
    await buyMatchmaker(bot, botRow, chatId, userId);
    return true;
  }
  if (!SUPER_ADMIN_ID || userId !== SUPER_ADMIN_ID || !reqId || !/^\d+$/.test(reqId)) {
    await ack();
    return true;
  }
  const row = await requestRow(reqId);
  if (!row) { await ack("غير موجود"); return true; }
  if (kind === "mm_cand") {
    await ack();
    await sendCandidates(bot, chatId, reqId);
    return true;
  }
  if (kind === "mm_sug") {
    const r = /^[0-9a-fA-F-]{36}$/.test(extra || "") ? await sendSuggestion(bot, botRow, reqId, extra.toLowerCase()) : "gone";
    await ack({ sent: "✅ وصل الاقتراح", closed: "الطلب مغلق", gone: "الملف لم يعد متاحاً", dup: "أُرسل هذا الملف من قبل", failed: "تعذّر الإرسال" }[r]);
    return true;
  }
  if (kind === "mm_msg") {
    await setUserPending(userId, { mode: "mm_reply", reqId });
    await ack();
    await bot.api.sendMessage(chatId, `✍️ اكتب الاقتراح لطلب #${reqId} (يمكنك لصق روابط الملفات من البحث المضمّن). سيصل للمستخدم كما هو.`).catch(() => null);
    return true;
  }
  if (row.status !== "OPEN" && row.status !== "AWAITING_NOTE") { await ack("مغلق مسبقاً"); return true; }
  if (kind === "mm_done") {
    await prisma.$executeRaw`UPDATE match_matchmaker SET status = 'DONE', closed_at = now() WHERE id = ${BigInt(reqId)} AND status IN ('OPEN','AWAITING_NOTE')`;
    await bot.api.sendMessage(Number(row.user_id), `💍 أُغلق طلب الخاطبة #${reqId}. نتمنى لك التوفيق 🤍`).catch(() => null);
    await ack("أُغلق ✅");
    return true;
  }
  if (kind === "mm_ref") {
    const amount = Number(row.paid) || PRICE_MATCHMAKER;
    const done = await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRaw`UPDATE match_matchmaker SET status = 'REFUNDED', closed_at = now() WHERE id = ${BigInt(reqId)} AND status IN ('OPEN','AWAITING_NOTE')`;
      if (n !== 1) return false;
      await tx.matchUser.update({ where: { id: row.user_id }, data: { balance: { increment: amount } } });
      await tx.matchTransaction.create({ data: { userId: row.user_id, amount, currency: "USD", type: "MATCHMAKER_REFUND", status: "COMPLETED", txHash: `mm_refund_${reqId}` } });
      return true;
    });
    if (done) await bot.api.sendMessage(Number(row.user_id), `↩️ لم نجد ملفاً مناسباً لطلبك #${reqId} الآن، فأُعيد $${amount.toFixed(2)} إلى رصيدك.`).catch(() => null);
    await ack(done ? "تم الاسترداد" : "مغلق مسبقاً");
    return true;
  }
  await ack();
  return true;
}
