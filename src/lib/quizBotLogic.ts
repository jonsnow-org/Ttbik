import { Bot as TelegramBot, Keyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit, countBotVisitors } from "@/lib/botVisit";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";
import { earnPoints } from "@/lib/platformPoints";

/**
 * QUIZ_BOT template (docs/claude-feature-backlog.md item 4) — static
 * personality quizzes. Every quiz is a fixed list of multiple-choice
 * questions defined in QUIZ_DEFINITIONS below; each option adds a point
 * to one result category, and whichever category has the most points at
 * the end wins (ties broken by the category's position in `results`).
 * No AI, no randomness, no user-generated content to moderate.
 *
 * A brand-new, fully isolated template: no shared tables, no shared logic
 * files, no shared payment routes with any other bot on the platform.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const HISTORY_PAGE_SIZE = 5;

// ---------------------------------------------------------------------
// Quiz definitions — static question banks
// ---------------------------------------------------------------------
type QuizOption = { label: string; result: string };
type QuizQuestion = { text: string; options: QuizOption[] };
type QuizResultInfo = { emoji: string; title: string; description: string };
type QuizDefinition = {
  id: string;
  title: string;
  menuLabel: string;
  intro: string;
  questions: QuizQuestion[];
  results: Record<string, QuizResultInfo>;
};

const QUIZ_DEFINITIONS: QuizDefinition[] = [
  {
    id: "personality_type",
    title: "ما نوع شخصيتك؟",
    menuLabel: "🧠 اختبار: ما نوع شخصيتك؟",
    intro: "أجب عن 5 أسئلة بسيطة واكتشف نوع شخصيتك!",
    questions: [
      {
        text: "في نزهة مع الأصدقاء، أنت عادة من:",
        options: [
          { label: "أ) يخطط للبرنامج بالكامل", result: "leader" },
          { label: "ب) يقترح أفكاراً غريبة وممتعة", result: "creative" },
          { label: "ج) يهتم بأن يكون الجميع مرتاحاً", result: "social" },
          { label: "د) يلاحظ التفاصيل التي يفوتها الآخرون", result: "analyst" },
        ],
      },
      {
        text: "عند مواجهة مشكلة صعبة، ماذا تفعل أولاً؟",
        options: [
          { label: "أ) أتخذ قراراً سريعاً وأتحرك", result: "leader" },
          { label: "ب) أبحث عن حل غير تقليدي", result: "creative" },
          { label: "ج) أستشير من حولي", result: "social" },
          { label: "د) أجمع كل المعلومات أولاً", result: "analyst" },
        ],
      },
      {
        text: "أصدقاؤك يصفونك بأنك:",
        options: [
          { label: "أ) حاسم وواثق", result: "leader" },
          { label: "ب) مبدع وخارج الصندوق", result: "creative" },
          { label: "ج) دافئ ومتعاطف", result: "social" },
          { label: "د) منطقي ودقيق", result: "analyst" },
        ],
      },
      {
        text: "في العمل الجماعي تفضل أن تكون:",
        options: [
          { label: "أ) قائد الفريق", result: "leader" },
          { label: "ب) صاحب الأفكار الجديدة", result: "creative" },
          { label: "ج) من يحافظ على الانسجام", result: "social" },
          { label: "د) من يراجع التفاصيل والجودة", result: "analyst" },
        ],
      },
      {
        text: "وقت فراغك المفضل هو:",
        options: [
          { label: "أ) تنظيم مشروع أو هدف جديد", result: "leader" },
          { label: "ب) الرسم أو الكتابة أو أي فن", result: "creative" },
          { label: "ج) قضاء الوقت مع الناس", result: "social" },
          { label: "د) القراءة أو حل الألغاز", result: "analyst" },
        ],
      },
    ],
    results: {
      leader: { emoji: "🦁", title: "القائد", description: "حاسم وواثق، تحب أن تقود وتتخذ القرار، ويعتمد عليك من حولك في الأوقات الصعبة." },
      creative: { emoji: "🎨", title: "المبدع", description: "عقلك دائماً يفكر خارج الصندوق، تحب الأفكار الجديدة وتكره الروتين." },
      social: { emoji: "🤝", title: "الاجتماعي", description: "دافئ ومتعاطف، تجيد بناء العلاقات وتجعل من حولك يشعرون بالراحة." },
      analyst: { emoji: "🔍", title: "المحلل", description: "دقيق ومنطقي، تحب فهم التفاصيل قبل اتخاذ أي قرار." },
    },
  },
  {
    id: "spirit_animal",
    title: "ما هو حيوانك المرشد؟",
    menuLabel: "🦉 اختبار: ما هو حيوانك المرشد؟",
    intro: "أجب عن 5 أسئلة واكتشف أي حيوان يمثل شخصيتك!",
    questions: [
      {
        text: "كيف تقضي مساءك المثالي؟",
        options: [
          { label: "أ) وحيداً في مكان هادئ أتأمل", result: "owl" },
          { label: "ب) في نشاط جسدي أو مغامرة", result: "fox" },
          { label: "ج) مع مجموعة كبيرة من الأصدقاء", result: "dolphin" },
          { label: "د) في مكان أشعر فيه بالسيطرة والهيبة", result: "lion" },
        ],
      },
      {
        text: "عند اتخاذ قرار مهم أنت:",
        options: [
          { label: "أ) تفكر بعمق وتحلل كل الاحتمالات", result: "owl" },
          { label: "ب) تجد طريقة ذكية وسريعة", result: "fox" },
          { label: "ج) تسأل من تثق بهم", result: "dolphin" },
          { label: "د) تعتمد على حدسك وثقتك بنفسك", result: "lion" },
        ],
      },
      {
        text: "ما الذي يصفك أكثر؟",
        options: [
          { label: "أ) حكيم وهادئ", result: "owl" },
          { label: "ب) ذكي ومرن", result: "fox" },
          { label: "ج) اجتماعي ومرح", result: "dolphin" },
          { label: "د) قوي وواثق", result: "lion" },
        ],
      },
      {
        text: "في مواجهة تحدٍ غير متوقع تميل إلى:",
        options: [
          { label: "أ) التفكير قبل التصرف", result: "owl" },
          { label: "ب) إيجاد حل بديل بسرعة", result: "fox" },
          { label: "ج) طلب المساعدة من الفريق", result: "dolphin" },
          { label: "د) مواجهته مباشرة بلا تردد", result: "lion" },
        ],
      },
      {
        text: "الناس يأتون إليك عادة من أجل:",
        options: [
          { label: "أ) نصيحة حكيمة", result: "owl" },
          { label: "ب) حل ذكي لمشكلة", result: "fox" },
          { label: "ج) الونس والدعم المعنوي", result: "dolphin" },
          { label: "د) الحماية والقيادة", result: "lion" },
        ],
      },
    ],
    results: {
      owl: { emoji: "🦉", title: "البومة", description: "حكيم وهادئ، تفضل التأمل والتفكير العميق قبل أي خطوة." },
      fox: { emoji: "🦊", title: "الثعلب", description: "ذكي وسريع البديهة، تجد دائماً طريقة مبتكرة للخروج من أي مأزق." },
      dolphin: { emoji: "🐬", title: "الدلفين", description: "اجتماعي ومرح، تحب التواصل مع الآخرين وتنشر الطاقة الإيجابية." },
      lion: { emoji: "🦁", title: "الأسد", description: "قوي وواثق من نفسك، تمتلك حضوراً يجعلك قائداً طبيعياً بين من حولك." },
    },
  },
];

function findQuiz(quizId: string): QuizDefinition | undefined {
  return QUIZ_DEFINITIONS.find((q) => q.id === quizId);
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type PendingAction =
  | { mode: "quiz_in_progress"; quizId: string; questionIndex: number; scores: Record<string, number> }
  | { mode: "admin_broadcast" }
  | { mode: "admin_lookup" }
  | { mode: "admin_channel" };

// ---------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------
function backLabel(): string {
  return "◀️ رجوع";
}
function isBack(text: string): boolean {
  return text === backLabel();
}
function mainMenu(): Keyboard {
  const kb = new Keyboard();
  for (const quiz of QUIZ_DEFINITIONS) kb.text(quiz.menuLabel).row();
  kb.text("📜 آخر نتائجي").text("ℹ️ معلومات");
  return kb.resized();
}
function plainBackMenu(): Keyboard {
  return new Keyboard().text(backLabel()).resized();
}
function adminMenu(): Keyboard {
  return new Keyboard()
    .text("📊 الإحصائيات").text("🔎 بحث عن مستخدم").row()
    .text("📡 قناة الاشتراك الإجباري").text("📢 بث جماعي")
    .resized();
}

// ---------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------
// upsert, not findUnique-then-create — same race-avoidance reasoning as
// every other ensureXUser in this codebase (two near-simultaneous first
// messages from the same new user must never both pass an existence check).
async function ensureQuizUser(botId: string, tgUserId: string) {
  return prisma.quizUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.quizUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}

// Deterministic winner of a completed quiz: highest score wins, ties
// broken by earliest position in the quiz's `results` map so the outcome
// never depends on object-key iteration order changing between runs.
function pickWinningResult(quiz: QuizDefinition, scores: Record<string, number>): string {
  const keys = Object.keys(quiz.results);
  let best = keys[0];
  let bestScore = scores[best] || 0;
  for (const key of keys.slice(1)) {
    const score = scores[key] || 0;
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return best;
}

function questionText(quiz: QuizDefinition, index: number): string {
  const q = quiz.questions[index];
  const options = q.options.map((o) => o.label).join("\n");
  return `سؤال ${index + 1} من ${quiz.questions.length}:\n\n${q.text}\n\n${options}\n\nأرسل حرف الإجابة (أ/ب/ج/د):`;
}

const ANSWER_LETTERS = ["أ", "ب", "ج", "د"];
function parseAnswerIndex(text: string): number | null {
  const clean = text.trim().replace(/[).\s]/g, "");
  const letter = clean[0];
  const idx = ANSWER_LETTERS.indexOf(letter);
  return idx === -1 ? null : idx;
}

function resultCardText(quiz: QuizDefinition, resultKey: string): string {
  const r = quiz.results[resultKey];
  return `${r.emoji} نتيجتك في اختبار «${quiz.title}»:\n\n${r.emoji} ${r.title}\n\n${r.description}\n\n🔁 جرّب اختباراً آخر أو شارك النتيجة مع أصدقائك!`;
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------
async function sendAdminStats(bot: TelegramBot, botRow: BotRow, chatId: number) {
  const notAdmin = { id: { not: SUPER_ADMIN_ID || "__none__" } };
  const [ownUsers, resultsCount, banned] = await Promise.all([
    prisma.quizUser.count({ where: { botId: botRow.id, ...notAdmin } }),
    prisma.quizResult.count({ where: { user: { botId: botRow.id } } }),
    prisma.quizUser.count({ where: { botId: botRow.id, isBanned: true } }),
  ]);
  const usersCount = await countBotVisitors(botRow.id, SUPER_ADMIN_ID, ownUsers);
  await bot.api.sendMessage(
    chatId,
    `📊 إحصائيات بوت الاختبارات\n\n👥 المستخدمون: ${usersCount}\n🚫 المحظورون: ${banned}\n🧠 الاختبارات المكتملة: ${resultsCount}`
  );
}

async function handleQuizAdmin(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) return false;

  const text = String(msg.text || "").trim();
  const adminUser = await ensureQuizUser(botRow.id, tgUserId);
  const pending = adminUser.pendingAction as PendingAction | null;

  if (text === "/start" || text.startsWith("/start ")) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت الاختبارات.", { reply_markup: adminMenu() });
    return true;
  }
  if (pending?.mode === "admin_broadcast" && text) {
    await setPending(tgUserId, null);
    const recipients = await prisma.quizUser.findMany({ where: { id: { not: SUPER_ADMIN_ID } }, select: { id: true } });
    const messageText = formatBroadcastText(text);
    let sent = 0;
    for (const r of recipients) {
      try {
        await bot.api.sendMessage(Number(r.id), messageText);
        sent++;
      } catch {}
    }
    await bot.api.sendMessage(chatId, `✅ تم الإرسال إلى ${sent} من أصل ${recipients.length}.`);
    return true;
  }
  if (pending?.mode === "admin_lookup" && text) {
    await setPending(tgUserId, null);
    const targetId = text.replace(/[^0-9]/g, "");
    const user = await prisma.quizUser.findUnique({ where: { id: targetId } });
    if (!user) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    const muted = user.mutedUntil && user.mutedUntil > new Date();
    await bot.api.sendMessage(
      chatId,
      `🆔 ${targetId}\n🧠 الاختبارات المكتملة: ${user.quizzesCompleted}\n🚫 محظور: ${user.isBanned ? "نعم" : "لا"}\n🔇 مكتوم: ${muted ? `نعم حتى ${user.mutedUntil!.toLocaleString("ar")}` : "لا"}\n\nلحظر/رفع الحظر أرسل: /ban ${targetId} أو /unban ${targetId}`
    );
    return true;
  }
  if (text.startsWith("/ban ") || text.startsWith("/unban ")) {
    const ban = text.startsWith("/ban ");
    const targetId = text.split(" ")[1]?.replace(/[^0-9]/g, "") || "";
    const target = await prisma.quizUser.findUnique({ where: { id: targetId } });
    if (!target) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    await prisma.quizUser.update({ where: { id: targetId }, data: { isBanned: ban } });
    await bot.api
      .sendMessage(Number(targetId), ban ? "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة." : "✅ تم رفع الحظر عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.")
      .catch(() => null);
    await bot.api.sendMessage(chatId, ban ? "⛔ تم الحظر." : "🔓 تم رفع الحظر.");
    return true;
  }
  if (text === "📊 الإحصائيات") {
    await sendAdminStats(bot, botRow, chatId);
    return true;
  }
  if (text === "🔎 بحث عن مستخدم") {
    await setPending(tgUserId, { mode: "admin_lookup" });
    await bot.api.sendMessage(chatId, "أرسل آيدي المستخدم:");
    return true;
  }
  if (text === "📡 قناة الاشتراك الإجباري") {
    await setPending(tgUserId, { mode: "admin_channel" });
    await bot.api.sendMessage(chatId, "أرسل معرّف القناة (@channel)، أو اضغط تخطّي لإلغاء الاشتراط الحالي:", { reply_markup: new Keyboard().text("⏭ تخطّي").resized() });
    return true;
  }
  if (pending?.mode === "admin_channel" && text) {
    await setPending(tgUserId, null);
    const skip = text === "⏭ تخطّي";
    await prisma.bot.update({ where: { id: botRow.id }, data: { requiredChannel: skip ? null : text.replace(/^@/, "") } });
    await bot.api.sendMessage(chatId, skip ? "✅ تم إلغاء اشتراط الاشتراك الإجباري." : `✅ تم تعيين قناة الاشتراك الإجباري: @${text.replace(/^@/, "")}`);
    return true;
  }
  if (text === "📢 بث جماعي") {
    await setPending(tgUserId, { mode: "admin_broadcast" });
    await bot.api.sendMessage(chatId, `✍️ اكتب رسالة البث الجماعي — ستُرسل لجميع مستخدمي البوت:\n\n${BROADCAST_COMPOSE_HINT}`);
    return true;
  }
  // anything else the owner sends used to get no reply at all
  await bot.api.sendMessage(chatId, "🛠 اختر من لوحة التحكم بالأسفل.", { reply_markup: adminMenu() });
  return true; // super admin's own chat never falls through to the regular flow below
}

// ---------------------------------------------------------------------
// Regular flow
// ---------------------------------------------------------------------
export async function handleQuizBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (await handleQuizAdmin(bot, botRow, msg)) return;

  const user = await ensureQuizUser(botRow.id, tgUserId);
  await prisma.quizUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.");
    return;
  }

  // Mandatory subscription channel gate (same pattern as AD_BOT/JOBS_BOT/CONFESSION_BOT/NAME_COMPAT_BOT).
  if (botRow.requiredChannel) {
    try {
      const member = await bot.api.getChatMember(`@${botRow.requiredChannel}`, Number(tgUserId));
      if (!["creator", "administrator", "member"].includes(member.status)) {
        await bot.api.sendMessage(chatId, `📡 يجب الاشتراك في القناة أولاً: @${botRow.requiredChannel}`);
        return;
      }
    } catch {
      // channel/bot admin misconfigured — fail open rather than lock everyone out
    }
  }

  const text = String(msg.text || "").trim();
  if (!text) return;

  if (isBack(text)) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
    return;
  }

  if (text === "/start" || text.startsWith("/start ")) {
    await recordBotVisit(botRow.id, tgUserId);
    await setPending(tgUserId, null);
    await bot.api.sendMessage(
      chatId,
      "👋 أهلاً بك في بوت الاختبارات الشخصية!\n\nاختر اختباراً من القائمة وأجب عن أسئلته البسيطة لتكتشف نتيجتك — بطاقة نتيجة جاهزة للمشاركة مع أصدقائك.",
      { reply_markup: mainMenu() }
    );
    return;
  }

  const pending = user.pendingAction as PendingAction | null;

  if (pending?.mode === "quiz_in_progress") {
    const quiz = findQuiz(pending.quizId);
    if (!quiz) {
      // Quiz definition disappeared/renamed since the user started — reset rather than crash.
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "حدث خطأ في الاختبار، حاول من جديد:", { reply_markup: mainMenu() });
      return;
    }
    const answerIdx = parseAnswerIndex(text);
    const question = quiz.questions[pending.questionIndex];
    if (answerIdx === null || !question.options[answerIdx]) {
      await bot.api.sendMessage(chatId, "من فضلك أرسل حرف الإجابة (أ/ب/ج/د) فقط.", { reply_markup: plainBackMenu() });
      return;
    }
    const chosenResult = question.options[answerIdx].result;
    const scores = { ...pending.scores, [chosenResult]: (pending.scores[chosenResult] || 0) + 1 };
    const nextIndex = pending.questionIndex + 1;

    if (nextIndex < quiz.questions.length) {
      await setPending(tgUserId, { mode: "quiz_in_progress", quizId: quiz.id, questionIndex: nextIndex, scores });
      await bot.api.sendMessage(chatId, questionText(quiz, nextIndex), { reply_markup: plainBackMenu() });
      return;
    }

    const resultKey = pickWinningResult(quiz, scores);
    await prisma.$transaction([
      prisma.quizResult.create({ data: { userId: tgUserId, quizId: quiz.id, resultKey } }),
      prisma.quizUser.update({ where: { id: tgUserId }, data: { quizzesCompleted: { increment: 1 } } }),
    ]);
    await setPending(tgUserId, null);

    await bot.api.sendMessage(chatId, resultCardText(quiz, resultKey), { reply_markup: mainMenu() });
    await earnPoints(tgUserId, 1, "quiz_completed", botRow.id).catch(() => null);
    return;
  }

  const startedQuiz = QUIZ_DEFINITIONS.find((q) => q.menuLabel === text);
  if (startedQuiz) {
    await setPending(tgUserId, { mode: "quiz_in_progress", quizId: startedQuiz.id, questionIndex: 0, scores: {} });
    await bot.api.sendMessage(chatId, startedQuiz.intro, { reply_markup: plainBackMenu() });
    await bot.api.sendMessage(chatId, questionText(startedQuiz, 0), { reply_markup: plainBackMenu() });
    return;
  }

  if (text === "📜 آخر نتائجي") {
    const results = await prisma.quizResult.findMany({
      where: { userId: tgUserId },
      orderBy: { created_at: "desc" },
      take: HISTORY_PAGE_SIZE,
    });
    if (results.length === 0) {
      await bot.api.sendMessage(chatId, "😔 لا توجد نتائج سابقة بعد. جرّب أحد الاختبارات في القائمة.", { reply_markup: mainMenu() });
      return;
    }
    const lines = results
      .map((r) => {
        const quiz = findQuiz(r.quizId);
        const info = quiz?.results[r.resultKey];
        return `${quiz?.title || r.quizId}: ${info ? `${info.emoji} ${info.title}` : r.resultKey}`;
      })
      .join("\n");
    await bot.api.sendMessage(chatId, `📜 آخر ${results.length} نتيجة:\n\n${lines}`, { reply_markup: mainMenu() });
    return;
  }

  if (text === "ℹ️ معلومات") {
    const me = await bot.api.getMe();
    const info =
      `ℹ️ بوت الاختبارات الشخصية\n\n` +
      `بوت ترفيهي لاختبارات الشخصية!\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🧠 كيف يعمل:\n` +
      `• اختر اختباراً من القائمة الرئيسية.\n` +
      `• أجب عن كل سؤال بإرسال حرف الإجابة (أ/ب/ج/د).\n` +
      `• بعد آخر سؤال تحصل فوراً على نتيجتك مع بطاقة جاهزة للمشاركة.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📜 آخر نتائجي:\n` +
      `• شاهد سجل آخر نتائجك السابقة.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📤 المشاركة:\n` +
      `• شارك بطاقة النتيجة مع أصدقائك للمرح!\n\n` +
      `📲 شارك البوت: https://t.me/${me.username}`;
    await bot.api.sendMessage(chatId, info, { reply_markup: mainMenu() });
    return;
  }

  await bot.api.sendMessage(chatId, "لم أفهم طلبك، اختر من القائمة:", { reply_markup: mainMenu() });
}
