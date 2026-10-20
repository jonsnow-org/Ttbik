// Two sections in the Sham Telegram bot (owner's plan, 2026-10-21):
//   💻 coder  — DEFAULT: the open coding model (src/lib/openCoderStudio.ts) with the agent harness (src/lib/coderAgent.ts)
//   🧪 Sham   — secondary, for periodic testing: the existing Sham path, untouched (handleNovaBotUpdate -> src/lib/shamStudio.ts)
// /mode (or the inline buttons) switches per chat. In the Sham section every update goes to the existing handler exactly as before.
//
// Long answers (no length cap, slowness OK): the Telegram webhook returns at once; the work runs in `after()` and keeps polling the Studio
// job, sending finished parts (< 4096 chars each) as they come. Before the 60 s function limit it hands itself to /api/coder/continue
// (signed with the bot's webhook secret), which carries on — so one answer may take many minutes.
// State per chat in Postgres (coder_chat_state, created on first use, keyed by a salted hash — never the raw chat id).
import { after } from "next/server";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prismaDb, coderChatKey, resolveConnections, tierFor, type Db, type Tier } from "@/lib/coderAuth";
import { coderEnabled, coderChat, coderJobResult, coderCancel, coderStatus, coderFailureText, chunkRanges, renderRange, splitForTelegram, type CoderMessage, type CoderToolCall, type CoderReply } from "@/lib/openCoderStudio";
import { coderSystemPrompt, coderTools, githubClient, runTool, toolLabel, trimMessages, type ToolCtx } from "@/lib/coderAgent";
import { afterCall, afterText, beforeCall, HARD_MAX_STEPS, logStall, stepsSinceProgress, newStallState, recentStalls, recoveryKnobs, recoveryMessage, type Stall, type StallState } from "@/lib/coderStall";
import { CATEGORIES, CATEGORY_LABEL, POLICY_LABEL, categoriesOf, evaluateCall, globalPolicy, isCategory, loadPrefs, nextPolicy, removePref, setPref, tierDefault, type Category, type Context } from "@/lib/coderPrefs";
import { fallbackSummary, needsSegment, saveSegment, segmentMessages, summaryRequest, usableSummary } from "@/lib/coderSegments";
import { taskEvent, taskSlot, taskStart, taskStatus, type TaskSource, type TaskStatus } from "@/lib/coderTasks";

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
};
export type ChatState = { mode: Mode; think: boolean; messages: CoderMessage[]; notes: string; inbox: string[]; run: Run | null; tz?: string; lang?: "ar" | "en"; convId?: string; repo?: string; menu?: boolean };
export type { Db };
export { coderChatKey };

const BUDGET_MS = 47000;                                              // per invocation, inside maxDuration 60
const LEASE_STALE_MS = 120000;
const pollMs = () => Number(process.env.CODER_POLL_MS || 3000);
const ciWaitMs = () => Number(process.env.CODER_CI_WAIT_MS || 20000);     // CI still running and nothing changed: wait this long before the next step
const MAX_RETRIES = 5;                                                // Studio hiccups are retried (with a smaller context on a job error)


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

/** after() keeps the work alive once the webhook has answered Telegram; outside a request (tests) it just runs. */
export function later(fn: () => Promise<unknown>): void {
  try {
    after(fn);
  } catch {
    void fn().catch(() => null);
  }
}

// ---------------------------------------------------------------- texts and keyboards
const WELCOME =
  "👋 أهلاً! هذا قسم «المبرمج» 💻 — نموذج برمجة مفتوح يكتب الكود ويراجعه ويشرحه، وينفّذ مهام على GitHub خطوة بخطوة (يخطط ← ينفّذ ← يتحقق)، ويبحث في الويب ويشغّل الكود في حاسوب افتراضي خاص بالمهمة.\n" +
  "اكتب طلبك بأي طول؛ الردود الطويلة تصل على دفعات.\n\n" +
  "⚙️ الإعدادات، الذاكرة، الجدولة، الصلاحيات، ربط GitHub، تبديل القسم وسجل المهام: من زر «المبرمج» في القائمة أو الزر أدناه.\n" +
  "/stop لإيقاف مهمة جارية.";
export const modeKeyboard = (mode: Mode) =>
  new InlineKeyboard().text(`${mode === "coder" ? "✅ " : ""}💻 المبرمج`, "cmode|coder").text(`${mode === "sham" ? "✅ " : ""}🧪 شام (تجريبي)`, "cmode|sham");

async function send(bot: TelegramBot, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await bot.api.sendMessage(chatId, text.slice(0, 4096), extra as never).catch(() => null);
}

// ---------------------------------------------------------------- entry from the Telegram route (true = handled here)
export async function handleCoderSections(bot: TelegramBot, botRow: BotRow, update: any, db: Db = prismaDb): Promise<boolean> {
  if (!coderEnabled()) return false;
  const cq = update.callback_query;
  if (cq) {
    const data = String(cq.data || "");
    const chatId = cq.message?.chat?.id;
    if (!chatId || !/^c(mode|cf|perm|sch)\|/.test(data)) return false;
    const st = await loadState(chatId, db);
    if (data.startsWith("cmode|")) {
      st.mode = data === "cmode|sham" ? "sham" : "coder";
      await saveState(chatId, st, db);
      await bot.api.answerCallbackQuery(cq.id, { text: st.mode === "coder" ? "💻 قسم المبرمج" : "🧪 قسم شام" }).catch(() => null);
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id, { reply_markup: modeKeyboard(st.mode) }).catch(() => null);
      await send(bot, chatId, st.mode === "coder" ? "💻 أنت الآن في قسم المبرمج. اكتب طلبك." : "🧪 أنت الآن في قسم شام (للتجربة). /mode للرجوع إلى المبرمج.");
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
  // Management lives in the Mini App (owner's UX decision, 2026-10-21): the chat is for the conversation. Only /start and /stop stay;
  // every other command (old habits, menus) answers with the button that opens the app on the right tab.
  const ROUTED: Record<string, string> = {
    "/mode": "settings", "/think": "settings", "/perms": "settings", "/memory": "memory", "/schedule": "schedules", "/schedules": "schedules",
    "/app": "tasks", "/settings": "settings", "/github": "connect", "/connect": "connect", "/history": "tasks", "/tasks": "tasks", "/status": "settings",
    "/stalls": "settings", "/new": "tasks", "/help": "tasks",
  };
  if (cmd in ROUTED && cmd !== "/new" && cmd !== "/help") {
    await ensureMenuButton(bot, chatId, st, db);
    await send(bot, chatId, "📱 الإعدادات والذاكرة والجدولة والصلاحيات والربط وسجل المهام كلها في تطبيق المبرمج.", { reply_markup: appButton(ROUTED[cmd]) });
    return true;
  }
  if (st.mode === "sham") return false;                     // the existing Sham path, exactly as before

  if (cmd === "/start" || cmd === "/help") {
    await ensureMenuButton(bot, chatId, st, db, true);
    await send(bot, chatId, WELCOME, { reply_markup: appButton("tasks") });
    return true;
  }
  if (cmd === "/new") {
    // kept quietly for old habits (the app's "new conversation" does the same)
    await newConversation(chatId, st, db);
    await send(bot, chatId, "🆕 بدأت محادثة جديدة.");
    return true;
  }
  if (cmd === "/stop") {
    if (st.run?.job) await coderCancel(st.run.job).catch(() => null);
    await endRun(st, "stopped", db, "/stop", coderChatKey(chatId));
    if (st.convId) later(() => import("@/lib/coderSandbox").then((m) => m.stopSandbox(coderChatKey(chatId), st.convId!)));
    st.inbox = [];
    await saveState(chatId, st, db);
    await send(bot, chatId, "⏹️ أوقفت المهمة الجارية.");
    return true;
  }
  if (!st.menu) await ensureMenuButton(bot, chatId, st, db);

  let content = text;
  if (msg.document) content = `${text}\n\n${await readDocument(bot, botRow, msg.document)}`.trim();
  if (!content) {
    await send(bot, chatId, "أرسل طلبك نصاً (أو ملف كود نصي).");
    return true;
  }
  if (st.run && Date.now() - st.run.lease < LEASE_STALE_MS) {
    st.inbox.push(content);
    await saveState(chatId, st, db);
    await send(bot, chatId, st.run.pending ? "📥 وصلت رسالتك؛ المهمة تنتظر تأكيدك على الزر أعلاه." : "📥 وصلت رسالتك؛ سأضيفها للمهمة الجارية في الخطوة التالية.");
    return true;
  }
  if (st.run) st.inbox.push(content);
  else st.messages.push({ role: "user", content });
  startChain(botRow, chatId, st, {}, db);
  await saveState(chatId, st, db);
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  later(() => drive(bot, botRow, chatId, st.run!.chain, db));
  return true;
}

/** The inline button that opens the Mini App (optionally on one tab). */
export const appButton = (tab = "") => new InlineKeyboard().webApp("💻 فتح تطبيق المبرمج", `${appUrl()}${tab ? `?tab=${tab}` : ""}`);

/** The chat's persistent menu button opens the Mini App (set once per chat; `force` sets it again, e.g. on /start). */
async function ensureMenuButton(bot: TelegramBot, chatId: number, st: ChatState, db: Db, force = false): Promise<void> {
  if (st.menu && !force) return;
  try {
    await (bot.api as any).setChatMenuButton?.({ chat_id: chatId, menu_button: { type: "web_app", text: "المبرمج", web_app: { url: appUrl() } } });
  } catch {
    /* best-effort: the inline button still works */
  }
  st.menu = true;
  await saveState(chatId, st, db);
}

/** A new conversation: the running task stops, the VM of the old conversation is stopped, settings stay. */
export async function newConversation(chatId: number, st: ChatState, db: Db = prismaDb): Promise<void> {
  if (st.run?.job) await coderCancel(st.run.job).catch(() => null);
  const old = st.messages;
  const runId = st.run?.id;
  await endRun(st, "stopped", db, "new conversation", coderChatKey(chatId));
  if (st.convId) later(() => import("@/lib/coderSandbox").then((m) => m.stopSandbox(coderChatKey(chatId), st.convId!)));
  if (old.length) rememberLater(chatId, old, runId, st.repo, db);       // what was said is kept as long-term memory first
  await saveState(chatId, { ...emptyState(), mode: st.mode, think: st.think, tz: st.tz, lang: st.lang, repo: st.repo, menu: st.menu }, db);
}

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
  const pending = run.pending;
  run.pending = undefined;
  const [first, ...rest] = pending.calls;
  if (answer !== "no") {
    if (answer === "all") run.allowCats = [...new Set([...(run.allowCats || []), ...(pending.categories || [])])];
    await send(bot, chatId, answer === "all" ? `✅ تم التأكيد لبقية هذه المهمة: ${pending.reason}` : `✅ تم التأكيد: ${pending.reason}`);
    await taskEvent(run.id, "approved", `${answer === "all" ? "[rest of task] " : ""}${pending.reason} — ${first.function.name}`, db);
    const out = await runTool(first, await toolCtx(chatId, st, db, run));
    st.messages.push({ role: "tool", content: out, tool_call_id: first.id, name: first.function.name });
  } else {
    await send(bot, chatId, "❌ أُلغيت هذه الخطوة.");
    await taskEvent(run.id, "declined", `${pending.reason} — ${first.function.name}`, db);
    st.messages.push({ role: "tool", content: "The user declined this action (it was NOT executed). Continue without it or ask what they want.", tool_call_id: first.id, name: first.function.name });
  }
  run.queued = rest;
  startChain(botRow, chatId, st);
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

function startChain(_botRow: BotRow, chatId: number, st: ChatState, init: Partial<Run> = {}, db: Db = prismaDb) {
  if (!st.run) {
    st.run = { id: randomUUID().slice(0, 12), chain: "", sent: 0, step: 0, lease: Date.now(), startedAt: Date.now(), source: "interactive", slot: "", ...init };
    const last = [...st.messages].reverse().find((m) => m.role === "user");
    const title = st.run.title || String(last?.content || "").slice(0, 200);
    st.run.goal = st.run.goal || String(last?.content || "").slice(0, 4000);
    void taskStart(chatId, { runId: st.run.id, slot: st.run.slot || "", source: st.run.source || "interactive", scheduleId: st.run.scheduleId, title }, db);
  }
  st.run.chain = randomUUID().slice(0, 12);
  st.run.lease = Date.now();
}

/** A run ended: history status + the run cleared. */
async function endRun(st: ChatState, status: TaskStatus, db: Db, note = "", chatKeyOf = ""): Promise<void> {
  const run = st.run;
  st.run = null;
  if (!run) return;
  if (note) await taskEvent(run.id, status === "done" ? "done" : status === "stopped" ? "info" : "failed", note, db);
  await taskStatus(run.id, status, run.step, db);
  // a scheduled run's VM ends with the run; the chat's VM lives for the conversation (stopped by /new or /stop, or its own timeout)
  if (chatKeyOf && run.slot) later(() => import("@/lib/coderSandbox").then((m) => m.stopSandbox(chatKeyOf, run.id)));
  if (run.scheduleId) {
    const { scheduleRunFinished } = await import("@/lib/coderSchedules");
    await scheduleRunFinished(run.scheduleId, status, db);
  }
}

const contextOf = (run: Run): Context => (run.source && run.source !== "interactive" ? "scheduled" : "interactive");

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
async function toolCtx(chatId: number, st: ChatState, db: Db, run?: Run | null): Promise<ToolCtx & { tier: Tier }> {
  const conn = await resolveConnections(chatId, db);
  return {
    tier: tierFor(chatId),
    runId: (run || st.run)?.slot ? (run || st.run)!.id : (st.convId ||= randomUUID().slice(0, 12)),   // sandbox key: per scheduled run, per chat conversation
    chatKey: coderChatKey(chatId),
    userId: chatId,
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
  await fetch(`${selfUrl()}/api/coder/continue`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) }).catch(() => null);
}

async function sendParts(bot: TelegramBot, chatId: number, text: string, run: Run, final: boolean) {
  for (const [a, b] of chunkRanges(text, run.sent, final)) {
    const part = renderRange(text, a, b);
    if (part.trim()) {
      await send(bot, chatId, part);
      await taskEvent(run.id, "text", part);
    }
    run.sent = b;
  }
}

export async function drive(bot: TelegramBot, botRow: BotRow, chatId: number, chain: string, db: Db = prismaDb, budgetMs = BUDGET_MS, slot = ""): Promise<void> {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  let cached: CoderReply | null = null;                 // `chat` already answered within its wait: no extra poll
  for (;;) {
    const st = await loadState(chatId, db, slot);
    const run = st.run;
    if (!run || run.chain !== chain || run.pending) return;
    run.stall = run.stall || newStallState();
    run.lease = Date.now();
    if (left() < 6000) {
      await saveState(chatId, st, db, slot);
      await handOff(botRow, chatId, chain, slot);
      return;
    }
    const ctx = await toolCtx(chatId, st, db, run);
    const github = Boolean(ctx.gh);

    // 1) tool calls waiting to run (after a confirmation, or the rest of a batch)
    if (run.queued?.length) {
      const [call, ...rest] = run.queued;
      const skip = beforeCall(run.stall, call);
      if (skip) {
        // the same call yet again after a recovery: not run; the model gets its earlier result and must change course
        run.stall.level++;
        st.messages.push({ role: "tool", content: skip.skip, tool_call_id: call.id, name: call.function.name });
        await onStall({ pattern: "repeat_call", detail: `${call.function.name} skipped (identical call again)` }, run, chatId, ctx, db);
        run.queued = rest;
        await saveState(chatId, st, db, slot);
        continue;
      }
      // permissions: tier defaults + the user's own policy (coder_permission_prefs) + "allow for the rest of this task"
      const g = await evaluateCall(call, ctx.gh, ctx.tier, contextOf(run), await loadPrefs(chatId, db), run.allowCats || []);
      if (g.action === "deny") {
        await taskEvent(run.id, "auto_denied", `${g.reason} — ${call.function.name}\n${g.summary}`, db);
        await send(bot, chatId, `⛔ رُفض تلقائياً حسب إعداداتك: ${g.reason}\n${call.function.name}`);
        st.messages.push({ role: "tool", content: `DENIED by the user's standing policy (${g.denied.join(", ")}); it was NOT executed. Do not retry it; find another way or explain what is needed.`, tool_call_id: call.id, name: call.function.name });
        run.queued = rest;
        afterCall(run.stall, call, "denied", run.step);
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
        const head = run.title && run.source !== "interactive" ? `⏰ ${run.title.slice(0, 80)}\n` : "";
        const m = await bot.api.sendMessage(chatId, `${head}⚠️ يحتاج تأكيدك: ${g.reason}\n${call.function.name}\n${g.summary}`.slice(0, 3500), { reply_markup: kb } as never).catch(() => null);
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
      await send(bot, chatId, toolLabel(call));
      await taskEvent(run.id, "tool", toolLabel(call), db);
      const out = await runTool(call, ctx);
      st.messages.push({ role: "tool", content: out, tool_call_id: call.id, name: call.function.name });
      run.queued = rest;
      const seen = afterCall(run.stall, call, out, run.step);
      if (seen.stall) await onStall(seen.stall, run, chatId, ctx, db);
      if (seen.wait) run.waitUntil = Date.now() + ciWaitMs();
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
      await bot.api.sendChatAction(chatId, "typing").catch(() => null);
      await new Promise((res) => setTimeout(res, ms));
      continue;
    }

    // 2) a job on the Studio: poll it and send what is finished
    if (run.job) {
      const o = cached && cached.job === run.job ? { reply: cached } : await coderJobResult(run.job, 0, Math.min(10000, left() - 2000));
      cached = null;
      const r: CoderReply | null = o.reply;
      if (!r || r.type === "error" || r.type === "gone" || r.type === "cancelled") {
        if (run.compacting && r?.type !== "cancelled" && !(!r && (o.failure === "timeout" || o.failure === "network"))) {
          run.job = undefined;                        // the summary job failed: the harness writes the summary itself
          run.sent = 0;
          await startSegment(bot, chatId, st, run, "", db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        if (!r && (o.failure === "timeout" || o.failure === "network")) {
          await saveState(chatId, st, db, slot);
          await new Promise((res) => setTimeout(res, pollMs()));
          continue;                                   // a slow / flaky poll is not the end of the job
        }
        if (r?.type === "error" && (run.retries || 0) < MAX_RETRIES) {
          // e.g. the context overflowed: same step again with a smaller history, the task goes on
          run.retries = (run.retries || 0) + 1;
          run.histChars = Math.max(12000, Math.floor((run.histChars || Number(process.env.CODER_HISTORY_CHARS || 70000)) / 2));
          run.job = undefined;
          run.sent = 0;
          await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "repeat_error", level: run.stall.level, detail: `studio job error, retry ${run.retries}: ${(r.error || "").slice(0, 200)}` }, db);
          await saveState(chatId, st, db, slot);
          continue;
        }
        await endRun(st, r?.type === "cancelled" ? "stopped" : "failed", db, r?.type === "cancelled" ? "cancelled" : coderFailureText(o), coderChatKey(chatId));
        await saveState(chatId, st, db, slot);
        if (r?.type !== "cancelled") await send(bot, chatId, coderFailureText(o));
        return;
      }
      const text = r.text || "";
      if (r.type === "pending") {
        if (!run.compacting) await sendParts(bot, chatId, text, run, false);
        await saveState(chatId, st, db, slot);
        await bot.api.sendChatAction(chatId, "typing").catch(() => null);
        await new Promise((res) => setTimeout(res, pollMs()));
        continue;
      }
      // done
      if (run.compacting) {
        // the end-of-segment progress summary: memory, a fresh context, and the task goes on in the next segment
        run.job = undefined;
        run.sent = 0;
        await startSegment(bot, chatId, st, run, text, db);
        await saveState(chatId, st, db, slot);
        continue;
      }
      await sendParts(bot, chatId, text, run, true);
      const calls = (r.tool_calls || []).filter((c) => c?.function?.name);
      st.messages.push(calls.length ? { role: "assistant", content: text, tool_calls: calls } : { role: "assistant", content: text });
      run.job = undefined;
      run.sent = 0;
      run.retries = 0;
      if (calls.length) {
        run.queued = calls;
        run.step++;
        const looped = afterText(run.stall, text, run.step);
        if (looped) await onStall(looped, run, chatId, ctx, db);
        if (stepsSinceProgress(run.stall, run.step) >= HARD_MAX_STEPS) {
          // the only stop: a stall safety net against runaway compute (CODER_HARD_MAX_STEPS model steps with no real progress — not total
          // steps, so a long task that keeps moving never reaches it). Not a pause — the task ends and says so.
          await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "hard_ceiling", level: run.stall.level, detail: `${HARD_MAX_STEPS} steps without progress (CODER_HARD_MAX_STEPS), step ${run.step}` }, db);
          for (const c of calls) st.messages.push({ role: "tool", content: "[harness] Hard safety ceiling reached; the task was stopped here (not executed).", tool_call_id: c.id, name: c.function.name });
          await endRun(st, "ceiling", db, `hard ceiling ${HARD_MAX_STEPS}`, coderChatKey(chatId));
          await saveState(chatId, st, db, slot);
          await send(bot, chatId, `⛔ توقفت المهمة عند سقف الأمان: ${HARD_MAX_STEPS} خطوة متتالية بلا أي تقدّم حقيقي، لمنع استهلاك لا نهائي. اكتب «تابع» لأكمل من حيث توقفت.`);
          return;
        }
        await saveState(chatId, st, db, slot);
        continue;
      }
      if (!text.trim()) await send(bot, chatId, "(انتهى الرد بلا نص)");
      if (st.inbox.length) {
        for (const m of st.inbox) st.messages.push({ role: "user", content: m });
        st.inbox = [];
        await saveState(chatId, st, db, slot);
        continue;
      }
      rememberLater(chatId, st.messages, run.id, st.repo, db);
      await endRun(st, "done", db, "✓", coderChatKey(chatId));
      await saveState(chatId, st, db, slot);
      return;
    }

    // 3) nothing running. A long task whose context grew large first closes its segment: the model writes a progress summary
    // (no tools), it is kept as task memory and becomes the whole context of the next segment (coderSegments.ts).
    if (run.compacting || needsSegment(st.messages, run)) {
      run.compacting = true;
      const sumMsgs: CoderMessage[] = [{ role: "system", content: "You are the coding agent pausing at a context checkpoint. Write the progress summary you are asked for, nothing else." }, ...trimMessages(st.messages, run.histChars), summaryRequest(run.goal || "", run.segment || 1)];
      const waitS = Math.max(1, Math.min(20, Math.floor((left() - 12000) / 1000)));
      const o = await coderChat(sumMsgs, { think: false, temperature: 0.3, waitS, timeoutMs: waitS * 1000 + 9000 });
      if (o.reply?.job) {
        run.job = o.reply.job;
        run.sent = 0;
        if (o.reply.type !== "pending") cached = o.reply;
      } else await startSegment(bot, chatId, st, run, "", db);
      await saveState(chatId, st, db, slot);
      continue;
    }
    // ask the model for the next step (messages that came in meanwhile join the conversation now)
    if (st.inbox.length) {
      for (const m of st.inbox) st.messages.push({ role: "user", content: m });
      st.inbox = [];
    }
    if (run.recovery) {
      st.messages.push({ role: "user", content: run.recovery });       // the reflection / re-plan step after a detected loop
      run.recovery = undefined;
    }
    const knobs = recoveryKnobs(run.stall);
    if (run.memory === undefined) {
      // relevant long-term memories, once per task (keyword + recency + repo scope)
      const { memoryPrompt, repoOf } = await import("@/lib/coderMemory");
      run.memory = await memoryPrompt(chatId, run.goal || "", repoOf(run.goal || "", st.repo), db).catch(() => "");
    }
    const messages: CoderMessage[] = [{ role: "system", content: coderSystemPrompt({ github, notes: `${run.memory ? `${run.memory}\n` : ""}${st.repo ? `Default repository for this user: ${st.repo}\n` : ""}${st.notes}` }) }, ...trimMessages(st.messages, run.histChars)];
    const waitS = Math.max(1, Math.min(20, Math.floor((left() - 12000) / 1000)));
    const o = await coderChat(messages, { tools: coderTools(github), think: st.think || knobs.think, temperature: knobs.temperature, waitS, timeoutMs: waitS * 1000 + 9000 });
    const r = o.reply;
    if ((!r || !r.job) && o.failure && o.failure !== "off" && (run.retries || 0) < MAX_RETRIES) {
      run.retries = (run.retries || 0) + 1;                            // a Studio hiccup is not the end of the task
      await saveState(chatId, st, db, slot);
      await new Promise((res) => setTimeout(res, Math.min(10000, pollMs() * 2 * run.retries!)));
      continue;
    }
    if (!r || !r.job) {
      await endRun(st, "failed", db, coderFailureText(o), coderChatKey(chatId));
      await saveState(chatId, st, db, slot);
      await send(bot, chatId, coderFailureText(o));
      return;
    }
    run.job = r.job;
    run.sent = 0;
    if (r.type !== "pending") cached = r;
    if (r.type === "pending" && r.queue_pos && r.queue_pos > 0) await send(bot, chatId, `⏳ طلبك في الدور (${r.queue_pos} قبله).`);
    if (r.type === "pending" && r.phase && r.phase !== "ready") await send(bot, chatId, "⏳ خادم المبرمج يحمّل النموذج الآن؛ سيبدأ الرد حين يجهز.");
    await saveState(chatId, st, db, slot);
  }
}

/** Closes the current segment with `text` (the model's summary, or the harness's own when it is unusable) and opens the next one. */
async function startSegment(bot: TelegramBot, chatId: number, st: ChatState, run: Run, text: string, db: Db): Promise<void> {
  const seg = run.segment || 1;
  const own = usableSummary(text);
  const summary = own ? text.trim() : fallbackSummary(run.goal || "", st.messages, run.stall?.touched || [], st.notes);
  await saveSegment(run.id, seg, stateKey(chatId, run.slot || ""), summary, db);
  await taskEvent(run.id, "segment", `${seg} → ${seg + 1}${own ? "" : " (harness summary)"}
${summary}`, db);
  st.messages = segmentMessages(run.goal || "", summary, seg + 1);
  run.segment = seg + 1;
  run.segStep = run.step;
  run.compacting = false;
  run.histChars = undefined;                                            // a fresh context gets the full budget again
  run.retries = 0;
  if (run.stall) {
    run.stall.calls = [];
    run.stall.texts = [];
  }
  await send(bot, chatId, `🔁 المهمة طويلة: حفظتُ ملخّص ما أُنجز وأكمل في الخلفية (المرحلة ${seg + 1}).${run.title ? ` — ${run.title.slice(0, 80)}` : ""}`);
}

/** /api/coder/continue: the next leg of a long run. */
export async function continueRun(botRow: BotRow, chatId: number, chain: string, db: Db = prismaDb, slot = ""): Promise<void> {
  const { Bot } = await import("grammy");
  const bot = new Bot(botRow.token);
  const st = await loadState(chatId, db, slot);
  if (!st.run || st.run.chain !== chain) return;
  st.run.lease = Date.now();
  await saveState(chatId, st, db, slot);
  await drive(bot, botRow, chatId, chain, db, BUDGET_MS, slot);
}

/**
 * Starts a scheduled / event-triggered task in its own slot (src/lib/coderSchedules.ts): a fresh run with its own step counter
 * (the hard ceiling is per run, never cumulative), same permission tiers and policy (context "scheduled"), results to the user's chat.
 * Returns "started", "busy" (the previous run of this schedule is still going) or "off".
 */
export async function startScheduledRun(
  bot: TelegramBot, botRow: BotRow, chatId: number, t: { scheduleId: string; title: string; prompt: string; source: "scheduled" | "event" }, db: Db = prismaDb,
): Promise<"started" | "busy" | "off"> {
  if (!coderEnabled()) return "off";
  const slot = `s:${t.scheduleId}`;
  const prev = await loadState(chatId, db, slot);
  if (prev.run && Date.now() - prev.run.lease < LEASE_STALE_MS * 5) return "busy";
  const main = await loadState(chatId, db);
  const st: ChatState = { ...emptyState(), mode: "coder", think: main.think, notes: main.notes, tz: main.tz, lang: main.lang, repo: main.repo, messages: [{ role: "user", content: t.prompt }] };
  startChain(botRow, chatId, st, { slot, source: t.source, scheduleId: t.scheduleId, title: t.title }, db);
  await saveState(chatId, st, db, slot);
  await send(bot, chatId, `⏰ بدأت مهمة ${t.source === "event" ? "حدث" : "مجدولة"}: ${t.title}`.slice(0, 600));
  later(() => drive(bot, botRow, chatId, st.run!.chain, db, BUDGET_MS, slot));
  return "started";
}

export { splitForTelegram };
