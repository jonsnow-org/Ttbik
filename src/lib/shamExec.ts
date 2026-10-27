// Sham's OWN tools: the definitions Sham is shown and the code that runs them. Nothing here goes through Nova's engine (coderAgent.ts):
// it calls the plain libraries directly (the guarded web fetch, the sandbox VM driver, memory, schedules) and talks to the GitHub API itself.
// The VM, the memory scope and the run id are Sham's own (`sham:<chat>`, `sham-<chat>`), so Sham and Nova never share a computer.
// Writing to the user's repositories (push, open / merge a pull request) is never run on the model's word alone: the loop stops and the user is asked
// first (shamAgent.ts "confirm"; the pending call is kept in sham_pending and runs only when the user taps «نفّذ»).
import { deepResearch, fetchPage, formatResearch, formatSearch, webSearch } from "@/lib/coderWeb";
import { runSandboxTool, SANDBOX_TOOLS } from "@/lib/coderSandbox";
import { prismaDb, resolveConnections, tierFor, coderChatKey, type Db } from "@/lib/coderAuth";
import type { CoderTool, CoderToolCall } from "@/lib/openCoderStudio";

export type ShamCtx = { chatId: number; botId?: string; db: Db; githubToken: string | null; chatKey: string; runId: string; owner: boolean; fetchImpl?: typeof fetch };

const RESULT_MAX = 7000;
const clip = (x: unknown, max = RESULT_MAX) => { const t = typeof x === "string" ? x : JSON.stringify(x, null, 1); return t.length > max ? `${t.slice(0, max)}\n…[truncated ${t.length - max} chars]` : t; };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const s = (description: string) => ({ type: "string", description });
const n = (description: string) => ({ type: "number", description });
const tool = (name: string, description: string, parameters: object): CoderTool => ({ type: "function", function: { name, description, parameters } } as CoderTool);
const REPO = s("owner/name");

/** Every tool Sham has, by name. Writes to the user's repositories are the ones in SHAM_NEEDS_OK. */
export const SHAM_TOOLS: CoderTool[] = [
  tool("web_search", "Search the web. Returns titles, URLs and snippets.", obj({ query: s("search words"), limit: n("results, default 8") }, ["query"])),
  tool("fetch_page", "Read one web page as clean text, or a raw text / JSON file.", obj({ url: s("http(s) URL"), max_chars: n("default 20000") }, ["url"])),
  tool("deep_research", "Research a question: several searches, many sources read, the best passages returned with numbered sources [n].", obj({ question: s("the question"), max_sources: n("default 10") }, ["question"])),
  tool("github_list_files", "List a repository's files (or one folder when `path` is given).", obj({ repo: REPO, path: s("folder, empty = all files"), ref: s("branch, empty = default") }, ["repo"])),
  tool("github_read_file", "Read a file from a repository (line window for big files).", obj({ repo: REPO, path: s("file path"), ref: s("branch"), start_line: n("1-based"), end_line: n("last line") }, ["repo", "path"])),
  tool("github_search_code", "Search code inside one repository.", obj({ repo: REPO, query: s("words to find") }, ["repo", "query"])),
  tool("github_repo_scan", "Overview of a repository: info, folders, README and manifests.", obj({ repo: REPO }, ["repo"])),
  tool("memory_save", "Remember a lasting fact, preference or decision about this user for later conversations. Never secrets.", obj({ text: s("one sentence"), kind: { type: "string", enum: ["preference", "fact", "decision"] }, repo: s("owner/name if it is about one repo") }, ["text"])),
  tool("memory_search", "Search what is remembered about this user.", obj({ query: s("what to look for"), repo: s("owner/name (optional)") }, ["query"])),
  tool("schedule_list", "List this user's scheduled tasks.", obj({})),
  tool("schedule_delete", "Delete a scheduled task.", obj({ id: s("schedule id") }, ["id"])),
  tool("schedule_create", "Schedule a task that runs by itself later and reports back in this chat. Write the prompt as a complete standalone instruction.", obj({ title: s("short title"), prompt: s("full instruction for the run"), kind: { type: "string", enum: ["cron", "event"] }, recurrence: { type: "object", description: "when it repeats (as the schedules API expects)" }, repo: s("owner/name for event schedules") }, ["title", "prompt"])),
  tool("sandbox_clone", "Clone a GitHub repo into YOUR private Linux VM for this chat, to install, run code and tests.", obj({ repo: REPO, branch: s("branch, empty = default"), dir: s("folder, default = repo name"), depth: n("history depth, default 50") }, ["repo"])),
  tool("sandbox_exec", "Run a shell command in the VM (bash, node, npm, python3, pip, git). A long command returns 'still running' with an id: then call sandbox_wait.", obj({ command: s("shell command"), cwd: s("working dir") }, ["command"])),
  tool("sandbox_wait", "Keep waiting for a long sandbox_exec command and get its output.", obj({ id: s("command id from sandbox_exec") }, ["id"])),
  tool("sandbox_write_file", "Write a file in the VM (creates folders).", obj({ path: s("path"), content: s("full file content"), cwd: s("base dir") }, ["path", "content"])),
  tool("sandbox_edit_file", "Edit a file in the VM by replacing an exact piece of text (must occur once unless replace_all).", obj({ path: s("file path"), old: s("exact text to replace"), new: s("replacement text"), replace_all: { type: "boolean" }, cwd: s("base dir") }, ["path", "old", "new"])),
  tool("sandbox_search", "Search the VM's files: `pattern` = regex inside files; `glob` = file names (e.g. *.ts).", obj({ pattern: s("regex"), glob: s("file name pattern"), path: s("folder, default ."), max: n("max results"), cwd: s("base dir") })),
  tool("sandbox_read_file", "Read a file from the VM.", obj({ path: s("path"), start_line: n("1-based"), max_lines: n("default 800"), cwd: s("base dir") }, ["path"])),
  tool("sandbox_push", "Send the changes made in the VM back to GitHub: commit everything changed in the cloned folder and push it to `branch`. Never forced. The user is asked first.", obj({ repo: REPO, branch: s("branch to push to, e.g. fix/cart-bugs"), message: s("commit message"), dir: s("the cloned folder, default = repo name") }, ["repo", "branch", "message"])),
  tool("github_create_pr", "Open a pull request FROM `head` INTO `base`. Name `base` (the branch the user said); head must already hold the changes. The user is asked first.", obj({ repo: REPO, head: s("source branch"), base: s("target branch (required)"), title: s("title"), body: s("description") }, ["repo", "head", "base", "title"])),
  tool("github_merge_pr", "Merge a pull request. The user is asked first.", obj({ repo: REPO, number: n("PR number"), method: s("merge | squash | rebase") }, ["repo", "number"])),
  tool("make_media", "Make a picture, a sound or a short video yourself (Sham's own media models) and send it to the user.", obj({ kind: { type: "string", enum: ["image", "audio", "video"] }, prompt: s("what to make") }, ["kind", "prompt"])),
  tool("ask_user", "Ask the user a short question when something needed is unclear or missing. The round ends with the question.", obj({ question: s("the question") }, ["question"])),
];

/** Calls that change the user's repositories: they wait for the user's tap. */
export const SHAM_NEEDS_OK = new Set(["sandbox_push", "github_create_pr", "github_merge_pr"]);
const GITHUB_TOOLS = new Set(["github_list_files", "github_read_file", "github_search_code", "github_repo_scan", "github_create_pr", "github_merge_pr", "sandbox_push"]);

/** The tools shown to Sham: GitHub ones only when this chat has a linked token. */
export function shamTools(github: boolean): CoderTool[] {
  return SHAM_TOOLS.filter((t) => github || !GITHUB_TOOLS.has(t.function.name));
}

export async function shamContext(chatId: number, botId?: string, db: Db = prismaDb): Promise<ShamCtx> {
  const conn = await resolveConnections(chatId, db);
  return { chatId, botId, db, githubToken: conn.github?.token || null, chatKey: `sham:${coderChatKey(chatId)}`, runId: `sham-${chatId}`, owner: tierFor(chatId) === "owner" };
}

// ---------------------------------------------------------------- GitHub (Sham's own small client)
type GhRes = { status: number; data: any };
async function gh(ctx: ShamCtx, method: string, path: string, body?: unknown): Promise<GhRes> {
  if (!ctx.githubToken) return { status: 401, data: { message: "GitHub is not connected in this chat" } };
  const res = await (ctx.fetchImpl || globalThis.fetch)(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "sham-agent", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* plain text */ }
  return { status: res.status, data };
}
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const repoOk = (r: unknown) => typeof r === "string" && /^[\w.-]+\/[\w.-]+$/.test(r);
const defaultBranch = async (ctx: ShamCtx, repo: string) => String((await gh(ctx, "GET", `/repos/${repo}`)).data?.default_branch || "main");

async function githubTool(ctx: ShamCtx, name: string, a: Record<string, any>): Promise<string> {
  if (!ctx.githubToken) return "error: GitHub is not connected in this chat";
  if (!repoOk(a.repo)) return "error: repo must be owner/name";
  const R = `/repos/${a.repo}`;
  switch (name) {
    case "github_list_files": {
      const ref = String(a.ref || (await defaultBranch(ctx, a.repo)));
      if (a.path) {
        const r = await gh(ctx, "GET", `${R}/contents/${enc(String(a.path))}?ref=${encodeURIComponent(ref)}`);
        return clip(Array.isArray(r.data) ? r.data.map((x: any) => `${x.type === "dir" ? "📁" : "  "} ${x.path}${x.size ? ` (${x.size})` : ""}`).join("\n") : r.data?.message || r.status);
      }
      const r = await gh(ctx, "GET", `${R}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      const items = (r.data?.tree || []).filter((x: any) => x.type === "blob").map((x: any) => x.path);
      return clip(`${items.length} files${r.data?.truncated ? " (truncated)" : ""}\n${items.slice(0, 1500).join("\n")}`);
    }
    case "github_read_file": {
      const r = await gh(ctx, "GET", `${R}/contents/${enc(String(a.path))}${a.ref ? `?ref=${encodeURIComponent(a.ref)}` : ""}`);
      if (r.status >= 300 || !r.data?.content) return clip(`error ${r.status}: ${r.data?.message || "not a file"}`);
      const lines = Buffer.from(r.data.content, "base64").toString("utf-8").split("\n");
      const from = Math.max(1, Number(a.start_line) || 1), to = Math.min(lines.length, Number(a.end_line) || lines.length);
      return clip(`${a.path} (${lines.length} lines)\n${lines.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join("\n")}`);
    }
    case "github_search_code": {
      const r = await gh(ctx, "GET", `/search/code?q=${encodeURIComponent(`${a.query} repo:${a.repo}`)}&per_page=30`);
      return clip((r.data?.items || []).map((x: any) => x.path).join("\n") || `no results (${r.status})`);
    }
    case "github_repo_scan": {
      const [info, top] = await Promise.all([gh(ctx, "GET", R), githubTool(ctx, "github_list_files", { repo: a.repo, path: "" })]);
      const files = top.split("\n").slice(1).map((f) => f.trim());
      const roots = files.filter((f) => !f.includes("/")).slice(0, 40), dirs = [...new Set(files.filter((f) => f.includes("/")).map((f) => f.split("/")[0]))].slice(0, 40);
      const picks = [files.find((f) => /^README(\.md)?$/i.test(f)), ...["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml"].filter((m) => files.includes(m)).slice(0, 2)].filter(Boolean) as string[];
      const got = await Promise.all(picks.map((path) => githubTool(ctx, "github_read_file", { repo: a.repo, path, end_line: path.startsWith("README") ? 60 : 50 })));
      const d = info.data || {};
      return clip(`${d.full_name} | default ${d.default_branch} | ${d.language || "-"} | ${d.description || ""}\nfolders: ${dirs.join(", ") || "-"}\nroot files: ${roots.join(", ") || "-"}\n\n${got.map((g, i) => `=== ${picks[i]} ===\n${g.slice(0, picks[i].startsWith("README") ? 2000 : 1200)}`).join("\n\n")}`);
    }
    case "github_create_pr": {
      const base = String(a.base || "").trim();
      if (!base) return "error: base is required: name the branch this pull request must merge INTO.";
      if (String(a.head || "").trim() === base) return "error: head and base are the same branch; push your changes to a new branch first (sandbox_push).";
      const r = await gh(ctx, "POST", `${R}/pulls`, { head: a.head, base, title: a.title, body: a.body || "" });
      return r.status < 300 ? `PR #${r.data.number} ${r.data.html_url} (${a.head} → ${base})` : clip(`error ${r.status}: ${r.data?.message} ${JSON.stringify(r.data?.errors || "")}`);
    }
    case "github_merge_pr": {
      const pr = await gh(ctx, "GET", `${R}/pulls/${Number(a.number)}`);
      const r = await gh(ctx, "PUT", `${R}/pulls/${Number(a.number)}/merge`, { merge_method: ["merge", "squash", "rebase"].includes(a.method) ? a.method : "merge" });
      const where = pr.data?.base?.ref ? ` into ${pr.data.base.ref} (from ${pr.data.head?.ref})` : "";
      return clip(r.status < 300 ? `merged PR #${Number(a.number)}${where}: ${r.data?.sha}` : `error ${r.status}: ${r.data?.message}`);
    }
  }
  return `error: unknown tool ${name}`;
}

const parse = (call: CoderToolCall): Record<string, any> => { try { const v = JSON.parse(call.function.arguments || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } };

/** Runs one of Sham's tools. `approved` must be true for a write (SHAM_NEEDS_OK): the loop never passes it on its own. */
export async function shamRunTool(call: CoderToolCall, ctx: ShamCtx, approved = false): Promise<string> {
  const name = call.function.name;
  const a = parse(call);
  try {
    if (SHAM_NEEDS_OK.has(name) && !approved) return "error: this changes the user's repository: it runs only after the user taps «نفّذ».";
    if (name === "web_search") {
      const q = String(a.query || "").trim();
      return q ? clip(formatSearch(q, await webSearch(q, { fetchImpl: ctx.fetchImpl, limit: Number(a.limit) || 8 }))) : "error: query is required";
    }
    if (name === "fetch_page") {
      const p = await fetchPage(String(a.url || ""), { fetchImpl: ctx.fetchImpl, maxChars: Number(a.max_chars) || 20000 });
      return p.ok ? clip(`${p.title ? `# ${p.title}\n` : ""}${p.url}\n\n${p.markdown}`, Math.max(RESULT_MAX, Number(a.max_chars) || 20000)) : `error: could not read ${p.url}: ${p.error}`;
    }
    if (name === "deep_research") {
      const q = String(a.question || "").trim();
      if (!q) return "error: question is required";
      const { checkLimit, addUsage } = await import("@/lib/coderPlans");
      const c = await checkLimit(ctx.chatId, "research", 1, ctx.db);
      if (!c.ok) return "error: the weekly deep-research allowance is used up. Use web_search + fetch_page instead.";
      await addUsage(ctx.chatId, "research", 1, ctx.db);
      return formatResearch(await deepResearch(q, { fetchImpl: ctx.fetchImpl, maxSources: Number(a.max_sources) || 10 }), 24000);
    }
    if (name === "memory_save" || name === "memory_search") {
      const { memoryTool } = await import("@/lib/coderMemory");
      return await memoryTool(ctx.chatId, name, a, ctx.runId, ctx.db);
    }
    if (name === "schedule_create" || name === "schedule_list" || name === "schedule_delete") {
      if (!ctx.botId) return "error: scheduling is not available here";
      const S = await import("@/lib/coderSchedules");
      if (name === "schedule_list") {
        const rows = await S.listSchedules(ctx.chatId, ctx.db);
        return rows.length ? rows.map((r) => `${r.id} | ${r.title} | ${S.publicSchedule(r, "ar").describe}${r.paused ? " (paused)" : ""} | next: ${r.next_run_at || "-"}`).join("\n") : "no schedules";
      }
      if (name === "schedule_delete") return (await S.deleteSchedule(ctx.chatId, String(a.id || ""), true, ctx.db)) === "deleted" ? `deleted schedule ${a.id}` : "error: no such schedule";
      const r = await S.createSchedule(ctx.chatId, ctx.botId, { title: a.title, prompt: String(a.prompt || ""), kind: a.kind === "event" ? "event" : "cron", recurrence: a.recurrence, repo: a.repo, events: a.events } as any, ctx.db);
      return r.ok ? `scheduled ${r.schedule.id}: ${S.publicSchedule(r.schedule, "ar").describe}` : `error: ${r.error}`;
    }
    if (SANDBOX_TOOLS.has(name)) {
      const { checkLimit, addUsage } = await import("@/lib/coderPlans");
      const c = ctx.owner ? { ok: true } : await checkLimit(ctx.chatId, "sandbox_minutes", 0, ctx.db);
      if (!c.ok) return "error: the weekly sandbox time is used up. Continue without running code.";
      const t0 = Date.now();
      const out = await runSandboxTool(name, a, { chatKey: ctx.chatKey, runId: ctx.runId, githubToken: ctx.githubToken, owner: ctx.owner, db: ctx.db });
      if (!ctx.owner) await addUsage(ctx.chatId, "sandbox_minutes", Math.ceil((Date.now() - t0) / 1000), ctx.db);
      return out === null ? `error: ${name} is not available` : out;
    }
    if (name.startsWith("github_")) return await githubTool(ctx, name, a);
    return `error: unknown tool ${name}`;
  } catch (e) {
    return `error: ${(e as Error).message || "tool failed"}`;
  }
}

// ---------------------------------------------------------------- the user's tap before a write
export type ShamPending = { id: string; call: CoderToolCall };
let pendingReady = false;
async function table(db: Db): Promise<void> {
  if (db === prismaDb && pendingReady) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS sham_pending (id TEXT PRIMARY KEY, chat_id BIGINT NOT NULL, call TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) pendingReady = true;
}

export async function shamSavePending(chatId: number, call: CoderToolCall, db: Db = prismaDb): Promise<string> {
  await table(db);
  const id = Math.random().toString(36).slice(2, 10);
  await db.exec(`INSERT INTO sham_pending (id, chat_id, call) VALUES ($1, $2, $3)`, id, chatId, JSON.stringify(call));
  return id;
}

/** Takes the pending call out (once): only the chat that asked can approve it, and only within an hour. */
export async function shamTakePending(chatId: number, id: string, db: Db = prismaDb): Promise<CoderToolCall | null> {
  await table(db);
  const rows = await db.query<{ call: string }>(`DELETE FROM sham_pending WHERE id = $1 AND chat_id = $2 AND created_at > now() - interval '1 hour' RETURNING call`, id, chatId);
  try { return rows[0] ? (JSON.parse(rows[0].call) as CoderToolCall) : null; } catch { return null; }
}

/** One line telling the user what they are about to allow. */
export function shamConfirmText(call: CoderToolCall): string {
  const a = parse(call);
  const what = call.function.name === "sandbox_push" ? `رفع التعديلات من الجهاز الافتراضي إلى الفرع ${a.branch} في ${a.repo}\nرسالة الحفظ: ${String(a.message || "").slice(0, 200)}`
    : call.function.name === "github_create_pr" ? `فتح طلب دمج في ${a.repo}: ${a.head} ← ${a.base}\n${String(a.title || "").slice(0, 200)}`
    : `دمج طلب الدمج رقم ${a.number} في ${a.repo}`;
  return `🔐 شام يريد أن ينفّذ:\n${what}\n\nهل أسمح له؟`;
}

// ---------------------------------------------------------------- a long task between legs (the shared background runner: coderRuntime later() + the signed continue route)
export type ShamRun = { chatId: number; botId: string; runId: string; request: string; messages: unknown[]; leg: number; variant: "v1" | "v2"; mode: Record<string, unknown> };
let runsReady = false;
async function runsTable(db: Db): Promise<void> {
  if (db === prismaDb && runsReady) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS sham_runs2 (run_id TEXT PRIMARY KEY, chat_id BIGINT NOT NULL, data TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) runsReady = true;
}
export async function shamSaveRun(run: ShamRun, db: Db = prismaDb): Promise<void> {
  await runsTable(db);
  await db.exec(`INSERT INTO sham_runs2 (run_id, chat_id, data, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (run_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, run.runId, run.chatId, JSON.stringify(run));
}
/** Takes one task's saved state out (once). Another task of the same chat is untouched. A state older than 2 hours is dropped. */
export async function shamTakeRun(chatId: number, runId: string, db: Db = prismaDb): Promise<ShamRun | null> {
  await runsTable(db);
  const rows = await db.query<{ data: string }>(`DELETE FROM sham_runs2 WHERE run_id = $1 AND chat_id = $2 AND updated_at > now() - interval '2 hours' RETURNING data`, runId, chatId);
  try { return rows[0] ? (JSON.parse(rows[0].data) as ShamRun) : null; } catch { return null; }
}

// ---------------------------------------------------------------- Telegram resends a webhook that is slow to answer: the same update must not start a second task
let seenReady = false;
/** true = first time this update is seen (go on); false = a Telegram retry of an update already taken (skip it). */
export async function shamClaimUpdate(chatId: number, updateId: number | undefined, db: Db = prismaDb): Promise<boolean> {
  if (!updateId) return true;
  try {
    if (!(db === prismaDb && seenReady)) {
      await db.exec(`CREATE TABLE IF NOT EXISTS sham_seen (chat_id BIGINT NOT NULL, update_id BIGINT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (chat_id, update_id))`);
      if (db === prismaDb) seenReady = true;
    }
    await db.exec(`DELETE FROM sham_seen WHERE at < now() - interval '1 day'`);
    const rows = await db.query<{ update_id: string }>(`INSERT INTO sham_seen (chat_id, update_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING update_id`, chatId, updateId);
    return rows.length > 0;
  } catch { return true; }
}

// ---------------------------------------------------------------- which media path comes first (the owner's switch in the Mini App panel)
export type ShamMediaOrder = "reserve_first" | "own_first";
let settingsReady = false;
async function settingsTable(db: Db): Promise<void> {
  if (db === prismaDb && settingsReady) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS sham_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) settingsReady = true;
}
/** reserve_first (default): the shared media Studio first, Sham's own weights as the second path. own_first: Sham's own weights first, the media Studio on failure. */
export async function shamMediaOrder(db: Db = prismaDb): Promise<ShamMediaOrder> {
  try {
    await settingsTable(db);
    const r = await db.query<{ value: string }>(`SELECT value FROM sham_settings WHERE key = 'media_order_v2'`);
    return r[0]?.value === "reserve_first" ? "reserve_first" : "own_first";
  } catch { return "own_first"; }
}
export async function setShamMediaOrder(order: ShamMediaOrder, db: Db = prismaDb): Promise<void> {
  await settingsTable(db);
  await db.exec(`INSERT INTO sham_settings (key, value, updated_at) VALUES ('media_order_v2', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, order);
}

// Priority for the new Hugging Face ZeroGPU image/video Spaces versus the established fallback providers.
export type HfMediaRouteOrder = "hf_first" | "fallback_first";
export async function hfMediaRouteOrder(db: Db = prismaDb): Promise<HfMediaRouteOrder> {
  try {
    await settingsTable(db);
    const r = await db.query<{ value: string }>(`SELECT value FROM sham_settings WHERE key = 'hf_media_route_order'`);
    return r[0]?.value === "fallback_first" ? "fallback_first" : "hf_first";
  } catch { return "hf_first"; }
}
export async function setHfMediaRouteOrder(order: HfMediaRouteOrder, db: Db = prismaDb): Promise<void> {
  await settingsTable(db);
  await db.exec(`INSERT INTO sham_settings (key, value, updated_at) VALUES ('hf_media_route_order', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, order);
}
