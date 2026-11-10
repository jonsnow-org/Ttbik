/**
 * «ختمة» on STREAK_BOT: group khatmas (free), memorial khatmas (⭐ Stars) and Ramadan sponsorship.
 * Own tables, created on first use; no prisma schema change. The bot only answers in a group when
 * someone there uses /khatma or taps the board, so nothing is sent unasked.
 */
import crypto from "crypto";
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/siteUrl";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { adStars, bindAdmenBot, findAdmenBot, siteAdStarsEnabled } from "@/lib/siteAds";
import { gateUrl } from "@/lib/hostingOps";
import {
  DEDICATION_MAX, INTENTS, JUZ_COUNT, KHATMA_CMD, MAX_OPEN_PER_USER, MEMORIAL_START_PREFIX, MEMORIAL_TIERS, NAME_MAX, SPONSOR_DAYS, SPONSOR_PRICE_USD, STARS_KIND, TITLE_MAX,
  arNum, boardKeyboard, boardText, cleanText, completionText, emptyBoard, isComplete, isSlug, makeSlug, memorialTitle, parseJuzCallback, sponsorLine, tap, tierById, type JuzState,
} from "@/lib/khatma/rules";

let ready: Promise<void> | null = null;
export function ensureKhatmaTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS khatma (id BIGSERIAL PRIMARY KEY, bot_id TEXT NOT NULL, chat_id TEXT, kind TEXT NOT NULL DEFAULT 'GROUP', title TEXT NOT NULL, dedication TEXT, slug TEXT UNIQUE, bot_username TEXT, round INT NOT NULL DEFAULT 1, completed_rounds INT NOT NULL DEFAULT 0, message_id BIGINT, creator_id TEXT, featured_until TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        `CREATE INDEX IF NOT EXISTS khatma_chat_idx ON khatma (bot_id, chat_id, status)`,
        `CREATE TABLE IF NOT EXISTS khatma_juz (khatma_id BIGINT NOT NULL, round INT NOT NULL, juz INT NOT NULL, user_id TEXT, user_name TEXT, done BOOLEAN NOT NULL DEFAULT false, taken_at TIMESTAMPTZ, done_at TIMESTAMPTZ, PRIMARY KEY (khatma_id, round, juz))`,
        `CREATE TABLE IF NOT EXISTS khatma_orders (id BIGSERIAL PRIMARY KEY, bot_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT, intent TEXT, dedication TEXT, tier TEXT, stars INT, status TEXT NOT NULL DEFAULT 'DRAFT', charge_id TEXT UNIQUE, khatma_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ)`,
        `CREATE TABLE IF NOT EXISTS khatma_sponsors (code TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT, contact TEXT, price NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT', paid_via TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
        // Sponsor slots are shared by products (khatma, contest); each product has its own queue.
        `ALTER TABLE khatma_sponsors ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'khatma'`,
        `ALTER TABLE khatma_sponsors ADD COLUMN IF NOT EXISTS prize TEXT`,
      ];
      for (const q of ddl) await prisma.$executeRawUnsafe(q);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

type KhatmaRow = { id: bigint; bot_id: string; chat_id: string | null; kind: string; title: string; dedication: string | null; slug: string | null; bot_username: string | null; round: number; completed_rounds: number; message_id: bigint | null; featured_until: Date | null; status: string; created_at: Date };

async function khatmaById(id: string | number | bigint): Promise<KhatmaRow | null> {
  const r = await prisma.$queryRaw<KhatmaRow[]>`SELECT * FROM khatma WHERE id = ${BigInt(id)}`;
  return r[0] || null;
}
async function boardOf(k: KhatmaRow): Promise<JuzState[]> {
  const rows = await prisma.$queryRaw<{ juz: number; user_id: string | null; user_name: string | null; done: boolean }[]>`
    SELECT juz, user_id, user_name, done FROM khatma_juz WHERE khatma_id = ${k.id} AND round = ${k.round}`;
  const b = emptyBoard();
  for (const r of rows) b[r.juz - 1] = { juz: r.juz, userId: r.user_id, userName: r.user_name, done: r.done };
  return b;
}

/** The single active Ramadan sponsor line, if any. */
export async function activeSponsor(product: SponsorProduct = "khatma"): Promise<string | null> {
  const r = await activeSponsorRow(product);
  return r ? sponsorLine(r.name, r.url) + (r.prize ? ` · 🎁 ${r.prize}` : "") : null;
}
export async function activeSponsorRow(product: SponsorProduct = "khatma"): Promise<{ name: string; url: string | null; prize: string | null; ends_at: Date } | null> {
  await ensureKhatmaTables();
  const r = await prisma.$queryRaw<{ name: string; url: string | null; prize: string | null; ends_at: Date }[]>`SELECT name, url, prize, ends_at FROM khatma_sponsors WHERE product = ${product} AND status = 'ACTIVE' AND starts_at <= now() AND ends_at > now() ORDER BY starts_at LIMIT 1`;
  return r[0] || null;
}

const displayName = (from: any) => cleanText([from?.first_name, from?.last_name].filter(Boolean).join(" ") || (from?.username ? `@${from.username}` : "مشارك"), 24);

async function renderBoard(bot: TelegramBot, k: KhatmaRow, chatId: number | string, messageId?: number) {
  const board = await boardOf(k);
  const sponsor = await activeSponsor().catch(() => null);
  const text = boardText({ title: k.title, dedication: k.dedication, round: k.round, completedRounds: k.completed_rounds, board, sponsor });
  const inline_keyboard = boardKeyboard(String(k.id), k.round, board);
  if (messageId) {
    await bot.api.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard } }).catch(() => null);
    return messageId;
  }
  const m = await bot.api.sendMessage(chatId, text, { reply_markup: { inline_keyboard } });
  return m.message_id;
}

async function botUsername(bot: TelegramBot): Promise<string> {
  const me = await bot.api.getMe().catch(() => null);
  return me?.username || "";
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
/** Handles every non-private update for STREAK_BOT. Returns true when it was a khatma action. */
export async function handleKhatmaGroupUpdate(bot: TelegramBot, botRow: BotRow, update: any): Promise<boolean> {
  if (update.callback_query) {
    const data = String(update.callback_query.data || "");
    if (data.startsWith("kn|")) return handleKhatmaNextCallback(bot, botRow, update.callback_query);
    return handleKhatmaCallback(bot, botRow, update.callback_query);
  }
  const msg = update.message;
  if (!msg?.chat || !msg.from || (msg.chat.type !== "group" && msg.chat.type !== "supergroup")) return false;
  const text = String(msg.text || "").trim();
  const startGroup = /^\/start(@[A-Za-z0-9_]+)?\s+khatma\b/i.test(text);
  const m = KHATMA_CMD.exec(text);
  if (!m && !startGroup) return false;
  await ensureKhatmaTables();
  const chatId = String(msg.chat.id);
  const existing = (await prisma.$queryRaw<KhatmaRow[]>`SELECT * FROM khatma WHERE bot_id = ${botRow.id} AND chat_id = ${chatId} AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`)[0];
  const arg = m?.[4] ? cleanText(m[4], TITLE_MAX) : "";
  if (existing && arg !== "جديدة" && arg !== "new") {
    // Re-post the live board at the bottom of the chat so people can find it.
    const id = await renderBoard(bot, existing, msg.chat.id);
    await prisma.$executeRaw`UPDATE khatma SET message_id = ${id} WHERE id = ${existing.id}`;
    return true;
  }
  if (existing) {
    const member = await bot.api.getChatMember(msg.chat.id, msg.from.id).catch(() => null);
    if (!member || !["creator", "administrator"].includes(member.status)) {
      await bot.api.sendMessage(msg.chat.id, "بدء ختمة جديدة مكان الحالية لمشرفي المجموعة فقط.", { reply_to_message_id: msg.message_id }).catch(() => null);
      return true;
    }
    await prisma.$executeRaw`UPDATE khatma SET status = 'CLOSED' WHERE id = ${existing.id}`;
  }
  const title = arg && arg !== "جديدة" && arg !== "new" ? arg : `ختمة ${cleanText(msg.chat.title || "المجموعة", 40)}`;
  const created = await prisma.$queryRaw<KhatmaRow[]>`
    INSERT INTO khatma (bot_id, chat_id, kind, title, creator_id, bot_username) VALUES (${botRow.id}, ${chatId}, 'GROUP', ${title}, ${String(msg.from.id)}, ${await botUsername(bot)}) RETURNING *`;
  const k = created[0];
  const id = await renderBoard(bot, k, msg.chat.id);
  await prisma.$executeRaw`UPDATE khatma SET message_id = ${id} WHERE id = ${k.id}`;
  return true;
}

async function handleKhatmaCallback(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const p = parseJuzCallback(String(cq.data || ""));
  if (!p) return false;
  await ensureKhatmaTables();
  const answer = (text: string, alert = false) => bot.api.answerCallbackQuery(cq.id, { text, show_alert: alert }).catch(() => null);
  const k = await khatmaById(p.khatmaId);
  if (!k || k.bot_id !== botRow.id || k.status !== "ACTIVE") { await answer("هذه الختمة مغلقة."); return true; }
  if (k.round !== p.round) { await answer("هذه لوحة ختمة سابقة. استخدم أحدث لوحة."); return true; }
  // A group board only works in its own group; a memorial board works in any private chat.
  const chat = cq.message?.chat;
  if (k.kind === "GROUP" && String(chat?.id) !== k.chat_id) { await answer("لوحة غير صالحة هنا."); return true; }
  const uid = String(cq.from.id);
  const board = await boardOf(k);
  const t = tap(board, p.juz, uid);
  const name = displayName(cq.from);
  if (t.kind === "busy") { await answer(`الجزء ${arNum(p.juz)} مع ${t.by}`); return true; }
  if (t.kind === "limit") { await answer(`معك ${arNum(MAX_OPEN_PER_USER)} أجزاء لم تكتمل. أنهِ واحداً أولاً.`, true); return true; }
  if (t.kind === "take") {
    const n = await prisma.$executeRaw`INSERT INTO khatma_juz (khatma_id, round, juz, user_id, user_name, taken_at) VALUES (${k.id}, ${k.round}, ${p.juz}, ${uid}, ${name}, now()) ON CONFLICT DO NOTHING`;
    await answer(n === 1 ? `الجزء ${arNum(p.juz)} لك. اضغطه مرة أخرى حين تنتهي منه.` : "سبقك أحدهم لهذا الجزء.");
  } else if (t.kind === "done") {
    await prisma.$executeRaw`UPDATE khatma_juz SET done = true, done_at = now() WHERE khatma_id = ${k.id} AND round = ${k.round} AND juz = ${p.juz} AND user_id = ${uid}`;
    await answer(`تقبّل الله. سُجّل الجزء ${arNum(p.juz)} مقروءاً ✅`);
  } else {
    await prisma.$executeRaw`UPDATE khatma_juz SET done = false, done_at = NULL WHERE khatma_id = ${k.id} AND round = ${k.round} AND juz = ${p.juz} AND user_id = ${uid}`;
    await answer(`أعدنا الجزء ${arNum(p.juz)} إلى «قيد القراءة».`);
  }
  const after = await boardOf(k);
  if (isComplete(after)) {
    // Only one tap may close a round, even if two land at the same moment.
    const moved = await prisma.$executeRaw`UPDATE khatma SET round = round + 1, completed_rounds = completed_rounds + 1 WHERE id = ${k.id} AND round = ${k.round}`;
    if (moved === 1) {
      const readers = new Set(after.map((j) => j.userId)).size;
      const sponsor = await activeSponsor().catch(() => null);
      const target = chat?.id ?? k.chat_id;
      if (k.kind === "GROUP" && target) {
        await bot.api.sendMessage(target, completionText({ title: k.title, dedication: k.dedication, round: k.round, readers, sponsor }), {
          reply_markup: { inline_keyboard: [[{ text: "📖 ابدأ الختمة التالية", callback_data: `kn|${k.id}` }]] },
        }).catch(() => null);
      } else if (k.kind === "MEMORIAL") {
        // Every reader of this round hears that the khatma they joined is complete (they opted in by taking a juz).
        for (const u of new Set(after.map((j) => j.userId).filter(Boolean) as string[])) {
          await bot.api.sendMessage(Number(u), completionText({ title: k.title, dedication: k.dedication, round: k.round, readers, sponsor })).catch(() => null);
        }
      }
    }
    const fresh = await khatmaById(k.id);
    if (fresh && chat?.id && cq.message?.message_id) await renderBoard(bot, fresh, chat.id, cq.message.message_id);
    return true;
  }
  if (chat?.id && cq.message?.message_id) await renderBoard(bot, k, chat.id, cq.message.message_id);
  return true;
}

/** "Start the next round" button under a group completion message: re-posts the fresh board. */
export async function handleKhatmaNextCallback(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const m = /^kn\|(\d{1,12})$/.exec(String(cq.data || ""));
  if (!m) return false;
  await ensureKhatmaTables();
  const k = await khatmaById(m[1]);
  if (!k || k.bot_id !== botRow.id || k.status !== "ACTIVE" || String(cq.message?.chat?.id) !== k.chat_id) {
    await bot.api.answerCallbackQuery(cq.id, { text: "غير متاح" }).catch(() => null);
    return true;
  }
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
  const id = await renderBoard(bot, k, cq.message.chat.id);
  await prisma.$executeRaw`UPDATE khatma SET message_id = ${id} WHERE id = ${k.id}`;
  return true;
}

// ---------------------------------------------------------------------------
// Private chat: menu, memorial khatma purchase, joining a memorial khatma
// ---------------------------------------------------------------------------
export type KhatmaPending = { mode: "khatma_name" } | { mode: "khatma_dedication"; orderId: string };

export async function sendKhatmaIntro(bot: TelegramBot, chatId: number) {
  const u = await botUsername(bot);
  await bot.api.sendMessage(chatId,
    "📖 ختمة جماعية في مجموعتك\n\n" +
    "1) اضغط «أضف البوت إلى مجموعة» بالأسفل واختر مجموعة العائلة أو الأصدقاء أو المسجد، فتظهر لوحة الختمة فيها تلقائياً.\n" +
    `2) لعرض اللوحة لاحقاً أو بعنوان خاص اكتب في المجموعة: /khatma@${u} ختمة رمضان\n` +
    "3) كل شخص يضغط رقم جزء ليأخذه، ثم يضغطه حين ينتهي. عند اكتمال 30 جزءاً تصل رسالة الختم والدعاء، وتبدأ الختمة التالية بضغطة.\n\n" +
    "مجاناً بالكامل.",
    { reply_markup: { inline_keyboard: [[{ text: "➕ أضف البوت إلى مجموعة", url: `https://t.me/${u}?startgroup=khatma` }], [{ text: "🕊 ختمة صدقة جارية لمن تحب", callback_data: "km_new" }]] } });
}

export async function startMemorialOrder(bot: TelegramBot, chatId: number, setPending: (p: KhatmaPending | null) => Promise<void>) {
  await setPending({ mode: "khatma_name" });
  await bot.api.sendMessage(chatId,
    "🕊 ختمة صدقة جارية\n\nختمة لا تتوقف: كلما اكتملت 30 جزءاً بدأت التالية، ولها صفحة تذكارية برابط ترسله للأهل والأصدقاء ليشاركوا بالقراءة.\n\n" +
    `اكتب الاسم الذي تُهدى له الختمة (حتى ${arNum(NAME_MAX)} حرفاً):`);
}

async function draftOrder(botId: string, userId: string, name: string) {
  await ensureKhatmaTables();
  const r = await prisma.$queryRaw<{ id: bigint }[]>`INSERT INTO khatma_orders (bot_id, user_id, name) VALUES (${botId}, ${userId}, ${name}) RETURNING id`;
  return String(r[0].id);
}

/** Consumes the pending text step. Returns true when the message belonged to the memorial flow. */
export async function consumeKhatmaText(bot: TelegramBot, botRow: BotRow, chatId: number, userId: string, text: string, pending: KhatmaPending, setPending: (p: KhatmaPending | null) => Promise<void>): Promise<boolean> {
  if (pending.mode === "khatma_name") {
    const name = cleanText(text, NAME_MAX);
    if (name.length < 2) { await bot.api.sendMessage(chatId, "اكتب اسماً صحيحاً."); return true; }
    const orderId = await draftOrder(botRow.id, userId, name);
    await setPending(null);
    await bot.api.sendMessage(chatId, `النية للختمة عن «${name}»:`, {
      reply_markup: { inline_keyboard: [INTENTS.map((i) => ({ text: i.label, callback_data: `ki|${orderId}|${i.id}` }))] },
    });
    return true;
  }
  if (pending.mode === "khatma_dedication") {
    const ded = text === "⏭" || text === "تخطي" ? "" : cleanText(text, DEDICATION_MAX);
    await prisma.$executeRaw`UPDATE khatma_orders SET dedication = ${ded || null} WHERE id = ${BigInt(pending.orderId)} AND user_id = ${userId} AND status = 'DRAFT'`;
    await setPending(null);
    await sendTierChoice(bot, chatId, pending.orderId);
    return true;
  }
  return false;
}

async function sendTierChoice(bot: TelegramBot, chatId: number, orderId: string) {
  await bot.api.sendMessage(chatId, "اختر الباقة (تُدفع مرة واحدة بنجوم تيليجرام):", {
    reply_markup: { inline_keyboard: MEMORIAL_TIERS.map((t) => [{ text: `${t.stars} ⭐ · ${t.label}`, callback_data: `kt|${orderId}|${t.id}` }]) },
  });
}

/** Private-chat callbacks: km_new, ki| (intent), kt| (tier → invoice), kj| (memorial board), kn|. */
export async function handleKhatmaPrivateCallback(bot: TelegramBot, botRow: BotRow, cq: any, setPending: (p: KhatmaPending | null) => Promise<void>): Promise<boolean> {
  const data = String(cq.data || "");
  const chatId = cq.message?.chat?.id;
  const uid = String(cq.from?.id || "");
  if (data.startsWith("kj|")) return handleKhatmaCallback(bot, botRow, cq);
  if (data === "km_new") {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    if (chatId) await startMemorialOrder(bot, chatId, setPending);
    return true;
  }
  let m = /^ki\|(\d{1,12})\|(ruh|shifa|niyya)$/.exec(data);
  if (m) {
    await ensureKhatmaTables();
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    const n = await prisma.$executeRaw`UPDATE khatma_orders SET intent = ${m[2]} WHERE id = ${BigInt(m[1])} AND user_id = ${uid} AND status = 'DRAFT'`;
    if (n === 1 && chatId) {
      await setPending({ mode: "khatma_dedication", orderId: m[1] });
      await bot.api.sendMessage(chatId, `اكتب دعاءً أو كلمة تظهر في الصفحة ورسالة الختم (حتى ${arNum(DEDICATION_MAX)} حرف)، أو أرسل «تخطي»:`);
    }
    return true;
  }
  m = /^kt\|(\d{1,12})\|(basic|featured)$/.exec(data);
  if (m) {
    await ensureKhatmaTables();
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    const tier = tierById(m[2])!;
    const n = await prisma.$executeRaw`UPDATE khatma_orders SET tier = ${tier.id}, stars = ${tier.stars}, status = 'PENDING' WHERE id = ${BigInt(m[1])} AND user_id = ${uid} AND status IN ('DRAFT','PENDING')`;
    if (n === 1 && chatId) {
      const o = (await prisma.$queryRaw<{ name: string; intent: string | null }[]>`SELECT name, intent FROM khatma_orders WHERE id = ${BigInt(m[1])}`)[0];
      await bot.api.sendInvoice(chatId, "ختمة صدقة جارية", `${memorialTitle(o?.name || "", o?.intent || "ruh")} · ${tier.label}`.slice(0, 255), `${STARS_KIND}${m[1]}`, "XTR", [{ label: "ختمة", amount: tier.stars }]).catch(() => null);
    }
    return true;
  }
  if (data.startsWith("kn|")) return handleKhatmaNextCallback(bot, botRow, cq);
  return false;
}

/** pre_checkout for KHATMA:<orderId>: only a pending order of this payer, at its full price. */
export async function khatmaPreCheckout(botRow: BotRow, pcq: any): Promise<{ ok: boolean; message?: string }> {
  const payload = String(pcq.invoice_payload || "");
  if (!payload.startsWith(STARS_KIND) || pcq.currency !== "XTR") return { ok: false, message: "طلب غير معروف" };
  await ensureKhatmaTables();
  const id = payload.slice(STARS_KIND.length);
  if (!/^\d{1,12}$/.test(id)) return { ok: false, message: "طلب غير معروف" };
  const o = (await prisma.$queryRaw<{ user_id: string; stars: number | null; status: string; bot_id: string }[]>`SELECT user_id, stars, status, bot_id FROM khatma_orders WHERE id = ${BigInt(id)}`)[0];
  if (!o || o.bot_id !== botRow.id || o.status !== "PENDING" || o.user_id !== String(pcq.from?.id) || Number(pcq.total_amount) < Number(o.stars || 0)) return { ok: false, message: "الطلب غير متاح للدفع." };
  return { ok: true };
}

/** successful_payment for KHATMA:<orderId>. Idempotent on the Telegram charge id. */
export async function handleKhatmaPayment(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const sp = msg?.successful_payment;
  const payload = String(sp?.invoice_payload || "");
  if (!sp || !payload.startsWith(STARS_KIND)) return false;
  await ensureKhatmaTables();
  const id = payload.slice(STARS_KIND.length);
  if (!/^\d{1,12}$/.test(id) || sp.currency !== "XTR") return true;
  const charge = String(sp.telegram_payment_charge_id || "");
  const n = await prisma.$executeRaw`UPDATE khatma_orders SET status = 'PAID', charge_id = ${charge}, paid_at = now() WHERE id = ${BigInt(id)} AND status = 'PENDING' AND bot_id = ${botRow.id}`;
  if (n !== 1) return true; // duplicate delivery or unknown order
  const o = (await prisma.$queryRaw<{ user_id: string; name: string; intent: string | null; dedication: string | null; tier: string }[]>`SELECT user_id, name, intent, dedication, tier FROM khatma_orders WHERE id = ${BigInt(id)}`)[0];
  const tier = tierById(o.tier) || MEMORIAL_TIERS[0];
  const slug = makeSlug(crypto.randomBytes(8));
  const featured = tier.featuredDays ? new Date(Date.now() + tier.featuredDays * 86400_000) : null;
  const k = (await prisma.$queryRaw<KhatmaRow[]>`
    INSERT INTO khatma (bot_id, kind, title, dedication, slug, bot_username, creator_id, featured_until)
    VALUES (${botRow.id}, 'MEMORIAL', ${memorialTitle(o.name, o.intent || "ruh")}, ${o.dedication}, ${slug}, ${await botUsername(bot)}, ${o.user_id}, ${featured}) RETURNING *`)[0];
  await prisma.$executeRaw`UPDATE khatma_orders SET khatma_id = ${k.id}, status = 'DONE' WHERE id = ${BigInt(id)}`;
  const page = `${SITE_URL}/khatma/${slug}`;
  const join = `https://t.me/${k.bot_username}?start=${MEMORIAL_START_PREFIX}${slug}`;
  await bot.api.sendMessage(msg.chat.id,
    `✅ تقبّل الله. فُتحت «${k.title}».\n\n🔗 الصفحة التذكارية:\n${page}\n\n📲 رابط المشاركة بالقراءة (أرسله للأهل والأصدقاء):\n${join}\n\nأنت أيضاً تستطيع أخذ جزء من اللوحة بالأسفل.`,
    { reply_markup: { inline_keyboard: [[{ text: "📤 أرسل الرابط", url: `https://t.me/share/url?url=${encodeURIComponent(join)}&text=${encodeURIComponent(`شاركنا بجزء في ${k.title}`)}` }]] } }).catch(() => null);
  await renderBoard(bot, k, msg.chat.id).catch(() => null);
  const admin = process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (admin) await bot.api.sendMessage(Number(admin), `🕊 ختمة مدفوعة: ${k.title} · ${sp.total_amount}⭐ · ${page}`).catch(() => null);
  return true;
}

/** /start k_<slug>: opens a memorial khatma's board in private chat. */
export async function openMemorialFromStart(bot: TelegramBot, botRow: BotRow, chatId: number, payload: string): Promise<boolean> {
  if (!payload.startsWith(MEMORIAL_START_PREFIX)) return false;
  const slug = payload.slice(MEMORIAL_START_PREFIX.length);
  if (!isSlug(slug)) return false;
  await ensureKhatmaTables();
  const k = (await prisma.$queryRaw<KhatmaRow[]>`SELECT * FROM khatma WHERE slug = ${slug} AND bot_id = ${botRow.id} AND status = 'ACTIVE'`)[0];
  if (!k) { await bot.api.sendMessage(chatId, "هذه الختمة غير متاحة."); return true; }
  await renderBoard(bot, k, chatId);
  return true;
}

// ---------------------------------------------------------------------------
// Public pages + sponsorship
// ---------------------------------------------------------------------------
export async function memorialPage(slug: string) {
  if (!isSlug(slug)) return null;
  await ensureKhatmaTables();
  const k = (await prisma.$queryRaw<KhatmaRow[]>`SELECT * FROM khatma WHERE slug = ${slug} AND kind = 'MEMORIAL'`)[0];
  if (!k) return null;
  const board = await boardOf(k);
  const total = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM khatma_juz WHERE khatma_id = ${k.id} AND done`;
  return {
    title: k.title, dedication: k.dedication, round: k.round, completedRounds: k.completed_rounds, createdAt: k.created_at.toISOString(),
    juzRead: Number(total[0]?.n || 0), board: board.map((j) => ({ juz: j.juz, state: j.done ? "done" : j.userId ? "taken" : "free" })),
    joinUrl: k.bot_username ? `https://t.me/${k.bot_username}?start=${MEMORIAL_START_PREFIX}${slug}` : "", sponsor: await activeSponsor().catch(() => null),
  };
}

export async function openMemorials() {
  await ensureKhatmaTables();
  const r = await prisma.$queryRaw<{ slug: string; title: string; completed_rounds: number; round: number; id: bigint }[]>`
    SELECT slug, title, completed_rounds, round, id FROM khatma WHERE kind = 'MEMORIAL' AND status = 'ACTIVE' AND featured_until > now() ORDER BY created_at DESC LIMIT 30`;
  return r.map((x) => ({ slug: x.slug, title: x.title, completedRounds: x.completed_rounds, round: x.round }));
}

export async function khatmaStats() {
  await ensureKhatmaTables();
  const r = await prisma.$queryRaw<{ groups: bigint; memorials: bigint; rounds: bigint; juz: bigint; stars: bigint }[]>`
    SELECT (SELECT count(*) FROM khatma WHERE kind='GROUP') groups, (SELECT count(*) FROM khatma WHERE kind='MEMORIAL') memorials,
      (SELECT COALESCE(sum(completed_rounds),0) FROM khatma) rounds, (SELECT count(*) FROM khatma_juz WHERE done) juz,
      (SELECT COALESCE(sum(stars),0) FROM khatma_orders WHERE status IN ('PAID','DONE')) stars`;
  const x = r[0];
  return { groups: Number(x.groups), memorials: Number(x.memorials), rounds: Number(x.rounds), juzRead: Number(x.juz), starsPaid: Number(x.stars) };
}

export const SPONSOR_PREFIX = "KSP-";
export type SponsorProduct = "khatma" | "contest";
/** Price and slot length per product. */
export const SPONSOR_PRODUCTS: Record<SponsorProduct, { price: number; days: number; title: string; what: string; page: string }> = {
  khatma: { price: SPONSOR_PRICE_USD, days: SPONSOR_DAYS, title: "رعاية الختمات", what: "سطر «برعاية …» في رسائل ختم القرآن وصفحات الختمات", page: "/khatma" },
  contest: { price: 15, days: 7, title: "رعاية مسابقات الجروبات", what: "اسمك وجائزتك في كل جولة ولوحة الصدارة الأسبوعية لمسابقات الجروبات", page: "/contests" },
};
const isProduct = (p: unknown): p is SponsorProduct => p === "khatma" || p === "contest";
const contactOk = (s: string) => /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s.trim());

export async function createSponsorOrder(input: { name: string; url: string; contact: string; product?: string; prize?: string }) {
  await ensureKhatmaTables();
  const product: SponsorProduct = isProduct(input.product) ? input.product : "khatma";
  const conf = SPONSOR_PRODUCTS[product];
  const prize = product === "contest" ? cleanText(input.prize || "", 80) : "";
  if (product === "contest" && prize.length < 3) return { ok: false as const, error: "اكتب الجائزة التي تموّلها (مثال: 20$ USDT للاعب الأول)." };
  const name = cleanText(input.name, 60);
  if (name.length < 2) return { ok: false as const, error: "اكتب اسم الجهة الراعية." };
  const url = String(input.url || "").trim();
  if (url && !/^https:\/\/[^\s<>"]{3,200}$/i.test(url)) return { ok: false as const, error: "الرابط يجب أن يبدأ بـ https://" };
  if (!contactOk(input.contact)) return { ok: false as const, error: "اكتب معرّفك على تيليجرام (@username)." };
  const code = `${SPONSOR_PREFIX}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  await prisma.$executeRaw`INSERT INTO khatma_sponsors (code, name, url, contact, price, product, prize) VALUES (${code}, ${name}, ${url || null}, ${input.contact.trim().replace(/^@?/, "@")}, ${conf.price}, ${product}, ${prize || null})`;
  return { ok: true as const, code, price: conf.price };
}

export async function sponsorByCode(code: string) {
  if (!/^KSP-[0-9A-F]{8}$/.test(code)) return null;
  await ensureKhatmaTables();
  const r = await prisma.$queryRaw<{ code: string; name: string; url: string | null; price: unknown; status: string; starts_at: Date | null; ends_at: Date | null; product: string }[]>`SELECT code, name, url, price, status, starts_at, ends_at, product FROM khatma_sponsors WHERE code = ${code}`;
  return r[0] ? { ...r[0], price: Number(r[0].price), product: (isProduct(r[0].product) ? r[0].product : "khatma") as SponsorProduct } : null;
}

/** Paid → queued right after the last booked slot, so sponsors never overlap. Idempotent. */
export async function markSponsorPaid(code: string, via: string, amountUsd?: number): Promise<{ ok: boolean; first: boolean }> {
  const s = await sponsorByCode(code);
  if (!s) return { ok: false, first: false };
  if (amountUsd != null && Number.isFinite(amountUsd) && amountUsd + 0.01 < s.price) return { ok: false, first: false };
  const days = SPONSOR_PRODUCTS[s.product].days;
  const n = await prisma.$executeRaw`
    UPDATE khatma_sponsors SET status = 'ACTIVE', paid_via = ${via.slice(0, 120)},
      starts_at = GREATEST(now(), COALESCE((SELECT max(ends_at) FROM khatma_sponsors WHERE status = 'ACTIVE' AND product = ${s.product}), now())),
      ends_at = GREATEST(now(), COALESCE((SELECT max(ends_at) FROM khatma_sponsors WHERE status = 'ACTIVE' AND product = ${s.product}), now())) + make_interval(days => ${days})
    WHERE code = ${code} AND status = 'PENDING_PAYMENT'`;
  return { ok: true, first: n === 1 };
}

export async function adminSponsors() {
  await ensureKhatmaTables();
  const r = await prisma.$queryRaw<any[]>`SELECT code, name, url, contact, price, status, paid_via, starts_at, ends_at, created_at, product, prize FROM khatma_sponsors ORDER BY created_at DESC LIMIT 100`;
  return r.map((x) => ({ ...x, price: Number(x.price) }));
}
export async function adminSponsorAction(code: string, action: "confirm_paid" | "stop") {
  if (action === "confirm_paid") return markSponsorPaid(code, "USDT (تأكيد الأدمن)");
  const n = await prisma.$executeRaw`UPDATE khatma_sponsors SET status = 'STOPPED', ends_at = LEAST(COALESCE(ends_at, now()), now()) WHERE code = ${code}`;
  return { ok: n === 1, first: false };
}

export const SPONSOR_STARS_PREFIX = "KSP:";
const apiSite = () => (process.env.NEXT_PUBLIC_SITE_URL || gateUrl()).replace(/\/$/, "");

/** Pay a sponsorship slot on the existing rails: Stars (Admen bot invoice link), NOWPayments, or manual USDT. */
export async function paySponsor(code: string, method: "stars" | "nowpayments" | "usdt") {
  const s = await sponsorByCode(code);
  if (!s) return { ok: false as const, error: "الكود غير موجود." };
  if (s.status !== "PENDING_PAYMENT") return { ok: false as const, error: "هذا الطلب مدفوع أو مغلق." };
  if (method === "usdt") return { ok: true as const, manual: true, amount: s.price, usdt: process.env.USDT_ADDRESS || "", network: process.env.USDT_NETWORK || "TRC20", note: `حوّل المبلغ واكتب الكود ${code} في ملاحظة التحويل. يؤكده الأدمن يدوياً.` };
  if (method === "stars") {
    if (!siteAdStarsEnabled()) return { ok: false as const, error: "الدفع بالنجوم غير مفعّل بعد." };
    const bot = await findAdmenBot();
    if (!bot) return { ok: false as const, error: "بوت الدفع غير متاح." };
    await bindAdmenBot().catch(() => null);
    const res = await fetch(`https://api.telegram.org/bot${bot.token}/createInvoiceLink`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: SPONSOR_PRODUCTS[s.product].title, description: `${SPONSOR_PRODUCTS[s.product].what} لمدة ${SPONSOR_PRODUCTS[s.product].days} أيام: ${s.name} (${code})`.slice(0, 255), payload: `${SPONSOR_STARS_PREFIX}${code}`, currency: "XTR", prices: [{ label: code, amount: adStars(s.price) }] }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!data?.ok || !data.result) return { ok: false as const, error: "تعذّر إنشاء فاتورة النجوم." };
    return { ok: true as const, invoiceUrl: String(data.result) };
  }
  if (!isNowPaymentsConfigured()) return { ok: false as const, error: "فاتورة العملات غير مفعّلة. اختر USDT أو النجوم." };
  const r = await createInvoice({ priceAmount: s.price, orderId: code, orderDescription: `Sham AI ${s.product} sponsorship ${code}`, ipnCallbackUrl: `${apiSite()}/api/ads/ipn`, successUrl: `${SITE_URL}${SPONSOR_PRODUCTS[s.product].page}?sponsor=${code}`, cancelUrl: `${SITE_URL}${SPONSOR_PRODUCTS[s.product].page}` });
  return r.ok ? { ok: true as const, invoiceUrl: r.invoiceUrl } : { ok: false as const, error: r.error || "تعذّر إنشاء الفاتورة" };
}

export { JUZ_COUNT };

let cachedUsername: { v: string; at: number } | null = null;
/** @username of the live STREAK_BOT (the khatma bot), for links on the public pages. */
export async function khatmaBotUsername(): Promise<string> {
  if (cachedUsername && Date.now() - cachedUsername.at < 3600_000) return cachedUsername.v;
  const row = await prisma.bot.findFirst({ where: { template: "STREAK_BOT", isActive: true }, orderBy: { created_at: "asc" }, select: { token: true } }).catch(() => null);
  if (!row) return "";
  const r = await fetch(`https://api.telegram.org/bot${row.token}/getMe`, { signal: AbortSignal.timeout(5000) }).then((x) => x.json()).catch(() => null);
  const v = String(r?.result?.username || "");
  if (v) cachedUsername = { v, at: Date.now() };
  return v;
}
