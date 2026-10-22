// Server side of the coder's Telegram Mini App (/coder-app). Every call carries Telegram's signed initData (header
// x-telegram-init-data), verified with the coder bot's own token (verifyTelegramInitData) — the user id from it is the private chat id.
// One dispatcher (appOp) so the route stays thin and everything here is unit-testable with a fake db and bot.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { connectionInfo, deleteConnection, prismaDb, saveConnection, tierFor, type Db } from "@/lib/coderAuth";
import { CATEGORIES, CATEGORY_LABEL, isCategory, isPolicy, loadPrefs, removePref, setPref, tierDefault } from "@/lib/coderPrefs";
import { listTasks, taskEvents } from "@/lib/coderTasks";
import { createSchedule, deleteSchedule, getSchedule, listSchedules, publicSchedule, setPaused, updateSchedule, cronPrompt, EVENT_TYPES } from "@/lib/coderSchedules";
import { defaultTz, validTimeZone } from "@/lib/coderCron";
import { isAccuracy } from "@/lib/coderAgent";

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

export async function appOp(user: AppUser, op: string, body: Json, deps: AppDeps): Promise<Json> {
  const db = deps.db || prismaDb;
  const { chatId } = user;
  const { loadState, saveState, resolvePending, startScheduledRun } = await sections();
  // a chat task whose loop died (server restart mid-task) is closed before the app shows it as "running"
  if (op === "me" || op === "tasks") await (await sections()).recoverDeadRun(chatId, db).catch(() => false);
  switch (op) {
    case "me": {
      const st = await loadState(chatId, db);
      const rules = (await loadPrefs(chatId, db)).map(({ chat_key: _k, ...r }: any) => r);
      const owner = user.tier === "owner";
      return {
        tier: user.tier,
        settings: { mode: owner ? st.mode : "coder", think: st.think, accuracy: isAccuracy(st.accuracy) ? st.accuracy : "balanced", lang: st.lang || "ar", tz: st.tz || "", repo: st.repo || "" },
        // sections this user may see — decided here from the verified Telegram id, not by the client
        features: { sham: owner, ownerTools: owner },
        connections: await connectionInfo(chatId, db), oauth: oauthConfigured(),
        prefs: { rules, categories: CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], tierDefault: tierDefault(user.tier, c) })) },
        events: EVENT_TYPES,
      };
    }
    case "settings": {
      const st = await loadState(chatId, db);
      if (body.mode === "coder" || (body.mode === "sham" && user.tier === "owner")) st.mode = body.mode;
      if (typeof body.think === "boolean") st.think = body.think;
      if (isAccuracy(body.accuracy)) st.accuracy = body.accuracy;
      if (typeof body.model === "string") {
        // a user may pick only a model the owner made visible; the owner may also pick hidden ones to try them
        const { listModels } = await import("@/lib/coderModels");
        const m = (await listModels(db)).find((x) => x.id === body.model);
        if (m && (m.visible || user.tier === "owner")) st.model = m.id;
      }
      if (body.lang === "ar" || body.lang === "en") st.lang = body.lang;
      if (typeof body.tz === "string" && (body.tz === "" || validTimeZone(body.tz))) st.tz = body.tz || undefined;
      if (typeof body.repo === "string" && (body.repo === "" || /^[\w.-]+\/[\w.-]+$/.test(body.repo))) st.repo = body.repo || undefined;
      await saveState(chatId, st, db);
      return { ok: true };
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
      const tasks = await listTasks(chatId, { limit: Number(body.limit) || 30, before: body.before || undefined }, db);
      // step counts are an internal meter: the owner only
      return { tasks: user.tier === "owner" ? tasks : tasks.map(({ steps: _s, ...t }: any) => t), pending: await pendings(chatId, db) };
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
    // ---------------------------------------------------------------- conversation threads (src/lib/coderThreads.ts)
    case "threads": {
      const T = await import("@/lib/coderThreads");
      const st = await loadState(chatId, db);
      if (!st.threadId && (st.messages.length || (await listTasks(chatId, { limit: 1 }, db)).length)) await (await sections()).adoptThread(chatId, st, db);
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
      return { thread: { id: t.id, title: t.title, legacy: t.legacy, created_at: t.created_at, updated_at: t.updated_at }, current: st.threadId === t.id, tasks: out };
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
      if (st.threadId === id) await (await sections()).switchThread(chatId, st, null, db);
      if (!(await hideThread(chatId, id, db))) throw new AppError(404, "not found");
      return { ok: true };
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
      return { connectors: await c.listConnectors(chatId, { githubOwnerEnv: ownerEnv }, db), mcp: await c.listMcpServers(chatId, db) };
    }
    case "connector_start": {
      const c = await import("@/lib/coderConnectors");
      const d = c.connectorById(String(body.id || ""));
      if (!d) throw new AppError(404, "unknown connector");
      if (!c.connectorReady(d)) throw new AppError(400, "soon");
      return { url: c.connectorStartUrl(chatId, d.id) };
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
      try {
        return { server: await c.addMcpServer(chatId, String(body.url || ""), String(body.token || ""), String(body.label || ""), db, deps.fetchImpl ? undefined : async (u) => { const r = await checkUrl(u); return r.ok ? { ok: true } : { ok: false, why: r.why }; }) };
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
