// Two sections in the Sham Telegram bot (owner's plan, 2026-10-21):
//   💻 coder  — DEFAULT: the open coding model (src/lib/openCoderStudio.ts) with the agent harness (src/lib/coderAgent.ts)
//   🧪 Sham   — secondary, for periodic testing: the existing Sham path, untouched (handleNovaBotUpdate -> src/lib/shamStudio.ts)
// /mode (or the inline buttons) switches per chat. In the Sham section every update goes to the existing handler exactly as before.
//
// Long answers (no length cap, slowness OK): the Telegram webhook returns at once; the work runs in `after()` and keeps polling the Studio
// job, sending finished parts (< 4096 chars each) as they come. Before the 60 s function limit it hands itself to /api/coder/continue
// (signed with the bot's webhook secret), which carries on — so one answer may take many minutes.
// State per chat in Postgres (coder_chat_state, created on first use, keyed by a salted hash — never the raw chat id).
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prismaDb, coderChatKey, resolveConnections, tierFor, type Db, type Tier } from "@/lib/coderAuth";
import { coderEnabled, coderChat, coderJobResult, coderCancel, coderStatus, coderFailureText, chunkRanges, renderRange, splitForTelegram, type CoderMessage, type CoderToolCall, type CoderReply } from "@/lib/openCoderStudio";
import { ACCURACY_TEMPERATURE, coderSystemPrompt, coderToolsFor, githubClient, isAccuracy, runTool, toolLabel, trimMessages, type Accuracy, type ToolCtx } from "@/lib/coderAgent";
import { afterCall, afterText, beforeCall, HARD_MAX_STEPS, logStall, stepsSinceProgress, newStallState, recentStalls, recoveryKnobs, recoveryMessage, type Stall, type StallState } from "@/lib/coderStall";
import { CATEGORIES, CATEGORY_LABEL, POLICY_LABEL, categoriesOf, evaluateCall, globalPolicy, isCategory, loadPrefs, nextPolicy, removePref, setPref, tierDefault, type Category, type Context } from "@/lib/coderPrefs";
import { addUsage, checkLimit, estimateTokens, limitMessage, type LimitCheck } from "@/lib/coderPlans";
import { fallbackSummary, needsSegment, saveSegment, segmentMessages, summaryRequest, usableSummary } from "@/lib/coderSegments";
import { taskEvent, taskSlot, taskStart, taskStatus, type TaskSource, type TaskStatus } from "@/lib/coderTasks";
import { defaultTz } from "@/lib/coderCron";

export type Mode = "coder" | "sham";
export type Pending = { calls: CoderToolCall[]; reason: string; summary: string; nonce: string; categories?: Category[]; msgId?: number; at?: number };
export type Run = {
  id: string; chain: string; job?: string; sent: number; step: number; lease: number; pending?: Pending; queued?: CoderToolCall[];
  stall?: StallState; recovery?: string; waitUntil?: number; retries?: number; histChars?: number; startedAt?: number;
  // a run's "slot": "" = the chat itself, "s:<scheduleId>" = a scheduled/event task with its own state and its own fresh step counter
  slot?: string; source?: TaskSource; scheduleId?: string; title?: string;
  allowCats?: Category[];                                             // "allow for the rest of this task"
  // segment continuation (coderSegments.ts): the request that started the task, the current segment, the step it began at,
  // and whether the model is writing the end-of-segment progress summary right now
  goal?: string; segment?: number; segStep?: number; compacting?: boolean;
  memory?: string;                                                    // long-term memories retrieved for this task (system prompt)
  progress?: { msgId?: number; lines: string[] }; progressAt?: number;                     // the one live "progress card" message of the current tool streak
  // the Studio job's own watchdog: when it was taken, its last seen size (text + reasoning) and when that last grew
  jobAt?: number; jobSize?: string; jobMovedAt?: number;
  promptEst?: number;                                                 // estimated prompt tokens of the job in flight (when the Studio sends no count)
};
export type ChatState = { mode: Mode; think: boolean; messages: CoderMessage[]; notes: string; inbox: string[]; run: Run | null; tz?: string; lang?: "ar" | "en"; convId?: string; repo?: string; menu?: boolean | string; accuracy?: Accuracy; model?: string; threadId?: string };
export type { Db };
export { coderChatKey };

const BUDGET_MS = 47000;                                              // per invocation, inside maxDuration 60
const LEASE_STALE_MS = 120000;
const pollMs = () => Number(process.env.CODER_POLL_MS || 3000);
const ciWaitMs = () => Number(process.env.CODER_CI_WAIT_MS || 20000);     // CI still running and nothing changed: wait this long before the next step
const MAX_RETRIES = 5;                                                // Studio hiccups are retried (with a smaller context on a job error)
// The CPU-only Studio can spend several minutes in prompt prefill before the first token, especially on repo-wide tasks.
// Allow a longer default before declaring a genuine stall; CODER_JOB_STALL_MS overrides (minimum 60 s).
const jobStallMs = () => Math.max(60000, Number(process.env.CODER_JOB_STALL_MS || 600000));
// A run whose loop died (no lease renewal, e.g. a server restart mid-task) is cleared after this long, so the chat and the app recover.
const RUN_DEAD_MS = () => Math.max(LEASE_STALE_MS * 2, Number(process.env.CODER_RUN_DEAD_MS || 360000));
const BUSY_TEXT = "⌛️ الخدمة مزدحمة الآن ولم أستطع الرد هذه المرة. أعد إرسال رسالتك بعد دقيقة، وسأرد عليك.";

/**
 * Short greetings / thanks / "how are you". NOT used for replies any more (owner's decision 2026-10-21: no fixed replies, every message,
 * even one word, goes to the model). Kept only as a classifier for tests and statistics.
 */
const SMALL_TALK = /^(?:(?:ال)?سلام(?: عليكم)?(?: ورحمة الله(?: وبركاته)?)?|مرحب[اًا]?|مرحبتين|أهلا|اهلا|أهلاً|اهلاً|هلا|هاي|هلو|صباح الخير|مساء الخير|صباح النور|مساء النور|كيفك|كيف حالك|شلونك|كيف الحال|شكرا|شكراً|مشكور|تسلم|يعطيك العافية|hi|hello|hey|hola|salam|thanks|thank you|thx|good (?:morning|evening))(?:\s+(?:يا\s*)?[\p{L}]{0,12})?[\s!.؟?،,🌹👋😊🙏❤️]*$/iu;
export function isSmallTalk(text: string): boolean {
  const t = String(text || "").trim();
  return t.length > 0 && t.length <= 40 && !t.includes("\n") && SMALL_TALK.test(t);
}
export function smallTalkReply(text: string, name = ""): string {
  const t = String(text || "").trim().toLowerCase();
  const who = name.trim().slice(0, 40);
  if (/شكر|مشكور|تسلم|العافية|thank|thx/.test(t)) return "🙏 العفو! إذا عندك أي طلب برمجي، اكتبه وأنا جاهز.";
  if (/كيف|شلون/.test(t)) return "😊 تمام الحمد لله! جاهز أساعدك بالكود. شو المهمة اليوم؟";
  if (/سلام|salam/.test(t)) return `وعليكم السلام${who ? ` ${who}` : ""} 👋 كيف بقدر ساعدك اليوم؟ اكتب طلبك البرمجي (شرح كود، إصلاح خطأ، مهمة على مستودعك…).`;
  return `👋 أهلاً${who ? ` ${who}` : ""}! كيف بقدر ساعدك اليوم؟ اكتب طلبك البرمجي (شرح كود، إصلاح خطأ، مهمة على مستودعك…).`;
}

/**
 * A run whose loop is gone (lease not renewed for RUN_DEAD_MS, not waiting for a confirmation): its Studio job is cancelled and the run
 * is closed as failed, so the next message starts fresh and the app stops showing it as running. Returns true when it cleared one.
 */
export async function recoverDeadRun(chatId: number | string, db: Db = prismaDb, slot = ""): Promise<boolean> {
  const st = await loadState(chatId, db, slot);
  const run = st.run;
  if (!run || run.pending || Date.now() - (run.lease || 0) < RUN_DEAD_MS()) return false;
  if (run.job) await coderCancel(run.job).catch(() => null);
  await endRun(st, "failed", db, "no progress: the run's loop stopped (recovered)", coderChatKey(chatId));
  await saveState(chatId, st, db, slot);
  return true;
}


export function defaultMode(): Mode {
  return (process.env.CODER_DEFAULT_MODE || "coder").trim().toLowerCase() === "sham" ? "sham" : "coder";
}

const emptyState = (): ChatState => ({ mode: defaultMode(), think: false, messages: [], notes: "", inbox: [], run: null });

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
  if (!ready) {
    ready = db
      .exec(`CREATE TABLE IF NOT EXISTS coder_chat_state (chat_key TEXT PRIMARY KEY, state JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

/** The state row of a chat (slot "") or of one of its scheduled tasks (slot "s:<id>"). */
export const stateKey = (chatId: number | string, slot = "") => coderChatKey(slot ? `${chatId}#${slot}` : chatId);

export async function loadState(chatId: number | string, db: Db = prismaDb, slot = ""): Promise<ChatState> {
  try {
    await ensureTable(db);
    const rows = await db.query<{ state: Partial<ChatState> }>(`SELECT state FROM coder_chat_state WHERE chat_key = $1`, stateKey(chatId, slot));
    return { ...emptyState(), ...(rows[0]?.state || {}) };
  } catch {
    return emptyState();
  }
}

export async function saveState(chatId: number | string, st: ChatState, db: Db = prismaDb, slot = ""): Promise<void> {
  try {
    await ensureTable(db);
    await db.exec(
      `INSERT INTO coder_chat_state (chat_key, state, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (chat_key) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      stateKey(chatId, slot),
      JSON.stringify(st),
    );
  } catch {
    /* best-effort: a database error never blocks a reply */
  }
}

// ---------------------------------------------------------------- signing of the self-continuation
export function signContinue(secret: string, botId: string, chatId: string, chain: string): string {
  return createHmac("sha256", secret || "coder").update(`${botId}|${chatId}|${chain}`).digest("hex");
}
export function verifyContinue(secret: string, botId: string, chatId: string, chain: string, sig: string): boolean {
  const want = Buffer.from(signContinue(secret, botId, chatId, chain));
  const got = Buffer.from(String(sig || ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

export function selfUrl(): string {
  return (process.env.CODER_SELF_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/+$/, "");
}
export function appUrl(): string {
  return (process.env.CODER_APP_URL || `${selfUrl()}/coder-app`).replace(/\/+$/, "");
}

/** Background work after the response: next/server after() on Vercel, plain async on a long-lived Node server (coderRuntime.ts). */
export { later } from "@/lib/coderRuntime";
import { later } from "@/lib/coderRuntime";

// ---------------------------------------------------------------- texts and keyboards
// The /start welcome (owner's note 2026-10-21: warmer, shorter, nothing internal). {name} = the user's first name.
const WELCOME_V1 =
  "👋 أهلاً! هذا قسم «Nova AI» 💻 — نموذج برمجة مفتوح يكتب الكود ويراجعه ويشرحه، وينفّذ مهام على GitHub خطوة بخطوة (يخطط ← ينفّذ ← يتحقق)، ويبحث في الويب ويشغّل الكود في حاسوب افتراضي خاص بالمهمة.\n" +
  "اكتب طلبك بأي طول؛ الردود الطويلة تصل على دفعات.\n\n" +
  "⚙️ الإعدادات، الذاكرة، الجدولة، الصلاحيات، ربط GitHub، تبديل القسم وسجل المهام: من زر «📱 التطبيق» في القائمة أو الزر أدناه.\n" +
  "/stop لإيقاف مهمة جارية.";
void WELCOME_V1;
export function welcomeText(name = ""): string {
  const who = name.trim().slice(0, 40);
  return [
    `👋 أهلاً${who ? ` ${who}` : ""}، أنا Nova AI، مساعد البرمجة من فريق شام.`,
    "",
    "أساعدك تكتب الكود وتراجعه وتصلّحه، وأنفّذ مهامك على مستودعاتك خطوة بخطوة: أخطط، أنفّذ، ثم أتحقق قبل ما أقول «تم».",
    "",
    "✨ جرّب تكتب لي مثلاً:",
    "• «اشرح لي هذا الكود» وأرسل الملف",
    "• «أصلح الخطأ في مستودعي وافتح طلب دمج»",
    "• «كل يوم الساعة 9 راجع طلبات الدمج الجديدة»",
    "",
    "📱 من زر «فتح التطبيق» تلاقي مهامك مباشرة، الموصلات (GitHub وGoogle وNotion…)، الذاكرة، الإعدادات والاشتراك.",
    "",
    "اكتب طلبك بالطول اللي بدك، وأي خطوة حساسة بستأذنك فيها قبل ما نفّذها. /stop يوقف المهمة الجارية.",
  ].join("\n");
}
export const WELCOME = welcomeText();
export const welcomeKeyboard = () => new InlineKeyboard().webApp("📱 فتح التطبيق", appUrl()).row().webApp("🖥️ الطرفية", `${appUrl()}?tab=terminal`).webApp("🔌 الموصلات", `${appUrl()}?tab=connect`).row().webApp("💎 الاشتراك", `${appUrl()}?tab=billing`);
export const modeKeyboard = (mode: Mode) =>
  new InlineKeyboard().text(`${mode === "coder" ? "✅ " : ""}💻 Nova AI`, "cmode|coder").text(`${mode === "sham" ? "✅ " : ""}🧪 شام (تجريبي)", "cmode|sham");

/** What a regular user is told when the model service failed: plain words, never the server's own error text. */
export function userFailureText(o: Parameters<typeof coderFailureText>[0], chatId: number | string): string {
  if (tierFor(chatId) === "owner") return coderFailureText(o);
  if (o.failure === "off") return "🛠️ Nova AI غير متاح الآن. جرّب بعد قليل.";
  if (o.failure === "timeout" || o.failure === "http" || o.failure === "network") return "⌛️ الخدمة مشغولة الآن. أعد إرسال طلبك بعد دقيقة.";
  if (o.reply?.type === "gone") return "انتهت صلاحية هذا الطلب. أعد إرسال رسالتك.";
  return "⚠️ تعذّر إكمال الرد هذه المرة. أعد المحاولة بعد قليل.";
}

async function send(bot: TelegramBot, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await bot.api.sendMessage(chatId, text.slice(0, 4096), extra as never).catch(() => null);
}

// ---------------------------------------------------------------- entry from the Telegram route (true = handled here)
export async function handleCoderSections(bot: TelegramBot, botRow: BotRow, update: any, db: Db = prismaDb): Promise<boolean> {
  // Stars payment for a coder plan (src/lib/coderStars.ts): recorded even while the coder itself is switched off
  if (update.message?.successful_payment) {
    const { handleCoderPaymentMessage } = await import("@/lib/coderStars");
    if (await handleCoderPaymentMessage(bot, update.message, db)) return true;
  }
  const fromId = update.callback_query?.from?.id ?? update.callback_query?.message?.chat?.id ?? update.message?.from?.id ?? update.message?.chat?.id;
  const owner = fromId !== undefined && tierFor(fromId) === "owner";
  if (!coderEnabled()) {
    if (owner || fromId === undefined) return false;
    // the Sham section is the owner's only (owner's rule, 2026-10-21): users get a short notice instead
    if (update.callback_query) await bot.api.answerCallbackQuery(update.callback_query.id).catch(() => null);
    else if (update.message?.chat?.id) await send(bot, update.message.chat.id, "🛠️ Nova AI قيد الصيانة لدقائق. جرّب بعد قليل، وشكراً لصبرك.");
    return true;
  }
  const cq = update.callback_query;
  if (cq) {
    const data = String(cq.data || "");
    const chatId = cq.message?.chat?.id;
    if (!chatId) return false;
    if (data.startsWith("cpanel|")) {
      // owner control panel buttons (src/lib/coderPanel.ts): the owner only
      if (!owner) {
        await bot.api.answerCallbackQuery(cq.id).catch(() => null);
        return true;
      }
      const { panel, panelAction, panelText } = await import("@/lib/coderPanel");
      const act = data.split("|")[1];
      const res = act === "refresh" ? null : await panelAction(act);
      await bot.api.answerCallbackQuery(cq.id, res ? { text: res.message.slice(0, 190) } : {}).catch(() => null);
      const d = await panel(db);
      await bot.api.editMessageText(chatId, cq.message.message_id, panelText(d), { reply_markup: panelKeyboard(Boolean(d.training?.nova.paused)) } as never).catch(() => null);
      return true;
    }
    if (!/^c(mode|cf|perm|sch)\|/.test(data)) {
      if (owner) return false;                                // owner: the Sham handler's own buttons
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return true;
    }
    const st = await loadState(chatId, db);
    if (data === "cmode|sham" && !owner) {
      await bot.api.answerCallbackQuery(cq.id, { text: "هذا القسم غير متاح حالياً." }).catch(() => null);
      return true;
    }
    if (data.startsWith("cmode|")) {
      st.mode = 