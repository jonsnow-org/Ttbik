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
  tool("github_update_ref", "Move a branch to a commit (force = rewrite history).", obj({ repo: REPO, branch: s("branch"), sha: s("commit sha"), force: { type: "boolean" } }, ["repo", "branch", "sha"])),
  tool("github_delete_repo", "Delete a repository.", obj({ repo: REPO }, ["repo"])),
  tool("github_create_release", "Create a release (draft: true = not published).", obj({ repo: REPO, tag: s("tag"), name: s("title"), body: s("notes"), target: s("branch / sha"), draft: { type: "boolean" }, prerelease: { type: "boolean" } }, ["repo", "tag"])),
  tool("github_delete_release", "Delete a release by id.", obj({ repo: REPO, id: n("release id") }, ["repo", "id"])),
  tool("github_update_repo", "Change repository settings (description, visibility, default_branch, features…).", obj({ repo: REPO, settings: { type: "object" } }, ["repo", "settings"])),
  tool("github_add_collaborator", "Invite a collaborator.", obj({ repo: REPO, user: s("GitHub login"), permission: s("pull | triage | push | maintain | admin") }, ["repo", "user"])),
  tool("github_remove_collaborator", "Remove a collaborator.", obj({ repo: REPO, user: s("GitHub login") }, ["repo", "user"])),
  tool("github_api", "Any other GitHub REST call (path like /repos/o/r/...). Use the specific tools when one exists.", obj({ method: s("GET | POST | PATCH | PUT | DELETE"), path: s("REST path starting with /"), body: { type: "object" } }, ["method", "path"])),
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
    "Consequential actions (deleting, pushing/merging into main/default branches, and for linked users also settings, secrets, collaborators, releases, deploy workflows) wait for the user's confirmation button: just call the tool; the user decides.",
    "If the harness tells you that you are repeating yourself, stop that approach: re-read the relevant files, write a new plan, and try a different strategy.",
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

// ---------------------------------------------------------------- permissions (two tiers, like an agent's permission modes)
// Every call is classified into the consequential things it would do; the tier decides which of those wait for a ✅/❌ tap.
//   user  : asks for every risk below (their own repos, their own token)
//   owner : asks only for deletes and for pushes/merges into main/default branches (incl. a workflow that writes to them) — owner's standing rule
// Everything not listed (thinking, planning, reading, searching, CI checks, test workflows, branches, commits/pushes to feature branches, PRs) runs.
export type Risk =
  | "delete" | "push_default" | "merge_default" | "push_protected" | "merge_protected" | "force_push"
  | "workflow_deploy" | "workflow_writes_default" | "settings" | "secrets" | "collaborators" | "release_publish";
export const OWNER_CONFIRMS: ReadonlySet<Risk> = new Set<Risk>(["delete", "push_default", "merge_default", "workflow_writes_default"]);
export const RISK_LABEL: Record<Risk, string> = {
  delete: "حذف",
  push_default: "دفع إلى الفرع الأساسي",
  merge_default: "دمج في الفرع الأساسي",
  push_protected: "دفع إلى فرع محمي",
  merge_protected: "دمج في فرع محمي",
  force_push: "دفع قسري / إعادة كتابة التاريخ",
  workflow_deploy: "تشغيل سير عمل ينشر أو يطلق",
  workflow_writes_default: "تشغيل سير عمل يكتب على الفرع الأساسي",
  settings: "تغيير إعدادات المستودع",
  secrets: "تغيير الأسرار",
  collaborators: "تغيير المتعاونين والصلاحيات",
  release_publish: "نشر إصدار",
};

export function confirmRisks(tier: "owner" | "user", risks: Risk[]): Risk[] {
  return tier === "owner" ? risks.filter((r) => OWNER_CONFIRMS.has(r)) : risks;
}

type BranchFacts = { main: boolean; protected: boolean };
async function branchFacts(gh: Gh | null, repo: string, branch: string): Promise<BranchFacts> {
  if (!branch || MAIN_NAMES.has(branch.toLowerCase())) return { main: true, protected: true };
  if (!gh || !repoOk(repo)) return { main: false, protected: false };
  const [def, b] = await Promise.all([defaultBranch(gh, repo).catch(() => ""), gh("GET", `/repos/${repo}/branches/${enc(branch)}`).catch(() => null)]);
  return { main: branch === def, protected: Boolean(b?.data?.protected) };
}

const DEPLOY_RX = /\b(deploy|publish|release|vercel|netlify|gh-pages|github-pages|pages-artifact|npm publish|yarn publish|pnpm publish|docker push|twine upload|cargo publish|gh release|modelscope|huggingface-cli upload|surge|firebase deploy|fly deploy|wrangler)\b/i;
const WRITE_RX = /(git push|contents:\s*write|git-auto-commit-action|github-push-action|create-or-update-file|git commit)/i;

/** What a workflow file does, from its own text: test-only workflows run without asking. Unreadable = treated as deploying. */
export function classifyWorkflow(fileName: string, text: string | null): { deploys: boolean; writes: boolean } {
  if (text == null) return { deploys: true, writes: false };
  return { deploys: DEPLOY_RX.test(text) || /deploy|publish|release/i.test(fileName), writes: WRITE_RX.test(text) };
}

async function workflowRisks(gh: Gh | null, repo: string, workflow: string, ref: string): Promise<Risk[]> {
  let text: string | null = null;
  if (gh && repoOk(repo)) {
    const path = workflow.includes("/") ? workflow : `.github/workflows/${workflow}`;
    const r = await gh("GET", `/repos/${repo}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`).catch(() => null);
    if (r && r.status < 300 && r.data?.content) text = Buffer.from(r.data.content, "base64").toString("utf-8");
  }
  const w = classifyWorkflow(workflow, text);
  const out: Risk[] = [];
  if (w.deploys) out.push("workflow_deploy");
  if (w.writes) out.push("workflow_writes_default");    // a workflow that commits/pushes is treated as writing to the default branch
  return out;
}

async function pushRisks(gh: Gh | null, repo: string, branch: string, force = false): Promise<Risk[]> {
  const f = await branchFacts(gh, repo, branch);
  const out: Risk[] = [];
  if (f.main) out.push("push_default");
  else if (f.protected) out.push("push_protected");
  if (force) out.push("force_push");
  return out;
}

async function mergeRisks(gh: Gh | null, repo: string, base: string): Promise<Risk[]> {
  if (!base) return ["merge_default"];
  const f = await branchFacts(gh, repo, base);
  return f.main ? ["merge_default"] : f.protected ? ["merge_protected"] : [];
}

/** The consequential effects of one call (empty = runs without asking for every tier). */
export async function classifyCall(call: CoderToolCall, gh: Gh | null): Promise<{ risks: Risk[]; summary: string }> {
  const a = parseArgs(call);
  const name = call.function.name;
  const where = `${a.repo || "?"}${a.branch ? ` @ ${a.branch}` : ""}`;
  const list = (xs: unknown) => (Array.isArray(xs) ? xs.slice(0, 30).map((x: any) => String(x?.path ?? x)).join("\n") : "");
  switch (name) {
    case "github_delete_files": return { risks: ["delete", ...(await pushRisks(gh, a.repo, String(a.branch || "")))], summary: `${where}\n${list(a.paths)}` };
    case "github_delete_branch": return { risks: ["delete"], summary: where };
    case "github_delete_repo": return { risks: ["delete"], summary: String(a.repo) };
    case "github_delete_release": return { risks: ["delete"], summary: `${a.repo} release ${a.id}` };
    case "github_remove_collaborator": return { risks: ["delete", "collaborators"], summary: `${a.repo} − ${a.user}` };
    case "github_write_files": return { risks: await pushRisks(gh, a.repo, String(a.branch || "")), summary: `${where}\n${a.message || ""}\n${list(a.files)}` };
    case "github_update_ref": return { risks: await pushRisks(gh, a.repo, String(a.branch || ""), Boolean(a.force)), summary: `${where} → ${String(a.sha || "").slice(0, 10)}${a.force ? " (force)" : ""}` };
    case "github_merge_pr": {
      let base = "";
      if (gh && repoOk(a.repo)) base = String((await gh("GET", `/repos/${a.repo}/pulls/${Number(a.number)}`).catch(() => null))?.data?.base?.ref || "");
      return { risks: await mergeRisks(gh, a.repo, base), summary: `${a.repo} PR #${a.number}${base ? ` → ${base}` : ""}` };
    }
    case "github_run_workflow": return { risks: await workflowRisks(gh, a.repo, String(a.workflow || ""), String(a.ref || "")), summary: `${a.repo} ${a.workflow} @ ${a.ref}` };
    case "github_update_repo": return { risks: ["settings"], summary: `${a.repo}\n${JSON.stringify(a.settings || {}).slice(0, 500)}` };
    case "github_add_collaborator": return { risks: ["collaborators"], summary: `${a.repo} + ${a.user} (${a.permission || "push"})` };
    case "github_create_release": return { risks: a.draft === true ? [] : ["release_publish"], summary: `${a.repo} ${a.tag}${a.draft ? " (draft)" : ""}` };
    case "github_api": return classifyApi(String(a.method || "GET").toUpperCase(), String(a.path || ""), a.body || {}, gh);
  }
  return { risks: [], summary: where };
}

async function classifyApi(method: string, path: string, body: any, gh: Gh | null): Promise<{ risks: Risk[]; summary: string }> {
  const summary = `${method} ${path}`;
  if (method === "GET" || method === "HEAD") return { risks: [], summary };
  const m = path.match(/^\/repos\/([\w.-]+\/[\w.-]+)(\/.*)?$/);
  const repo = m?.[1] || "";
  const rest = m?.[2] || "";
  const risks = new Set<Risk>();
  if (method === "DELETE") risks.add("delete");
  if (/\/(actions|dependabot|codespaces)\/secrets|\/environments\/[^/]+\/secrets|\/actions\/variables/.test(rest)) risks.add("secrets");
  if (/\/(collaborators|invitations|teams)\b/.test(rest) || /^\/orgs\/[^/]+\/(members|memberships|teams)/.test(path)) risks.add("collaborators");
  if ((repo && rest === "" && method === "PATCH") || /\/(hooks|keys|rulesets|pages|transfer|topics|vulnerability-alerts|automated-security-fixes)\b|\/branches\/[^/]+\/protection|\/actions\/permissions/.test(rest)) risks.add("settings");
  if (/\/releases(\/\d+)?$/.test(rest) && (method === "POST" || method === "PATCH") && body?.draft !== true) risks.add("release_publish");
  const ref = rest.match(/^\/git\/refs\/heads\/(.+)$/);
  if (ref) (await pushRisks(gh, repo, decodeURIComponent(ref[1]), Boolean(body?.force))).forEach((r) => risks.add(r));
  if (rest === "/git/refs" && typeof body?.ref === "string") (await pushRisks(gh, repo, body.ref.replace(/^refs\/heads\//, ""))).forEach((r) => { if (r !== "push_protected") risks.add(r); });
  if (/^\/contents\//.test(rest) && method === "PUT") (await pushRisks(gh, repo, String(body?.branch || ""))).forEach((r) => risks.add(r));
  if (/^\/pulls\/\d+\/merge$/.test(rest)) {
    const n = rest.split("/")[2];
    const base = gh ? String((await gh("GET", `/repos/${repo}/pulls/${n}`).catch(() => null))?.data?.base?.ref || "") : "";
    (await mergeRisks(gh, repo, base)).forEach((r) => risks.add(r));
  }
  if (rest === "/merges") (await mergeRisks(gh, repo, String(body?.base || ""))).forEach((r) => risks.add(r));
  const wf = rest.match(/^\/actions\/workflows\/([^/]+)\/dispatches$/);
  if (wf) (await workflowRisks(gh, repo, decodeURIComponent(wf[1]), String(body?.ref || ""))).forEach((r) => risks.add(r));
  if (rest === "/dispatches") risks.add("workflow_deploy");
  return { risks: [...risks], summary };
}

export type Guard = { confirm: false } | { confirm: true; reason: string; summary: string; risks: Risk[] };

export async function guardCall(call: CoderToolCall, gh: Gh | null, tier: "owner" | "user" = "user"): Promise<Guard> {
  const c = await classifyCall(call, gh);
  const ask = confirmRisks(tier, c.risks);
  return ask.length ? { confirm: true, reason: ask.map((r) => RISK_LABEL[r]).join(" + "), summary: c.summary, risks: ask } : { confirm: false };
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
    if (name === "github_api") {
      const path = String(a.path || "");
      if (!path.startsWith("/")) return "error: path must start with /";
      const r = await gh(String(a.method || "GET").toUpperCase(), path, a.body && Object.keys(a.body).length ? a.body : undefined);
      return clip(`HTTP ${r.status}\n${typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 1)}`);
    }
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
      case "github_update_ref": {
        const r = await gh("PATCH", `${R}/git/refs/heads/${enc(String(a.branch))}`, { sha: a.sha, force: Boolean(a.force) });
        return r.status < 300 ? `${a.branch} → ${a.sha}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_delete_repo": {
        const r = await gh("DELETE", R);
        return r.status < 300 ? `deleted ${a.repo}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_create_release": {
        const r = await gh("POST", `${R}/releases`, { tag_name: a.tag, name: a.name || a.tag, body: a.body || "", target_commitish: a.target || undefined, draft: Boolean(a.draft), prerelease: Boolean(a.prerelease) });
        return r.status < 300 ? `release ${r.data.id} ${r.data.html_url}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_delete_release": {
        const r = await gh("DELETE", `${R}/releases/${Number(a.id)}`);
        return r.status < 300 ? `deleted release ${a.id}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_update_repo": {
        const r = await gh("PATCH", R, a.settings || {});
        return r.status < 300 ? "settings updated" : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_add_collaborator": {
        const r = await gh("PUT", `${R}/collaborators/${encodeURIComponent(String(a.user))}`, { permission: a.permission || "push" });
        return r.status < 300 ? `invited ${a.user}` : clip(`error ${r.status}: ${r.data?.message}`);
      }
      case "github_remove_collaborator": {
        const r = await gh("DELETE", `${R}/collaborators/${encodeURIComponent(String(a.user))}`);
        return r.status < 300 ? `removed ${a.user}` : clip(`error ${r.status}: ${r.data?.message}`);
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
