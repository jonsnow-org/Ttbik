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
import { coderSystemPrompt, coderTools, githubClient, guardCall, runTool, toolLabel, trimMessages, type ToolCtx } from "@/lib/coderAgent";
import { afterCall, afterText, beforeCall, HARD_MAX_STEPS, logStall, newStallState, recentStalls, recoveryKnobs, recoveryMessage, type Stall, type StallState } from "@/lib/coderStall";

export type Mode = "coder" | "sham";
export type Pending = { calls: CoderToolCall[]; reason: string; summary: string; nonce: string };
export type Run = {
  id: string; chain: string; job?: string; sent: number; step: number; lease: number; pending?: Pending; queued?: CoderToolCall[];
  stall?: StallState; recovery?: string; waitUntil?: number; retries?: number; histChars?: number; startedAt?: number;
};
export type ChatState = { mode: Mode; think: boolean; messages: CoderMessage[]; notes: string; inbox: string[]; run: Run | null };
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
    if (!chatId || !/^c(mode|cf)\|/.test(data)) return false;
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
        const out = await runTool(first, await toolCtx(chatId, st, db));
        st.messages.push({ role: "tool", content: out, tool_call_id: first.id, name: first.function.name });
      } else {
        await send(bot, chatId, "❌ أُلغيت هذه الخطوة.");
        st.messages.push({ role: "tool", content: "The user declined this action (it was NOT executed). Continue without it or ask what they want.", tool_call_id: first.id, name: first.function.name });
      }
      run.queued = rest;
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
  if (cmd === "/stalls" && tierFor(chatId) === "owner") {
    const rows = await recentStalls(15);
    await send(bot, chatId, rows.length ? rows.map((r) => `${String(r.created_at || "").slice(0, 16)} ${r.run_id} step ${r.step} ${r.pattern} L${r.level} — ${r.detail.slice(0, 120)}`).join("\n") : "لا توجد حلقات مسجّلة.");
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
  startChain(botRow, chatId, st);
  await saveState(chatId, st, db);
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  later(() => drive(bot, botRow, chatId, st.run!.chain, db));
  return true;
}

function startChain(_botRow: BotRow, _chatId: number, st: ChatState) {
  if (!st.run) st.run = { id: randomUUID().slice(0, 12), chain: "", sent: 0, step: 0, lease: Date.now(), startedAt: Date.now() };
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

/** Tools for this chat: the owner's token for the owner, a user's own linked token for a user (src/lib/coderAuth.ts), else none. */
async function toolCtx(chatId: number, st: ChatState, db: Db): Promise<ToolCtx & { tier: Tier }> {
  const conn = await resolveConnections(chatId, db);
  return {
    tier: tierFor(chatId),
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
    if (!run || run.chain !== chain || run.pending) return;
    run.stall = run.stall || newStallState();
    run.lease = Date.now();
    if (left() < 6000) {
      await saveState(chatId, st, db);
      await handOff(botRow, chatId, chain);
      return;
    }
    const ctx = await toolCtx(chatId, st, db);
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
        await saveState(chatId, st, db);
        continue;
      }
      const g = await guardCall(call, ctx.gh, ctx.tier);
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
      const out = await runTool(call, ctx);
      st.messages.push({ role: "tool", content: out, tool_call_id: call.id, name: call.function.name });
      run.queued = rest;
      const seen = afterCall(run.stall, call, out, run.step);
      if (seen.stall) await onStall(seen.stall, run, chatId, ctx, db);
      if (seen.wait) run.waitUntil = Date.now() + ciWaitMs();
      await saveState(chatId, st, db);
      continue;
    }

    // CI still running with nothing new: wait (inside this leg, or hand the wait to the next leg)
    if (run.waitUntil && run.waitUntil > Date.now()) {
      const ms = run.waitUntil - Date.now();
      if (ms > left() - 7000) {
        await saveState(chatId, st, db);
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
        if (!r && (o.failure === "timeout" || o.failure === "network")) {
          await saveState(chatId, st, db);
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
          await saveState(chatId, st, db);
          continue;
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
        await new Promise((res) => setTimeout(res, pollMs()));
        continue;
      }
      // done
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
        if (run.step >= HARD_MAX_STEPS) {
          // the only stop: a very high ceiling against runaway compute (CODER_HARD_MAX_STEPS). Not a pause — the task ends and says so.
          await logStall({ run_id: run.id, chat_key: coderChatKey(chatId), step: run.step, pattern: "hard_ceiling", level: run.stall.level, detail: `reached CODER_HARD_MAX_STEPS=${HARD_MAX_STEPS}` }, db);
          for (const c of calls) st.messages.push({ role: "tool", content: "[harness] Hard safety ceiling reached; the task was stopped here (not executed).", tool_call_id: c.id, name: c.function.name });
          st.run = null;
          await saveState(chatId, st, db);
          await send(bot, chatId, `⛔ توقفت المهمة عند سقف الأمان (${HARD_MAX_STEPS} خطوة) لمنع استهلاك لا نهائي. اكتب «تابع» لأكمل من حيث توقفت.`);
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
    if (run.recovery) {
      st.messages.push({ role: "user", content: run.recovery });       // the reflection / re-plan step after a detected loop
      run.recovery = undefined;
    }
    const knobs = recoveryKnobs(run.stall);
    const messages: CoderMessage[] = [{ role: "system", content: coderSystemPrompt({ github, notes: st.notes }) }, ...trimMessages(st.messages, run.histChars)];
    const waitS = Math.max(1, Math.min(20, Math.floor((left() - 12000) / 1000)));
    const o = await coderChat(messages, { tools: coderTools(github), think: st.think || knobs.think, temperature: knobs.temperature, waitS, timeoutMs: waitS * 1000 + 9000 });
    const r = o.reply;
    if ((!r || !r.job) && o.failure && o.failure !== "off" && (run.retries || 0) < MAX_RETRIES) {
      run.retries = (run.retries || 0) + 1;                            // a Studio hiccup is not the end of the task
      await saveState(chatId, st, db);
      await new Promise((res) => setTimeout(res, Math.min(10000, pollMs() * 2 * run.retries!)));
      continue;
    }
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
