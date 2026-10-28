// Server side of the coder's Telegram Mini App (/coder-app). Every call carries Telegram's signed initData (header
// x-telegram-init-data), verified with the coder bot's own token (verifyTelegramInitData) — the user id from it is the private chat id.
// One dispatcher (appOp) so the route stays thin and everything here is unit-testable with a fake db and bot.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { terminalAllowed } from "@/lib/coderPlans";
import { connectionInfo, deleteConnection, prismaDb, saveConnection, tierFor, type Db } from "@/lib/coderAuth";
import { CATEGORIES, CATEGORY_LABEL, isCategory, isPolicy, loadPrefs, removePref, setPref, tierDefault } from "@/lib/coderPrefs";
import { archiveFinishedTasks, listTasks, taskEvents } from "@/lib/coderTasks";
import { createSchedule, deleteSchedule, getSchedule, listSchedules, publicSchedule, setPaused, updateSchedule, cronPrompt, EVENT_TYPES } from "@/lib/coderSchedules";
import { defaultTz, validTimeZone } from "@/lib/coderCron";
import { isAccuracy } from "@/lib/coderAgent";
import { modelSettings, modelReady, memorySettings, setMemorySettings } from "@/lib/coderModels";

export type AppUser = { chatId: number; tier: "owner" | "user" };
export type AppDeps = { db?: Db; bot: TelegramBot; botRow: BotRow; fetchImpl?: typeof fetch };
type Json = Record<string, any>;
export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- GitHub sign-in (OAuth App; zero cost) + pasted token fallback
export const oauthConfigured = () => Boolean(process.env.CODER_GITHUB_CLIENT_ID && process.env.CODER_GITHUB_CLIENT_SECRET);
export const OAUTH_SCOPES = "repo workflow admin:repo_hook read:user";
const stateKey = () => process.env.CODER_TOKEN_KEY || process.env.CRON_SECRET || "";
export function signState(chatId: number, now = Date.now()): string {
  const body = `${chatId}.${now + 15 * 60000}.${randomBytes(6).toString("hex")}`;
  return `${body}.${createHmac("sha256", stateKey()).update(body).digest("hex").slice(0, 32)}`;
}
export function verifyState(state: string, now = Date.now()): number | null {
  const parts = String(state || "").split(".");
  if (parts.length !== 4 || !stateKey()) return null;
  const body = parts.slice(0, 3).join(".");
  const want = Buffer.from(createHmac("sha256", stateKey()).update(body).digest("hex").slice(0, 32));
  const got = Buffer.from(parts[3]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Number(parts[1]) < now) return null;
  return /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
}
export function oauthStartUrl(chatId: number, redirect: string): string {
  const q = new URLSearchParams({ client_id: process.env.CODER_GITHUB_CLIENT_ID || "", redirect_uri: redirect, scope: OAUTH_SCOPES, state: signState(chatId), allow_signup: "true" });
  return `https://github.com/login/oauth/authorize?${q}`;
}
async function ghUser(token: string, f: typeof fetch): Promise<{ login: string; scopes: string } | null> {
  const r = await f("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "coder-bot" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!r || r.status !== 200) return null;
  const d = (await r.json().catch(() => null)) as { login?: string } | null;
  return d?.login ? { login: d.login, scopes: r.headers.get("x-oauth-scopes") || "" } : null;
}
export async function oauthFinish(code: string, state: string, redirect: string, db: Db = prismaDb, f: typeof fetch = globalThis.fetch): Promise<{ chatId: number; login: string }> {
  const chatId = verifyState(state);
  if (!chatId) throw new AppError(400, "expired or invalid sign-in link — start again from the app");
  const r = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.CODER_GITHUB_CLIENT_ID, client_secret: process.env.CODER_GITHUB_CLIENT_SECRET, code, redirect_uri: redirect }),
    signal: AbortSignal.timeout(15000),
  });
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!d.access_token) throw new AppError(400, d.error_description || "GitHub did not return a token");
  const u = await ghUser(d.access_token, f);
  if (!u) throw new AppError(400, "could not read the GitHub account");
  await saveConnection(chatId, "github", d.access_token, u.login, db);
  return { chatId, login: u.login };
}

// ---------------------------------------------------------------- the operations
async function sections() {
  return import("@/lib/coderSections");
}

/** Pending confirmations across the chat and its scheduled tasks. */
async function pendings(chatId: number, db: Db) {
  const { loadState } = await sections();
  const waiting = await listTasks(chatId, { active: true, limit: 30 }, db);
  const out: Json[] = [];
  const slots = new Set<string>(["", ...waiting.map((t) => t.slot)]);
  for (const slot of slots) {
    const st = await loadState(chatId, db, slot);
    const p = st.run?.pending;
    if (st.run && p) {
      const c = p.calls[0];
      out.push({ runId: st.run.id, nonce: p.nonce, reason: p.reason, summary: p.summary, tool: c?.function?.name || "", categories: p.categories || [], title: st.run.title || "", slot, at: p.at || null });
    }
  }
  return out;
}

/**
 * Keeps the lists honest before they are read: runs that cannot be alive any more are closed (they used to stay in "running now" for days), and the conversation the user is
 * talking in is never hidden (a delete of the open chat that raced a running task left new requests in a hidden thread: the Chats tab said "no chats" while Home showed them).
 */
async function tidyBeforeList(chatId: number, st: { threadId?: string | null }, db: Db): Promise<void> {
  const { reapStaleTasks } = await import("@/lib/coderTasks");
  await reapStaleTasks(chatId, db);
  if (st.threadId) {
    const T = await import("@/lib/coderThreads");
    const row = await T.getThread(chatId, st.threadId, db);
    if (row?.deleted_at) await T.unhideThread(chatId, st.threadId, db);
  }
}

export async function appOp(user: AppUser, op: string, body: Json, deps: AppDeps): Promise<Json> {
  const db = deps.db || prismaDb;
  const { chatId } = user;
  const { loadState, saveState, resolvePending, startScheduledRun } = await sections();
  // Status polling is read-only; stale-run recovery happens on incoming messages using the persisted worker heartbeat.
  switch (op) {
    case "me": {
      const st = await loadState(chatId, db);
      void sections().then((m: any) => m.prewarmChat?.(chatId, db)).catch(() => null);            // the app is open: read the conversation into the Studio while the user types
      const rules = (await loadPrefs(chatId, db)).map(({ chat_key: _k, ...r }: any) => r);
      const owner = user.tier === "owner";
      return {
        tier: user.tier,
        // think / accuracy / media are the SELECTED model's own; `models` lists every visible model's settings so the app can show each one
        settings: { model: st.model || "coder", ...modelSettings(st, st.model), memory: memorySettings(st, st.model), perModel: Object.fromEntries((await (await import("@/lib/coderModels")).listModels(db)).filter((m) => owner || (m.visible && modelReady(m))).map((m) => [m.id, { ...modelSettings(st, m.id), memory: memorySettings(st, m.id) }])), lang: st.lang || "ar", tz: st.tz || "", repo: st.repo || "" },
        // sections this user may see — decided here from the verified Telegram id, not by the client
        features: { sham: owner, ownerTools: owner, terminal: await terminalAllowed(chatId, db) },
        connections: await connectionInfo(chatId, db), oauth: oauthConfigured(),
        prefs: { rules, categories: CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], tierDefault: tierDefault(user.tier, c) })) },
        events: EVENT_TYPES,
      };
    }
    case "settings": {
      const st = await loadState(chatId, db);
      let carried = 0;
      if (typeof body.model === "string") {
        // the one place a model is chosen: a user may pick only what the owner made visible; Sham stays the owner's until the owner switches it on for everyone
        const { listModels, chooseModel, canonModelId } = await import("@/lib/coderModels");
        const C = await import("@/lib/coderChats");
        const from = canonModelId(st.model) || "coder";
        if (!chooseModel(st, await listModels(db), body.model, user.tier === "owner")) throw new AppError(400, "model not available");
        // switching in the middle of a conversation: the new model gets the conversation so far as its open chat (connectors are the user's and are already there)
        // `carry: false` switches without it (a clean start in the other model's own last chat)
        const to = canonModelId(st.model) || "coder";
        if (body.carry !== false && C.isChatModel(from) && C.isChatModel(to)) carried = await C.carryConversation(chatId, st, from, to, db).catch(() => 0);
      }
      // thinking / speed / media generation belong to ONE model: the one named in body.for, else the selected one (after a switch in this same call, the new one)
      if (typeof body.think === "boolean" || isAccuracy(body.accuracy) || typeof body.media === "boolean") {
        const { listModels, setModelSettings, canonModelId } = await import("@/lib/coderModels");
        const target = canonModelId(typeof body.for === "string" ? body.for : st.model) || "coder";
        const known = await listModels(db);
        const m = known.find((x) => x.id === target);
        if (!m || !(user.tier === "owner" || (m.visible && modelReady(m)))) throw new AppError(400, "model not available");
        const eff = setModelSettings(st, target, { think: typeof body.think === "boolean" ? body.think : undefined, accuracy: isAccuracy(body.accuracy) ? body.accuracy : undefined, media: typeof body.media === "boolean" ? body.media : undefined });
        if (target === "coder") { st.think = eff.think; st.accuracy = eff.accuracy; }           // Nova's own values also stay in the old fields (older readers, forks)
      }
      // memory / save switches also belong to ONE model (body.for, else the selected one): remember, recall, save
      if (body.memory && typeof body.memory === "object") {
        const { listModels, canonModelId } = await import("@/lib/coderModels");
        const target = canonModelId(typeof body.for === "string" ? body.for : st.model) || "coder";
        const m = (await listModels(db)).find((x) => x.id === target);
        if (!m || !(user.tier === "owner" || (m.visible && modelReady(m)))) throw new AppError(400, "model not available");
        const b = body.memory as Record<string, unknown>;
        setMemorySettings(st, target, { remember: typeof b.remember === "boolean" ? b.remember : undefined, recall: typeof b.recall === "boolean" ? b.recall : undefined, save: typeof b.save === "boolean" ? b.save : undefined });
      }
      if (body.lang === "ar" || body.lang === "en") st.lang = body.lang;
      if (typeof body.tz === "string" && (body.tz === "" || validTimeZone(body.tz))) st.tz = body.tz || undefined;
      if (typeof body.repo === "string" && (body.repo === "" || /^[\w.-]+\/[\w.-]+$/.test(body.repo))) st.repo = body.repo || undefined;
      await saveState(chatId, st, db);
      return { ok: true, carried };
    }
    // what Sham / Sham v2 have learned about this user: view, and forget only that (the conversations stay) — the owner's or an exposed Sham only
    case "sham_memory": {
      const { listModels, canonModelId } = await import("@/lib/coderModels");
      const st = await loadState(chatId, db);
      const model = canonModelId(typeof body.model === "string" ? body.model : st.model);
      const m = (await listModels(db)).find((x) => x.id === model);
      if ((model !== "sham" && model !== "sham_v2") || !m || !(user.tier === "owner" || (m.visible && modelReady(m)))) throw new AppError(400, "model not available");
      const M = await import("@/lib/shamMemory");
      if (body.forget === true) return { ok: await M.forgetFacts(chatId, db), facts: {} };
      return { facts: await M.shamFacts(chatId, db), enabled: M.shamMemoryEnabled() };
    }
    case "pref_preset": {
      // one tap for the whole confirmation policy: "careful" asks for every category, "default" goes back to the tier defaults,
      // "auto" lets routine categories run but keeps asking for deletes, force-pushes and writes to connected services
      const preset = String(body.preset || "");
      if (!["careful", "default", "auto"].includes(preset)) throw new AppError(400, "bad preset");
      for (const c of CATEGORIES) {
        if (preset === "default") await removePref(chatId, c, "*", "*", db);
        else await setPref(chatId, { category: c, repo: "*", context: "*", policy: preset === "careful" || ["delete", "force", "external"].includes(c) ? "ask" : "allow" }, db);
      }
      return { ok: true, rules: (await loadPrefs(chatId, db)).map(({ chat_key: _k, ...r }: any) => r) };
    }
    case "pref": {
      if (!isCategory(body.category)) throw new AppError(400, "bad category");
      if (body.policy === "default") await removePref(chatId, body.category, body.repo || "*", body.context || "*", db);
      else if (isPolicy(body.policy)) await setPref(chatId, { category: body.category, repo: body.repo || "*", context: body.context || "*", policy: body.policy }, db);
      else throw new AppError(400, "bad policy");
      return { ok: true, rules: (await loadPrefs(chatId, db)).map(({ chat_key: _k, ...r }: any) => r) };
    }
    case "tasks": {
      await (await import("@/lib/coderTasks")).reapStaleTasks(chatId, db);
      const tasks = await listTasks(chatId, { limit: Number(body.limit) || 30, before: body.before || undefined }, db);
      // step counts are an internal meter: the owner only
      return { tasks: user.tier === "owner" ? tasks : tasks.map(({ steps: _s, ...t }: any) => t), pending: await pendings(chatId, db) };
    }
    case "task_delete": {
      if (!/^[\w-]{4,40}$/.test(String(body.runId || ""))) throw new AppError(400, "bad run id");
      const { archiveTask } = await import("@/lib/coderTasks");
      if (!(await archiveTask(chatId, String(body.runId), db))) throw new AppError(409, "the task is still running or does not exist");
      return { ok: true };
    }
    case "tasks_clear": {
      const archived = await archiveFinishedTasks(chatId, db);
      return { ok: true, archived };
    }
    case "events": {
      if (!/^[\w-]{4,40}$/.test(String(body.runId || ""))) throw new AppError(400, "bad run id");
      const evs = await taskEvents(chatId, body.runId, Number(body.after) || 0, db);
      return { events: user.tier === "owner" ? evs : publicEvents(evs) };
    }
    case "resolve": {
      const answer = body.answer === "yes" || body.answer === "all" || body.answer === "no" ? body.answer : null;
      if (!answer) throw new AppError(400, "bad answer");
      const ok = await resolvePending(deps.bot, deps.botRow, chatId, String(body.runId || ""), String(body.nonce || ""), answer, db);
      return { ok };
    }
    case "stop": {
      // the same as /stop: the Studio job is cancelled too, so it does not hold the queue
      const slot = typeof body.slot === "string" && /^(|s:[a-f0-9]{12})$/.test(body.slot) ? body.slot : "";
      const { stopRun } = await sections();
      return { ok: await stopRun(chatId, slot, String(body.runId || ""), db) };
    }
    case "task_stop":
    case "stop_all": {
      // stops one running task (or every running one) from Home: a live Nova run is cancelled like /stop (its Studio job too), any other row is closed in the history
      const { stopRun } = await sections();
      const { stopTaskRow } = await import("@/lib/coderTasks");
      const targets = op === "stop_all" ? await listTasks(chatId, { active: true, limit: 50 }, db) : (await listTasks(chatId, { active: true, limit: 50 }, db)).filter((t) => t.run_id === String(body.runId || ""));
      let stopped = 0;
      for (const t of targets) {
        if (!/^[\w-]{4,60}$/.test(t.run_id)) continue;
        if (!t.run_id.startsWith("sham-")) await stopRun(chatId, t.slot || "", t.run_id, db).catch(() => false);
        if (await stopTaskRow(chatId, t.run_id, db)) stopped++;
      }
      return { ok: true, stopped };
    }
    // ---------------------------------------------------------------- conversation threads (src/lib/coderThreads.ts)
    case "threads": {
      const T = await import("@/lib/coderThreads");
      const st = await loadState(chatId, db);
      if (!st.threadId && (st.messages.length || (await listTasks(chatId, { limit: 1 }, db)).length)) await (await sections()).adoptThread(chatId, st, db);
      await tidyBeforeList(chatId, st, db);
      const threads = await T.listThreads(chatId, { limit: Number(body.limit) || 40, before: body.before || undefined }, db);
      const live = await listTasks(chatId, { active: true, limit: 20 }, db);
      // scheduled / event runs are not conversations: listed on their own
      const runs = (await listTasks(chatId, { limit: 20 }, db)).filter((t) => t.source !== "interactive");
      const strip = (x: any[]) => (user.tier === "owner" ? x : x.map(({ steps: _s, ...t }) => t));
      return { threads, current: st.threadId || null, currentEmpty: !st.messages.length, live: strip(live), runs: strip(runs), pending: await pendings(chatId, db) };
    }
    case "thread": {
      const T = await import("@/lib/coderThreads");
      const t = await T.getThread(chatId, String(body.id || ""), db);
      if (!t || t.deleted_at) throw new AppError(404, "not found");
      const tasks = await T.threadTasks(chatId, t, db);
      const out: Json[] = [];
      for (const k of tasks.slice(-60)) {
        const evs = await taskEvents(chatId, k.run_id, 0, db);
        const shown = user.tier === "owner" ? evs : publicEvents(evs);
        out.push({ ...k, events: shown.filter((e) => e.kind === "start" || e.kind === "text" || e.kind === "failed" || e.kind === "confirm" || e.kind === "segment") });
      }
      const st = await loadState(chatId, db);
      return { thread: { id: t.id, title: t.title, legacy: t.legacy, pinned: Boolean(t.pinned), archived: Boolean(t.archived), created_at: t.created_at, updated_at: t.updated_at }, current: st.threadId === t.id, tasks: out };
    }
    case "thread_new":
    case "thread_open": {
      const { switchThread } = await sections();
      try {
        const id = await switchThread(chatId, await loadState(chatId, db), op === "thread_new" ? null : String(body.id || ""), db);
        return { ok: true, id };
      } catch {
        throw new AppError(404, "not found");
      }
    }
    case "thread_rename": {
      const { renameThread } = await import("@/lib/coderThreads");
      if (!(await renameThread(chatId, String(body.id || ""), String(body.title || ""), db))) throw new AppError(400, "bad title");
      return { ok: true };
    }
    case "thread_delete": {
      // hidden from the list, kept in the database; deleting the active conversation opens a fresh one
      const { hideThread } = await import("@/lib/coderThreads");
      const id = String(body.id || "");
      const st = await loadState(chatId, db);
      // the open chat when nothing was said in it yet: it is already "a fresh chat" (never listed), hiding it would hide the conversation the next message goes to
      if (st.threadId === id && !st.messages.length && !st.run) return { ok: true };
      if (st.threadId === id) await (await sections()).switchThread(chatId, st, null, db);
      if (!(await hideThread(chatId, id, db))) throw new AppError(404, "not found");
      return { ok: true };
    }
    // ---------------------------------------------------------------- per-model chat lists (src/lib/coderChats.ts): Nova, Sham and Sham v2 each have their own
    case "chats":
    case "chat_new":
    case "chat_open":
    case "chat_rename":
    case "chat_pin":
    case "chat_archive":
    case "chat_delete":
    case "chat_messages": {
      const C = await import("@/lib/coderChats");
      const { listModels, canonModelId, chooseModel } = await import("@/lib/coderModels");
      const st = await loadState(chatId, db);
      const model = canonModelId(typeof body.model === "string" ? body.model : st.model) || "coder";
      const known = await listModels(db);
      const m = known.find((x) => x.id === model);
      // the same rule as the model picker: a user sees only the models the owner opened (Sham and Sham v2 are the owner's until their own switch is on)
      if (!C.isChatModel(model) || !m || !(user.tier === "owner" || (m.visible && modelReady(m)))) throw new AppError(400, "model not available");
      const id = String(body.id || "");
      if (op === "chats") {
        await tidyBeforeList(chatId, st, db);
        if (!st.threadId && model === "coder" && (st.messages.length || (await listTasks(chatId, { limit: 1 }, db)).length)) await (await sections()).adoptThread(chatId, st, db);
        const archived = body.archived === "only" || body.archived === "include" ? body.archived : "exclude";
        return { model, selected: st.model || "coder", ...(await C.chatList(chatId, st, model, { q: typeof body.q === "string" ? body.q : undefined, archived, limit: Number(body.limit) || 60 }, db)) };
      }
      if (op === "chat_new" || op === "chat_open") {
        // continuing a chat of another model also selects that model (its tools, settings and connectors are the same user's)
        if (model !== (canonModelId(st.model) || "coder") && !chooseModel(st, known, model, user.tier === "owner")) throw new AppError(400, "model not available");
        const ok = op === "chat_new" ? Boolean(await C.chatNew(chatId, st, model, db)) : await C.chatOpen(chatId, st, model, id, db);
        if (!ok) throw new AppError(404, "not found");
        await saveState(chatId, st, db);
        return { ok: true, model, ...(op === "chat_open" ? { messages: (await C.chatMessages(chatId, model, id, db)) || [] } : {}) };
      }
      if (op === "chat_rename") {
        if (!(await C.chatRename(chatId, model, id, String(body.title || ""), db))) throw new AppError(400, "bad title");
        return { ok: true };
      }
      if (op === "chat_pin") {
        if (!(await C.chatPin(chatId, model, id, body.pinned !== false, db))) throw new AppError(404, "not found");
        return { ok: true };
      }
      if (op === "chat_archive") {
        if (!(await C.chatArchive(chatId, st, model, id, body.archived !== false, db))) throw new AppError(404, "not found");
        return { ok: true };
      }
      if (op === "chat_delete") {
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : id ? [id] : undefined;
        const spec = ids ? { ids } : Number(body.olderThanDays) > 0 ? { olderThanDays: Number(body.olderThanDays) } : body.archived === true ? { archived: true } : body.all === true ? { all: true } : null;
        if (!spec) throw new AppError(400, "nothing to delete");
        const deleted = await C.chatDelete(chatId, st, model, spec, db);
        await saveState(chatId, st, db);
        return { ok: true, deleted };
      }
      const messages = await C.chatMessages(chatId, model, id, db);
      if (!messages) throw new AppError(404, "not found");
      return { model, id, messages };
    }
    case "send": {
      const text = String(body.text || "").trim();
      if (!text) throw new AppError(400, "empty");
      if (text.length > 12000) throw new AppError(400, "task too long (max 12000 characters)");
      // Do not create a fake task row: start the actual background agent so progress, output, stop and history all refer to one run.
      const { startAppTask } = await import("@/lib/coderSections");
      try {
        return { ok: true, ...(await startAppTask(deps.bot, deps.botRow, chatId, text, db)) };
      } catch (e) {
        throw new AppError(503, String((e as Error)?.message || "could not start task").slice(0, 300));
      }
    }
    case "schedules": {
      const lang = (await loadState(chatId, db)).lang || "ar";
      return { schedules: (await listSchedules(chatId, db)).map((s) => publicSchedule(s, lang)) };
    }
    case "schedule_create": {
      const tz = body.tz || (await loadState(chatId, db)).tz || defaultTz();
      const r = await createSchedule(chatId, deps.botRow.id, { title: body.title, prompt: body.prompt, kind: body.kind, recurrence: body.recurrence, tz, repo: body.repo, events: body.events }, db);
      if (!r.ok) throw new AppError(400, r.error);
      return { schedule: publicSchedule(r.schedule), hook: "hook" in r ? r.hook : undefined };
    }
    case "schedule_update": {
      const r = await updateSchedule(chatId, String(body.id || ""), { title: body.title, prompt: body.prompt, recurrence: body.recurrence, tz: body.tz, events: body.events }, db);
      if (!r.ok) throw new AppError(400, r.error);
      return { schedule: publicSchedule(r.schedule) };
    }
    case "schedule_pause": {
      const s = await setPaused(chatId, String(body.id || ""), Boolean(body.paused), db);
      if (!s) throw new AppError(404, "not found");
      return { schedule: publicSchedule(s) };
    }
    case "schedule_delete": {
      const r = await deleteSchedule(chatId, String(body.id || ""), body.confirm === true, db);
      if (r === "not_found") throw new AppError(404, "not found");
      return { result: r };
    }
    case "schedule_run": {
      const s = await getSchedule(String(body.id || ""), db);
      const { coderChatKey } = await import("@/lib/coderAuth");
      if (!s || s.chat_key !== coderChatKey(chatId)) throw new AppError(404, "not found");
      const r = await startScheduledRun(deps.bot, deps.botRow, chatId, { scheduleId: s.id, title: s.title, prompt: s.kind === "cron" ? cronPrompt(s) : s.prompt, source: "scheduled" }, db);
      return { result: r };
    }
    case "github_start": {
      if (!oauthConfigured()) throw new AppError(400, "GitHub sign-in is not configured on the server yet — paste a fine-grained token instead");
      // the registered callback, never the address the request came through (src/lib/coderConnectors.ts siteBase)
      const c = await import("@/lib/coderConnectors");
      try {
        return { url: c.connectorStartUrl(chatId, "github") };
      } catch {
        return { url: oauthStartUrl(chatId, `${c.siteBase()}/api/coder/app/github/callback`) };
      }
    }
    case "github_token": {
      const token = String(body.token || "").trim();
      if (!/^(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,})$/.test(token)) throw new AppError(400, "that does not look like a GitHub token");
      const u = await ghUser(token, deps.fetchImpl || globalThis.fetch);
      if (!u) throw new AppError(400, "GitHub rejected this token");
      await saveConnection(chatId, "github", token, u.login, db);
      return { ok: true, login: u.login };
    }
    case "github_unlink": {
      await deleteConnection(chatId, "github", db);
      return { ok: true };
    }
    case "plans":
    case "billing": {
      // regular users: plan name, one overall percentage and the plans on sale (no meters, no counts — owner's rule 2026-10-21).
      // The owner also gets the full meters and every plan for pricing.
      const { listPlans, usageSummary, METRIC_LABEL, publicUsage, publicPlans } = await import("@/lib/coderPlans");
      const count = (await listSchedules(chatId, db)).length;
      const usage = await usageSummary(chatId, db, Date.now(), { schedules: count });
      const plans = await listPlans(db);
      const out: Json = { usage: publicUsage(usage), plans: publicPlans(plans, usage.plan.id), payments: "stars" };
      if (user.tier === "owner") out.owner = { usage, plans, labels: METRIC_LABEL };
      return out;
    }
    case "buy": {
      const { createPlanInvoice } = await import("@/lib/coderStars");
      try {
        return { url: await createPlanInvoice(deps.bot, chatId, String(body.planId || ""), db) };
      } catch (e) {
        throw new AppError(400, String((e as Error).message || "تعذّر إنشاء الفاتورة"));
      }
    }
    // ---------------------------------------------------------------- models (src/lib/coderModels.ts)
    case "models": {
      const { listModels, publicModels, ownerModels } = await import("@/lib/coderModels");
      const st = await loadState(chatId, db);
      const all = await listModels(db);
      return { models: publicModels(all, st.model), ...(user.tier === "owner" ? { owner: ownerModels(all, st.model) } : {}) };
    }
    case "lessons": {
      // the owner's finished runs kept as training examples (coderLessons.ts): how many, and the JSON Lines to take
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const L = await import("@/lib/coderLessons");
      if (body.clear === true) await L.clearLessons(db);
      const stats = await L.lessonStats(db);
      return body.export === true ? { ...stats, ...(await L.exportLessons(db, Number(body.limit) || 200)) } : stats;
    }
    case "model_update": {
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const { updateModel } = await import("@/lib/coderModels");
      try {
        return { model: await updateModel(String(body.id || ""), { visible: body.visible, price_stars: body.price_stars, name: body.name }, db) };
      } catch (e) {
        throw new AppError(400, String((e as Error).message));
      }
    }
    case "plan_update": {
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const { upsertPlan } = await import("@/lib/coderPlans");
      try {
        return { plan: await upsertPlan({ id: String(body.id || ""), name: body.name, price_label: body.price_label, price_cents: body.price_cents, currency: body.currency, limits: body.limits, sort: body.sort, active: body.active, price_stars: body.price_stars, days: body.days }, db) };
      } catch (e) {
        throw new AppError(400, String((e as Error).message));
      }
    }
    case "plan_assign": {
      // manual assignment by the owner (until a payment provider exists): Telegram user id, plan, days (0 = no end)
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const { listPlans, setSubscription } = await import("@/lib/coderPlans");
      const target = Number(body.userId);
      if (!Number.isSafeInteger(target) || target <= 0) throw new AppError(400, "bad user id");
      if (!(await listPlans(db)).some((p) => p.id === body.planId)) throw new AppError(400, "no such plan");
      await setSubscription(target, String(body.planId), Number(body.days) || null, "manual", db);
      return { ok: true };
    }
    case "memories": {
      const { listMemories } = await import("@/lib/coderMemory");
      return { memories: (await listMemories(chatId, db)).map(({ id, scope, kind, text, source_run, created_at, updated_at }) => ({ id, scope, kind, text, source_run, created_at, updated_at })) };
    }
    case "memory_add": {
      const { saveMemory } = await import("@/lib/coderMemory");
      const r = await saveMemory(chatId, { text: String(body.text || ""), kind: body.kind, repo: body.repo, source: "app" }, db);
      if (r.action === "invalid") throw new AppError(400, "text too short");
      return { ok: true, ...r };
    }
    case "memory_update": {
      const { updateMemory } = await import("@/lib/coderMemory");
      if (!(await updateMemory(chatId, Number(body.id), { text: body.text, kind: body.kind, scope: body.repo !== undefined ? (body.repo ? `repo:${body.repo}` : "global") : undefined }, db))) throw new AppError(404, "no such memory");
      return { ok: true };
    }
    case "memory_delete": {
      const { deleteMemory } = await import("@/lib/coderMemory");
      if (!(await deleteMemory(chatId, Number(body.id), db))) throw new AppError(404, "no such memory");
      return { ok: true };
    }
    case "new_conversation": {
      const { newConversation } = await import("@/lib/coderSections");
      return { ok: true, id: await newConversation(chatId, await loadState(chatId, db), db) };
    }
    // ---------------------------------------------------------------- owner control panel (src/lib/coderPanel.ts)
    case "panel": {
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const { panel } = await import("@/lib/coderPanel");
      return await panel(db, deps.fetchImpl || globalThis.fetch);
    }
    case "sham_media": {                       // owner's isolated Sham route selector + per-route enable switches
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const S = await import("@/lib/shamExec");
      const validRoute = (v: unknown) => v === "sham_v1" || v === "sham_v2_internal" || v === "sham_v2_ready";
      if (validRoute(body.route)) {
        await S.setShamMediaRoute(body.route, db);
      } else if (body.enabledRoute && validRoute(body.enabledRoute) && typeof body.enabled === "boolean") {
        await S.setShamMediaRouteEnabled(body.enabledRoute, body.enabled, db);
      } else if (body.order === "own_first" || body.order === "reserve_first") {
        // Compatibility with clients that still send the old binary switch.
        await S.setShamMediaOrder(body.order, db);
      }
      return { route: await S.shamMediaRoute(db), enabled: await S.shamMediaRouteEnabledMap(db), order: await S.shamMediaOrder(db) };
    }
    case "hf_media_route": {
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      // Quarantined by owner request: external media routes are disabled.
      // Keep this response only for older Mini App clients; never persist or enable HF.
      return { order: "fallback_first" as const };
    }
    case "panel_action": {
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const { panelAction } = await import("@/lib/coderPanel");
      return await panelAction(String(body.action || ""), deps.fetchImpl || globalThis.fetch);
    }
    case "status": {
      // the model Studio(s) + the health of every failover chain (sandbox backends, search engines)
      const { coderStatus, coderStudioUrls } = await import("@/lib/openCoderStudio");
      const status = await coderStatus().catch(() => null);
      // users: is the service up — nothing about servers, models or backends
      if (user.tier !== "owner") return { available: Boolean(status) };
      const { sandboxHealth } = await import("@/lib/coderSandbox");
      const { searchHealth } = await import("@/lib/coderWeb");
      return { available: Boolean(status), status, studios: coderStudioUrls().length, sandbox: sandboxHealth(), search: searchHealth() };
    }
    case "stalls": {
      if (user.tier !== "owner") throw new AppError(403, "owner only");
      const { recentStalls } = await import("@/lib/coderStall");
      return { stalls: await recentStalls(30, db) };
    }
    // ---------------------------------------------------------------- connectors (src/lib/coderConnectors.ts)
    case "connectors": {
      const c = await import("@/lib/coderConnectors");
      const ownerEnv = user.tier === "owner" && Boolean((process.env.CODER_GITHUB_TOKEN || "").trim());
      const mcp = await c.listMcpServers(chatId, db);
      const have = new Set(mcp.map((m) => m.url));
      const presets = c.MCP_PRESETS.map((p) => ({ id: p.id, name: p.name, desc: p.desc, token: p.token, tokenHelp: p.tokenHelp || null, added: have.has(new URL(p.url).origin) }));
      const list = await c.listConnectors(chatId, { githubOwnerEnv: ownerEnv }, db);
      // only the owner sees how to switch the sign-in flow on (creating the OAuth app is the owner's, one time per service)
      const connectors = list.map((v) => {
        const d = c.connectorById(v.id)!;
        return user.tier === "owner" && !v.oauth ? { ...v, setup: { create: d.createUrl, callback: c.callbackUrl(d.id), env: [d.env.id, d.env.secret], scope: d.scope } } : v;
      });
      return { connectors, mcp, presets };
    }
    case "connector_start": {
      const c = await import("@/lib/coderConnectors");
      const d = c.connectorById(String(body.id || ""));
      if (!d) throw new AppError(404, "unknown connector");
      if (!c.connectorReady(d)) throw new AppError(400, "sign-in is not set up for this service yet; link it with a token instead");
      return { url: c.connectorStartUrl(chatId, d.id) };
    }
    case "connector_link": {
      // linking with a personal token the user created in their own account (checked with the service before it is stored)
      const c = await import("@/lib/coderConnectors");
      const id = String(body.id || "");
      if (!c.connectorById(id)) throw new AppError(404, "unknown connector");
      try {
        return { ok: true, ...(await c.linkWithToken(chatId, id, String(body.token || ""), db, deps.fetchImpl || globalThis.fetch)) };
      } catch (e) {
        if (e instanceof c.ConnectorError) throw new AppError(400, e.message);
        throw e;
      }
    }
    case "connector_test": {
      const c = await import("@/lib/coderConnectors");
      const id = String(body.id || "");
      if (!c.connectorById(id)) throw new AppError(404, "unknown connector");
      const ownerToken = user.tier === "owner" ? (process.env.CODER_GITHUB_TOKEN || "").trim() : "";
      return await c.testConnector(chatId, id, { ownerToken }, db, deps.fetchImpl || globalThis.fetch);
    }
    case "connector_disconnect": {
      const c = await import("@/lib/coderConnectors");
      if (!c.connectorById(String(body.id || ""))) throw new AppError(404, "unknown connector");
      await c.disconnectConnector(chatId, String(body.id), db, deps.fetchImpl || globalThis.fetch);
      return { ok: true };
    }
    case "mcp_add": {
      const c = await import("@/lib/coderConnectors");
      const { checkUrl } = await import("@/lib/coderWeb");
      const preset = body.preset ? c.mcpPresetById(String(body.preset)) : null;
      if (body.preset && !preset) throw new AppError(400, "unknown preset");
      if (preset?.token === "required" && !String(body.token || "").trim()) throw new AppError(400, "token required");
      try {
        return { server: await c.addMcpServer(chatId, preset ? preset.url : String(body.url || ""), String(body.token || ""), preset ? preset.name : String(body.label || ""), db, deps.fetchImpl ? undefined : async (u) => { const r = await checkUrl(u); return r.ok ? { ok: true } : { ok: false, why: r.why }; }) };
      } catch (e) {
        throw new AppError(400, String((e as Error).message));
      }
    }
    case "mcp_remove": {
      const c = await import("@/lib/coderConnectors");
      try {
        await c.removeMcpServer(chatId, String(body.id || ""), db);
      } catch (e) {
        throw new AppError(400, String((e as Error).message));
      }
      return { ok: true };
    }
    case "repos": {
      const { resolveConnections } = await import("@/lib/coderAuth");
      const c = await resolveConnections(chatId, db);
      if (!c.github) return { repos: [] };
      const q = String(body.q || "").toLowerCase();
      const r = await (deps.fetchImpl || globalThis.fetch)(`https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`, { headers: { Authorization: `Bearer ${c.github.token}`, Accept: "application/vnd.github+json", "User-Agent": "coder-bot" }, signal: AbortSignal.timeout(12000) }).catch(() => null);
      const list = r && r.status === 200 ? ((await r.json().catch(() => [])) as any[]) : [];
      return {
        repos: list
          .map((x) => ({ full_name: String(x.full_name), private: Boolean(x.private), default_branch: String(x.default_branch || ""), pushed_at: x.pushed_at || null, description: String(x.description || "").slice(0, 140) }))
          .filter((x) => !q || x.full_name.toLowerCase().includes(q))
          .slice(0, 100),
      };
    }
  }
  throw new AppError(404, `unknown op ${op}`);
}

export const tierOf = (chatId: number) => tierFor(chatId);

/** Task history as a regular user sees it: no loop-detector entries, no internal error texts. */
export function publicEvents<T extends { kind: string; text: string }>(evs: T[]): T[] {
  return evs
    .filter((e) => e.kind !== "stall")
    .map((e) => (e.kind === "failed" ? { ...e, text: "تعذّر إكمال هذه الخطوة." } : e.kind === "segment" ? { ...e, text: e.text.split("\n").slice(1).join("\n") || e.text } : e));
}
