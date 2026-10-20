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
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { coderEnabled, coderChat, coderJobResult, coderCancel, coderStatus, coderFailureText, chunkRanges, renderRange, splitForTelegram, type CoderMessage, type CoderToolCall, type CoderReply } from "@/lib/openCoderStudio";
import { coderSystemPrompt, coderTools, githubClient, guardCall, runTool, toolLabel, trimMessages } from "@/lib/coderAgent";

export type Mode = "coder" | "sham";
export type Pending = { calls: CoderToolCall[]; reason: string; summary: string; nonce: string };
export type Run = { id: string; chain: string; job?: string; sent: number; step: number; lease: number; pending?: Pending; pausedAtStep?: boolean; queued?: CoderToolCall[] };
export type ChatState = { mode: Mode; think: boolean; messages: CoderMessage[]; notes: string; inbox: string[]; run: Run | null };
export type Db = { exec: (sql: string, ...args: unknown[]) => Promise<unknown>; query: <T>(sql: string, ...args: unknown[]) => Promise<T[]> };

const prismaDb: Db = {
  exec: (sql, ...args) => prisma.$executeRawUnsafe(sql, ...args),
  query: <T,>(sql: string, ...args: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...args),
};

const MAX_STEPS = Number(process.env.CODER_MAX_STEPS || 60);         // runaway-loop pause: asks «متابعة؟» (one tap), never a refusal
const BUDGET_MS = 47000;                                              // per invocation, inside maxDuration 60
const LEASE_STALE_MS = 120000;
const POLL_MS = Number(process.env.CODER_POLL_MS || 3000);

export function coderChatKey(chatId: number | string): string {
  const salt = process.env.CODER_STATE_SALT || process.env.SHAM_MEMORY_SALT || "coder-section";
  return "tgc:" + createHash("sha256").update(`${salt}|${chatId}`).digest("hex").slice(0, 32);
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

export async function loadState(chatId: number | string, db: Db = prismaDb): Promise<ChatState> {
  try {
    await ensureTable(db);
    const rows = await db.query<{ state: Partial<ChatState> }>(`SELECT state FROM coder_chat_state WHERE chat_key = $1`, coderChatKey(chatId));
    return { ...emptyState(), ...(rows[0]?.state || {}) };
  } catch {
    return emptyState();
  }
}

export async function saveState(chatId: number | string, st: ChatState, db: Db = prismaDb): Promise<void> {
  try {
    await ensureTable(db);
    await db.exec(
      `INSERT INTO coder_chat_state (chat_key, state, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (chat_key) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      coderChatKey(chatId),
      JSON.stringify(st),
    );
  } catch {
    /* best-effort: a database error never blocks a reply */
  }
}

// ---------------------------------------------------------------- who gets GitHub tools (the owner's token is not handed to strangers)
export function githubAllowed(chatId: number | string): boolean {
  if (!(process.env.CODER_GITHUB_TOKEN || "").trim()) return false;
  const ids = [process.env.SUPER_ADMIN_TELEGRAM_ID, process.env.TELEGRAM_ADMIN_CHAT_ID, ...(process.env.CODER_GITHUB_CHAT_IDS || "").split(",")]
    .map((x) => (x || "").trim())
    .filter(Boolean);
  return ids.includes(String(chatId));
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

function selfUrl(): string {
  return (process.env.CODER_SELF_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/+$/, "");
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
  "👋 أهلاً! هذا قسم «المبرمج» 💻 — نموذج برمجة مفتوح يكتب الكود ويراجعه ويشرحه، وينفّذ مهام على GitHub خطوة بخطوة (يخطط ← ينفّذ ← يتحقق).\n" +
  "اكتب طلبك بأي طول؛ الردود الطويلة تصل على دفعات.\n\n" +
  "الأوامر: /mode تبديل القسم (المبرمج / شام) · /new محادثة جديدة · /stop إيقاف المهمة الجارية · /think تفكير أعمق (أبطأ) · /status حالة الخادم";
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
    if (!chatId || !/^c(mode|cf|go)\|/.test(data)) return false;
    const st = await loadState(chatId, db);
    if (data.startsWith("cmode|")) {
      st.mode = data === "cmode|sham" ? "sham" : "coder";
      await saveState(chatId, st, db);
      await bot.api.answerCallbackQuery(cq.id, { text: st.mode === "coder" ? "💻 قسم المبرمج" : "🧪 قسم شام" }).catch(() => null);
      await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id, { reply_markup: modeKeyboard(st.mode) }).catch(() => null);
      await send(bot, chatId, st.mode === "coder" ? "💻 أنت الآن في قسم المبرمج. اكتب طلبك." : "🧪 أنت الآن في قسم شام (للتجربة). /mode للرجوع إلى المبرمج.");
      return true;
    }
    const [kind, runId, nonce, answer] = data.split("|");
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    await bot.api.editMessageReplyMarkup(chatId, cq.message.message_id, { reply_markup: new InlineKeyboard() }).catch(() => null);
    const run = st.run;
    if (!run || run.id !== runId) {
      await send(bot, chatId, "انتهت هذه المهمة بالفعل.");
      return true;
    }
    if (kind === "ccf") {
      if (!run.pending || run.pending.nonce !== nonce) return true;
      const pending = run.pending;
      run.pending = undefined;
      const [first, ...rest] = pending.calls;
      if (answer === "yes") {
        await send(bot, chatId, `✅ تم التأكيد: ${pending.reason}`);
        const out = await runTool(first, toolCtx(chatId, st));
        st.messages.push({ role: "tool", content: out, tool_call_id: first.id, name: first.function.name });
      } else {
        await send(bot, chatId, "❌ أُلغيت هذه الخطوة.");
        st.messages.push({ role: "tool", content: "The user declined this action (it was NOT executed). Continue without it or ask what they want.", tool_call_id: first.id, name: first.function.name });
      }
      run.queued = rest;
    } else if (kind === "cgo") {
      if (answer !== "yes") {
        st.run = null;
        await saveState(chatId, st, db);
        await send(bot, chatId, "⏹️ أوقفت المهمة.");
        return true;
      }
      run.step = 0;
      run.pausedAtStep = false;
    }
    startChain(botRow, chatId, st);
    await saveState(chatId, st, db);
    later(() => drive(bot, botRow, chatId, st.run!.chain, db));
    return true;
  }

  const msg = update.message;
  const chatId: number | undefined = msg?.chat?.id;
  if (!chatId) return false;
  const text: string = typeof msg.text === "string" ? msg.text.trim() : typeof msg.caption === "string" ? msg.caption.trim() : "";
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const st = await loadState(chatId, db);
  if (cmd === "/mode") {
    await send(bot, chatId, "اختر القسم:", { reply_markup: modeKeyboard(st.mode) });
    return true;
  }
  if (st.mode === "sham") return false;                     // the existing Sham path, exactly as before

  if (cmd === "/start" || cmd === "/help") {
    await send(bot, chatId, WELCOME, { reply_markup: modeKeyboard(st.mode) });
    return true;
  }
  if (cmd === "/new") {
    if (st.run?.job) await coderCancel(st.run.job).catch(() => null);
    await saveState(chatId, { ...emptyState(), mode: st.mode, think: st.think }, db);
    await send(bot, chatId, "🆕 بدأت محادثة جديدة.");
    return true;
  }
  if (cmd === "/stop") {
    if (st.run?.job) await coderCancel(st.run.job).catch(() => null);
    st.run = null;
    st.inbox = [];
    await saveState(chatId, st, db);
    await send(bot, chatId, "⏹️ أوقفت المهمة الجارية.");
    return true;
  }
  if (cmd === "/think") {
    st.think = !st.think;
    await saveState(chatId, st, db);
    await send(bot, chatId, st.think ? "🧠 التفكير الأعمق مفعّل (أدق وأبطأ)." : "⚡ التفكير الأعمق متوقف (أسرع).");
    return true;
  }
  if (cmd === "/status") {
    const s = await coderStatus();
    await send(bot, chatId, s ? `حالة خادم المبرمج:\n${JSON.stringify(s, null, 1).slice(0, 1500)}` : "تعذّر الوصول إلى خادم المبرمج الآن.");
    return true;
  }

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
  if (!st.run) st.run = { id: randomUUID().slice(0, 12), chain: "", sent: 0, step: 0, lease: Date.now() };
  startChain(botRow, chatId, st);
  await saveState(chatId, st, db);
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  later(() => drive(bot, botRow, chatId, st.run!.chain, db));
  return true;
}

function startChain(_botRow: BotRow, _chatId: number, st: ChatState) {
  if (!st.run) st.run = { id: randomUUID().slice(0, 12), chain: "", sent: 0, step: 0, lease: Date.now() };
  st.run.chain = randomUUID().slice(0, 12);
  st.run.lease = Date.now();
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

function toolCtx(chatId: number, st: ChatState) {
  const token = (process.env.CODER_GITHUB_TOKEN || "").trim();
  return {
    gh: githubAllowed(chatId) && token ? githubClient(token) : null,
    addNote: (t: string) => {
      st.notes = `${st.notes}\n- ${t}`.trim().slice(-4000);
    },
  };
}

// ---------------------------------------------------------------- the loop: submit -> poll/stream -> tools (guarded) -> submit … until a final answer
async function handOff(botRow: BotRow, chatId: number, chain: string): Promise<void> {
  const body = JSON.stringify({ botId: botRow.id, chatId: String(chatId), chain, sig: signContinue(botRow.webhookSecret || "", botRow.id, String(chatId), chain) });
  await fetch(`${selfUrl()}/api/coder/continue`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) }).catch(() => null);
}

async function sendParts(bot: TelegramBot, chatId: number, text: string, run: Run, final: boolean) {
  for (const [a, b] of chunkRanges(text, run.sent, final)) {
    const part = renderRange(text, a, b);
    if (part.trim()) await send(bot, chatId, part);
    run.sent = b;
  }
}

export async function drive(bot: TelegramBot, botRow: BotRow, chatId: number, chain: string, db: Db = prismaDb, budgetMs = BUDGET_MS): Promise<void> {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  let cached: CoderReply | null = null;                 // `chat` already answered within its wait: no extra poll
  for (;;) {
    const st = await loadState(chatId, db);
    const run = st.run;
    if (!run || run.chain !== chain || run.pending || run.pausedAtStep) return;
    run.lease = Date.now();
    if (left() < 6000) {
      await saveState(chatId, st, db);
      await handOff(botRow, chatId, chain);
      return;
    }
    const github = githubAllowed(chatId);

    // 1) tool calls waiting to run (after a confirmation, or the rest of a batch)
    if (run.queued?.length) {
      const [call, ...rest] = run.queued;
      const gh = toolCtx(chatId, st).gh;
      const g = await guardCall(call, gh);
      if (g.confirm) {
        const nonce = randomUUID().slice(0, 6);
        run.pending = { calls: run.queued, reason: g.reason, summary: g.summary, nonce };
        run.queued = [];
        await saveState(chatId, st, db);
        const kb = new InlineKeyboard().text("✅ نفّذ", `ccf|${run.id}|${nonce}|yes`).text("❌ ألغِ", `ccf|${run.id}|${nonce}|no`);
        await send(bot, chatId, `⚠️ يحتاج تأكيدك: ${g.reason}\n${call.function.name}\n${g.summary}`.slice(0, 3500), { reply_markup: kb });
        return;
      }
      await send(bot, chatId, toolLabel(call));
      const out = await runTool(call, toolCtx(chatId, st));
      st.messages.push({ role: "tool", content: out, tool_call_id: call.id, name: call.function.name });
      run.queued = rest;
      await saveState(chatId, st, db);
      continue;
    }

    // 2) a job on the Studio: poll it and send what is finished
    if (run.job) {
      const o = cached && cached.job === run.job ? { reply: cached } : await coderJobResult(run.job, 0, Math.min(10000, left() - 2000));
      cached = null;
      const r: CoderReply | null = o.reply;
      if (!r || r.type === "error" || r.type === "gone" || r.type === "cancelled") {
        if (!r && (o.failure === "timeout" || o.failure === "network")) {
          await saveState(chatId, st, db);
          await new Promise((res) => setTimeout(res, POLL_MS));
          continue;                                   // a slow / flaky poll is not the end of the job
        }
        st.run = null;
        await saveState(chatId, st, db);
        if (r?.type !== "cancelled") await send(bot, chatId, coderFailureText(o));
        return;
      }
      const text = r.text || "";
      if (r.type === "pending") {
        await sendParts(bot, chatId, text, run, false);
        await saveState(chatId, st, db);
        await bot.api.sendChatAction(chatId, "typing").catch(() => null);
        await new Promise((res) => setTimeout(res, POLL_MS));
        continue;
      }
      // done
      await sendParts(bot, chatId, text, run, true);
      const calls = (r.tool_calls || []).filter((c) => c?.function?.name);
      st.messages.push(calls.length ? { role: "assistant", content: text, tool_calls: calls } : { role: "assistant", content: text });
      run.job = undefined;
      run.sent = 0;
      if (calls.length) {
        run.queued = calls;
        run.step++;
        if (run.step >= MAX_STEPS) {
          run.pausedAtStep = true;
          await saveState(chatId, st, db);
          const kb = new InlineKeyboard().text("▶️ متابعة", `cgo|${run.id}|-|yes`).text("⏹️ إيقاف", `cgo|${run.id}|-|no`);
          await send(bot, chatId, `نفّذ المبرمج ${run.step} خطوة في هذه المهمة. أتابع؟`, { reply_markup: kb });
          return;
        }
        await saveState(chatId, st, db);
        continue;
      }
      if (!text.trim()) await send(bot, chatId, "(انتهى الرد بلا نص)");
      if (st.inbox.length) {
        for (const m of st.inbox) st.messages.push({ role: "user", content: m });
        st.inbox = [];
        await saveState(chatId, st, db);
        continue;
      }
      st.run = null;
      await saveState(chatId, st, db);
      return;
    }

    // 3) nothing running: ask the model for the next step (messages that came in meanwhile join the conversation now)
    if (st.inbox.length) {
      for (const m of st.inbox) st.messages.push({ role: "user", content: m });
      st.inbox = [];
    }
    const messages: CoderMessage[] = [{ role: "system", content: coderSystemPrompt({ github, notes: st.notes }) }, ...trimMessages(st.messages)];
    const waitS = Math.max(1, Math.min(20, Math.floor((left() - 12000) / 1000)));
    const o = await coderChat(messages, { tools: coderTools(github), think: st.think, waitS, timeoutMs: waitS * 1000 + 9000 });
    const r = o.reply;
    if (!r || !r.job) {
      st.run = null;
      await saveState(chatId, st, db);
      await send(bot, chatId, coderFailureText(o));
      return;
    }
    run.job = r.job;
    run.sent = 0;
    if (r.type !== "pending") cached = r;
    if (r.type === "pending" && r.queue_pos && r.queue_pos > 0) await send(bot, chatId, `⏳ طلبك في الدور (${r.queue_pos} قبله).`);
    if (r.type === "pending" && r.phase && r.phase !== "ready") await send(bot, chatId, "⏳ خادم المبرمج يحمّل النموذج الآن؛ سيبدأ الرد حين يجهز.");
    await saveState(chatId, st, db);
  }
}

/** /api/coder/continue: the next leg of a long run. */
export async function continueRun(botRow: BotRow, chatId: number, chain: string, db: Db = prismaDb): Promise<void> {
  const { Bot } = await import("grammy");
  const bot = new Bot(botRow.token);
  const st = await loadState(chatId, db);
  if (!st.run || st.run.chain !== chain) return;
  st.run.lease = Date.now();
  await saveState(chatId, st, db);
  await drive(bot, botRow, chatId, chain, db);
}

export { splitForTelegram };
