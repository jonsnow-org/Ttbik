// Agent harness of the coder section (plan -> act -> verify). The model (src/lib/openCoderStudio.ts) asks for tools with native tool calls;
// this file describes the tools, runs them, and decides which calls need the user's tap first.
// The ONLY guardrail (owner's order, 2026-10-21): an explicit confirmation button before ANY delete, and before any push / merge into a
// main or default branch. Everything else runs directly.
// GitHub access: CODER_GITHUB_TOKEN (a fine-grained token the owner scopes to the repos the coder may work on). Never logged or echoed.
import type { CoderMessage, CoderTool, CoderToolCall } from "@/lib/openCoderStudio";

const GH = "https://api.github.com";
const RESULT_MAX = Number(process.env.CODER_TOOL_RESULT_MAX || 9000);

const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });
const s = (description: string) => ({ type: "string", description });
const n = (description: string) => ({ type: "number", description });
const tool = (name: string, description: string, parameters: Record<string, unknown>): CoderTool => ({ type: "function", function: { name, description, parameters } });
const REPO = s("owner/name, e.g. jonsnow-org/Ttbik");

export const GITHUB_TOOLS: CoderTool[] = [
  tool("github_whoami", "Who the GitHub token belongs to.", obj({})),
  tool("github_list_repos", "List repositories the token can access.", obj({ owner: s("optional org or user") })),
  tool("github_repo_info", "Repository facts: default branch, description, visibility, open issues.", obj({ repo: REPO }, ["repo"])),
  tool("github_list_files", "List files of a repository (recursive tree, or one folder).", obj({ repo: REPO, path: s("folder, empty = whole repo"), ref: s("branch / sha, empty = default") }, ["repo"])),
  tool("github_read_file", "Read a text file. Use start_line/end_line for big files.", obj({ repo: REPO, path: s("file path"), ref: s("branch / sha"), start_line: n("1-based"), end_line: n("inclusive") }, ["repo", "path"])),
  tool("github_search_code", "Search code in one repository.", obj({ repo: REPO, query: s("search words") }, ["repo", "query"])),
  tool("github_list_branches", "List branches.", obj({ repo: REPO }, ["repo"])),
  tool("github_create_branch", "Create a branch from another branch (default branch when `from` is empty).", obj({ repo: REPO, branch: s("new branch"), from: s("source branch") }, ["repo", "branch"])),
  tool("github_write_files", "Create or update several files in ONE commit on a branch (created from the default branch if missing).",
    obj({ repo: REPO, branch: s("target branch"), message: s("commit message"), files: { type: "array", items: obj({ path: s("file path"), content: s("full new file content") }, ["path", "content"]) } }, ["repo", "branch", "message", "files"])),
  tool("github_delete_files", "Delete files in one commit on a branch.", obj({ repo: REPO, branch: s("branch"), message: s("commit message"), paths: { type: "array", items: s("file path") } }, ["repo", "branch", "message", "paths"])),
  tool("github_delete_branch", "Delete a branch.", obj({ repo: REPO, branch: s("branch") }, ["repo", "branch"])),
  tool("github_create_pr", "Open a pull request.", obj({ repo: REPO, head: s("source branch"), base: s("target branch, empty = default"), title: s("title"), body: s("description") }, ["repo", "head", "title"])),
  tool("github_merge_pr", "Merge a pull request.", obj({ repo: REPO, number: n("PR number"), method: s("merge | squash | rebase") }, ["repo", "number"])),
  tool("github_list_prs", "List open pull requests.", obj({ repo: REPO }, ["repo"])),
  tool("github_list_issues", "List open issues.", obj({ repo: REPO }, ["repo"])),
  tool("github_create_issue", "Open an issue.", obj({ repo: REPO, title: s("title"), body: s("body") }, ["repo", "title"])),
  tool("github_comment", "Comment on an issue or pull request.", obj({ repo: REPO, number: n("issue / PR number"), body: s("comment") }, ["repo", "number", "body"])),
  tool("github_ci_status", "VERIFY step: check runs and statuses (tests, build, lint) of a branch or commit.", obj({ repo: REPO, ref: s("branch or sha") }, ["repo", "ref"])),
  tool("github_run_workflow", "Start a workflow_dispatch workflow (e.g. tests).", obj({ repo: REPO, workflow: s("file name, e.g. ci.yml"), ref: s("branch"), inputs: { type: "object" } }, ["repo", "workflow", "ref"])),
];
export const COMMON_TOOLS: CoderTool[] = [
  tool("web_fetch", "Read a public web page or raw file (docs, APIs, errors).", obj({ url: s("https URL") }, ["url"])),
  tool("memory_note", "Save a short note you need in later steps (plan, findings, decisions). Kept for this conversation.", obj({ text: s("note") }, ["text"])),
];

export function coderTools(github: boolean): CoderTool[] {
  return github ? [...GITHUB_TOOLS, ...COMMON_TOOLS] : COMMON_TOOLS;
}

export function coderSystemPrompt(opts: { github: boolean; notes: string; now?: Date }): string {
  const now = (opts.now || new Date()).toISOString().slice(0, 16).replace("T", " ");
  return [
    "You are the coder: an expert software engineer and agent. Reply in the user's language (Arabic or English); code and identifiers stay in English.",
    "Work like a senior engineer on a real project, in a loop:",
    "1. PLAN: for any non-trivial task first write a short numbered plan (save it with memory_note).",
    "2. ACT: use the tools one step at a time. Read the relevant files before changing them; never guess file contents or APIs.",
    "3. VERIFY: after a change, re-read what you wrote and check CI with github_ci_status (or start a workflow). If something fails, read the error, fix it, verify again.",
    "4. REPORT: finish with what you did, what you verified, and anything left open. Be honest when something failed.",
    "Prefer a feature branch + pull request for code changes. Keep commits focused and messages clear.",
    "Deleting anything, and pushing or merging into a main/default branch, waits for the user's confirmation button: just call the tool; the user decides.",
    "Answers may be as long as needed. Use ``` code blocks for code.",
    opts.github ? "You have GitHub tools with the owner's token." : "GitHub tools are not connected in this chat; you can still write and review code and read public pages with web_fetch.",
    `Current time (UTC): ${now}.`,
    opts.notes ? `Your notes so far:\n${opts.notes}` : "",
  ].filter(Boolean).join("\n");
}

/** Keep the conversation inside the model's context: newest messages first, whole turns only (never start on a tool result). */
export function trimMessages(msgs: CoderMessage[], maxChars = Number(process.env.CODER_HISTORY_CHARS || 70000)): CoderMessage[] {
  let total = 0;
  let i = msgs.length;
  while (i > 0) {
    const m = msgs[i - 1];
    const len = (m.content || "").length + JSON.stringify((m as { tool_calls?: unknown }).tool_calls || "").length;
    if (total + len > maxChars && i < msgs.length) break;
    total += len;
    i--;
  }
  let out = msgs.slice(i);
  while (out.length > 1 && out[0].role !== "user") out = out.slice(1);
  return out;
}

export function parseArgs(call: CoderToolCall): Record<string, any> {
  try {
    const a = JSON.parse(call.function.arguments || "{}");
    return a && typeof a === "object" ? a : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- GitHub
type Gh = (method: string, path: string, body?: unknown) => Promise<{ status: number; data: any }>;

export function githubClient(token: string, fetchImpl?: typeof fetch): Gh {
  return async (method, path, body) => {
    const res = await (fetchImpl || globalThis.fetch)(`${GH}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "coder-bot", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* raw text */
    }
    return { status: res.status, data };
  };
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const repoOk = (r: unknown) => typeof r === "string" && /^[\w.-]+\/[\w.-]+$/.test(r);

async function defaultBranch(gh: Gh, repo: string): Promise<string> {
  const r = await gh("GET", `/repos/${repo}`);
  return String(r.data?.default_branch || "main");
}

const MAIN_NAMES = new Set(["main", "master", "trunk", "production", "prod"]);

export type Guard = { confirm: false } | { confirm: true; reason: string; summary: string };

/** The only guardrail: delete -> confirm; push / merge into main or the repo's default branch -> confirm. Everything else runs. */
export async function guardCall(call: CoderToolCall, gh: Gh | null): Promise<Guard> {
  const a = parseArgs(call);
  const name = call.function.name;
  const where = `${a.repo || "?"}${a.branch ? ` @ ${a.branch}` : ""}`;
  if (name === "github_delete_files") return { confirm: true, reason: "حذف ملفات", summary: `${where}\n${(a.paths || []).slice(0, 30).join("\n")}` };
  if (name === "github_delete_branch") return { confirm: true, reason: "حذف فرع", summary: where };
  const isMain = async (branch: string) => {
    if (!branch || MAIN_NAMES.has(branch.toLowerCase())) return true;
    if (!gh || !repoOk(a.repo)) return false;
    return branch === (await defaultBranch(gh, a.repo).catch(() => ""));
  };
  if (name === "github_write_files" && (await isMain(String(a.branch || "")))) {
    const files = (Array.isArray(a.files) ? a.files : []).map((f: any) => String(f?.path || "?"));
    return { confirm: true, reason: "دفع إلى الفرع الأساسي", summary: `${where}\n${a.message || ""}\n${files.slice(0, 30).join("\n")}` };
  }
  if (name === "github_merge_pr") {
    let base = "";
    if (gh && repoOk(a.repo)) base = String((await gh("GET", `/repos/${a.repo}/pulls/${Number(a.number)}`).catch(() => null))?.data?.base?.ref || "");
    if (!base || (await isMain(base))) return { confirm: true, reason: "دمج في الفرع الأساسي", summary: `${a.repo} PR #${a.number}${base ? ` → ${base}` : ""}` };
  }
  return { confirm: false };
}

const clip = (x: unknown) => {
  const t = typeof x === "string" ? x : JSON.stringify(x, null, 1);
  return t.length > RESULT_MAX ? `${t.slice(0, RESULT_MAX)}\n…[truncated ${t.length - RESULT_MAX} chars]` : t;
};

async function writeFiles(gh: Gh, repo: string, branch: string, message: string, files: { path: string; content: string | null }[]) {
  let ref = await gh("GET", `/repos/${repo}/git/ref/heads/${enc(branch)}`);
  if (ref.status === 404) {
    const base = await defaultBranch(gh, repo);
    const b = await gh("GET", `/repos/${repo}/git/ref/heads/${enc(base)}`);
    if (b.status >= 300) return { error: `base branch ${base}: ${b.status}` };
    const c = await gh("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: b.data.object.sha });
    if (c.status >= 300) return { error: `create branch: ${c.status} ${clip(c.data?.message || "")}` };
    ref = await gh("GET", `/repos/${repo}/git/ref/heads/${enc(branch)}`);
  }
  if (ref.status >= 300) return { error: `branch ${branch}: ${ref.status}` };
  const parent = ref.data.object.sha;
  const commit = await gh("GET", `/repos/${repo}/git/commits/${parent}`);
  const tree: any[] = [];
  for (const f of files) {
    if (f.content === null) {
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await gh("POST", `/repos/${repo}/git/blobs`, { content: f.content, encoding: "utf-8" });
    if (blob.status >= 300) return { error: `blob ${f.path}: ${blob.status}` };
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.data.sha });
  }
  const t = await gh("POST", `/repos/${repo}/git/trees`, { base_tree: commit.data.tree.sha, tree });
  if (t.status >= 300) return { error: `tree: ${t.status} ${clip(t.data?.message || "")}` };
  const c = await gh("POST", `/repos/${repo}/git/commits`, { message, tree: t.data.sha, parents: [parent] });
  if (c.status >= 300) return { error: `commit: ${c.status}` };
  const u = await gh("PATCH", `/repos/${repo}/git/refs/heads/${enc(branch)}`, { sha: c.data.sha, force: false });
  if (u.status >= 300) return { error: `update branch: ${u.status} ${clip(u.data?.message || "")}` };
  return { ok: true, branch, commit: c.data.sha, files: files.map((f) => f.path) };
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export type ToolCtx = { gh: Gh | null; addNote: (t: string) => void; fetchImpl?: typeof fetch };

export async function runTool(call: CoderToolCall, ctx: ToolCtx): Promise<string> {
  const a = parseArgs(call);
  const name = call.function.name;
  try {
    if (name === "memory_note") {
      ctx.addNote(String(a.text || "").slice(0, 1500));
      return "saved";
    }
    if (name === "web_fetch") {
      const url = String(a.url || "");
      if (!/^https?:\/\//i.test(url)) return "error: url must start with https://";
      const r = await (ctx.fetchImpl || fetch)(url, { headers: { "User-Agent": "coder-bot" }, signal: AbortSignal.timeout(20000) });
      const body = await r.text();
      return clip(`HTTP ${r.status}\n${/html/i.test(r.headers.get("content-type") || "") ? stripHtml(body) : body}`);
    }
    const gh = ctx.gh;
    if (!gh) return "error: GitHub is not connected in this chat";
    if (name !== "github_whoami" && name !== "github_list_repos" && !repoOk(a.repo)) return "error: repo must be owner/name";
    const R = `/repos/${a.repo}`;
    switch (name) {
      case "github_whoami": {
        const r = await gh("GET", "/user");
        return clip({ login: r.data?.login, name: r.data?.name, status: r.status });
      }
      case "github_list_repos": {
        const r = await gh("GET", a.owner ? `/users/${encodeURIComponent(a.owner)}/repos?per_page=100&sort=updated` : "/user/repos?per_page=100&sort=updated");
        return clip(Array.isArray(r.data) ? r.data.map((x: any) => `${x.full_name}${x.private ? " (private)" : ""} — default ${x.default_branch}`).join("\n") : r.data);
      }
      case "github_repo_info": {
        const r = await gh("GET", R);
        const d = r.data || {};
        return clip({ status: r.status, full_name: d.full_name, default_branch: d.default_branch, private: d.private, description: d.description, open_issues: d.open_issues_count, language: d.language, pushed_at: d.pushed_at });
      }
      case "github_list_files": {
        const ref = a.ref || (await defaultBranch(gh, a.repo));
        if (a.path) {
          const r = await gh("GET", `${R}/contents/${enc(String(a.path))}?ref=${encodeURIComponent(ref)}`);
          return clip(Array.isArray(r.data) ? r.data.map((x: any) => `${x.type === "dir" ? "📁" : "  "} ${x.path}${x.size ? ` (${x.size})` : ""}`).join("\n") : r.data?.message || r.status);
        }
        const r = await gh("GET", `${R}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
        const items = (r.data?.tree || []).filter((x: any) => x.type === "blob").map((x: any) => x.path);
        return clip(`${items.length} files${r.data?.truncated ? " (truncated)" : ""}\n${items.slice(0, 1500).join("\n")}`);
      }
      case "github_read_file": {
        const ref = a.ref ? `?ref=${encodeURIComponent(a.ref)}` : "";
        const r = await gh("GET", `${R}/contents/${enc(String(a.path))}${ref}`);
        if (r.status >= 300 || !r.data?.content) return clip(`error ${r.status}: ${r.data?.message || "not a file"}`);
        const text = Buffer.from(r.data.content, "base64").toString("utf-8");
        const lines = text.split("\n");
        const from = Math.max(1, Number(a.start_line) || 1);
        const to = Math.min(lines.length, Number(a.end_line) || lines.length);
        const body = lines.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join("\n");
        return clip(`${a.path} (${lines.length} lines, sha ${String(r.data.sha).slice(0, 7)})\n${body}`);
      }
      case "github_search_code": {
        const r = await gh("GET", `/search/code?q=${encodeURIComponent(`${a.query} repo:${a.repo}`)}&per_page=30`);
        return clip((r.data?.items || []).map((x: any) => x.path).join("\n") || `no results (${r.status})`);
      }
      case "github_list_branches": {
        const r = await gh("GET", `${R}/branches?per_page=100`);
        return clip(Array.isArray(r.data) ? r.data.map((x: any) => x.name).join("\n") : r.data);
      }
      case "github_create_branch": {
        const from = a.from || (await defaultBranch(gh, a.repo));
        const b = await gh("GET", `${R}/git/ref/heads/${enc(from)}`);
        if (b.status >= 300) return `error: source branch ${from}: ${b.status}`;
        const c = await gh("POST", `${R}/git/refs`, { ref: `refs/heads/${a.branch}`, sha: b.data.object.sha });
        return c.status < 300 ? `created ${a.branch} from ${from}` : clip(`error ${c.status}: ${c.data?.message}`);
      }
      case "github_write_files": {
        const files = (Array.isArray(a.files) ? a.files : []).map((f: any) => ({ path: String(f.path), content: String(f.content ?? "") }));
        if (!files.length) return "error: no files";
        return clip(await writeFiles(gh, a.repo, String(a.branch), String(a.message || "update"), files));
      }
      case "github_delete_files": {
        const paths = (Array.isArray(a.paths) ? a.paths : []).map(String);
        if (!paths.length) return "error: no paths";
        return clip(await writeFiles(gh, a.repo, String(a.branch), String(a.message || "delete"), paths.map((p: string) => ({ path: p, content: null }))));
      }
      case "github_delete_branch": {
        const r = await gh("DELETE", `${R}/git/refs/heads/${enc(String(a.branch))}`);
        return r.status < 300 ? `deleted branch ${a.branch}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_create_pr": {
        const base = a.base || (await defaultBranch(gh, a.repo));
        const r = await gh("POST", `${R}/pulls`, { head: a.head, base, title: a.title, body: a.body || "" });
        return r.status < 300 ? `PR #${r.data.number} ${r.data.html_url}` : clip(`error ${r.status}: ${r.data?.message} ${JSON.stringify(r.data?.errors || "")}`);
      }
      case "github_merge_pr": {
        const r = await gh("PUT", `${R}/pulls/${Number(a.number)}/merge`, { merge_method: ["merge", "squash", "rebase"].includes(a.method) ? a.method : "merge" });
        return clip(r.status < 300 ? `merged: ${r.data?.sha}` : `error ${r.status}: ${r.data?.message}`);
      }
      case "github_list_prs": {
        const r = await gh("GET", `${R}/pulls?state=open&per_page=50`);
        return clip(Array.isArray(r.data) ? r.data.map((x: any) => `#${x.number} ${x.title} (${x.head.ref} → ${x.base.ref})`).join("\n") || "none" : r.data);
      }
      case "github_list_issues": {
        const r = await gh("GET", `${R}/issues?state=open&per_page=50`);
        return clip(Array.isArray(r.data) ? r.data.map((x: any) => `#${x.number}${x.pull_request ? " [PR]" : ""} ${x.title}`).join("\n") || "none" : r.data);
      }
      case "github_create_issue": {
        const r = await gh("POST", `${R}/issues`, { title: a.title, body: a.body || "" });
        return r.status < 300 ? `issue #${r.data.number} ${r.data.html_url}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_comment": {
        const r = await gh("POST", `${R}/issues/${Number(a.number)}/comments`, { body: a.body });
        return r.status < 300 ? `comment ${r.data.html_url}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_ci_status": {
        const ref = encodeURIComponent(String(a.ref));
        const runs = await gh("GET", `${R}/commits/${ref}/check-runs?per_page=50`);
        const st = await gh("GET", `${R}/commits/${ref}/status`);
        const lines = (runs.data?.check_runs || []).map((x: any) => `${x.name}: ${x.status}${x.conclusion ? ` / ${x.conclusion}` : ""}${x.output?.summary ? ` — ${String(x.output.summary).slice(0, 300)}` : ""}`);
        return clip(`combined: ${st.data?.state || "?"}\n${lines.join("\n") || "no check runs yet"}`);
      }
      case "github_run_workflow": {
        const r = await gh("POST", `${R}/actions/workflows/${encodeURIComponent(String(a.workflow))}/dispatches`, { ref: a.ref, inputs: a.inputs || {} });
        return r.status < 300 ? `started ${a.workflow} on ${a.ref}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
    }
    return `error: unknown tool ${name}`;
  } catch (e) {
    return `error: ${(e as Error)?.name || "Error"}: ${String((e as Error)?.message || e).slice(0, 300)}`;
  }
}

export function toolLabel(call: CoderToolCall): string {
  const a = parseArgs(call);
  const bits = [a.repo, a.path, a.branch, a.number ? `#${a.number}` : "", a.url, a.query].filter(Boolean).map(String);
  return `🔧 ${call.function.name}${bits.length ? ` — ${bits.join(" ").slice(0, 160)}` : ""}`;
}
