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
import { InlineKeyboard, InputFile, type Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prismaDb, coderChatKey, resolveConnections, tierFor, type Db, type Tier } from "@/lib/coderAuth";
import { coderStudioUrls, coderEnabled, coderChat, coderJobResult, coderCancel, coderStatus, recentStudioCalls, anyIdleStudio, coderFailureText, chunkRanges, renderRange, splitForTelegram, type CoderMessage, type CoderToolCall, type CoderReply } from "@/lib/openCoderStudio";
import { shamToolsEnabled } from "@/lib/shamTools";
import { claimTelegramUpdate } from "@/lib/telegramDedupe";
import { toModelImage, dropShownImages } from "@/lib/coderVision";
import { bankAdd } from "@/lib/coderBank";
import { ACCURACY_TEMPERATURE, accuracyNote, windowFrom, researchQuestion, fallbackQueries, parseQueries, queryDraftPrompt, githubQuery, agentToolDefs, loadedGroups, toolGroups, coderSystemPrompt, coderToolsFor, githubClient, isAccuracy, parseArgs, runTool, toolLabel, trimMessages, type Accuracy, type ToolCtx } from "@/lib/coderAgent";
import { afterCall, afterText, beforeCall, HARD_MAX_STEPS, logStall, stepsSinceProgress, newStallState, recentStalls, recoveryKnobs, recoveryMessage, type Stall, type StallState } from "@/lib/coderStall";
import { CATEGORIES, CATEGORY_LABEL, POLICY_LABEL, categoriesOf, evaluateCall, globalPolicy, isCategory, loadPrefs, nextPolicy, removePref, setPref, tierDefault, type Category, type Context } from "@/lib/coderPrefs";
import { chooseModel, listModels, modelReady } from "@/lib/coderModels";
import { SECTIONS_MAX, parallelEnabled, parallelReport, studioWriter } from "@/lib/coderParallel";
import { historyChars } from "@/lib/coderContext";
import { fitReports, agentMaxSteps, AGENT_TIMEOUT_MS, agentSlot, agentsEnabled, agentToolAllowed, composeResults, isAgentSlot, normalizeTasks, type AgentResult, type AgentRole, type AgentTask } from "@/lib/coderAgents";
import { addUsage, checkLimit, estimateTokens, limitMessage, type LimitCheck } from "@/lib/coderPlans";
import { fallbackSummary, needsSegment, saveSegment, segmentMessages, summaryRequest, usableSummary } from "@/lib/coderSegments";
import { taskEvent, taskHeartbeatFresh, taskSlot, taskStart, taskStatus, taskTouch, type TaskSource, type TaskStatus } from "@/lib/coderTasks";
import { defaultTz } from "@/lib/coderCron";

export type Mode = "coder" | "sham";
export type Pending = { calls: CoderToolCall[]; reason: string; summary: string; nonce: string; categories?: Category[]; msgId?: number; at?: number };
export type Run = {
  id: string; chain: string; job?: string; sent: number; logged?: number; step: number; lease: number; surface?: "telegram" | "app"; pending?: Pending; queued?: CoderToolCall[]; approved?: string[];
  stall?: StallState; recovery?: string; waitUntil?: number; retries?: number; histChars?: number; ctxStamped?: boolean; coldReset?: boolean; thinkOff?: boolean; outageSaid?: boolean; queueMoves?: number; avoidHome?: boolean; pfLogged?: string; startedAt?: number;
  // a run's "slot": "" = the chat itself, "s:<scheduleId>" = a scheduled/event task with its own state and its own fresh step counter
  slot?: string; source?: TaskSource; scheduleId?: string; title?: string; appReplySent?: boolean; botSent?: number; botProgressAt?: number; origin?: "chat"; asking?: { id: string; name: string; question: string; at: number };
  prefetched?: boolean; softSteps?: number; softWarned?: boolean; keepGroups?: string[]; announceNudges?: number; outageSince?: number; outageNoted?: boolean; stallRetries?: number; goneRetries?: number; pollFailSince?: number;   // model-server patience
  agent?: boolean; agentRole?: AgentRole; agentDepth?: number; parentCtx?: Context; parentRunId?: string; agentWarned?: boolean; delegating?: { id: string; slots: string[]; titles: string[]; at: number; noted?: number }; draftId?: number; draftAt?: number; draftText?: string; noDraft?: boolean;   // agent/delegating: sub-agents (coderAgents.ts)
  allowCats?: Category[];                                             // "allow for the rest of this task"
  // segment continuation (coderSegments.ts): the request that started the task, the current segment, the step it began at,
  // and whether the model is writing the end-of-segment progress summary right now
  goal?: string; segment?: number; segStep?: number; compacting?: boolean;
  memory?: string;                                                    // long-term memories retrieved for this task (system prompt)
  progress?: { msgId?: number; lines: string[]; phase?: string }; progressAt?: number;                     // the one live "progress card" message of the current tool streak
  // the Studio job's own watchdog: when it was taken, its last seen size (text + reasoning) and when that last grew
  jobAt?: number; jobSize?: string; jobMovedAt?: number;
  promptEst?: number;                                                 // estimated prompt tokens of the job in flight (when the Studio sends no count)
};
export type ChatState = { groups?: string[]; winStart?: number; mode: Mode; think: boolean; messages: CoderMessage[]; notes: string; inbox: string[]; run: Run | null; tz?: string; lang?: "ar" | "en"; convId?: string; repo?: string; menu?: boolean | string; accuracy?: Accuracy; model?: string; threadId?: string; agentResult?: AgentResult };
export type { Db };
export { coderChatKey };

const BUDGET_MS = 30000;                                              // Telegram webhook leg stays short under its 60s route ceiling
const APP_BUDGET_MS = 240000;                                           // Mini App terminal leg: 4 minutes, with 60s headroom under Vercel 300s
const LEASE_STALE_MS = 120000;
const pollMs = () => Math.max(800, Number(process.env.CODER_POLL_MS || 1200));
const ciWaitMs = () => Number(process.env.CODER_CI_WAIT_MS || 20000);     // CI still running and nothing changed: wait this long before the next step
const MAX_RETRIES = 5;                                                // Studio hiccups are retried (with a smaller context on a job error)
// The CPU-only Studio can spend several minutes in prompt prefill before the first token, especially on repo-wide tasks.
// Allow a longer default before declaring a genuine stall; CODER_JOB_STALL_MS overrides (minimum 60 s).
/** How long a run waits patiently for the model server to come back (restart, wake-up, deploy) before it gives up. */
const outageMs = () => Math.max(0, Number(process.env.CODER_OUTAGE_MS ?? 2 * 60000));
/** The CPU reads a prompt at ~25 tokens/s and says nothing meanwhile: until the first text, a long prompt is given the time it needs (capped), unless the Studio reports its reading progress (then any progress counts as life). */
const readingMs = (run: { promptEst?: number }, r: { total?: number; prefill?: { processed?: number } | null }) =>
  r.total || r.prefill ? 0 : Math.min(20 * 60000, Math.round(((run.promptEst || 0) / 25) * 1000 * 1.3) + 60000);
const jobStallMs = () => Math.max(60000, Number(process.env.CODER_JOB_STALL_MS || 180000));
// A run whose loop died (no lease renewal, e.g. a server restart mid-task) is cleared after this long, so the chat and the app recover.
const RUN_DEAD_MS = () => Math.max(LEASE_STALE_MS * 2, Number(process.env.CODER_RUN_DEAD_MS || 360000));
const BUSY_TEXT = "⌛ الخدمة مزدحمة الآن ولم أستطع الرد هذه المرة. أعد إرسال رسالتك بعد دقيقة، وسأرد عليك.";

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
/** How long a thought may be, by accuracy mode (characters): the mode that wants speed thinks briefly, the precise one is given room. 1200 = the Studio's own default (nothing extra is sent). */
export const thinkCapFor = (a?: string): number => Number(process.env[`CODER_THINK_CAP_${String(isAccuracy(a) ? a : "balanced").toUpperCase()}`]) || (a === "fast" ? 500 : a === "precise" ? 3000 : 1200);

// reads that do not depend on each other and change nothing
const PAR_READ = new Set(["github_read_file", "github_read_files", "github_repo_scan", "github_ci_logs", "github_pr_info", "github_commits", "github_compare", "github_list_files", "github_search_code", "github_list_branches", "github_list_prs", "github_list_issues"]);

export async function recoverDeadRun(chatId: number | string, db: Db = prismaDb, slot = ""): Promise<boolean> {
  const st = await loadState(chatId, db, slot);
  const run = st.run;
  if (!run || run.pending || run.asking) return false;     // waiting for the user's tap or answer is not a dead run
  // The persisted task heartbeat is authoritative: Vercel can kill a background leg while the chat-state lease
  // still looks fresh. Recover from a missing heartbeat quickly instead of queuing messages behind a dead runner.
  const heartbeatFresh = await taskHeartbeatFresh(run.id, 300000, db);
  if (heartbeatFresh === true) return false;
  if (heartbeatFresh === null && Date.now() - (run.lease || 0) < RUN_DEAD_MS()) return false;
  if (heartbeatFresh === false && Date.now() - (run.startedAt || run.lease || 0) < 45000) return false;
  if (run.job) await coderCancel(run.job).catch(() => null);
  await endRun(st, "failed", db, "no progress: the run's loop stopped (recovered)", coderChatKey(chatId));
  await saveState(chatId, st, db, slot);
  return true;
}


export function defaultMode(): Mode {
  return (process.env.CODER_DEFAULT_MODE || "coder").trim().toLowerCase() === "sham" ? "sham" : "coder";
}

/** A sub-agent run never writes to the chat: every Telegram call is swallowed (its work is visible in the task events). */
function silentBot(bot: TelegramBot): TelegramBot {
  const real = (bot as any).__real || bot;
  const api = new Proxy(bot.api as any, { get: (target, prop) => (typeof Reflect.get(target, prop, target) === "function" ? async () => null : Reflect.get(target, prop, target)) });
  return new Proxy(bot as any, { get(target, prop, receiver) { return prop === "api" ? api : prop === "__real" ? real : Reflect.get(target, prop, receiver); } }) as TelegramBot;
}
/** The real chat bot behind a silenced agent bot: an agent never chats, but its ✅/❌ permission questions must reach the user. */
const realBot = (bot: TelegramBot): TelegramBot => (bot as any).__real || bot;

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

export async function loadStateStrict(chatId: number | string, db: Db = prismaDb, slot = ""): Promise<ChatState> {
  await ensureTable(db);
  const rows = await db.query<{ state: Partial<ChatState> }>(`SELECT state FROM coder_chat_state WHERE chat_key = $1`, stateKey(chatId, slot));
  return { ...emptyState(), ...(rows[0]?.state || {}) };
}

export async function loadState(chatId: number | string, db: Db = prismaDb, slot = ""): Promise<ChatState> {
  try { return await loadStateStrict(chatId, db, slot); } catch { return emptyState(); }
}

export async function saveStateStrict(chatId: number | string, st: ChatState, db: Db = prismaDb, slot = ""): Promise<void> {
  await ensureTable(db);
  await db.exec(
    `INSERT INTO coder_chat_state (chat_key, state, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (chat_key) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    stateKey(chatId, slot), JSON.stringify(st),
  );
}

export async function saveState(chatId: number | string, st: ChatState, db: Db = prismaDb, slot = ""): Promise<void> {
  try { await saveStateStrict(chatId, st, db, slot); } catch { /* best-effort for non-critical state updates */ }
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
// token updated 2026-10-22T14:04Z
// token updated
export function appUrl(): string {
  // Telegram must be given the Mini App route, not the marketing homepage. A configured
  // CODER_APP_URL may accidentally contain only the site origin; normalize that safely.
  const raw = (process.env.CODER_APP_URL || `${selfUrl()}/coder-app`).trim().split("?")[0].replace(/\/+$/, "");
  if (!raw) return `${selfUrl()}/coder-app`;
  if (/^https?:\/\/[^/]+$/i.test(raw)) return `${raw}/coder-app`;
  return raw;
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
    `👋 أهلاً${who ? ` ${who}` : ""}، أنا Nova AI، مساعد البرمجة.`,
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
export const welcomeKeyboard = () => new InlineKeyboard().webApp("📱 فتح التطبيق", appUrl()).row().webApp("🖥 الطرفية", `${appUrl()}?tab=terminal`).webApp("🔌 الموصلات", `${appUrl()}?tab=connect`).row().webApp("💎 الاشتراك", `${appUrl()}?tab=billing`);
export const modeKeyboard = (mode: Mode) =>
  new InlineKeyboard().text(`${mode === "coder" ? "✅ " : ""}💻 Nova AI`, "cmode|coder").text(`${mode === "sham" ? "✅ " : ""}🧪 شام (تجريبي)`, "cmode|sham");

/** What a regular user is told when the model service failed: plain words, never the server's own error text. */
export function userFailureText(o: Parameters<typeof coderFailureText>[0], chatId: number | string): string {
  if (tierFor(chatId) === "owner") return coderFailureText(o);
  if (o.failure === "off") return "🛠️ Nova AI غير متاح الآن. جرّب بعد قليل.";
  if (o.failure === "timeout" || o.failure === "http" || o.failure === "network" || o.failure === "auth") return "⌛ الخدمة مشغولة الآن. أعد إرسال طلبك بعد دقيقة.";
  if (o.reply?.type === "gone") return "انتهت صلاحية هذا الطلب. أعد إرسال رسالتك.";
  return "⚠️ تعذّر إكمال الرد هذه المرة. أعد المحاولة بعد قليل.";
}

async function send(bot: TelegramBot, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await bot.api.sendMessage(chatId, text.slice(0, 4096), extra as never).catch(() => null);
}

/** Route user-visible output to its originating surface. App tasks keep their answer in task events;
 * confirmation keyboards remain in Telegram so an explicit approval can still resume the shared run. */
export function surfaceBot(bot: TelegramBot, surface: "telegram" | "app" | undefined, origin?: "chat"): TelegramBot {
  // a task the user started by writing in the chat keeps ALL its notices in the chat (failures, queue, confirmations); only tasks started
  // from the Mini App (and scheduled ones) keep the chat quiet and report to the terminal
  if (surface !== "app" || origin === "chat") return bot;
  const api = new Proxy(bot.api as any, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "sendMessage") return (...args: any[]) => {
        const extra = args[2];
        const rows = extra?.reply_markup?.inline_keyboard;
        const isApproval = Array.isArray(rows) && rows.some((row: any[]) => Array.isArray(row) && row.some((button: any) => String(button?.callback_data || "").startsWith("ccf|")));
        const isProgress = String(args[1] || "").startsWith("📋 التقدم");
        if (isApproval || isProgress) return value.apply(target, args);
        return Promise.resolve(null);
      };
      if (prop === "editMessageText") return (...args: any[]) => {
        const text = String(args[2] || "");
        if (text.startsWith("📋 التقدم") || text.startsWith("⚙️ [محطة العمل]")) return value.apply(target, args);
        return Promise.resolve(null);
      };
      if (["sendChatAction", "editMessageReplyMarkup", "sendPhoto", "sendDocument", "sendVideo", "sendAudio", "sendVoice", "sendAnimation", "sendSticker"].includes(String(prop))) return async () => null;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(bot as any, { get(target, prop, receiver) { return prop === "api" ? api : Reflect.get(target, prop, receiver); } }) as TelegramBot;
}

/** The user's chat message (or terminal command) answers the question the agent asked with ask_user; the task goes on. */
async function answerAsk(bot: TelegramBot, botRow: BotRow, chatId: number, st: ChatState, text: string, db: Db, slot = ""): Promise<void> {
  const run = st.run!;
  const ask = run.asking!;
  run.asking = undefined;
  st.messages.push({ role: "tool", content: text.slice(0, 4000), tool_call_id: ask.id, name: ask.name });
  await startChain(botRow, chatId, st, {}, db);
  await taskEvent(run.id, "approved", `✅ جواب المستخدم: ${text.slice(0, 300)}`, db);
  await taskStatus(run.id, "running", run.step, db);
  await saveState(chatId, st, db, slot);
  later(() => drive(bot, botRow, chatId, st.run!.chain, db, run.surface === "app" ? APP_BUDGET_MS : BUDGET_MS, slot));
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
  // Telegram re-sends an update it found slow (same update_id): the copy must not start or queue a second answer to the same message
  if (fromId !== undefined && update.update_id && !(await claimTelegramUpdate("coder", fromId, update.update_id, db))) return true;
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
    if (data.startsWith("cmode|")) {
      const { listModels } = await import("@/lib/coderModels");
      if (!chooseModel(st, await listModels(db), data.slice(6) === "sham" ? "sham" : "coder", owner)) {
        await bot.api.answerCallbackQuery(cq.id, { text: "هذا القسم غير متاح حالياً." }).catch(() => null);
        return true;
      }
      await saveState(chatId, st, db);
      await bot.api.answerCallbackQuery(cq.id, { text: st.mode === "coder" ? "💻 قسم Nova AI" : "🧪 قسم شام" }).catch(() => null);
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id, { reply_markup: modeKeyboard(st.mode) }).catch(() => null);
      await send(bot, chatId, st.mode === "coder" ? "💻 أنت الآن في قسم Nova AI. اكتب طلبك." : "🧪 أنت الآن في قسم شام (للتجربة). /mode للرجوع إلى Nova AI.");
      return true;
    }
    if (data.startsWith("cperm|")) {
      const cat = data.split("|")[1];
      if (isCategory(cat)) {
        const rules = await loadPrefs(chatId, db);
        const next = nextPolicy(globalPolicy(rules, cat));
        if (next === "default") await removePref(chatId, cat, "*", "*", db);
        else await setPref(chatId, { category: cat, repo: "*", context: "*", policy: next }, db);
      }
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      const kb = await permsKeyboard(chatId, db);
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id, { reply_markup: kb }).catch(() => null);
      return true;
    }
    if (data.startsWith("csch|")) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      const { handleScheduleCallback } = await import("@/lib/coderSchedules");
      await handleScheduleCallback(bot, botRow, chatId, cq.message.message_id, data, db);
      return true;
    }
    const [, runId, nonce, answer] = data.split("|");
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    await resolvePending(bot, botRow, chatId, runId, nonce, answer === "yes" ? "yes" : answer === "all" ? "all" : "no", db, cq.message.message_id);
    return true;
  }

  const msg = update.message;
  const chatId: number | undefined = msg?.chat?.id;
  if (!chatId) return false;
  const text: string = typeof msg.text === "string" ? msg.text.trim() : typeof msg.caption === "string" ? msg.caption.trim() : "";
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const st = await loadState(chatId, db);
  const OWNER_FIRST = new Set(["sham", "sham_loop", "sham_v2"]);
  if (tierFor(chatId) !== "owner" && (st.mode === "sham" || OWNER_FIRST.has(st.model || ""))) {
    const open = new Set((await listModels(db)).filter((m) => m.visible && modelReady(m)).map((m) => m.id));          // switched on for everyone AND ready (one tap by the owner)
    if (!(st.model && open.has(st.model))) {
      st.mode = "coder";                                        // these models are the owner's until the owner opens them
      if (OWNER_FIRST.has(st.model || "")) st.model = undefined;
      await saveState(chatId, st, db);
    }
  }
  if ((st.model === "sham" || st.model === "sham_v2" || st.model === "sham_loop") && st.mode !== "sham") {            // Sham always runs on its own path
    if (st.model === "sham_loop") st.model = "sham";
    st.mode = "sham";
    await saveState(chatId, st, db);
  }
  // Management lives in the Mini App (owner's UX decision, 2026-10-21): the chat is for the conversation. Only /start and /stop stay;
  // every other command (old habits, menus) answers with the button that opens the app on the right tab.
  const ROUTED: Record<string, string> = {
    "/mode": "settings", "/think": "settings", "/perms": "settings", "/memory": "memory", "/schedule": "schedules", "/schedules": "schedules",
    "/app": "tasks", "/settings": "settings", "/github": "connect", "/connect": "connect", "/history": "tasks", "/tasks": "tasks", "/status": "settings",
    "/stalls": "settings", "/new": "tasks", "/help": "tasks", "/plan": "billing", "/billing": "billing", "/upgrade": "billing", "/connectors": "connect",
  };
  if (cmd === "/panel" && tierFor(chatId) === "owner") {
    const { panel, panelText } = await import("@/lib/coderPanel");
    const d = await panel(db);
    await send(bot, chatId, panelText(d), { reply_markup: panelKeyboard(Boolean(d.training?.nova.paused)) });
    return true;
  }
  if (cmd in ROUTED && cmd !== "/new" && cmd !== "/help") {
    await ensureMenuButton(bot, chatId, st, db);
    await send(bot, chatId, "📱 الإعدادات والذاكرة والجدولة والصلاحيات والربط وسجل المهام كلها في تطبيق Nova AI.", { reply_markup: appButton(ROUTED[cmd]) });
    return true;
  }
  if (st.mode === "sham") return false;                     // the existing Sham path, exactly as before

  if (cmd === "/start" || cmd === "/help") {
    later(() => prewarmChat(chatId, db));
    await ensureMenuButton(bot, chatId, st, db, true);
    await send(bot, chatId, welcomeText(String(msg.from?.first_name || "")), { reply_markup: welcomeKeyboard() });
    return true;
  }
  if (cmd === "/new") {
    // kept quietly for old habits (the app's "new conversation" does the same)
    await newConversation(chatId, st, db);
    await send(bot, chatId, "🆕 بدأت محادثة جديدة.");
    return true;
  }
  if (cmd === "/stop") {
    const was = await loadState(chatId, db);
    const had = Boolean(was.run?.progress?.msgId);
    await closeCard(bot, chatId, was.run, "⏹️ أوقفت المهمة الجارية.", true);       // the top card goes, the notice is the last message
    await stopRun(chatId, "", undefined, db);
    if (!had) await send(bot, chatId, "⏹️ أوقفت المهمة الجارية.");
    return true;
  }
  if (st.menu !== appUrl()) await ensureMenuButton(bot, chatId, st, db);

  let content = text;
  if (msg.document) content = `${text}\n\n${await readDocument(bot, botRow, msg.document)}`.trim();
  // a photo goes to the model as a picture (a vision Studio reads it); the caption is the question
  let images: string[] = [];
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const { anyVisionStudio } = await import("@/lib/openCoderStudio");
    if (!(await anyVisionStudio())) {
      await send(bot, chatId, "📷 قراءة الصور غير مفعّلة بعد على الاستوديوهات. أرسل طلبك نصاً.");
      return true;
    }
    const img = await telegramPhoto(bot, botRow, msg.photo);
    if (img) images = [img];
    else { await send(bot, chatId, "تعذّر تحميل الصورة. جرّب مرة أخرى."); return true; }
    if (!content) content = String(msg.caption || "").trim() || "ماذا ترى في هذه الصورة؟ صفها بإيجاز.";
  }
  if (!content) {
    await send(bot, chatId, "أرسل طلبك نصاً (أو ملف كود نصي).");
    return true;
  }
  if (st.run?.asking) {                                     // the agent asked a question: this message is the answer
    await answerAsk(bot, botRow, chatId, st, content, db);
    return true;
  }
  if (st.run && !st.run.pending) {
    // Check the persisted worker heartbeat before queueing: the state lease can look fresh after Vercel killed the worker.
    if (await recoverDeadRun(chatId, db)) Object.assign(st, await loadState(chatId, db));
  }
  // every message, greetings included, goes to the model (owner's rule 2026-10-21: no canned replies)
  // the conversation thread this message belongs to (created on the first message; an older single conversation becomes one thread)
  if (!st.threadId) await ensureThread(chatId, st, db, content);
  if (st.run && Date.now() - st.run.lease < LEASE_STALE_MS) {
    st.inbox.push(content);
    await saveState(chatId, st, db);
    return true;
  }
  if (!st.run) {
    // plan limit: tasks per rolling week (the owner has none)
    const lim = await checkLimit(chatId, "tasks", 1, db);
    if (!lim.ok) {
      await sendLimit(bot, chatId, lim, st.tz);
      return true;
    }
    await addUsage(chatId, "tasks", 1, db);
  }
  if (st.run) st.inbox.push(content);
  else st.messages.push(images.length ? { role: "user", content, images } : { role: "user", content });
  await startChain(botRow, chatId, st, { surface: "app", origin: "chat" }, db);
  // no canned "request received" message (owner 2026-10-25): the first thing in the chat is the model's own reply (frontAck) and then its work
  if (st.run) await taskEvent(st.run.id, "info", "بدأ مسار المعالجة الخلفية.", db);
  await saveState(chatId, st, db);
  await typing(bot, chatId);
  later(() => drive(bot, botRow, chatId, st.run!.chain, db));
  // no second message in the chat: ONE reply per user message (the live-typing answer); the quick "understood" lane exists for the app terminal only
  return true;
}

/**
 * The quick lane: the main worker has to read the whole conversation first (minutes on a CPU, silent), so a second, tiny call on a Studio
 * nobody is using answers within seconds: what the model understood and what it will do first. It never touches a Studio that holds a
 * conversation's prompt cache, never answers the task itself, and is dropped if the real answer has already started.
 */
async function frontAck(bot: TelegramBot, chatId: number, runId: string, content: string, surface: "telegram" | "app", db: Db): Promise<void> {
  if (surface !== "app") return;                                      // a chat reply to the same message would be a second reply; the chat gets exactly one
  if ((process.env.NODE_ENV === "test" && process.env.CODER_FRONT_ACK !== "1") || process.env.CODER_FRONT_ACK === "0") return;
  if (coderStudioUrls().length < 2) return;
  await new Promise((res) => setTimeout(res, 700));                  // the main call picks its Studio first
  const messages: CoderMessage[] = [
    { role: "system", content: "You are Nova AI. The user just sent a request and a longer worker is starting on it right now. Reply in the user's language with ONE or TWO short sentences: say what you understood and what you will do first. Do not claim you have done anything, do not answer the request itself, no lists, no code, no tools." },
    { role: "user", content: content.slice(0, 700) },
  ];
  const o = await coderChat(messages, { maxTokens: 70, temperature: 0.3, waitS: 8, timeoutMs: 20000, fresh: true, tag: "ack" }).catch(() => null);
  let r = o?.reply || null;
  for (let i = 0; r?.type === "pending" && r.job && i < 12; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    r = (await coderJobResult(r.job, 0, 8000).catch(() => null))?.reply || null;
  }
  if (r?.type === "pending" && r.job) { await coderCancel(r.job).catch(() => null); return; }
  const text = r?.type === "done" ? stripForeignScript(r.text || "", content).trim() : "";
  if (!text) return;
  const cur = await loadState(chatId, db).catch(() => null);
  if (!cur?.run || cur.run.id !== runId || cur.run.sent || cur.run.botSent) return;   // the real answer got there first
  await taskEvent(runId, "info", `🤖 ${text}`, db);
}

const warmedAt = new Map<number, number>();
/**
 * Reads the conversation into the Studio's cache BEFORE the user's next message, while they are still typing: when the app is opened or /start is sent and the
 * conversation's Studio is not holding it (restarted, or used by something else), one invisible request with the same start as the next prompt (system, tools,
 * the same history window) and a dummy last line, one token of output. Measured: a prompt that differs only in its last message is then read in ~3 s instead of
 * ~110 s. It writes nothing to the chat, runs only when no task is running, at most once per 8 minutes, and CODER_PREWARM=0 turns it off.
 */
export async function prewarmChat(chatId: number, db: Db = prismaDb): Promise<void> {
  if ((process.env.NODE_ENV === "test" && process.env.CODER_PREWARM !== "1") || process.env.CODER_PREWARM === "0" || !coderEnabled()) return;
  if (Date.now() - (warmedAt.get(chatId) || 0) < 8 * 60000) return;
  warmedAt.set(chatId, Date.now());
  const st = await loadState(chatId, db);
  if (st.run || st.model === "sham" || st.model === "sham_loop" || st.model === "sham_v2") return;
  const ctx = await toolCtx(chatId, st, db, null);
  const github = Boolean(ctx.gh);
  const connected = await import("@/lib/coderConnectors").then((m) => m.connectedIds(chatId, db)).catch(() => [] as string[]);
  const w = windowFrom(st.messages, st.winStart || 0, historyChars(), Number(process.env.CODER_RESET_CHARS) || 5000);
  const sticky = [...new Set([...(st.groups || []), ...loadedGroups(st.messages, toolGroups(true, true))])].sort();
  const wire = (m: CoderMessage): CoderMessage => (m.role === "user" && m.ctx ? { role: "user", content: `${m.content}\n\n${m.ctx}`, ...((m as { images?: string[] }).images?.length ? { images: (m as { images?: string[] }).images } : {}) } : m);
  let messages: CoderMessage[] = [{ role: "system", content: coderSystemPrompt({ github, owner: tierFor(chatId) === "owner", connectors: connected, notes: "", date: false }) }, ...w.msgs.map(wire), { role: "user", content: "." }];
  // A warm-up reads the whole conversation to fill the Studio's cache: on a cold Studio that is MINUTES of the one worker (measured 2026-10-25: a 35k-character conversation held a Studio for 7+ minutes
  // while the owner's real request waited behind it). So it is small-only, and the moment a real request of the same chat is sent it is cancelled (cancelWarm).
  // A long conversation is not read ahead (minutes of the one worker), but the START every conversation shares (system text + the whole fixed tool list, ~9k tokens) still is:
  // measured, a new conversation then reads ~24 new tokens instead of ~9,000 (the cache keeps that start across conversations).
  if (messages.reduce((n, m) => n + String((m as { content?: string }).content || "").length, 0) > (Number(process.env.CODER_PREWARM_MAX_CHARS) || 16000)) messages = [messages[0], messages[messages.length - 1]];
  const o = await coderChat(messages, { affinity: `${chatId}:`, tools: coderToolsFor(github, connected.length > 0, messages, sticky), maxTokens: 1, think: false, temperature: 0.2, waitS: 1, timeoutMs: 20000, tag: "prewarm" }).catch(() => null);
  let r = o?.reply || null;
  if (r?.job) warming.set(chatId, r.job);
  const t0 = Date.now();
  while (r?.type === "pending" && r.job && warming.get(chatId) === r.job && Date.now() - t0 < 9 * 60000) {         // keep polling: a job nobody polls is cancelled by the Studio
    await new Promise((res) => setTimeout(res, Number(process.env.CODER_PREWARM_POLL_MS) || 5000));
    r = (await coderJobResult(r.job, 0, 8000).catch(() => null))?.reply || null;
  }
  if (r?.job && warming.get(chatId) === r.job) warming.delete(chatId);
}
const warming = new Map<number, string>();                       // chat -> the Studio job of its warm-up, while it runs
/** A real request is about to be sent for this chat: its warm-up (if still running) must not stand in front of it. */
export async function cancelWarm(chatId: number): Promise<void> {
  const job = warming.get(chatId);
  if (!job) return;
  warming.delete(chatId);
  await coderCancel(job).catch(() => null);
}

/** Starts a coding task from the Mini App using the same durable runner as Telegram chat. */
export async function startAppTask(bot: TelegramBot, botRow: BotRow, chatId: number, text: string, db: Db = prismaDb): Promise<{ runId: string; queued: boolean }> {
  const content = String(text || "").trim();
  if (!content) throw new Error("empty task");
  if (!coderEnabled()) throw new Error("coder service is not configured");
  const st = await loadStateStrict(chatId, db);
  if (st.run?.asking) {                                     // a terminal command answers the agent's question
    await answerAsk(bot, botRow, chatId, st, content, db);
    return { runId: st.run.id, queued: true };
  }
  if (st.run && !st.run.pending) {
    if (await recoverDeadRun(chatId, db)) Object.assign(st, await loadState(chatId, db));
  }
  if (st.run && Date.now() - st.run.lease < LEASE_STALE_MS) {
    st.inbox.push(content);
    await saveStateStrict(chatId, st, db);
    await taskEvent(st.run.id, "info", "وصل طلب جديد من الطرفية وأُضيف إلى المهمة الجارية.", db);
    return { runId: st.run.id, queued: true };
  }
  if (!st.threadId) await ensureThread(chatId, st, db, content);
  const lim = await checkLimit(chatId, "tasks", 1, db);
  if (!lim.ok) throw new Error(limitMessage(lim, st.tz || defaultTz()));
  await addUsage(chatId, "tasks", 1, db);
  st.messages.push({ role: "user", content });
  await startChain(botRow, chatId, st, { source: "interactive", title: content.slice(0, 200), surface: "app" }, db);
  const runId = st.run!.id;
  await taskEvent(runId, "info", "بدأت المهمة من طرفية التطبيق المصغر.", db);
  await saveStateStrict(chatId, st, db);
  later(() => drive(bot, botRow, chatId, st.run!.chain, db, APP_BUDGET_MS));
  later(() => frontAck(bot, chatId, runId, content, "app", db));
  return { runId, queued: false };
}

/** A plan limit was reached: the message (with the reset time) and an "upgrade" button that opens the plans page of the app. */
async function sendLimit(bot: TelegramBot, chatId: number, c: Exclude<LimitCheck, { ok: true }>, tz?: string, prefix = ""): Promise<void> {
  await send(bot, chatId, prefix + limitMessage(c, tz || defaultTz()), { reply_markup: new InlineKeyboard().webApp("⬆️ الترقية والاستخدام", `${appUrl()}?tab=plans`) });
}

/** The inline button that opens the Mini App (optionally on one tab). */
/** The owner panel's buttons (bot /panel). */
const panelKeyboard = (paused: boolean) =>
  new InlineKeyboard()
    .text("🔄 تحديث", "cpanel|refresh").text(paused ? "▶️ استئناف نوفا 1" : "⏸ إيقاف نوفا 1", paused ? "cpanel|nova_resume" : "cpanel|nova_pause").row()
    .text("🛰 تشغيل المراقب الآن", "cpanel|monitor_run").row()
    .webApp("🎛 فتح اللوحة", `${appUrl()}?tab=panel`);

export const appButton = (tab = "") => new InlineKeyboard().webApp("💻 فتح تطبيق Nova AI", `${appUrl()}${tab ? `?tab=${tab}` : ""}`);

/** The chat's persistent menu button opens the Mini App (set once per chat and again whenever the app address changes; `force` sets it again, e.g. on /start). */
async function ensureMenuButton(bot: TelegramBot, chatId: number, st: ChatState, db: Db, force = false): Promise<void> {
  // Always refresh menu button so Telegram picks up new Mini App URL after deploys
  if (st.menu === appUrl() && !force) { /* still update to be safe */ }
  try {
    await (bot.api as any).setChatMenuButton?.({ chat_id: chatId, menu_button: { type: "web_app", text: "📱 التطبيق", web_app: { url: appUrl() } } });
  } catch {
    /* best-effort: the inline button still works */
  }
  st.menu = appUrl();
  await saveState(chatId, st, db);
}

/** A new conversation: the current one is kept as its own thread (nothing is wiped), a fresh thread opens, settings stay. */
export async function newConversation(chatId: number, st: ChatState, db: Db = prismaDb): Promise<string> {
  return switchThread(chatId, st, null, db);
}

/** The chat's first message (or an older single conversation) gets its thread. */
async function ensureThread(chatId: number, st: ChatState, db: Db, firstText = ""): Promise<void> {
  const { createThread, LEGACY_TITLE } = await import("@/lib/coderThreads");
  const legacy = st.messages.length > 0 || !firstText;
  st.threadId = await createThread(chatId, legacy ? { title: LEGACY_TITLE, messages: st.messages, notes: st.notes, convId: st.convId, legacy: true } : { title: firstText }, db);
}

/**
 * Leaves the current thread (saved as it is, its long-term memories are learned later in quiet time) and opens `targetId`
 * (null = a fresh conversation; an empty current thread is reused). A request still running in the old thread is stopped
 * exactly like /stop. Returns the active thread id.
 */
export async function switchThread(chatId: number, st: ChatState, targetId: string | null, db: Db = prismaDb): Promise<string> {
  const T = await import("@/lib/coderThreads");
  const key = coderChatKey(chatId);
  if (targetId && targetId === st.threadId) return targetId;
  let target: Awaited<ReturnType<typeof T.getThread>> = null;
  if (targetId) {
    target = await T.getThread(chatId, targetId, db);
    if (!target || target.deleted_at) throw new Error("no such thread");
  }
  if (!targetId && st.threadId && !st.messages.length && !st.run) return st.threadId;          // already on an empty new chat
  if (st.run?.job) await coderCancel(st.run.job).catch(() => null);
  await endRun(st, "stopped", db, "conversation switched", key);
  if (st.convId) {
    const conv = st.convId;
    later(() => import("@/lib/coderSandbox").then((m) => m.stopSandbox(key, conv)));
  }
  if (st.threadId) await T.syncThread(key, st.threadId, st, db, st.messages.length > 0);
  else if (st.messages.length) await ensureThread(chatId, st, db);
  if (!encryptionReady() && st.messages.length) rememberLater(chatId, st.messages, undefined, st.repo, db);   // no key for quiet time: as before
  const next: ChatState = { ...emptyState(), groups: st.groups, mode: st.mode, think: st.think, tz: st.tz, lang: st.lang, repo: st.repo, menu: st.menu, accuracy: st.accuracy, model: st.model };
  if (target) {
    next.threadId = target.id;
    next.messages = target.messages || [];
    next.notes = target.notes || "";
    next.convId = target.conv_id || undefined;
  } else next.threadId = await T.createThread(chatId, {}, db);
  await saveState(chatId, next, db);
  Object.assign(st, next);
  return next.threadId!;
}

/** The Mini App's ⏹ and /stop: the Studio job is cancelled, the request ends as stopped, its queued messages are dropped. */
export async function stopRun(chatId: number, slot = "", runId?: string, db: Db = prismaDb): Promise<boolean> {
  const st = await loadState(chatId, db, slot);
  if (!st.run || (runId && st.run.id !== runId)) return false;
  if (st.run.job) await coderCancel(st.run.job).catch(() => null);
  if (st.run.delegating) await cancelAgents(chatId, st.run.delegating.slots, db);
  await endRun(st, "stopped", db, slot ? "stopped from the app" : "/stop", coderChatKey(chatId));
  if (!slot && st.convId) {
    const conv = st.convId;
    later(() => import("@/lib/coderSandbox").then((m) => m.stopSandbox(coderChatKey(chatId), conv)));
  }
  st.inbox = [];
  await saveState(chatId, st, db, slot);
  return true;
}

/** The Mini App opened before any message: an older single conversation (or older requests) becomes the "previous conversation" thread. */
export async function adoptThread(chatId: number, st: ChatState, db: Db = prismaDb): Promise<void> {
  if (st.threadId) return;
  await ensureThread(chatId, st, db);
  await saveState(chatId, st, db);
}

const encryptionReady = () => Boolean((process.env.CODER_TOKEN_KEY || "").trim());

/** Long-term memory extraction in the background (coderMemory.ts); CODER_MEMORY=off disables it. */
function rememberLater(chatId: number, msgs: CoderMessage[], runId: string | undefined, repo: string | undefined, db: Db): void {
  if ((process.env.CODER_MEMORY || "").toLowerCase() === "off") return;
  const snap = msgs.slice(-40);
  later(() => import("@/lib/coderMemory").then((m) => m.extractMemories(chatId, snap, { runId, repo }, db)).catch(() => null));
}

/**
 * A tap on ✅ / ✅ للمهمة كلها / ❌ — from the inline buttons or from the Mini App (both end here, and the other side is updated:
 * the Telegram buttons are removed, the app sees the pending card disappear). Returns false when nothing was pending under that nonce.
 */
export async function resolvePending(
  bot: TelegramBot, botRow: BotRow, chatId: number, runId: string, nonce: string, answer: "yes" | "no" | "all", db: Db = prismaDb, msgId?: number,
): Promise<boolean> {
  const slot = (await taskSlot(runId, chatId, db)) ?? "";
  const st = await loadState(chatId, db, slot);
  const run = st.run;
  const mid = msgId ?? run?.pending?.msgId;
  if (mid) await bot.api.editMessageReplyMarkup(chatId, mid, { reply_markup: new InlineKeyboard() }).catch(() => null);
  if (!run || run.id !== runId) {
    if (msgId) await send(bot, chatId, "انتهت هذه المهمة بالفعل.");
    return false;
  }
  if (!run.pending || run.pending.nonce !== nonce) return false;
  const ioBot = surfaceBot(bot, run.surface, run.origin);
  const pending = run.pending;
  run.pending = undefined;
  const [first, ...rest] = pending.calls;
  if (answer !== "no") {
    if (answer === "all") {
      run.allowCats = [...new Set([...(run.allowCats || []), ...(pending.categories || [])])];
      if (run.agent && run.parentRunId) {      // the user's "for the rest of the task" on an agent's card is for the whole task
        const pslot = (await taskSlot(run.parentRunId, chatId, db)) ?? "";
        const pst = await loadState(chatId, db, pslot);
        if (pst.run?.id === run.parentRunId) {
          pst.run.allowCats = [...new Set([...(pst.run.allowCats || []), ...(pending.categories || [])])];
          await saveState(chatId, pst, db, pslot);
        }
      }
    }
    await send(ioBot, chatId, answer === "all" ? `✅ تم التأكيد لبقية هذه المهمة: ${pending.reason}` : `✅ تم التأكيد: ${pending.reason}`);
    await taskEvent(run.id, "approved", `${answer === "all" ? "[rest of task] " : ""}${pending.reason} — ${first.function.name}`, db);
    // Never execute a potentially slow GitHub/sandbox tool inside the 30-second Mini App HTTP request.
    // The shared background runner consumes this one-time approval and performs the tool after the response.
    run.approved = [...new Set([...(run.approved || []), toolCallKey(first)])];
    run.queued = pending.calls;
  } else {
    await send(ioBot, chatId, "❌ أُلغيت هذه الخطوة.");
    await taskEvent(run.id, "declined", `${pending.reason} — ${first.function.name}`, db);
    st.messages.push({ role: "tool", content: "The user declined this action (it was NOT executed). Continue without it or ask what they want.", tool_call_id: first.id, name: first.function.name });
    run.queued = rest;
  }
  await startChain(botRow, chatId, st);
  await taskStatus(run.id, "running", run.step, db);
  await saveState(chatId, st, db, slot);
  later(() => drive(bot, botRow, chatId, st.run!.chain, db, BUDGET_MS, slot));
  return true;
}

async function permsKeyboard(chatId: number, db: Db): Promise<InlineKeyboard> {
  const rules = await loadPrefs(chatId, db);
  const tier = tierFor(chatId);
  const kb = new InlineKeyboard();
  for (const c of CATEGORIES) {
    const p = globalPolicy(rules, c);
    const label = p === "default" ? `افتراضي (${tierDefault(tier, c) === "ask" ? "اسأل" : "ينفّذ"})` : POLICY_LABEL[p].ar;
    const icon = p === "allow" ? "🟢" : p === "deny" ? "⛔" : p === "ask" ? "❓" : "⚪";
    kb.text(`${icon} ${CATEGORY_LABEL[c].ar}: ${label}`, `cperm|${c}`).row();
  }
  return kb;
}

async function startChain(_botRow: BotRow, chatId: number, st: ChatState, init: Partial<Run> = {}, db: Db = prismaDb): Promise<void> {
  if (!st.run) {
    st.run = { id: randomUUID().slice(0, 12), chain: "", sent: 0, logged: 0, step: 0, lease: Date.now(), startedAt: Date.now(), source: "interactive", slot: "", surface: "telegram", ...init };
    const last = [...st.messages].reverse().find((m) => m.role === "user");
    const title = st.run.title || String(last?.content || "").slice(0, 200);
    st.run.goal = st.run.goal || String(last?.content || "").slice(0, 4000);
    await taskStart(chatId, { runId: st.run.id, slot: st.run.slot || "", source: st.run.source || "interactive", scheduleId: st.run.scheduleId, title, botId: _botRow.id, threadId: st.run.slot ? null : st.threadId || null }, db);
  }
  st.run.chain = randomUUID().slice(0, 12);
  st.run.lease = Date.now();
}

/** A run ended: history status + the run cleared. */
async function endRun(st: ChatState, status: TaskStatus, db: Db, note = "", chatKeyOf = ""): Promise<void> {
  const run = st.run;
  st.run = null;
  if (!run) return;
  // a job still on the Studio when its run ends would hold the Studio's one-at-a-time queue for the next user: cancel it (harmless if done)
  if (run.job) {
    const job = run.job;
    later(() => coderCancel(job).catch(() => null));
  }
  if (run.agent && !st.agentResult) st.agentResult = { status, text: note || status, at: Date.now() };   // a sub-agent always leaves a report row, even when it failed or was stopped
  if (note) await taskEvent(run.id, status === "done" ? "done" : status === "stopped" ? "info" : "failed", note, db);
  await taskStatus(run.id, status, run.step, db);
  // the conversation's saved copy follows each finished request (memories are learned from it later, in quiet time)
  if (!run.slot && st.threadId && chatKeyOf) {
    const { syncThread } = await import("@/lib/coderThreads");
    await syncThread(chatKeyOf, st.threadId, st, db, true);
  }
  // a scheduled run's VM ends with the run; the chat's VM lives for the conversation (stopped by /new or /stop, or its own timeout)
  if (chatKeyOf && run.slot) later(() => import("@/lib/coderSandbox").then((m) => m.stopSandbox(chatKeyOf, run.id)));
  if (run.scheduleId) {
    const { scheduleRunFinished } = await import("@/lib/coderSchedules");
    await scheduleRunFinished(run.scheduleId, status, db);
  }
}

const contextOf = (run: Run): Context => (run.agent ? run.parentCtx || "interactive" : run.source && run.source !== "interactive" ? "scheduled" : "interactive");
const toolCallKey = (call: CoderToolCall): string => call.id || `${call.function.name}:${call.function.arguments}`;

/** The largest size of a Telegram photo, downloaded and shrunk to what the model should be shown. */
async function telegramPhoto(bot: TelegramBot, botRow: BotRow, sizes: { file_id: string; file_size?: number; width?: number }[]): Promise<string | null> {
  try {
    const big = [...sizes].sort((x, y) => (y.width || 0) - (x.width || 0) || (y.file_size || 0) - (x.file_size || 0))[0];
    const f = await bot.api.getFile(big.file_id);
    const r = await fetch(`https://api.telegram.org/file/bot${botRow.token}/${f.file_path}`, { signal: AbortSignal.timeout(20000) });
    return await toModelImage(Buffer.from(await r.arrayBuffer()));
  } catch {
    return null;
  }
}

async function readDocument(bot: TelegramBot, botRow: BotRow, doc: { file_id: string; file_name?: string; file_size?: number }): Promise<string> {
  if ((doc.file_size || 0) > 400_000) return `[file ${doc.file_name || ""} is too big to read here (${doc.file_size} bytes)]`;
  try {
    const f = await bot.api.getFile(doc.file_id);
    const r = await fetch(`https://api.telegram.org/file/bot${botRow.token}/${f.file_path}`, { signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    return `File ${doc.file_name || f.file_path}:\n\`\`\`\n${body.slice(0, 120000)}\n\`\`\``;
  } catch {
    return `[could not read file ${doc.file_name || ""}]`;
  }
}

/** Tools for this chat: the owner's token for the owner, a user's own linked token for a user (src/lib/coderAuth.ts), else none. */
async function toolCtx(chatId: number, st: ChatState, db: Db, run?: Run | null, botId?: string): Promise<ToolCtx & { tier: Tier }> {
  const conn = await resolveConnections(chatId, db);
  return {
    tier: tierFor(chatId),
    runId: (run || st.run)?.slot ? (run || st.run)!.id : (st.convId ||= randomUUID().slice(0, 12)),   // sandbox key: per scheduled run, per chat conversation
    chatKey: coderChatKey(chatId),
    userId: chatId,
    botId,
    tz: st.tz || defaultTz(),
    db,
    githubToken: conn.github?.token || null,
    gh: conn.github ? githubClient(conn.github.token) : null,
    addNote: (t: string) => {
      st.notes = `${st.notes}\n- ${t}`.trim().slice(-4000);
    },
  };
}

/** Fresh copies of the files the task was working on (re-read on recovery), short. */
async function rereadTouched(ctx: ToolCtx, ss: StallState): Promise<string> {
  if (!ctx.gh) return "";
  const out: string[] = [];
  for (const t of ss.touched.slice(-3)) {
    const i = t.indexOf(":");
    const call = { id: "reread", type: "function" as const, function: { name: "github_read_file", arguments: JSON.stringify({ repo: t.slice(0, i), path: t.slice(i + 1) }) } };
    out.push((await runTool(call, ctx)).slice(0, 3000));
  }
  return out.join("\n\n");
}

async function onStall(stall: Stall, run: Run, chatId: number, ctx: ToolCtx, db: Db): Promise<void> {
  const ss = run.stall!;
  await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: stall.pattern, level: ss.level, detail: stall.detail }, db);
  const fresh = ss.level >= 2 ? await rereadTouched(ctx, ss) : "";
  run.recovery = `${run.recovery ? run.recovery + "\n\n" : ""}${recoveryMessage(stall, ss, fresh)}`;
}

// ---------------------------------------------------------------- the loop: submit -> poll/stream -> tools (guarded) -> submit … until a final answer
async function handOff(botRow: BotRow, chatId: number, chain: string, slot = ""): Promise<void> {
  const who = slot ? `${chatId}#${slot}` : String(chatId);       // the slot is part of what is signed
  const body = JSON.stringify({ botId: botRow.id, chatId: who, chain, sig: signContinue(botRow.webhookSecret || "", botRow.id, who, chain) });
  // Do not retry an ambiguous POST: the server may have accepted it even if the response was lost, and a retry could start two runners.
  const res = await fetch(`${selfUrl()}/api/coder/continue`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (res.status !== 202) throw new Error(`coder continuation handoff was not accepted (HTTP ${res.status})`);
}

/**
 * One live "progress card" per streak of tool calls (idea taken from CI agents that keep a single status comment up to date):
 * the first tool sends a message, the next ones edit it, so the chat is not flooded with one line per step. A text reply from the
 * model closes the card; the next tools open a new one. CODER_PROGRESS_CARD=off restores one message per tool.
 */
/** What the model is told about its own time, so IT can decide to stop reading: the step and minutes spent on this task, from step 6 or the 8th minute on. Information only (the model decides);
 *  it is stored with the tool result, so the prompt prefix the Studio cached stays byte-identical on the next step. CODER_TIME_NOTE=off removes it. */
export function progressNote(run: { step: number; startedAt?: number; agent?: boolean }, now = Date.now()): string {
  if (run.agent || (process.env.CODER_TIME_NOTE || "").toLowerCase() === "off") return "";
  const min = Math.round((now - (run.startedAt || now)) / 60000);
  if (run.step < 5 && min < 8) return "";
  return `\n[time: step ${run.step + 1}, ${min} min spent on this task${min >= 20 ? "; this is already long" : ""}. If what you have read is enough to answer, write the answer now instead of reading more.]`;
}

/** A poll that got no answer for a reason that passes: no connection, a timeout, the hub's rate limit (429) or a server error (5xx). The job is not lost; the poll is repeated. */
export const pollTransient = (o: { failure?: string; status?: number }): boolean =>
  o.failure === "timeout" || o.failure === "network" || (o.failure === "http" && (o.status === 429 || Number(o.status) >= 500 || o.status === undefined));

/** The "typing…" indicator. Off by default: in the owner's chat the client reserved a blank area under her message while it was on (the message jumped to the top of the screen until the reply came). CODER_TYPING=on brings it back. */
async function typing(bot: TelegramBot, chatId: number): Promise<void> {
  if ((process.env.CODER_TYPING || "").toLowerCase() !== "on") return;
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
}

/** The clock on the progress card: the user's local time (CODER_DEFAULT_TZ, Syria / Türkiye UTC+3 by default), never the server's UTC. */
export function localClock(now: Date = new Date(), tz: string = defaultTz()): string {
  return now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz });
}

/** The progress card: the tool steps so far (✅ done, ▶️ current) and, under them, the live state of the model (reading %, thinking, writing, queue) with the time of the last update. */
function cardText(run: Run): string {
  const p = run.progress || { lines: [] as string[] };
  const shown = p.lines.slice(-12);
  const clock = localClock();
  return `📋 التقدم${run.step ? ` · الخطوة ${run.step + 1}` : ""}\n${p.lines.length > shown.length ? `… (${p.lines.length - shown.length} سابقة)\n` : ""}${shown.map((l, i) => (i === shown.length - 1 ? `▶️ ${l}` : `✅ ${l}`)).join("\n")}\n\n${p.phase ? `⏳ ${p.phase}` : "🔄 جارٍ..."}\n🕒 ${clock}`.slice(0, 4000);
}
/** Live refresh of the same card message while the model works (every few seconds): the chat shows each phase from start to end, like the app's log. Never sends a second card when an edit fails. */
async function refreshCard(bot: TelegramBot, chatId: number, run: Run, phase: string): Promise<void> {
  if ((process.env.CODER_PROGRESS_CARD || "").toLowerCase() === "off" || typeof (bot.api as any).editMessageText !== "function") return;
  const p = (run.progress ||= { lines: [] });
  p.phase = phase;
  if (!p.msgId) {
    if (!p.lines.length) p.lines.push("بدأت المهمة");
    const m = await bot.api.sendMessage(chatId, cardText(run)).catch(() => null);
    p.msgId = (m as any)?.message_id || undefined;
    return;
  }
  await (bot.api as any).editMessageText(chatId, p.msgId, cardText(run)).catch(() => null);
}

async function progressLine(bot: TelegramBot, chatId: number, run: Run, line: string): Promise<void> {
  if ((process.env.CODER_PROGRESS_CARD || "").toLowerCase() === "off" || typeof (bot.api as any).editMessageText !== "function") {
    await send(bot, chatId, line);
    return;
  }
  const p = (run.progress ||= { lines: [] });
  p.lines.push(line.slice(0, 300));
  const shown = p.lines.slice(-12);
  const text = cardText(run);
  if (p.msgId) {
    const ok = await (bot.api as any).editMessageText(chatId, p.msgId, text).then(() => true).catch(() => false);
    if (ok) return;
  }
  const m = await bot.api.sendMessage(chatId, text).catch(() => null);
  p.msgId = (m as any)?.message_id || undefined;
}

/** The live progress card must never stay on "working…" after the task ended: it says so. */
/** "Allow for the rest of this task" is one thing for the whole task tree: an agent sees what its parent allowed (also later), and what the user allowed on an agent's card reaches the parent (and so its other agents). */
async function parentAllowCats(chatId: number, run: Run, db: Db): Promise<Category[]> {
  if (!run.agent || !run.parentRunId) return [];
  const slot = (await taskSlot(run.parentRunId, chatId, db)) ?? "";
  const st = await loadState(chatId, db, slot);
  return st.run?.id === run.parentRunId ? st.run.allowCats || [] : [];
}

/** A small model sometimes drops Chinese/Japanese/Korean words into an Arabic or English answer (seen in the owner's tests). Removed char by char (so a streamed prefix stays a prefix) when the user wrote in neither. */
const FOREIGN_RX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/g;
export function stripForeignScript(text: string, userText: string): string {
  if (FOREIGN_RX.test(userText)) { FOREIGN_RX.lastIndex = 0; return text; }
  FOREIGN_RX.lastIndex = 0;
  return text.replace(FOREIGN_RX, "").replace(/ {2,}/g, " ");
}

async function closeCard(bot: TelegramBot, chatId: number, run: Run | null | undefined, text: string, atEnd = false): Promise<void> {
  const mid = run?.progress?.msgId;
  if (!mid) return;
  run!.progress = undefined;
  if (atEnd) {
    // a stop / failure notice belongs AFTER the replies already shown, not in the card at the top of the conversation: the card goes, the notice is a new last message
    await (bot.api as any).deleteMessage?.(chatId, mid)?.catch?.(() => null);
    await (bot.api as any).sendMessage?.(chatId, text)?.catch?.(() => null);
    return;
  }
  await (bot.api as any).editMessageText?.(chatId, mid, text)?.catch?.(() => null);
}

/** Keep the existing progress message alive while a slow Studio/GitHub call is in flight. */
async function withHeartbeat<T>(bot: TelegramBot, chatId: number, run: Run, label: string, work: () => Promise<T>): Promise<T> {
  let beat = 0;
  const timer = setInterval(() => {
    beat += 1;
    if (run.surface === "app") {
      if (beat % 2 === 0) void taskEvent(run.id, "info", `⏳ ${label} — ما زال التنفيذ جارياً`).catch(() => null);
      return;
    }
    const msgId = run.progress?.msgId;
    if (!msgId) return;
    const dots = ".".repeat((beat % 3) + 1);
    const text = `📋 التقدم\n⏳ ${label}\n🔄 أعمل${dots}\n\n⏱️ ${localClock()}`;
    void (bot.api as any).editMessageText(chatId, msgId, text).catch(() => null);
  }, 8000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

/** A model reply: its Markdown rendered as Telegram HTML; if Telegram refuses that, the same text without the marks. */
async function sendRich(bot: TelegramBot, chatId: number, text: string) {
  const { markdownToTelegramHtml, stripMarkdown } = await import("@/lib/telegramMarkdown");
  const html = markdownToTelegramHtml(text);
  if (html.length <= 4096) {
    const ok = await bot.api.sendMessage(chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } } as never).then(() => true).catch(() => false);
    if (ok) return;
  }
  for (const piece of splitForTelegram(stripMarkdown(text), 4000)) await send(bot, chatId, piece);
}

const DRAFT_MAX = 3600;           // characters one live draft may hold (Telegram: 4096 after formatting)
const DRAFT_EVERY_MS = 1500;      // at most one draft update this often (Bot API rate limits)
let draftRefusedAt = 0;           // Telegram refused drafts for this bot: not tried again for an hour (every run would pay one failed call)
const liveDraftOn = () => (process.env.CODER_LIVE_DRAFT || "").toLowerCase() !== "off" && Date.now() - draftRefusedAt > 3600_000;

async function commitMessages(bot: TelegramBot, chatId: number, text: string, run: Run, ranges: [number, number][]) {
  for (const [a, b] of ranges) {
    const part = renderRange(text, a, b);
    if (part.trim()) await sendRich(bot, chatId, part);
    run.botSent = b;
    run.draftId = undefined;                                            // the next stretch starts a fresh draft
  }
}

/** Telegram-side delivery of a run's text (see sendParts). `text` is everything the model has written so far in this step. */
export async function deliverToChat(bot: TelegramBot, chatId: number, text: string, run: Run, final: boolean): Promise<void> {
  const from = Math.max(0, Math.min(text.length, run.botSent || 0));
  const unsent = text.length - from;
  if (unsent <= 0 || !text.slice(from).trim()) return;
  if (final) {
    await commitMessages(bot, chatId, text, run, chunkRanges(text, from, true, 3800));
    run.botProgressAt = Date.now();
    return;
  }
  const api = bot.api as any;
  const canDraft = liveDraftOn() && !run.noDraft && chatId > 0 && typeof api.sendMessageDraft === "function";
  if (canDraft) {
    if (unsent > DRAFT_MAX) {                                           // too long for one draft: commit the finished part
      await commitMessages(bot, chatId, text, run, chunkRanges(text, from, false, 3000));
    }
    const start = Math.max(0, Math.min(text.length, run.botSent || 0));
    const tail = renderRange(text, start, text.length);
    if (tail.trim() && tail !== run.draftText && Date.now() - (run.draftAt || 0) >= DRAFT_EVERY_MS) {
      run.draftId = run.draftId || 1 + Math.floor(Math.random() * 2_000_000_000);
      const { markdownToTelegramHtml } = await import("@/lib/telegramMarkdown");
      const html = markdownToTelegramHtml(tail);
      let ok = html.length <= 4096 && await api.sendMessageDraft(chatId, run.draftId, html, { parse_mode: "HTML" }).then(() => true).catch(() => false);
      if (!ok) ok = await api.sendMessageDraft(chatId, run.draftId, tail.slice(0, 4096)).then(() => true).catch(() => false);
      if (ok) { run.draftAt = Date.now(); run.draftText = tail; }
      else { run.noDraft = true; draftRefusedAt = Date.now(); }         // refused (not supported here): batches from now on
    }
    return;
  }
  // no live draft: readable batches, not every token
  if (unsent > 1000 || (unsent >= 300 && Date.now() - (run.botProgressAt || 0) > 25000)) {
    const batchSize = Math.max(250, Math.min(1200, unsent - 1));
    await commitMessages(bot, chatId, text, run, chunkRanges(text, from, false, batchSize));
    run.botProgressAt = Date.now();
  }
}

async function sendParts(bot: TelegramBot, chatId: number, text: string, run: Run, final: boolean, db: Db = prismaDb) {
  if (run.surface === "app") {
    const from = Math.max(0, Math.min(text.length, run.logged || 0));
    const delta = text.slice(from);
    if (delta.trim()) await taskEvent(run.id, "text", delta, db);
    run.logged = text.length;
    run.sent = text.length;

    // The terminal is the detailed live feed. In the chat the text is delivered by what is actually happening (never by what the
    // request says): while the model writes, the tail streams live in a Telegram draft (sendMessageDraft, private chats); whatever
    // no longer fits one draft is committed as real messages cut at paragraph/line ends; the rest is sent as the final message
    // (one message when it fits 4096 characters, never fragments). If drafts are refused, the same text goes in readable batches.
    await deliverToChat(bot, chatId, text, run, final);
    // a plain answer (no tool ran): the "request received" card has nothing more to say, so it is removed instead of staying stuck
    if (final && text.trim() && run.progress?.msgId && run.progress.lines.length <= 2) {
      const mid = run.progress.msgId;
      run.progress = undefined;
      await (bot.api as any).deleteMessage?.(chatId, mid)?.catch?.(() => null);
    }
    return;
  }
  for (const [a, b] of chunkRanges(text, run.sent, final)) {
    const part = renderRange(text, a, b);
    if (part.trim()) {
      if (final && run.progress?.msgId) {
        await (bot.api as any).editMessageText(chatId, run.progress.msgId, "✅ اكتمل توليد الرد بنجاح.\n📄 أُرسلت النتيجة في الرسائل التالية.").catch(() => null);
      }
      run.progress = undefined;
      await sendRich(bot, chatId, part);
      await taskEvent(run.id, "text", part);
    }
    run.sent = b;
  }
}

async function driveLoop(bot: TelegramBot, botRow: BotRow, chatId: number, chain: string, db: Db = prismaDb, budgetMs = BUDGET_MS, slot = ""): Promise<void> {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  let cached: CoderReply | null = null;                 // `chat` already answered within its wait: no extra poll
  for (;;) {
    let st: ChatState;
    try {
      st = await loadStateStrict(chatId, db, slot);
    } catch {
      // A transient pooler/DB error must not look like an empty conversation and silently kill the task.
      if (left() < 7000) { await handOff(botRow, chatId, chain, slot); return; }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1200, Math.max(200, left() - 6000))));
      continue;
    }
    const run = st.run;
    if (!run || run.chain !== chain || run.pending || run.asking) return;
    const ioBot = surfaceBot(bot, run.surface, run.origin);
    run.stall = run.stall || newStallState();
    run.lease = Date.now();
    if (left() < 6000) {
      await saveState(chatId, st, db, slot);
      await handOff(botRow, chatId, chain, slot);
      return;
    }
    const ctx = await toolCtx(chatId, st, db, run, botRow.id);
    const github = Boolean(ctx.gh);

    // 0) sub-agents running for this run: wait for their reports (they are separate runs; this leg only polls their state rows)
    if (run.delegating) {
      const d = run.delegating;
      const kids = await Promise.all(d.slots.map((sl) => loadState(chatId, db, sl)));
      const finished = kids.map((k) => (k.agentResult && !k.run ? k.agentResult : undefined));
      const timedOut = Date.now() - d.at > AGENT_TIMEOUT_MS;
      if (finished.every(Boolean) || timedOut) {
        if (timedOut) await cancelAgents(chatId, d.slots, db);
        st.messages.push({ role: "tool", content: composeResults(await fitReports(d.titles.map((title, i) => ({ title, result: finished[i] })), async (t) => (await import("@/lib/coderMemory")).studioLlm(150000)([{ role: "user", content: `Condense this agent report to about half its length. Keep EVERY name, path, number, version, source and the whole NOT DONE and OUTPUT lines exactly; drop only repetition and filler. Keep the four labelled lines (JOB, DONE, NOT DONE, OUTPUT).\n\n${t}` }]))), tool_call_id: d.id, name: "delegate" });
        run.delegating = undefined;
        await taskEvent(run.id, "info", `🧩 وصلت تقارير الوكلاء (${finished.filter(Boolean).length}/${d.slots.length})${timedOut ? " — انتهت المهلة" : ""}.`, db);
        await progressLine(ioBot, chatId, run, `🧩 وصلت تقارير الوكلاء (${finished.filter(Boolean).length}/${d.slots.length})`);
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (Date.now() - (d.noted || d.at) > 60000) {
        d.noted = Date.now();
        await taskEvent(run.id, "info", `⏳ بانتظار الوكلاء: ${finished.filter(Boolean).length}/${d.slots.length} أنهوا.`, db);
        await saveState(chatId, st, db, slot);
      }
      await typing(ioBot, chatId);
      await new Promise((res) => setTimeout(res, Math.max(200, Math.min(pollMs() * 2, 3000, left() - 7000))));
      continue;
    }

    // 1) tool calls waiting to run (after a confirmation, or the rest of a batch)
    if (run.queued?.length) {
      const [call, ...rest] = run.queued;
      if (run.agent && !agentToolAllowed(call.function.name, run.agentRole, run.agentDepth || 1, parseArgs(call))) {
        // an agent only uses its role's tools: enforced here, whatever the model asks for
        st.messages.push({ role: "tool", content: "DENIED: your role has no such tool. Use only the tools you were given, or write your report now.", tool_call_id: call.id, name: call.function.name });
        run.queued = rest;
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (call.function.name === "delegate") {
        const tasks = normalizeTasks(parseArgs(call), tierFor(chatId) === "owner", run.agent ? run.agentDepth || 1 : 0);
        run.queued = rest;
        if (!agentsEnabled() || !tasks.length) {
          st.messages.push({ role: "tool", content: tasks.length ? "error: sub-agents are switched off" : "error: delegate needs tasks:[{title, task}] (1 to 3)", tool_call_id: call.id, name: "delegate" });
          await saveState(chatId, st, db, slot);
          continue;
        }
        const slots = await startAgents(bot, botRow, chatId, st, run, tasks, db);
        run.delegating = { id: call.id || "delegate", slots, titles: tasks.map((t) => t.title), at: Date.now() };
        await progressLine(ioBot, chatId, run, `🧩 وكلاء (${tasks.length}): ${tasks.map((t) => t.title).join(" · ").slice(0, 120)}`);
        await taskEvent(run.id, "tool", `🧩 إطلاق ${tasks.length} وكيل: ${tasks.map((t) => `${t.title} [${t.role}]`).join(" | ")}`, db);
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (call.function.name === "ask_user") {
        // not a tool that runs: the question goes to the chat and the task waits (without a time limit) for the user's answer
        const a = parseArgs(call);
        const q = String(a.question || "").trim().slice(0, 900) || "؟";
        const opts = (Array.isArray(a.options) ? a.options : []).map((x: unknown) => String(x).slice(0, 80)).filter(Boolean).slice(0, 6);
        run.queued = rest;
        run.asking = { id: call.id || "ask", name: "ask_user", question: q, at: Date.now() };
        await closeCard(ioBot, chatId, run, "❓ بانتظار جوابك.");
        await taskEvent(run.id, "confirm", `❓ سؤال للمستخدم: ${q}`, db);
        await taskStatus(run.id, "waiting", run.step, db);
        await saveState(chatId, st, db, slot);
        await send(bot, chatId, `❓ ${q}${opts.length ? `\n\n${opts.map((o: string, i: number) => `${i + 1}. ${o}`).join("\n")}` : ""}\n\nاكتب جوابك هنا وأكمل المهمة.`);
        return;
      }
      if ((call.function.name === "view_image" || call.function.name === "view_video" || call.function.name === "make_media") && (!run.agent || run.agentRole === "worker" || run.agentRole === "sham")) {
        // tools whose result is a picture the model is shown next (view_*), or a file made by Sham and sent to the chat (make_media): they need the chat, so they run here
        const a = parseArgs(call);
        let out = "";
        let shown: string[] = [];
        let from = "";
        try {
          if (call.function.name === "make_media") {
            // Nova's OWN media Studio (src/lib/novaMedia.ts -> ai-system/modelscope-media): SDXS pictures, Piper speech, AnimateDiff video. Nothing of Sham's is used here.
            const kind = ["image", "audio", "video"].includes(String(a.kind)) ? (String(a.kind) as "image" | "audio" | "video") : null;
            const prompt = String(a.prompt || "").trim().slice(0, 600);
            const nm = await import("@/lib/novaMedia");
            const { vetMedia } = await import("@/lib/mediaQuality");
            if (!kind || !prompt) out = "error: kind (image | audio | video) and prompt are required";
            else if (!nm.novaMediaEnabled()) out = "error: Nova's media Studio is not connected here. Nothing was made or sent; tell the user so, do not say it was made.";
            else {
              const r0 = await withHeartbeat(ioBot, chatId, run, `جارٍ صنع ${kind === "image" ? "صورة" : kind === "audio" ? "صوت" : "مقطع"}`, () => nm.novaMakeMedia(kind, prompt, { timeoutMs: 240000 }));
              const r = (await vetMedia(r0)) as typeof r0;               // the last gate before Telegram: a blank / constant / noise picture, silent sound or empty clip is never sent
              const rb = realBot(bot);
              if (r?.b64 && r.type === "image") { await (rb.api as any).sendPhoto(chatId, new InputFile(Buffer.from(r.b64, "base64"), "nova.png")); out = "made by Nova's media Studio and sent to the user as a picture"; }
              else if (r?.b64 && r.type === "audio") { await (rb.api as any).sendDocument(chatId, new InputFile(Buffer.from(r.b64, "base64"), "nova.wav")); out = "made by Nova's media Studio and sent to the user as a sound file"; }
              else if (r?.b64 && r.type === "video") { await (rb.api as any).sendVideo(chatId, new InputFile(Buffer.from(r.b64, "base64"), "nova.mp4")); out = "made by Nova's media Studio and sent to the user as a short video"; }
              else out = `error: the ${kind} could not be made (${r?.text ? String(r.text).slice(0, 220) : r?.type || "no answer"}). NOTHING was sent to the user: tell them plainly that it failed; never say it was made.`;
            }
          } else {
            const { anyVisionStudio } = await import("@/lib/openCoderStudio");
            if (!(await anyVisionStudio())) out = "error: no Studio reads pictures yet (vision is not switched on). Say so to the user; do not guess what the picture shows.";
            else if (call.function.name === "view_image") {
              let bytes: Buffer | null = null;
              if (a.url) {
                const { safeGetBytes } = await import("@/lib/coderWeb");
                bytes = (await safeGetBytes(String(a.url))).bytes; from = String(a.url).slice(0, 160);
              } else if (a.path) {
                const { readSandboxFile } = await import("@/lib/coderSandbox");
                const f = await readSandboxFile({ chatKey: ctx.chatKey, runId: ctx.runId, githubToken: ctx.githubToken }, String(a.path), a.cwd ? String(a.cwd) : undefined);
                bytes = f?.bytes || null; from = f?.path || String(a.path);
              } else out = "error: give a url or a path";
              if (!out) { const img = bytes ? await toModelImage(bytes) : null; if (img) shown = [img]; else out = "error: that is not a picture I can read (or the file was not found)"; }
            } else {
              const n = Math.max(1, Math.min(6, Number(a.frames) || 4));
              const { runSandboxTool, readSandboxFile } = await import("@/lib/coderSandbox");
              const sc = { chatKey: ctx.chatKey, runId: ctx.runId, githubToken: ctx.githubToken };
              const file = String(a.path || "").replace(/'/g, "'\\''");
              const cmd = `command -v ffmpeg >/dev/null || { echo "NO_FFMPEG"; exit 3; }; mkdir -p /tmp/vf && rm -f /tmp/vf/f*.jpg; D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 '${file}' 2>/dev/null || echo 4); for i in $(seq 1 ${n}); do T=$(python3 -c "print(max(0, float('$D'.strip() or 4) * ($i - 0.5) / ${n}))"); ffmpeg -loglevel error -y -ss $T -i '${file}' -frames:v 1 -vf scale=512:-2 /tmp/vf/f$i.jpg; done; ls /tmp/vf`;
              const r = (await runSandboxTool("sandbox_exec", { command: cmd, cwd: a.cwd }, sc)) || "";
              if (/NO_FFMPEG/.test(r)) out = "error: ffmpeg is not installed in the VM. Install it first with sandbox_exec (e.g. `sudo dnf install -y ffmpeg-free` or `pip install imageio-ffmpeg`), then call view_video again.";
              else {
                for (let i = 1; i <= n; i++) {
                  const f = await readSandboxFile(sc, `/tmp/vf/f${i}.jpg`);
                  const img = f ? await toModelImage(f.bytes, 512) : null;
                  if (img) shown.push(img);
                }
                from = String(a.path).slice(0, 160);
                if (!shown.length) out = `error: no frames could be taken from the video (${r.slice(0, 200)})`;
              }
            }
          }
        } catch (e) {
          out = `error: ${String((e as Error)?.message || e).slice(0, 240)}`;
        }
        await taskEvent(run.id, "tool", toolLabel(call), db);
        if (shown.length) {
          st.messages.push({ role: "tool", content: `${shown.length} picture${shown.length > 1 ? "s" : ""} from ${from} will be shown to you in the next message.`, tool_call_id: call.id, name: call.function.name });
          st.messages.push({ role: "user", content: `[the ${call.function.name === "view_video" ? "frames of the video" : "picture"} you asked to see: ${from}]`, images: shown });
        } else st.messages.push({ role: "tool", content: out, tool_call_id: call.id, name: call.function.name });
        run.queued = rest;
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (call.function.name === "send_file" && (!run.agent || run.agentRole === "worker" || run.agentRole === "sham")) {
        // not a tool that runs in the VM: the file leaves the VM and goes to the user's chat as a document
        const a = parseArgs(call);
        let out: string;
        try {
          const { readSandboxFile } = await import("@/lib/coderSandbox");
          const f = await readSandboxFile({ chatKey: ctx.chatKey, runId: ctx.runId, githubToken: ctx.githubToken }, String(a.path || ""), a.cwd ? String(a.cwd) : undefined);
          if (!f) out = "error: the file was not found in the VM (check the path first, e.g. with sandbox_search)";
          else if (f.bytes.length > 45 * 1024 * 1024) out = "error: the file is too large for Telegram (45 MB at most)";
          else {
            await (realBot(bot).api as any).sendDocument(chatId, new InputFile(f.bytes, f.path.split("/").pop() || "file"), a.caption ? { caption: String(a.caption).slice(0, 900) } : {});
            out = `sent ${f.path} (${f.bytes.length} bytes) to the user`;
          }
        } catch (e) {
          out = `error: could not send the file: ${String((e as Error)?.message || e).slice(0, 200)}`;
        }
        await taskEvent(run.id, "tool", toolLabel(call), db);
        st.messages.push({ role: "tool", content: out, tool_call_id: call.id, name: "send_file" });
        run.queued = rest;
        await saveState(chatId, st, db, slot);
        continue;
      }
      const approvedKey = toolCallKey(call);
      const wasApproved = (run.approved || []).includes(approvedKey);
      const skip = wasApproved ? null : beforeCall(run.stall, call);
      if (skip) {
        // the same call yet again after a recovery: not run; the model gets its earlier result and must change course
        run.stall.level++;
        st.messages.push({ role: "tool", content: skip.skip, tool_call_id: call.id, name: call.function.name });
        await onStall({ pattern: "repeat_call", detail: `${call.function.name} skipped (identical call again)` }, run, chatId, ctx, db);
        run.queued = rest;
        await saveState(chatId, st, db, slot);
        continue;
      }
      // A one-time approval from the Mini App / Telegram is consumed here, in the background runner.
      // All unapproved calls still go through the normal permission policy.
      if (wasApproved) {
        run.approved = (run.approved || []).filter((key) => key !== approvedKey);
        const short = toolLabel(call).split("—")[0].trim().slice(0, 80) || "تنفيذ أداة";
        await taskEvent(run.id, "tool", toolLabel(call), db);
        const out = await withHeartbeat(ioBot, chatId, run, `تنفيذ بعد الموافقة: ${short}`, () => runTool(call, ctx));
        st.messages.push({ role: "tool", content: out, tool_call_id: call.id, name: call.function.name });
        run.queued = rest;
        const seen = afterCall(run.stall, call, out, run.step);
        if (seen.stall) await onStall(seen.stall, run, chatId, ctx, db);
        if (seen.wait) run.waitUntil = Date.now() + ciWaitMs();
        await saveState(chatId, st, db, slot);
        continue;
      }
      // permissions: tier defaults + the user's own policy (coder_permission_prefs) + "allow for the rest of this task"
      const g = await evaluateCall(call, ctx.gh, ctx.tier, contextOf(run), await loadPrefs(chatId, db), [...new Set([...(run.allowCats || []), ...(await parentAllowCats(chatId, run, db))])]);
      if (g.action === "deny") {
        await taskEvent(run.id, "auto_denied", `${g.reason} — ${call.function.name}\n${g.summary}`, db);
        await send(ioBot, chatId, `⛔ رُفض تلقائياً حسب إعداداتك: ${g.reason}\n${call.function.name}`);
        st.messages.push({ role: "tool", content: `DENIED by the user's standing policy (${g.denied.join(", ")}); it was NOT executed. Do not retry it; find another way or explain what is needed.`, tool_call_id: call.id, name: call.function.name });
        run.queued = rest;
        afterCall(run.stall, call, "denied", run.step);
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (g.action === "ask" && run.agent && run.agentRole !== "worker") {
        // a reader / tester has no way to ask the user: what needs a confirmation is simply not allowed for it (a worker asks, below)
        st.messages.push({ role: "tool", content: `NOT PERMITTED: ${call.function.name} needs the user's confirmation, which a sub-agent cannot request. Skip it and report what you could not do.`, tool_call_id: call.id, name: call.function.name });
        run.queued = rest;
        await taskEvent(run.id, "auto_denied", `sub-agent: ${call.function.name} needs confirmation — refused`, db);
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (g.action === "ask") {
        const nonce = randomUUID().slice(0, 6);
        run.pending = { calls: run.queued, reason: g.reason, summary: g.summary, nonce, categories: categoriesOf(g.ask), at: Date.now() };
        run.queued = [];
        await saveState(chatId, st, db, slot);
        await taskEvent(run.id, "confirm", `${g.reason} — ${call.function.name}\n${g.summary}`, db);
        await taskStatus(run.id, "waiting", run.step, db);
        const kb = new InlineKeyboard().text("✅ نفّذ", `ccf|${run.id}|${nonce}|yes`).text("❌ ألغِ", `ccf|${run.id}|${nonce}|no`).row().text("✅ اسمح لبقية المهمة", `ccf|${run.id}|${nonce}|all`);
        const head = run.agent ? `🤖 وكيل «${(run.title || "").slice(0, 70)}» يطلب إذنك\n` : run.title && run.source !== "interactive" ? `⏰ ${run.title.slice(0, 80)}\n` : "";
        const m = await (run.agent ? realBot(bot) : ioBot).api.sendMessage(chatId, `${head}⚠️ يحتاج تأكيدك: ${g.reason}\n${call.function.name}\n${g.summary}`.slice(0, 3500), { reply_markup: kb } as never).catch(() => null);
        if (m && (m as any).message_id) {
          const again = await loadState(chatId, db, slot);
          if (again.run?.pending?.nonce === nonce) {
            again.run.pending.msgId = (m as any).message_id;
            await saveState(chatId, again, db, slot);
          }
        }
        return;
      }
      if (g.autoAllowed.length) await taskEvent(run.id, "auto_allowed", `${g.reason} — ${call.function.name}\n${g.summary}`, db);
      const short = toolLabel(call).split("—")[0].trim().slice(0, 80) || "تنفيذ أداة";
      await progressLine(ioBot, chatId, run, short);
      await taskEvent(run.id, "tool", toolLabel(call), db);
      // Independent reads the model asked for in the same step (e.g. three files) run together instead of one after the other; each
      // one still passes the same checks (role, repeat guard, permissions). Writes and anything that needs a confirmation stay one by one.
      const batch = [call];
      if (PAR_READ.has(call.function.name) && process.env.CODER_PARALLEL_TOOLS !== "off") {
        const prefs = await loadPrefs(chatId, db);
        for (const nx of rest) {
          if (batch.length >= 4 || !PAR_READ.has(nx.function.name)) break;
          if (run.agent && !agentToolAllowed(nx.function.name, run.agentRole, run.agentDepth || 1, parseArgs(nx))) break;
          if (beforeCall(run.stall, nx) || (run.approved || []).includes(toolCallKey(nx))) break;
          const gx = await evaluateCall(nx, ctx.gh, ctx.tier, contextOf(run), prefs, [...new Set([...(run.allowCats || []), ...(await parentAllowCats(chatId, run, db))])]);
          if (gx.action !== "run" || gx.autoAllowed.length) break;
          batch.push(nx);
        }
      }
      if (batch.length > 1) await taskEvent(run.id, "info", `⚡ ${batch.length} قراءات مستقلة بالتوازي`, db);
      for (const b of batch.slice(1)) await taskEvent(run.id, "tool", toolLabel(b), db);
      const outs = await withHeartbeat(ioBot, chatId, run, `تنفيذ: ${short}${batch.length > 1 ? ` (+${batch.length - 1})` : ""}`, () => Promise.all(batch.map((b) => runTool(b, ctx))));
      run.queued = rest.slice(batch.length - 1);
      for (let i = 0; i < batch.length; i++) {
        await bankAdd(run.id, coderChatKey(chatId), run.step, batch[i].function.name, toolLabel(batch[i]), outs[i], db);          // kept in full for recall()
        st.messages.push({ role: "tool", content: outs[i] + (i === batch.length - 1 ? progressNote(run) : ""), tool_call_id: batch[i].id, name: batch[i].function.name });
        const seen = afterCall(run.stall, batch[i], outs[i], run.step);
        if (seen.stall) await onStall(seen.stall, run, chatId, ctx, db);
        if (seen.wait) run.waitUntil = Date.now() + ciWaitMs();
      }
      await saveState(chatId, st, db, slot);
      continue;
    }

    // CI still running with nothing new: wait (inside this leg, or hand the wait to the next leg)
    if (run.waitUntil && run.waitUntil > Date.now()) {
      const ms = run.waitUntil - Date.now();
      if (ms > left() - 7000) {
        await saveState(chatId, st, db, slot);
        await new Promise((res) => setTimeout(res, Math.max(0, left() - 7000)));
        continue;
      }
      await typing(ioBot, chatId);
      await new Promise((res) => setTimeout(res, ms));
      continue;
    }

    // 2) a job on the Studio: poll it and send what is finished
    if (run.job) {
      const o = cached && cached.job === run.job ? { reply: cached } : await coderJobResult(run.job, 0, Math.min(10000, left() - 2000));
      cached = null;
      const r: CoderReply | null = o.reply;
      if (!r || r.type === "error" || r.type === "gone" || r.type === "cancelled") {
        if (run.compacting && r?.type !== "cancelled" && !(!r && pollTransient(o))) {
          run.job = undefined;                        // the summary job failed: the harness writes the summary itself
          run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
        run.logged = 0;
          await startSegment(ioBot, chatId, st, run, "", db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        if (!r && pollTransient(o)) {
          run.pollFailSince = run.pollFailSince || Date.now();
          if (Date.now() - run.pollFailSince > jobStallMs() && (run.goneRetries || 0) < 3) {
            // the server has not answered for minutes: it probably restarted and lost the job: ask again (same step)
            run.goneRetries = (run.goneRetries || 0) + 1;
            run.pollFailSince = undefined;
            run.job = undefined;
            run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
            run.logged = 0;
            await taskEvent(run.id, "info", `🔁 فُقد اتصال الخادم بالطلب؛ أعيد إرسال الخطوة (محاولة ${run.goneRetries}).`, db);
            await saveState(chatId, st, db, slot);
            continue;
          }
          await saveState(chatId, st, db, slot);
          await new Promise((res) => setTimeout(res, o.status === 429 ? Math.max(pollMs(), 8000) : pollMs()));      // a 429 (the hub's request limit) is answered with a longer pause, not more asks
          continue;                                   // a slow / flaky poll is not the end of the job
        }
        run.pollFailSince = undefined;
        // "cancelled" while the task is still alive is not the user's stop (a stop ends the task first): the Studio drops a job nobody polled for a while, e.g. while the
        // worker was replaced mid-step (measured: two server updates in 3 minutes ended a task as "stopped" by itself). The same step goes again, like a lost job.
        const droppedByStudio = r?.type === "cancelled" && (run.goneRetries || 0) < 3 && (await loadState(chatId, db, slot).catch(() => null))?.run?.id === run.id;
        if ((r?.type === "gone" || droppedByStudio) && (run.goneRetries || 0) < 3) {
          // the Studio restarted and no longer knows the job: the same step goes again (the history is intact)
          run.goneRetries = (run.goneRetries || 0) + 1;
          run.job = undefined;
          run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
          run.logged = 0;
          await taskEvent(run.id, "info", `🔁 ${droppedByStudio ? "الاستوديو أسقط الطلب بعد انقطاع المتابعة" : "خادم النموذج أُعيد تشغيله وفقد الطلب"}؛ أعيد إرسال الخطوة (محاولة ${run.goneRetries}).`, db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        if (r?.type === "error" && (run.retries || 0) < MAX_RETRIES) {
          // e.g. the context overflowed: same step again with a smaller history, the task goes on
          run.retries = (run.retries || 0) + 1;
          run.histChars = Math.max(12000, Math.floor((run.histChars || historyChars()) / 2));
          run.job = undefined;
          run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
        run.logged = 0;
          await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "repeat_error", level: run.stall.level, detail: `studio job error, retry ${run.retries}: ${(r.error || "").slice(0, 200)}` }, db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        await closeCard(ioBot, chatId, run, r?.type === "cancelled" ? "⏹️ أُوقفت المهمة." : "❌ توقفت المهمة بسبب خطأ من خادم النموذج.", true);
        await endRun(st, r?.type === "cancelled" ? "stopped" : "failed", db, r?.type === "cancelled" ? "cancelled" : coderFailureText(o), coderChatKey(chatId));
        await saveState(chatId, st, db, slot);
        if (r?.type !== "cancelled") await send(ioBot, chatId, userFailureText(o, chatId));
        return;
      }
      const text = stripForeignScript(r.text || "", String([...st.messages].reverse().find((m) => m.role === "user" && !String(m.content).startsWith("[harness]"))?.content || ""));
      if (r.type === "pending") {
        // Keep the Telegram progress card alive while Studio is in prompt prefill / queue and emits no tokens.
        if (Date.now() - (run.progressAt || 0) >= (Number(process.env.CODER_CARD_REFRESH_MS) || 5000)) {
          run.progressAt = Date.now();
          const pf = r.prefill && Number(r.prefill.total) > 0 ? Math.min(99, Math.floor((Number(r.prefill.processed || 0) / Number(r.prefill.total)) * 100)) : -1;
          const readDone = Boolean(r.prefill && Number(r.prefill.total) > 0 && Number(r.prefill.processed) >= Number(r.prefill.total));
          const phase = r.phase && r.phase !== "ready" ? `جارٍ التحضير (${r.phase})` : r.queue_pos && r.queue_pos > 0 ? `في الطابور، الترتيب ${r.queue_pos}` : Number(r.reasoning_len || 0) > 0 ? "جارٍ التفكير…" : readDone ? "جارٍ الكتابة…" : pf >= 0 ? `جارٍ قراءة المهمة… ${pf}%` : "جارٍ انتظار أول مخرجات النموذج";
          if (run.surface === "app") await taskEvent(run.id, "info", `⏳ ${phase}`, db);
          await refreshCard(run.surface === "app" ? bot : ioBot, chatId, run, phase);
        }
        // once per job: how much of the prompt the Studio really had to read (the rest came from its cache) and on which Studio: the evidence for "does it read everything again?"
        if (r.prefill && Number(r.prefill.total) > 0 && run.pfLogged !== run.job) {
          run.pfLogged = run.job;
          const sn = Number(/^s(\d+)~/.exec(String(run.job))?.[1] || 0) + 1;
          await taskEvent(run.id, "info", `📊 الاستوديو ${sn}: يقرأ ${Number(r.prefill.total) - Number(r.prefill.cache || 0)} رمزاً جديداً من ${r.prefill.total} (${Number(r.prefill.cache || 0)} من ذاكرته).`, db);
        }
        // a Studio whose model server is in ERROR (not just loading) will not answer this job: with other Studios available the step goes to another one at once
        if (r.phase === "error" && coderStudioUrls().length > 1 && (run.stallRetries || 0) < 2) {
          await coderCancel(run.job).catch(() => null);
          run.stallRetries = (run.stallRetries || 0) + 1;
          run.job = undefined;
          run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
          run.logged = 0;
          await taskEvent(run.id, "info", "🔁 خادم النموذج هذا في حالة خطأ؛ أعيد إرسال الخطوة إلى استوديو آخر.", db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        // A cold Studio (restarted, or another conversation took its slot) would read this whole prompt from zero: ~30-45 tokens/s, minutes of silence. The Studio's
        // first progress report says how much it must read; when that is a lot, the window restarts small (the latest request plus a few recent turns) and the step is sent again.
        if (r.prefill && !run.coldReset && Number(r.prefill.total) > 0 && Number(r.prefill.total) - Number(r.prefill.cache || 0) > (Number(process.env.CODER_COLD_MAX_TOKENS) || 5000)) {
          await coderCancel(run.job).catch(() => null);
          run.coldReset = true;
          st.winStart = windowFrom(st.messages, st.winStart || 0, 0, Number(process.env.CODER_RESET_CHARS) || 5000).start;
          run.job = undefined;
          run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
          run.logged = 0;
          await taskEvent(run.id, "info", `🧊 الاستوديو بارد: كان سيقرأ ${Number(r.prefill.total) - Number(r.prefill.cache || 0)} رمزاً من الصفر؛ أقصّر المحادثة وأعيد الإرسال.`, db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        // the job's watchdog: any growth of its text or reasoning, a move in the queue or a model phase change counts as life
        const size = `${r.total || 0}|${Number((r as { reasoning_len?: number }).reasoning_len || 0)}|${r.queue_pos ?? ""}|${r.phase || ""}|${r.prefill?.processed ?? ""}`;   // reading the prompt counts as life
        if (r.queue_pos && r.queue_pos > 0 && !r.total && (!r.phase || r.phase === "ready") && (run.queueMoves || 0) < 3 && Date.now() - (run.jobAt || run.jobMovedAt || 0) > (process.env.CODER_QUEUE_MOVE_MS !== undefined ? Number(process.env.CODER_QUEUE_MOVE_MS) : 1500) && await anyIdleStudio()) {
          // Waiting in a Studio's queue while another Studio is idle (measured: 3+ minutes at "position 1" with four idle): the step is cancelled and sent again at once to an idle
          // Studio (about 1.5 s after the first poll shows the queue). Speed first: a cold read of a short prompt is seconds, waiting behind an unknown job was minutes.
          await coderCancel(run.job).catch(() => null);
          run.queueMoves = (run.queueMoves || 0) + 1;
          run.avoidHome = true;
          run.job = undefined;
          run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
          run.logged = 0;
          await taskEvent(run.id, "info", `🔀 الاستوديو مشغول بطلب آخر منذ ${Math.round((Date.now() - (run.jobAt || run.jobMovedAt || 0)) / 1000)} ث؛ أرسل الخطوة إلى استوديو آخر فارغ.`, db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        if (!run.jobMovedAt || size !== run.jobSize) {
          run.jobSize = size;
          run.jobMovedAt = Date.now();
        } else if (Date.now() - run.jobMovedAt > Math.max(jobStallMs(), readingMs(run, r))) {
          const where = r.phase && r.phase !== "ready" ? `model ${r.phase}` : r.queue_pos && r.queue_pos > 0 ? `queued behind ${r.queue_pos}` : "no new output";
          await coderCancel(run.job).catch(() => null);
          await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "repeat_error", level: run.stall.level, detail: `studio job stalled ${Math.round(jobStallMs() / 1000)}s (${where}); cancelled` }, db);
          if ((run.stallRetries || 0) < 2) {
            // a stuck generation is not the end of a long task: the same step goes again, twice at most
            run.stallRetries = (run.stallRetries || 0) + 1;
            run.job = undefined;
            run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
            run.logged = 0;
            await taskEvent(run.id, "info", `🔁 توقف الخادم عن الإخراج (${where})؛ أعيد إرسال الخطوة (محاولة ${run.stallRetries}).`, db);
            await saveState(chatId, st, db, slot);
            continue;
          }
          if (run.progress?.msgId) await (ioBot.api as any).editMessageText(chatId, run.progress.msgId, `❌ توقفت المهمة بسبب عدم وصول أي تقدم من خادم النموذج.\nالسبب: ${where}\nيمكنك إعادة المحاولة أو فتح الطرفية لعرض السجلات.`).catch(() => null);
          await endRun(st, "failed", db, `studio job stalled (${where})`, coderChatKey(chatId));
          await saveState(chatId, st, db, slot);
          await send(ioBot, chatId, tierFor(chatId) === "owner" ? `⌛ أوقفت الطلب: خادم Nova AI بلا أي تقدّم منذ ${Math.round(jobStallMs() / 60000)} دقائق (${where}). أعد الإرسال بعد قليل.` : BUSY_TEXT);
          return;
        }
        if (!run.compacting) await sendParts(run.surface === "app" ? bot : ioBot, chatId, text, run, false, db);
        await saveState(chatId, st, db, slot);
        await typing(ioBot, chatId);
        // while the Studio is still reading the prompt nothing new can arrive for a long while: poll slowly (the ModelScope gateway answers 429 to a fast poller)
        await new Promise((res) => setTimeout(res, r.total ? pollMs() : Math.max(pollMs(), Number(process.env.CODER_PREFILL_POLL_MS ?? (process.env.NODE_ENV === "test" ? 0 : 4000)))));
        continue;
      }
      // done: metered in model tokens (plans are token-based): the Studio's own counts (llama.cpp timings) when it sends them,
      // else an estimate. Input = the larger of the processed prompt and the estimated full prompt (a cached prompt still counts).
      {
        const tm = (r as { timings?: { prompt_n?: number; predicted_n?: number } }).timings || {};
        const out = Number(tm.predicted_n) > 0 ? Number(tm.predicted_n) : estimateTokens(text + JSON.stringify(r.tool_calls || []));
        const inp = Math.max(Number(tm.prompt_n) || 0, run.promptEst || 0);
        await addUsage(chatId, "tokens", inp + out, db);
        run.promptEst = undefined;
      }
      if (run.compacting) {
        // the end-of-segment progress summary: memory, a fresh context, and the task goes on in the next segment
        run.job = undefined;
        run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
        run.logged = 0;
        await startSegment(ioBot, chatId, st, run, text, db);
        await saveState(chatId, st, db, slot);
        continue;
      }
      run.stallRetries = 0; run.goneRetries = 0;
      const completedCalls = (r.tool_calls || []).filter((c) => c?.function?.name);
      // Some Studio/model responses finish with neither text nor tool calls. Never report that as success:
      // retry once with a smaller prompt, then close the run with a useful error instead of a blank answer.
      if (!text.trim() && completedCalls.length === 0) {
        run.job = undefined;
        run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
        run.logged = 0;
        // With deeper thinking a small model sometimes writes its whole answer (or its tool call) inside the thinking part, which the server hands back as "no text":
        // the same step is asked again with thinking off, for the rest of this run, before anything else is tried.
        if ((st.think || run.stall.level >= 2) && !run.thinkOff) {
          run.thinkOff = true;
          await taskEvent(run.id, "info", "🔁 انتهت الخطوة بلا نص مع التفكير الأعمق؛ أعيدها بدونه.", db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        if ((run.retries || 0) < 1) {
          run.retries = (run.retries || 0) + 1;
          run.histChars = Math.max(12000, Math.floor((run.histChars || historyChars()) / 2));
          run.promptEst = undefined;
          await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "repeat_error", level: run.stall.level, detail: "Studio returned done with empty text and no tool calls; retrying once with smaller context" }, db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "repeat_error", level: run.stall.level, detail: "Studio returned empty output twice; ending run as failed" }, db);
        await endRun(st, "failed", db, "empty model output after retry", coderChatKey(chatId));
        await saveState(chatId, st, db, slot);
        await send(ioBot, chatId, "⚠️ انتهى توليد النموذج بلا نص مرتين. لم أعتبر المهمة ناجحة؛ جرّب مرة أخرى بعد قليل، وسأحتفظ بسياق المحادثة.");
        return;
      }
      // the model only announced what it will do ("سأقوم الآن بالبحث...") and stopped: not an answer. The text is still sent (a streamed draft that is not finalised vanishes in Telegram); the model is then told to act now (twice at most).
      if (!completedCalls.length && !run.agent && (run.announceNudges || 0) < 2 && text.trim().length < 900 && /(?:سأقوم|سوف أقوم|سأبدأ|سأبحث|سأحاول|سأستخدم|لذلك،? سأ)|\b(?:I(?:'ll| will) (?:now )?(?:search|try|run|use|look)|Let me (?:search|try|look))/i.test(text) && !/[؟?]\s*$/.test(text.trim())) {
        run.announceNudges = (run.announceNudges || 0) + 1;
        await sendParts(run.surface === "app" ? bot : ioBot, chatId, text, run, true, db);
        st.messages.push({ role: "assistant", content: text });
        st.messages.push({ role: "user", content: "[harness] You only announced a plan and stopped. Do NOT announce: call the tool NOW, or, if the sources you already have are enough, write the final answer from them. Never repeat an earlier message." });
        run.job = undefined; run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined; run.logged = 0;
        await saveState(chatId, st, db, slot);
        continue;
      }
      await sendParts(run.surface === "app" ? bot : ioBot, chatId, text, run, true, db);
      const calls = completedCalls;
      st.messages.push(calls.length ? { role: "assistant", content: text, tool_calls: calls } : { role: "assistant", content: text });
      dropShownImages(st.messages);                        // a picture is shown to the model once; after its answer it is only a note
      run.job = undefined;
      run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
        run.logged = 0;
      run.retries = 0;
      run.avoidHome = false; run.queueMoves = 0;          // a finished step: the next one may go back to the Studio that holds the cache
      if (calls.length) {
        run.queued = calls;
        run.step++;
        const looped = afterText(run.stall, text, run.step);
        if (looped) await onStall(looped, run, chatId, ctx, db);
        if (stepsSinceProgress(run.stall, run.step) >= HARD_MAX_STEPS && tierFor(chatId) !== "owner") {   // the owner has no ceiling
          // the only stop: a stall safety net against runaway compute (CODER_HARD_MAX_STEPS model steps with no real progress — not total
          // steps, so a long task that keeps moving never reaches it). Not a pause — the task ends and says so.
          await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "hard_ceiling", level: run.stall.level, detail: `${HARD_MAX_STEPS} steps without progress (CODER_HARD_MAX_STEPS), step ${run.step}` }, db);
          for (const c of calls) st.messages.push({ role: "tool", content: "[harness] Hard safety ceiling reached; the task was stopped here (not executed).", tool_call_id: c.id, name: c.function.name });
          await endRun(st, "ceiling", db, `hard ceiling ${HARD_MAX_STEPS}`, coderChatKey(chatId));
          await saveState(chatId, st, db, slot);
          await send(ioBot, chatId, tierFor(chatId) === "owner"
            ? `⛔ توقفت المهمة عند سقف الأمان: ${HARD_MAX_STEPS} خطوة متتالية بلا أي تقدّم حقيقي، لمنع استهلاك لا نهائي. اكتب «تابع» لأكمل من حيث توقفت.`
            : "⛔ توقفت المهمة لأنها دارت في حلقة بلا تقدّم. اكتب «تابع» لأكمل من حيث توقفت، أو وضّح لي المطلوب أكثر.");
          return;
        }
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (!text.trim()) await send(ioBot, chatId, "⚠️ انتهى الرد بلا نص. قد يكون خادم البرمجة مشغولاً أو يعيد نتيجة فارغة. جرّب مرة أخرى بعد دقيقة، أو افتح التطبيق لرؤية السجلات.");
      if (st.inbox.length) {
        for (const m of st.inbox) st.messages.push({ role: "user", content: `[new message from the user while you were working]\n${m}` });
        st.inbox = [];
        await saveState(chatId, st, db, slot);
        continue;
      }
      // long-term memory: learned in quiet time from the saved thread (coderThreads.ts quietWork), never on the reply path
      if (!run.agent && (!encryptionReady() || run.slot || !st.threadId)) rememberLater(chatId, st.messages, run.id, st.repo, db);
      if (run.agent) st.agentResult = { status: "done", text: text.trim() || "(empty report)", at: Date.now() };
      else if (tierFor(chatId) === "owner" && !run.slot && st.mode !== "sham") {
        // the owner's successful runs become lessons for training another model (coderLessons.ts: owner only, secrets drop the whole run)
        const snap = [...st.messages], id = run.id, steps = run.step;
        later(() => import("@/lib/coderLessons").then((m) => m.recordLessonStatus(id, steps, snap, db)).then((r) => taskEvent(id, "info", r === "saved" ? "📚 حُفظ درس هذه المهمة للتدريب." : `📚 لم يُحفظ الدرس: ${r}`, db)).then(() => undefined).catch(() => undefined));
      }
      await endRun(st, "done", db, "✓", coderChatKey(chatId));
      await saveState(chatId, st, db, slot);
      return;
    }

    // 3) nothing running. A long task whose context grew large first closes its segment: the model writes a progress summary
    // (no tools), it is kept as task memory and becomes the whole context of the next segment (coderSegments.ts).
    if (run.compacting || needsSegment(st.messages, run)) {
      run.compacting = true;
      // The summary the harness writes from what the tools returned (coderSegments.fallbackSummary) costs no model call; the model's own summary cost 4 minutes of CPU on a live task
      // (2026-10-25: 6:53 -> 6:57 writing it). The model's version stays available with CODER_SEGMENT_MODEL_SUMMARY=on.
      if ((process.env.CODER_SEGMENT_MODEL_SUMMARY || "").toLowerCase() !== "on") {
        await startSegment(ioBot, chatId, st, run, "", db);
        await saveState(chatId, st, db, slot);
        continue;
      }
      const sumMsgs: CoderMessage[] = [{ role: "system", content: "You are the coding agent pausing at a context checkpoint. Write the progress summary you are asked for, nothing else." }, ...trimMessages(st.messages, run.histChars), summaryRequest(run.goal || "", run.segment || 1)];
      const waitS = Math.max(1, Math.min(20, Math.floor((left() - 12000) / 1000)));
      const o = await coderChat(sumMsgs, { tag: "summary", think: false, temperature: 0.3, waitS, timeoutMs: waitS * 1000 + 9000 });
      if (o.reply?.job) {
        run.job = o.reply.job;
        run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
        run.logged = 0;
        run.jobAt = run.jobMovedAt = Date.now();
        run.jobSize = "";
        if (o.reply.type !== "pending") cached = o.reply;
      } else await startSegment(ioBot, chatId, st, run, "", db);
      await saveState(chatId, st, db, slot);
      continue;
    }
    // ask the model for the next step (messages that came in meanwhile join the conversation now)
    if (st.inbox.length) {
      for (const m of st.inbox) st.messages.push({ role: "user", content: `[new message from the user while you were working]\n${m}` });
      st.inbox = [];
    }
    if (run.recovery) {
      st.messages.push({ role: "user", content: run.recovery });       // the reflection / re-plan step after a detected loop
      run.recovery = undefined;
    }
    // A plain "go and find out" request does not need the small model to plan searches one slow step at a time (it loops on broad queries,
    // 30+ minutes): the harness runs ONE deep research first, and the model's first step already has the sources to write the report from.
    if (!run.prefetched && !run.agent && run.step === 0 && run.source === "interactive" && !run.slot && process.env.CODER_RESEARCH_FASTPATH !== "off") {
      run.prefetched = true;
      const q = researchQuestion(run.goal || String([...st.messages].reverse().find((m) => m.role === "user")?.content || ""));
      if (q) {
        // the request's own words ("go and search for…") make poor search queries: the model drafts 4 focused ones first (a short call), keywords as the fallback
        const drafted = parseQueries(await import("@/lib/coderMemory").then((m) => m.studioLlm(75000)(queryDraftPrompt(q))).catch(() => ""));
        const queries = (drafted.length ? drafted : fallbackQueries(q)).slice(0, 6);
        await taskEvent(run.id, "info", `🔎 استعلامات البحث: ${queries.join(" | ")}`, db);
        const call = { id: "pre_research", type: "function" as const, function: { name: "deep_research", arguments: JSON.stringify({ question: q, ...(queries.length ? { queries } : {}) }) } };
        await progressLine(ioBot, chatId, run, "بحث معمّق");
        await taskEvent(run.id, "tool", toolLabel(call), db);
        const out = await withHeartbeat(ioBot, chatId, run, "بحث معمّق", () => runTool(call, ctx));
        st.messages.push({ role: "assistant", content: "", tool_calls: [call] }, { role: "tool", content: out, tool_call_id: call.id, name: "deep_research" });
        // "search GitHub" requests: the engine also asks GitHub itself (repositories by stars) and reads the top READMEs, so the report names real projects
        let ghFound = 0;
        if (/github|جيتهوب|جيت هاب|git hub/i.test(q)) {
          const pub: ToolCtx = ctx.gh ? ctx : { ...ctx, gh: githubClient("") };      // public repositories need no token (read only)
          const lists: string[] = [];
          for (const qq of queries.slice(0, 3)) lists.push(await runTool({ id: "pre_gh", type: "function", function: { name: "github_search_repos", arguments: JSON.stringify({ query: githubQuery(qq), sort: "stars" }) } }, pub));
          const repos = [...new Set(lists.join("\n").split("\n").map((l) => /^([\w.-]+\/[\w.-]+) ★/.exec(l)?.[1] || "").filter(Boolean))].slice(0, 3);
          const readmes: string[] = [];
          for (const r of repos) {
            const t = await runTool({ id: "pre_rd", type: "function", function: { name: "github_read_file", arguments: JSON.stringify({ repo: r, path: "README.md" }) } }, pub);
            if (!/^error/.test(t)) readmes.push(`## ${r} README (start)\n${t.slice(0, 1500)}`);
          }
          ghFound = repos.length;
          const text = `GitHub repository search:\n${lists.join("\n") || "(none)"}${readmes.length ? `\n\n${readmes.join("\n\n")}` : ""}`;
          await taskEvent(run.id, "tool", `🔭 بحث عن مستودعات: ${repos.join(", ") || "لا نتائج"}`, db);
          st.messages.push({ role: "assistant", content: "", tool_calls: [{ id: "pre_gh", type: "function" as const, function: { name: "github_search_repos", arguments: JSON.stringify({ query: queries[0] || q, sort: "stars" }) } }] }, { role: "tool", content: text, tool_call_id: "pre_gh", name: "github_search_repos" });
        }
        const thin = !ghFound && out.length < 700 || /no (?:usable )?sources|لم يُعثر/i.test(out.slice(0, 400));

        // Several Studios and real sources: the independent SECTIONS of the report are written at the same time, one per Studio (coderParallel.ts), instead of one Studio writing it all
        if (!thin && (!st.model || st.model === "coder") && parallelEnabled(coderStudioUrls().length)) {
          await taskEvent(run.id, "info", `✍️ [سجل داخلي] كتابة التقرير بالتوازي: ${Math.min(coderStudioUrls().length, SECTIONS_MAX)} أقسام.`, db);
          const srcText = st.messages.filter((m) => m.role === "tool").map((m) => String(m.content || "")).join("\n\n");
          const pr = await withHeartbeat(ioBot, chatId, run, "كتابة التقرير", () => parallelReport({ request: q, queries, sources: srcText, lang: st.lang === "en" ? "en" : "ar", write: studioWriter(`${chatId}:${run.id}`) }));
          if (pr) {
            st.messages.push({ role: "assistant", content: pr.text });
            await sendParts(run.surface === "app" ? bot : ioBot, chatId, pr.text, run, true, db);
            await taskEvent(run.id, "info", `✍️ [سجل داخلي] كُتب التقرير من ${pr.sections} أقسام بالتوازي.`, db);
            if (!encryptionReady() || run.slot || !st.threadId) rememberLater(chatId, st.messages, run.id, st.repo, db);
            if (tierFor(chatId) === "owner" && !run.slot && st.mode !== "sham") {
              const snap = [...st.messages], id = run.id, steps = run.step;
              later(() => import("@/lib/coderLessons").then((mm) => mm.recordLessonStatus(id, steps, snap, db)).then((r) => taskEvent(id, "info", r === "saved" ? "📚 حُفظ درس هذه المهمة للتدريب." : `📚 لم يُحفظ الدرس: ${r}`, db)).then(() => undefined).catch(() => undefined));
            }
            await endRun(st, "done", db, "✓", coderChatKey(chatId));
            await saveState(chatId, st, db, slot);
            return;
          }
        }
        st.messages.push({ role: "user", content: thin
          ? "[harness] The research above found little or nothing. Do NOT invent names or facts. Run at most two precise web_search queries, then answer only from what they return; if still nothing, say plainly what you could not find."
          : "[harness] The research above was already run for you. Write the final answer / report NOW from these sources (cite them by number, in the user's language). Use only what the sources say; if they are not enough, say exactly what is missing; at most one more search." });
        run.softSteps = 6;                                                 // a research task ends in a few steps, not in half an hour
        await saveState(chatId, st, db, slot);
      }
    }
    const softLast = Boolean(run.softSteps && run.step >= run.softSteps - 1);
    if (softLast && !run.softWarned) {
      run.softWarned = true;
      st.messages.push({ role: "user", content: "[harness] Step budget reached: no more tools. Write the final report now from what you have, and say what is still missing." });
    }
    {
      // plan limits per model step: steps and model tokens (rolling week; the owner has none). Reached = the task ends gracefully.
      const lim = (await checkLimit(chatId, "steps", 1, db)) as LimitCheck;
      const limT = lim.ok ? await checkLimit(chatId, "tokens", 1, db) : lim;
      const hit = !lim.ok ? lim : !limT.ok ? limT : null;
      if (hit) {
        await endRun(st, "limited", db, `plan limit: ${hit.metric}`, coderChatKey(chatId));
        await saveState(chatId, st, db, slot);
        await sendLimit(ioBot, chatId, hit, st.tz, run.title && run.slot ? `${run.title}: ` : "");
        return;
      }
    }
    const knobs = recoveryKnobs(run.stall);
    if (run.memory === undefined) {
      // relevant long-term memories, once per task (keyword + recency + repo scope)
      const { memoryPrompt, repoOf } = await import("@/lib/coderMemory");
      run.memory = await memoryPrompt(chatId, run.goal || "", repoOf(run.goal || "", st.repo), db).catch(() => "");
    }
    const connected = await import("@/lib/coderConnectors").then((m) => m.connectedIds(chatId, db)).catch(() => [] as string[]);
    const accuracy: Accuracy = isAccuracy(st.accuracy) ? st.accuracy : "balanced";
    if (run.agent && (run.agentRole !== "sham" || shamToolsEnabled()) && run.step >= agentMaxSteps(run.agentRole) - 1 && !run.agentWarned) {
      run.agentWarned = true;
      st.messages.push({ role: "user", content: "[harness] This is your LAST step: do not call tools any more. Write the final report now from what you found." });
    }
    const agentLast = Boolean(run.agent && run.step >= agentMaxSteps(run.agentRole) - 1);
    // The model server reuses its prompt cache only while the START of the prompt is byte-identical (measured: one changed line in the system
    // message = the whole conversation read again, 77 s for 3k tokens; same start + new messages = 4 s). So the system message is the same text every
    // time, and what varies (date, memories, default repo, notes) rides on the task's own request message, stamped once when the task starts.
    if (!run.ctxStamped) {
      let k = st.messages.length - 1;
      while (k >= 0 && !(st.messages[k].role === "user" && !String(st.messages[k].content).startsWith("[harness]"))) k--;
      const ctxText = [`Current date (UTC): ${new Date().toISOString().slice(0, 10)}.`, accuracyNote(accuracy), run.memory || "", st.repo ? `Default repository for this user: ${st.repo}` : "", st.notes ? `Your notes so far:\n${st.notes}` : ""].filter(Boolean).join("\n");
      if (k >= 0 && ctxText) (st.messages[k] as { ctx?: string }).ctx = `[context for this request]\n${ctxText}`;
      run.ctxStamped = true;
    }
    const toSham = run.agent ? run.agentRole === "sham" : st.model === "sham" || st.model === "sham_loop" || st.model === "sham_v2";      // Sham gets the bare words, no context block
    const histOf = (): CoderMessage[] => {
      if (run.histChars) return trimMessages(st.messages, run.histChars);                  // after a context overflow: the old hard cut
      const w = windowFrom(st.messages, st.winStart || 0, historyChars(), Number(process.env.CODER_RESET_CHARS) || 5000);
      st.winStart = w.start;
      return w.msgs;
    };
    const wireOf = (m: CoderMessage): CoderMessage => (!toSham && m.role === "user" && m.ctx ? { role: "user", content: `${m.content}\n\n${m.ctx}` } : m);
    const messages: CoderMessage[] = [{ role: "system", content: coderSystemPrompt({ github, owner: tierFor(chatId) === "owner", connectors: connected, agent: run.agent ? (st.lang === "en" ? "en" : "ar") : undefined, agentRole: run.agentRole, agentDepth: run.agentDepth, notes: "", date: false }) }, ...histOf().map(wireOf)];
    const waitS = Math.max(1, Math.min(20, Math.floor((left() - 12000) / 1000)));
    await addUsage(chatId, "steps", 1, db);
    run.promptEst = estimateTokens(messages.map((m) => m.content || "").join("\n"));   // metered when the job is done (with the real counts)
    // the user's model settings (Mini App → settings): deeper thinking and accuracy; a detected loop may still raise both
    const temperature = run.stall.level >= 2 ? knobs.temperature : ACCURACY_TEMPERATURE[accuracy];
    await taskEvent(run.id, "info", "🧠 إرسال الخطوة " + (run.step + 1) + " إلى خادم النموذج؛ السياق التقريبي " + run.promptEst + " رمزاً (تعليمات " + estimateTokens(String(messages[0].content || "")) + " + محادثة " + estimateTokens(messages.slice(1).map((m) => m.content || "").join("\n")) + ").", db);
    const modelStartedAt = Date.now();
    // The tool list sits at the very START of the prompt, so any change to it makes the Studio read the whole conversation again. Groups once used in this
    // chat therefore stay loaded for every later task (persisted with the state): the list only grows, the first time a new group is needed.
    const sticky = [...new Set([...(st.groups || []), ...loadedGroups(st.messages, toolGroups(true, true))])].sort();
    if (sticky.join(",") !== (st.groups || []).join(",")) st.groups = sticky;
    const keepAll = [...new Set([...(run.keepGroups || []), ...sticky])];
    await cancelWarm(chatId);
    const o = await withHeartbeat(ioBot, chatId, run, "انتظار استجابة النموذج", () => coderChat(messages, { affinity: `${chatId}:${run.slot || ""}`, model: run.agent ? (run.agentRole === "sham" ? (shamToolsEnabled() ? "sham_loop" : "sham_probe") : "coder") : st.model, tools: run.agent ? (agentLast ? [] : run.agentRole === "worker" || (run.agentRole === "sham" && shamToolsEnabled()) ? coderToolsFor(github, connected.length > 0, messages, keepAll).filter((t) => agentToolAllowed(t.function.name, "worker", run.agentDepth || 1)) : agentToolDefs(github, run.agentRole)) : softLast ? [] : coderToolsFor(github, connected.length > 0, messages, keepAll), think: (st.think || knobs.think) && !run.thinkOff, thinkCap: thinkCapFor(accuracy), accuracy, avoidHome: run.avoidHome || undefined, tag: run.agent ? "agent" : "step", temperature, waitS, timeoutMs: waitS * 1000 + 9000 }));
    const r = o.reply;
    await taskEvent(run.id, "info", "⏱️ استجابة خادم النموذج الأولية بعد " + (Date.now() - modelStartedAt) + "ms" + (r?.queue_pos ? "؛ في الطابور: " + r.queue_pos + "؛ أرسل البوت مؤخراً: " + (recentStudioCalls(300000).filter((e) => e.ageS > 1).map((e) => `${e.tag}@${e.studio} قبل ${e.ageS}ث`).join("، ") || "لا شيء قبل هذا الطلب") : "") + (r?.phase ? "؛ المرحلة: " + r.phase : "") + (o.failure ? "؛ تعذر الاتصال: " + o.failure + (o.status ? " (HTTP " + o.status + ")" : "") + (o.detail ? " — " + o.detail : "") : "") + ".", db);
    if ((!r || !r.job) && o.failure && o.failure !== "off" && o.failure !== "auth") {
      // the model server is away (restart, wake-up, a deploy): wait for it, minutes if need be, instead of failing a long task
      run.outageSince = run.outageSince || Date.now();
      if (Date.now() - run.outageSince < outageMs()) {
        run.retries = (run.retries || 0) + 1;
        if (!run.outageNoted) {
          run.outageNoted = true;
          await taskEvent(run.id, "info", `⏳ خادم النموذج غير متاح الآن (${o.failure}${o.status ? ` HTTP ${o.status}` : ""})؛ أعاود تلقائياً لمدة تصل إلى ${Math.round(outageMs() / 60000)} دقيقة.`, db);
        }
        if (!run.outageSaid && Date.now() - run.outageSince >= (process.env.NODE_ENV === "test" ? 0 : 45000)) {          // a blip of a few seconds is not worth a message
          run.outageSaid = true;
          await send(ioBot, chatId, "⏳ خادم النموذج غير متاح لحظياً؛ أعاود تلقائياً وسأكمل المهمة حين يعود.");
        }
        await saveState(chatId, st, db, slot);
        const wait = Math.min(60000, Math.max(o.status === 429 ? 10000 : 0, Number(process.env.CODER_OUTAGE_STEP_MS ?? 5000) * run.retries!));      // a 429 (the hub's request limit) is not hammered: at least 10 s          // 5 s, 10 s … at most a minute
        await new Promise((res) => setTimeout(res, Math.max(200, Math.min(wait, left() - 7000))));
        continue;
      }
    }
    if (!r || !r.job) {
      await closeCard(ioBot, chatId, run, "❌ توقفت المهمة: تعذّر الوصول إلى خادم النموذج.", true);
      await endRun(st, "failed", db, coderFailureText(o), coderChatKey(chatId));
      await saveState(chatId, st, db, slot);
      await send(ioBot, chatId, userFailureText(o, chatId));
      return;
    }
    run.job = r.job;
    run.outageSince = undefined; run.outageNoted = undefined; run.outageSaid = undefined;
    run.sent = 0; run.botSent = 0; run.draftId = undefined; run.draftText = undefined;
        run.logged = 0;
    run.jobAt = Date.now();
    run.jobMovedAt = Date.now();
    run.jobSize = "";
    if (r.type !== "pending") cached = r;
    if (r.type === "pending" && r.queue_pos && r.queue_pos > 0 && tierFor(chatId) !== "owner") await send(ioBot, chatId, `⏳ طلبك في الدور (${r.queue_pos} قبله).`);   // the owner sees the queue on the progress card, never as a message
    if (r.type === "pending" && r.phase && r.phase !== "ready") await send(ioBot, chatId, tierFor(chatId) === "owner" ? "⏳ خادم Nova AI يحمّل النموذج الآن؛ سيبدأ الرد حين يجهز." : "⏳ أجهّز نفسي للرد، لحظات…");
    await saveState(chatId, st, db, slot);
  }
}

/** Closes the current segment with `text` (the model's summary, or the harness's own when it is unusable) and opens the next one. */
async function startSegment(bot: TelegramBot, chatId: number, st: ChatState, run: Run, text: string, db: Db): Promise<void> {
  const seg = run.segment || 1;
  const own = usableSummary(text);
  const summary = own ? text.trim() : fallbackSummary(run.goal || "", st.messages, run.stall?.touched || [], st.notes);
  // the tool groups this segment used stay loaded in the next one (otherwise the model spends a whole slow step on load_tools again)
  run.keepGroups = [...new Set([...(run.keepGroups || []), ...loadedGroups(st.messages, toolGroups(true, true))])];
  await saveSegment(run.id, seg, stateKey(chatId, run.slot || ""), summary, db);
  await taskEvent(run.id, "segment", `${seg} → ${seg + 1}${own ? "" : " (harness summary)"}
${summary}`, db);
  st.messages = segmentMessages(run.goal || "", summary, seg + 1);
  st.winStart = 0;
  run.segment = seg + 1;
  run.segStep = run.step;
  run.compacting = false;
  run.histChars = undefined;                                            // a fresh context gets the full budget again
  run.ctxStamped = false;
  run.retries = 0;
  if (run.stall) {
    run.stall.calls = [];
    run.stall.texts = [];
  }
  await send(bot, chatId, `🔁 المهمة طويلة: حفظتُ ملخّص ما أُنجز وأكمل في الخلفية (المرحلة ${seg + 1}).${run.title ? ` — ${run.title.slice(0, 80)}` : ""}`);
}

/** /api/coder/continue: the next leg of a long run. */
/**
 * Supervise one runner leg. Unexpected exceptions must become a visible failed task, never a silent fire-and-forget rejection.
 * Terminal tasks get a 4-minute leg under the 300s app/continuation routes; Telegram tasks keep a short leg under the shared webhook route.
 */
export async function drive(bot: TelegramBot, botRow: BotRow, chatId: number, chain: string, db: Db = prismaDb, budgetMs = BUDGET_MS, slot = ""): Promise<void> {
  if (isAgentSlot(slot)) bot = silentBot(bot);
  let runId = "";
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatBusy = false;
  try {
    try {
      const st = await loadStateStrict(chatId, db, slot);
      if (st.run?.chain === chain) {
        runId = st.run.id;
        const surface = st.run.surface;
        heartbeat = setInterval(() => {
          if (heartbeatBusy || !runId) return;
          heartbeatBusy = true;
          const beat = surface === "app"
            ? taskEvent(runId, "info", "⏳ العامل الخلفي حيّ؛ ما زال يجهّز الخطوة التالية.", db)
            : taskTouch(runId, db);
          void beat.finally(() => { heartbeatBusy = false; });
        }, 15000);
      }
    } catch { /* driveLoop retries transient state-store failures itself */ }
    await driveLoop(bot, botRow, chatId, chain, db, budgetMs, slot);
  } catch (error) {
    console.error("[coder-drive]", { chatId, chain, error: String((error as Error)?.message || error).slice(0, 240) });
    try {
      const st = await loadStateStrict(chatId, db, slot);
      if (st.run?.chain === chain) {
        const run = st.run;
        runId = run.id;
        st.run = null;
        if (run.agent && !st.agentResult) st.agentResult = { status: "failed", text: "the sub-agent stopped on an internal error", at: Date.now() };
        await saveStateStrict(chatId, st, db, slot); // persist the terminal state before best-effort cleanup
        if (run.job) later(() => coderCancel(run.job!).catch(() => null));
        await taskEvent(run.id, "failed", "توقف العامل الخلفي بسبب خطأ غير متوقع. أعد إرسال الطلب؛ لن تبقى المهمة عالقة بصمت.", db);
        await taskStatus(run.id, "failed", run.step, db);
        await send(bot, chatId, "⚠️ توقّف تنفيذ المهمة بسبب خطأ داخلي. أصبحت المهمة معلّمة كفاشلة بدل بقائها معلّقة؛ أعد إرسال طلبك بعد قليل.");
      }
    } catch (recoveryError) {
      console.error("[coder-drive-recovery]", String((recoveryError as Error)?.message || recoveryError).slice(0, 200));
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

export async function continueRun(botRow: BotRow, chatId: number, chain: string, db: Db = prismaDb, slot = ""): Promise<void> {
  const { Bot } = await import("grammy");
  const bot = new Bot(botRow.token);
  const st = await loadState(chatId, db, slot);
  if (!st.run || st.run.chain !== chain) return;
  const surface = st.run.surface;
  st.run.lease = Date.now();
  await saveState(chatId, st, db, slot);
  await drive(bot, botRow, chatId, chain, db, surface === "app" ? APP_BUDGET_MS : BUDGET_MS, slot);
}

/**
 * Starts a scheduled / event-triggered task in its own slot (src/lib/coderSchedules.ts): a fresh run with its own step counter
 * (the hard ceiling is per run, never cumulative), same permission tiers and policy (context "scheduled"), results to the user's chat.
 * Returns "started", "busy" (the previous run of this schedule is still going) or "off".
 */
export async function startScheduledRun(
  bot: TelegramBot, botRow: BotRow, chatId: number, t: { scheduleId: string; title: string; prompt: string; source: "scheduled" | "event" }, db: Db = prismaDb,
): Promise<"started" | "busy" | "off" | "limited"> {
  if (!coderEnabled()) return "off";
  const slot = `s:${t.scheduleId}`;
  const prev = await loadState(chatId, db, slot);
  if (prev.run && Date.now() - prev.run.lease < LEASE_STALE_MS * 5) return "busy";
  const main = await loadState(chatId, db);
  const lim = await checkLimit(chatId, "tasks", 1, db);
  if (!lim.ok) {
    await sendLimit(bot, chatId, lim, main.tz, `⏰ ${t.title}: `);
    return "limited";
  }
  await addUsage(chatId, "tasks", 1, db);
  const st: ChatState = { ...emptyState(), mode: "coder", think: main.think, accuracy: main.accuracy, notes: main.notes, tz: main.tz, lang: main.lang, repo: main.repo, messages: [{ role: "user", content: `${t.prompt}\n\n[${main.lang === "en" ? "Reply to the user in English." : "الرد للمستخدم يكون بالعربية دائماً (الكود وأسماء الملفات تبقى بالإنجليزية)."}]` }] };
  await startChain(botRow, chatId, st, { slot, source: t.source, scheduleId: t.scheduleId, title: t.title, surface: "app" }, db);
  await saveState(chatId, st, db, slot);
  await send(bot, chatId, `⏰ بدأت مهمة ${t.source === "event" ? "حدث" : "مجدولة"}: ${t.title}`.slice(0, 600));
  later(() => drive(bot, botRow, chatId, st.run!.chain, db, BUDGET_MS, slot));
  return "started";
}

export { splitForTelegram };

/** A run whose worker disappeared (server replaced mid-leg): continue it from the saved state, the Studio job included. */
export async function resumeOrphan(chatId: number, runId: string, slot: string, botRow: BotRow, db: Db = prismaDb): Promise<boolean> {
  const st = await loadState(chatId, db, slot);
  const run = st.run;
  if (!run || run.id !== runId || run.pending || run.asking) return false;
  await taskEvent(runId, "info", "🔁 انقطع العامل الخلفي (غالباً بسبب تحديث الخادم)؛ أكمل المهمة من حيث توقفت.", db);
  later(() => continueRun(botRow, chatId, run.chain, db, slot));
  return true;
}

/** Starts one quiet, read-only child run per task (own slot, own state) on our Studio model; returns their slots. */
async function startAgents(bot: TelegramBot, botRow: BotRow, chatId: number, parent: ChatState, run: Run, tasks: AgentTask[], db: Db): Promise<string[]> {
  const slots: string[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const slot = agentSlot(run.id, i);
    const st: ChatState = { ...emptyState(), mode: "coder", model: "coder", think: false, accuracy: tasks[i].role === "worker" ? parent.accuracy || "balanced" : "fast", tz: parent.tz, lang: parent.lang, repo: parent.repo, messages: [{ role: "user", content: tasks[i].task }] };
    // an agent inherits the parent's settings: the same permission rules (through the parent's context) and what the user already allowed for this task
    await startChain(botRow, chatId, st, { slot, source: "agent", surface: "app", agent: true, agentRole: tasks[i].role, agentDepth: (run.agent ? run.agentDepth || 1 : 0) + 1, parentCtx: contextOf(run), parentRunId: run.id, allowCats: run.allowCats, title: tasks[i].title, goal: tasks[i].task }, db);
    await saveState(chatId, st, db, slot);
    later(() => drive(bot, botRow, chatId, st.run!.chain, db, APP_BUDGET_MS, slot));
    slots.push(slot);
  }
  return slots;
}

/** Stops children that are still running (the parent was stopped, or their time ran out). Each leaves a "stopped" report row. */
export async function cancelAgents(chatId: number, slots: string[], db: Db = prismaDb): Promise<void> {
  for (const slot of slots) {
    const st = await loadState(chatId, db, slot);
    if (!st.run) continue;
    if (st.run.job) await coderCancel(st.run.job).catch(() => null);
    await endRun(st, "stopped", db, "stopped (parent finished or stopped)", coderChatKey(chatId));
    await saveState(chatId, st, db, slot);
  }
}


/** What Sham's own path needs to know about this chat: which Sham (old / new) and the user's thinking / accuracy settings. */
export async function shamContextFor(update: any, db: Db = prismaDb): Promise<{ variant: "v1" | "v2"; mode: { accuracy?: "fast" | "balanced" | "precise"; think?: boolean; thinkCap?: number } } | null> {
  const chatId: number | undefined = update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
  if (!chatId) return null;
  const st = await loadState(chatId, db);
  const accuracy: Accuracy = isAccuracy(st.accuracy) ? st.accuracy : "balanced";
  return { variant: st.model === "sham_v2" ? "v2" : "v1", mode: { accuracy, think: Boolean(st.think), thinkCap: thinkCapFor(accuracy) } };
}
