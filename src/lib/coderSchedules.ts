// Scheduled and event-triggered coder tasks (owner's plan, 2026-10-21).
//   cron   : recurrence in the user's own time zone (src/lib/coderCron.ts). Dispatcher: ONE frequent tick (/api/coder/schedules/tick,
//            called every 5 min by the free GitHub Actions scheduler in .github/workflows/coder-schedules.yml — Vercel Hobby cron
//            only allows once a day), which claims due rows atomically and fans out one signed request per run (/api/coder/schedules/run).
//   event  : a GitHub webhook on the user's repo (pull_request / push / issues / issue_comment / release / workflow_run) →
//            /api/coder/hooks/github?s=<id>, verified with that schedule's own secret.
// Each run is a full agent task in its own slot with a fresh step counter (the hard ceiling is per run), the same permission tiers and
// the user's policy for context "scheduled"; confirmations come to the chat as ✅/❌ and the run waits. Results go to the user's chat.
// The chat id and hook secret are stored encrypted (CODER_TOKEN_KEY); rows are keyed by the salted chat hash.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { coderChatKey, decryptToken, encryptToken, prismaDb, resolveConnections, type Db } from "@/lib/coderAuth";
import { defaultTz, describeCron, nextRun, toCron, validTimeZone } from "@/lib/coderCron";
import { CATEGORIES, isCategory, isPolicy, removePref, setPref, type Context } from "@/lib/coderPrefs";
import type { TaskStatus } from "@/lib/coderTasks";

export const EVENT_TYPES = ["pull_request", "push", "issues", "issue_comment", "release", "workflow_run"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type Schedule = {
  id: string; chat_key: string; chat_enc: string; bot_id: string; title: string; prompt: string; kind: "cron" | "event";
  cron: string | null; tz: string; repo: string | null; events: string[]; paused: boolean; next_run_at: string | null;
  last_run_at: string | null; last_status: string | null; hook_id: number | null; hook_secret_enc: string | null; created_at?: string;
};
export type PublicSchedule = Omit<Schedule, "chat_key" | "chat_enc" | "hook_secret_enc" | "bot_id"> & { describe: string };

const REPO_RX = /^[\w.-]+\/[\w.-]+$/;
export const MAX_PROMPT = 4000;

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_schedules (id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, chat_enc TEXT NOT NULL, bot_id TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, kind TEXT NOT NULL, cron TEXT, tz TEXT NOT NULL DEFAULT 'UTC', repo TEXT, events JSONB NOT NULL DEFAULT '[]'::jsonb, paused BOOLEAN NOT NULL DEFAULT false, next_run_at TIMESTAMPTZ, last_run_at TIMESTAMPTZ, last_status TEXT, hook_id BIGINT, hook_secret_enc TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_schedules_due_idx ON coder_schedules (next_run_at) WHERE NOT paused AND kind = 'cron'`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_schedules_chat_idx ON coder_schedules (chat_key)`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export function publicSchedule(s: Schedule, lang: "ar" | "en" = "ar"): PublicSchedule {
  const { chat_key: _a, chat_enc: _b, hook_secret_enc: _c, bot_id: _d, ...rest } = s;
  const describe = s.kind === "cron" ? describeCron(s.cron || "", lang) : `${lang === "ar" ? "عند" : "On"} ${s.events.join(", ")} · ${s.repo}`;
  return { ...rest, describe };
}

// ---------------------------------------------------------------- CRUD
export type NewSchedule = { title?: string; prompt: string; kind: "cron" | "event"; recurrence?: string; tz?: string; repo?: string; events?: string[] };

export function validate(n: NewSchedule): { ok: true; cron: string | null; events: EventType[]; tz: string; repo: string | null } | { ok: false; error: string } {
  const prompt = String(n.prompt || "").trim();
  if (!prompt) return { ok: false, error: "prompt is required" };
  if (prompt.length > MAX_PROMPT) return { ok: false, error: `prompt is too long (max ${MAX_PROMPT})` };
  const tz = n.tz && validTimeZone(n.tz) ? n.tz : "UTC";
  if (n.kind === "cron") {
    try {
      const cron = toCron(String(n.recurrence || ""));
      if (!nextRun(cron, tz)) return { ok: false, error: "this recurrence never happens" };
      return { ok: true, cron, events: [], tz, repo: n.repo && REPO_RX.test(n.repo) ? n.repo : null };
    } catch (e) {
      return { ok: false, error: `recurrence: ${(e as Error).message}` };
    }
  }
  if (n.kind === "event") {
    if (!n.repo || !REPO_RX.test(n.repo)) return { ok: false, error: "repo must be owner/name" };
    const events = [...new Set((n.events || []).map(String))].filter((e): e is EventType => (EVENT_TYPES as readonly string[]).includes(e));
    if (!events.length) return { ok: false, error: `events: pick from ${EVENT_TYPES.join(", ")}` };
    return { ok: true, cron: null, events, tz, repo: n.repo };
  }
  return { ok: false, error: "kind must be cron or event" };
}

export async function createSchedule(chatId: number | string, botId: string, n: NewSchedule, db: Db = prismaDb, now = new Date()): Promise<{ ok: true; schedule: Schedule; hook?: { ok: boolean; note: string } } | { ok: false; error: string }> {
  const v = validate(n);
  if (!v.ok) return v;
  await ensureTable(db);
  {
    // plan limit: number of scheduled tasks (the owner has none)
    const { checkLimit, limitMessage } = await import("@/lib/coderPlans");
    const count = (await listSchedules(chatId, db)).length;
    const c = await checkLimit(chatId, "schedules", 1, db, count);
    if (!c.ok) return { ok: false, error: limitMessage(c) };
  }
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  const title = (String(n.title || "").trim() || String(n.prompt).trim().split("\n")[0]).slice(0, 120);
  const next = v.cron ? nextRun(v.cron, v.tz, now) : null;
  const secret = n.kind === "event" ? randomBytes(24).toString("hex") : null;
  const row: Schedule = {
    id, chat_key: coderChatKey(chatId), chat_enc: encryptToken(String(chatId)), bot_id: botId, title, prompt: String(n.prompt).trim(), kind: n.kind,
    cron: v.cron, tz: v.tz, repo: v.repo, events: v.events, paused: false, next_run_at: next ? next.toISOString() : null, last_run_at: null, last_status: null,
    hook_id: null, hook_secret_enc: secret ? encryptToken(secret) : null,
  };
  await db.exec(
    `INSERT INTO coder_schedules (id, chat_key, chat_enc, bot_id, title, prompt, kind, cron, tz, repo, events, paused, next_run_at, hook_secret_enc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,false,$12::timestamptz,$13)`,
    row.id, row.chat_key, row.chat_enc, row.bot_id, row.title, row.prompt, row.kind, row.cron, row.tz, row.repo, JSON.stringify(row.events), row.next_run_at, row.hook_secret_enc,
  );
  if (n.kind === "event" && secret) {
    const hook = await installHook(chatId, row, secret, db);
    return { ok: true, schedule: row, hook };
  }
  return { ok: true, schedule: row };
}

export async function listSchedules(chatId: number | string, db: Db = prismaDb): Promise<Schedule[]> {
  try {
    await ensureTable(db);
    return await db.query<Schedule>(
      `SELECT id, chat_key, chat_enc, bot_id, title, prompt, kind, cron, tz, repo, events, paused, next_run_at::text AS next_run_at, last_run_at::text AS last_run_at, last_status, hook_id::int AS hook_id, hook_secret_enc, created_at::text AS created_at FROM coder_schedules WHERE chat_key = $1 ORDER BY created_at DESC`,
      coderChatKey(chatId),
    );
  } catch {
    return [];
  }
}

export async function getSchedule(id: string, db: Db = prismaDb): Promise<Schedule | null> {
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  try {
    await ensureTable(db);
    const rows = await db.query<Schedule>(
      `SELECT id, chat_key, chat_enc, bot_id, title, prompt, kind, cron, tz, repo, events, paused, next_run_at::text AS next_run_at, last_run_at::text AS last_run_at, last_status, hook_id::int AS hook_id, hook_secret_enc FROM coder_schedules WHERE id = $1`,
      id,
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function own(chatId: number | string, id: string, db: Db): Promise<Schedule | null> {
  const s = await getSchedule(id, db);
  return s && s.chat_key === coderChatKey(chatId) ? s : null;
}

export async function setPaused(chatId: number | string, id: string, paused: boolean, db: Db = prismaDb, now = new Date()): Promise<Schedule | null> {
  const s = await own(chatId, id, db);
  if (!s) return null;
  const next = !paused && s.kind === "cron" && s.cron ? nextRun(s.cron, s.tz, now)?.toISOString() || null : s.next_run_at;
  await db.exec(`UPDATE coder_schedules SET paused = $2, next_run_at = $3::timestamptz, updated_at = now() WHERE id = $1`, id, paused, next);
  return { ...s, paused, next_run_at: next };
}

export async function updateSchedule(chatId: number | string, id: string, patch: Partial<NewSchedule>, db: Db = prismaDb, now = new Date()): Promise<{ ok: true; schedule: Schedule } | { ok: false; error: string }> {
  const s = await own(chatId, id, db);
  if (!s) return { ok: false, error: "not found" };
  const merged: NewSchedule = {
    title: patch.title ?? s.title, prompt: patch.prompt ?? s.prompt, kind: s.kind, recurrence: patch.recurrence ?? s.cron ?? "", tz: patch.tz ?? s.tz,
    repo: patch.repo ?? s.repo ?? undefined, events: patch.events ?? s.events,
  };
  if (s.kind === "event" && merged.repo !== s.repo) return { ok: false, error: "the repo of an event task cannot change (delete it and create a new one)" };
  const v = validate(merged);
  if (!v.ok) return v;
  const next = v.cron ? nextRun(v.cron, v.tz, now)?.toISOString() || null : null;
  await db.exec(
    `UPDATE coder_schedules SET title = $2, prompt = $3, cron = $4, tz = $5, events = $6::jsonb, next_run_at = CASE WHEN paused THEN next_run_at ELSE $7::timestamptz END, updated_at = now() WHERE id = $1`,
    id, String(merged.title || s.title).slice(0, 120), String(merged.prompt).trim(), v.cron, v.tz, JSON.stringify(v.events), next,
  );
  if (s.kind === "event" && s.hook_id && JSON.stringify(v.events) !== JSON.stringify(s.events)) {
    const conn = await resolveConnections(chatId, db);
    if (conn.github) await ghFetch(conn.github.token, "PATCH", `/repos/${s.repo}/hooks/${s.hook_id}`, { events: v.events }).catch(() => null);
  }
  return { ok: true, schedule: { ...s, ...merged, cron: v.cron, tz: v.tz, events: v.events, next_run_at: next ?? s.next_run_at } as Schedule };
}

/** Deleting needs `confirmed` (the bot asks with a button, the app with a dialog). Also removes the repo webhook it installed. */
export async function deleteSchedule(chatId: number | string, id: string, confirmed: boolean, db: Db = prismaDb): Promise<"deleted" | "confirm" | "not_found"> {
  const s = await own(chatId, id, db);
  if (!s) return "not_found";
  if (!confirmed) return "confirm";
  if (s.kind === "event" && s.hook_id && s.repo) {
    const conn = await resolveConnections(chatId, db);
    if (conn.github) await ghFetch(conn.github.token, "DELETE", `/repos/${s.repo}/hooks/${s.hook_id}`).catch(() => null);
  }
  await db.exec(`DELETE FROM coder_schedules WHERE id = $1 AND chat_key = $2`, id, coderChatKey(chatId));
  return "deleted";
}

export async function scheduleRunFinished(id: string, status: TaskStatus | "skipped_busy" | "off", db: Db = prismaDb): Promise<void> {
  try {
    await ensureTable(db);
    await db.exec(`UPDATE coder_schedules SET last_status = $2, updated_at = now() WHERE id = $1`, id, status);
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------- GitHub webhooks (event triggers)
async function ghFetch(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const r = await globalThis.fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "coder-bot", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: r.status, data };
}

export function hookUrl(id: string): string {
  const base = (process.env.CODER_SELF_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/+$/, "");
  return `${base}/api/coder/hooks/github?s=${id}`;
}

/** Installs the repo webhook with the user's own linked token (needs admin:repo_hook / "Webhooks: write"). */
async function installHook(chatId: number | string, s: Schedule, secret: string, db: Db): Promise<{ ok: boolean; note: string }> {
  const conn = await resolveConnections(chatId, db);
  if (!conn.github) return { ok: false, note: `GitHub is not linked: add a webhook manually on ${s.repo} → ${hookUrl(s.id)} (content type JSON, events: ${s.events.join(", ")}). The secret is shown once in the app.` };
  const r = await ghFetch(conn.github.token, "POST", `/repos/${s.repo}/hooks`, { name: "web", active: true, events: s.events, config: { url: hookUrl(s.id), content_type: "json", secret, insecure_ssl: "0" } }).catch(() => ({ status: 0, data: null }));
  if (r.status === 201 && r.data?.id) {
    await db.exec(`UPDATE coder_schedules SET hook_id = $2 WHERE id = $1`, s.id, Number(r.data.id));
    s.hook_id = Number(r.data.id);
    return { ok: true, note: "webhook installed" };
  }
  return { ok: false, note: `could not install the webhook (HTTP ${r.status}${r.data?.message ? `: ${r.data.message}` : ""}). The token needs webhook admin rights on ${s.repo}.` };
}

export function verifyHubSignature(secret: string, body: string, header: string | null): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Should this delivery start a run, and with what summary (null = ignore: an action we don't trigger on, or a bot's own push). */
export function eventSummary(event: string, p: any): string | null {
  const repo = p?.repository?.full_name || "";
  const who = p?.sender?.login || "";
  if (p?.sender?.type === "Bot") return null;
  switch (event) {
    case "pull_request":
      if (!["opened", "reopened", "ready_for_review", "synchronize"].includes(p?.action)) return null;
      return `Pull request #${p.pull_request?.number} ${p.action} by ${who} on ${repo}: "${p.pull_request?.title}"\n${p.pull_request?.html_url}\nhead ${p.pull_request?.head?.ref} → base ${p.pull_request?.base?.ref}\n${String(p.pull_request?.body || "").slice(0, 1500)}`;
    case "push": {
      if (p?.deleted) return null;
      const commits = (p?.commits || []).slice(0, 10).map((c: any) => `- ${String(c.id).slice(0, 7)} ${String(c.message).split("\n")[0]} (${c.author?.username || c.author?.name || ""})`).join("\n");
      return `Push to ${String(p?.ref || "").replace("refs/heads/", "")} on ${repo} by ${who}, ${p?.commits?.length || 0} commit(s):\n${commits}\n${p?.compare || ""}`;
    }
    case "issues":
      if (!["opened", "reopened"].includes(p?.action)) return null;
      return `Issue #${p.issue?.number} ${p.action} by ${who} on ${repo}: "${p.issue?.title}"\n${p.issue?.html_url}\n${String(p.issue?.body || "").slice(0, 1500)}`;
    case "issue_comment":
      if (p?.action !== "created") return null;
      return `New comment by ${who} on #${p.issue?.number} (${repo}): ${String(p.comment?.body || "").slice(0, 1500)}\n${p.comment?.html_url}`;
    case "release":
      if (p?.action !== "published") return null;
      return `Release ${p.release?.tag_name} published on ${repo}: ${p.release?.name || ""}\n${p.release?.html_url}`;
    case "workflow_run":
      if (p?.action !== "completed" || p?.workflow_run?.conclusion !== "failure") return null;
      return `Workflow "${p.workflow_run?.name}" FAILED on ${repo} (${p.workflow_run?.head_branch} @ ${String(p.workflow_run?.head_sha).slice(0, 7)})\n${p.workflow_run?.html_url}`;
  }
  return null;
}

export function eventPrompt(s: Schedule, summary: string): string {
  return `${s.prompt}\n\n[Trigger: GitHub event on ${s.repo}]\n${summary}`;
}
export function cronPrompt(s: Schedule, now = new Date()): string {
  return `${s.prompt}\n\n[Scheduled task "${s.title}" — ${describeCron(s.cron || "", "en")} (${s.tz}); this run: ${now.toISOString().slice(0, 16)} UTC${s.repo ? `; repo ${s.repo}` : ""}]\n[Automated run: nobody is chatting with you now and there is no earlier conversation. Carry out the instruction above now with your tools, in the language of the instruction. Never summarise this conversation. If the instruction names no concrete subject to work on, say that in one sentence instead of guessing.]`;
}
export const scheduleChatId = (s: Schedule): number | null => {
  const t = decryptToken(s.chat_enc);
  return t && /^-?\d+$/.test(t) ? Number(t) : null;
};

// ---------------------------------------------------------------- dispatcher (one tick fans out one request per due run)
export function signRun(id: string, at: number): string {
  return createHmac("sha256", process.env.CRON_SECRET || process.env.CODER_TOKEN_KEY || "coder").update(`run|${id}|${at}`).digest("hex");
}
export function verifyRun(id: string, at: number, sig: string): boolean {
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 10 * 60000) return false;
  const want = Buffer.from(signRun(id, at));
  const got = Buffer.from(String(sig || ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Claims due cron schedules atomically (moves next_run_at forward first, so overlapping ticks never double-run). */
export async function claimDue(db: Db = prismaDb, now = new Date(), limit = 25): Promise<Schedule[]> {
  await ensureTable(db);
  const due = await db.query<Schedule>(
    `SELECT id, chat_key, chat_enc, bot_id, title, prompt, kind, cron, tz, repo, events, paused, next_run_at::text AS next_run_at, last_run_at::text AS last_run_at, last_status, hook_id::int AS hook_id, hook_secret_enc FROM coder_schedules WHERE kind = 'cron' AND NOT paused AND next_run_at <= $1::timestamptz ORDER BY next_run_at LIMIT ${Math.max(1, Math.min(100, limit))}`,
    now.toISOString(),
  );
  const claimed: Schedule[] = [];
  for (const s of due) {
    const next = s.cron ? nextRun(s.cron, s.tz, now) : null;
    const rows = await db.query<{ id: string }>(
      `UPDATE coder_schedules SET next_run_at = $2::timestamptz, last_run_at = $3::timestamptz, updated_at = now() WHERE id = $1 AND NOT paused AND next_run_at <= $3::timestamptz RETURNING id`,
      s.id, next ? next.toISOString() : null, now.toISOString(),
    );
    if (rows.length) claimed.push({ ...s, next_run_at: next ? next.toISOString() : null });
  }
  return claimed;
}

export async function fanOut(claimed: Schedule[], base: string, f: typeof fetch = globalThis.fetch): Promise<{ id: string; ok: boolean }[]> {
  return Promise.all(
    claimed.map(async (s) => {
      const at = Date.now();
      try {
        const r = await f(`${base.replace(/\/+$/, "")}/api/coder/schedules/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: s.id, at, sig: signRun(s.id, at) }),
          signal: AbortSignal.timeout(10000),
        });
        return { id: s.id, ok: r.status < 300 };
      } catch {
        return { id: s.id, ok: false };
      }
    }),
  );
}

// ---------------------------------------------------------------- bot commands
async function say(bot: TelegramBot, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  await bot.api.sendMessage(chatId, text.slice(0, 4096), extra as never).catch(() => null);
}
function listKeyboard(rows: Schedule[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const s of rows.slice(0, 20)) kb.text(`${s.paused ? "▶️" : "⏸"} ${s.title.slice(0, 24)}`, `csch|p|${s.id}`).text("🗑", `csch|d|${s.id}`).row();
  return kb;
}
const HELP =
  "⏰ المهام المجدولة:\n" +
  "/schedule daily 09:00 <المهمة>\n/schedule weekdays 08:30 <المهمة>\n/schedule weekly mon,thu 18:00 <المهمة>\n/schedule monthly 1 09:00 <المهمة>\n" +
  '/schedule cron "0 9 * * 1-5" <المهمة>\n/schedule on pull_request,push owner/repo <المهمة>  (أحداث: ' + EVENT_TYPES.join(", ") + ")\n" +
  "/schedule tz Europe/Istanbul — منطقتك الزمنية\n/schedule pause|resume|delete <id>\nأو من التطبيق: /app";

export async function handleScheduleCommand(bot: TelegramBot, botRow: BotRow, chatId: number, text: string, st: { tz?: string }, db: Db = prismaDb): Promise<void> {
  const rest = text.replace(/^\/schedules?(@\S+)?\s*/i, "").trim();
  const tz = st.tz || defaultTz();
  if (!rest || rest === "list") {
    const rows = await listSchedules(chatId, db);
    if (!rows.length) return say(bot, chatId, `لا توجد مهام مجدولة بعد.\n\n${HELP}`);
    const lines = rows.map((s) => `${s.paused ? "⏸" : "🟢"} ${s.title} — ${publicSchedule(s).describe}${s.next_run_at && !s.paused ? ` · التالي ${s.next_run_at.slice(0, 16)} UTC` : ""} · id ${s.id}`);
    return say(bot, chatId, `منطقتك الزمنية: ${tz}\n${lines.join("\n")}`, { reply_markup: listKeyboard(rows) });
  }
  if (rest === "help") return say(bot, chatId, HELP);
  let m: RegExpMatchArray | null;
  if ((m = rest.match(/^tz\s+(\S+)$/i))) {
    if (!validTimeZone(m[1])) return say(bot, chatId, "منطقة زمنية غير معروفة. مثال: Europe/Istanbul");
    const { loadState, saveState } = await import("@/lib/coderSections");
    const s = await loadState(chatId, db);
    s.tz = m[1];
    await saveState(chatId, s, db);
    return say(bot, chatId, `🕒 منطقتك الزمنية الآن: ${m[1]} (للمهام الجديدة).`);
  }
  if ((m = rest.match(/^(pause|resume|delete|run)\s+([a-f0-9]{12})$/i))) {
    const [, verb, id] = m;
    if (verb === "delete") {
      const s = await own(chatId, id, db);
      if (!s) return say(bot, chatId, "لم أجد هذه المهمة.");
      return say(bot, chatId, `🗑 حذف «${s.title}»؟`, { reply_markup: new InlineKeyboard().text("✅ احذف", `csch|dy|${id}`).text("❌ تراجع", `csch|dn|${id}`) });
    }
    if (verb === "run") {
      const s = await own(chatId, id, db);
      if (!s) return say(bot, chatId, "لم أجد هذه المهمة.");
      const { startScheduledRun } = await import("@/lib/coderSections");
      const r = await startScheduledRun(bot, botRow, chatId, { scheduleId: s.id, title: s.title, prompt: s.kind === "cron" ? cronPrompt(s) : s.prompt, source: "scheduled" }, db);
      if (r !== "started") await say(bot, chatId, r === "busy" ? "⏳ التشغيل السابق لهذه المهمة ما زال جارياً." : "قسم Nova AI غير مفعّل الآن.");
      return;
    }
    const s = await setPaused(chatId, id, verb === "pause", db);
    return say(bot, chatId, s ? (s.paused ? `⏸ أوقفت «${s.title}» مؤقتاً.` : `▶️ استأنفت «${s.title}».`) : "لم أجد هذه المهمة.");
  }
  let n: NewSchedule | null = null;
  if ((m = rest.match(/^on\s+(\S+)\s+([\w.-]+\/[\w.-]+)\s+([\s\S]+)$/i))) n = { kind: "event", events: m[1].split(",").map((e) => (e === "pr" ? "pull_request" : e === "issue" ? "issues" : e)), repo: m[2], prompt: m[3], tz };
  else if ((m = rest.match(/^cron\s+"([^"]+)"\s+([\s\S]+)$/i))) n = { kind: "cron", recurrence: m[1], prompt: m[2], tz };
  else if ((m = rest.match(/^(daily|weekdays|hourly)\s+(\S+)\s+([\s\S]+)$/i))) n = { kind: "cron", recurrence: `${m[1]} ${m[2]}`, prompt: m[3], tz };
  else if ((m = rest.match(/^(weekly|monthly)\s+(\S+)\s+(\S+)\s+([\s\S]+)$/i))) n = { kind: "cron", recurrence: `${m[1]} ${m[2]} ${m[3]}`, prompt: m[4], tz };
  if (!n) return say(bot, chatId, HELP);
  const r = await createSchedule(chatId, botRow.id, n, db).catch((e) => ({ ok: false as const, error: String((e as Error).message || e) }));
  if (!r.ok) return say(bot, chatId, `تعذّر إنشاء المهمة: ${r.error}`);
  const s = r.schedule;
  const when = s.kind === "cron" ? `${publicSchedule(s).describe} (${s.tz}) · أول تشغيل ${s.next_run_at?.slice(0, 16)} UTC` : publicSchedule(s).describe;
  await say(bot, chatId, `✅ أُنشئت المهمة «${s.title}» — ${when}\nid ${s.id}${"hook" in r && r.hook ? `\n${r.hook.ok ? "🔗 ربطت webhook على المستودع." : `⚠️ ${r.hook.note}`}` : ""}`);
}

export async function handleScheduleCallback(bot: TelegramBot, _botRow: BotRow, chatId: number, msgId: number, data: string, db: Db = prismaDb): Promise<void> {
  const [, verb, id] = data.split("|");
  if (verb === "p") {
    const s = await own(chatId, id, db);
    if (!s) return;
    await setPaused(chatId, id, !s.paused, db);
  } else if (verb === "d") {
    const s = await own(chatId, id, db);
    if (s) await say(bot, chatId, `🗑 حذف «${s.title}»؟`, { reply_markup: new InlineKeyboard().text("✅ احذف", `csch|dy|${id}`).text("❌ تراجع", `csch|dn|${id}`) });
    return;
  } else if (verb === "dy") {
    await bot.api.editMessageReplyMarkup(chatId, msgId, { reply_markup: new InlineKeyboard() }).catch(() => null);
    const r = await deleteSchedule(chatId, id, true, db);
    await say(bot, chatId, r === "deleted" ? "🗑 حُذفت المهمة." : "لم أجد هذه المهمة.");
    return;
  } else if (verb === "dn") {
    await bot.api.editMessageReplyMarkup(chatId, msgId, { reply_markup: new InlineKeyboard() }).catch(() => null);
    return;
  }
  const rows = await listSchedules(chatId, db);
  await bot.api.editMessageReplyMarkup(chatId, msgId, { reply_markup: listKeyboard(rows) }).catch(() => null);
}

/** /perms <category> <ask|allow|deny|reset> [owner/repo] [interactive|scheduled] — false when there are no arguments (show the keyboard). */
export async function handlePermsCommand(bot: TelegramBot, chatId: number, text: string, db: Db = prismaDb): Promise<boolean> {
  const args = text.replace(/^\/perms(@\S+)?\s*/i, "").trim().split(/\s+/).filter(Boolean);
  if (!args.length) return false;
  const [cat, pol, ...more] = args;
  if (!isCategory(cat) || !(isPolicy(pol) || pol === "reset")) {
    await say(bot, chatId, `الصيغة: /perms <${CATEGORIES.join("|")}> <ask|allow|deny|reset> [owner/repo] [interactive|scheduled]`);
    return true;
  }
  const repo = more.find((x) => REPO_RX.test(x)) || "*";
  const context = (more.find((x) => x === "interactive" || x === "scheduled") as Context | undefined) || "*";
  if (pol === "reset") await removePref(chatId, cat, repo, context, db);
  else await setPref(chatId, { category: cat, repo, context, policy: pol }, db);
  await say(bot, chatId, `🔐 ${cat} → ${pol}${repo !== "*" ? ` · ${repo}` : ""}${context !== "*" ? ` · ${context}` : ""}`);
  return true;
}
