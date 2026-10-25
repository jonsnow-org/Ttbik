// Sub-agents ("delegate"): the parent run hands up to 3 independent, READ-ONLY investigations to child runs and goes on when their
// reports are in. Each child is an ordinary coder run in its own state slot ("a:<parentRunId>:<i>") on OUR Studio model, so it gets the
// same legs, hand-offs, heartbeats and orphan recovery as any run. A child is quiet (nothing reaches the chat), may use only the
// read-only tools below (enforced on the server, not just in the prompt), has a small step budget, and leaves its report in its own
// state row (`agentResult`). The parent only polls those rows, so there is no shared write and no race between finishing children.
// CODER_AGENTS=off removes the tool.

import { reportsHardChars } from "@/lib/coderContext";

export const AGENT_MAX = 5;          // agents one run can start at once
export const SUB_AGENT_MAX = 2;      // sub-agents ONE "worker" agent can start (read-only helpers, one level only)
export const AGENT_MAX_DEPTH = 2;    // run (0) → agents (1) → sub-agents (2); sub-agents cannot start anything
export const AGENT_MAX_STEPS = 6;
export const TESTER_MAX_STEPS = 10;
export const WORKER_MAX_STEPS = 12;
export type AgentRole = "reader" | "tester" | "sham" | "worker";   // worker = full tools, the parent's own permission settings, asks the user like the parent does; sham = the owner's own model, raw answer, owner only
export const agentMaxSteps = (role?: AgentRole): number => (role === "tester" ? TESTER_MAX_STEPS : role === "worker" ? WORKER_MAX_STEPS : role === "sham" ? 1 : AGENT_MAX_STEPS);
export const AGENT_TIMEOUT_MS = 25 * 60000;
/** The model's context is a hard physical limit (32,768 tokens). Reports are never cut; only if ALL of them together exceed this many characters (default 60,000, about 20k tokens) does the system step in (see fitReports). */
export const agentReportsHard = (): number => reportsHardChars();

export const agentsEnabled = (): boolean => (process.env.CODER_AGENTS || "").toLowerCase() !== "off";

/** The only tools a sub-agent may call. Anything else is refused by the runner. */
export const AGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "github_repo_info", "github_repo_scan", "github_read_files", "github_ci_logs", "github_pr_info", "github_commits", "github_compare", "github_list_files", "github_read_file", "github_search_code", "github_search_repos", "github_list_branches", "github_list_prs", "github_list_issues",
  "web_search", "fetch_page", "memory_search",
]);

/** What the "tester" role adds: run the project's own tests in its own disposable VM. Never write files into the repo, never push. */
export const TESTER_TOOL_NAMES: ReadonlySet<string> = new Set(["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_read_file", "sandbox_search"]);
/** A worker may use every tool the parent has (each consequential call still goes through the user's permission settings and asks), except asking the user a free question, and starting agents at the deepest level. */
export const agentToolAllowed = (name: string, role?: AgentRole, depth = 1): boolean => {
  if (role === "sham") return false;
  if (role === "worker") return name !== "ask_user" && (name !== "delegate" || depth < AGENT_MAX_DEPTH);
  return AGENT_TOOL_NAMES.has(name) || (role === "tester" && TESTER_TOOL_NAMES.has(name));
};
export const agentSlot = (runId: string, i: number): string => `a:${runId}:${i}`;
export const isAgentSlot = (slot: string): boolean => slot.startsWith("a:");


/**
 * Preset jobs for the helpers an agent starts (depth 2). The agent names a job and gives ONE argument; the server writes the instruction from
 * the template, so a small model gets a precise, proven recipe and cannot widen the helper's tools by what it writes. All are read-only;
 * `runner` is the only one with a VM (it can clone and run commands, never write to GitHub). An unknown job falls back to a free read-only task.
 */
export type HelperJob = { title: string; role: AgentRole; hint: string; make: (arg: string) => string };
const NEVER_INVENT = "Report only what a tool result showed you; never name a repository, file, version or page you did not see. If nothing relevant exists, say so plainly.";
export const HELPERS: Record<string, HelperJob> = {
  repo_scout: { title: "باحث مستودعات", role: "reader", hint: "keywords", make: (a) => `Find real GitHub repositories about: ${a}. Call github_search_repos twice with two different short queries (topic words only, never the word "github"; add language:/stars: qualifiers if useful), then read the README of the best 3 with github_read_file. For each: owner/name, what it does, and how it handles the topic. ${NEVER_INVENT}` },
  repo_reader: { title: "قارئ مستودع", role: "reader", hint: "owner/name [focus]", make: (a) => `Study the repository ${a}. Read its README, list its files (top level, then the main source folder), and read the 2-3 files most relevant to the focus (or the entry points). Report the architecture, the key files with exact paths, how it is run, and what is relevant to the focus. ${NEVER_INVENT}` },
  code_finder: { title: "باحث كود", role: "reader", hint: "owner/name | symbol or phrase", make: (a) => `Locate in code: ${a} (format "owner/name | what to find"). Use github_search_code, read the matching files around the hits, and report exact file paths, line numbers, a short quote of each hit and what the code does. ${NEVER_INVENT}` },
  web_researcher: { title: "باحث ويب", role: "reader", hint: "keywords", make: (a) => `Research on the web: ${a}. Call web_search with two different focused queries, read the 2 best pages with fetch_page, and report the facts with the URL of each. Prefer documentation and technical articles. ${NEVER_INVENT}` },
  page_reader: { title: "قارئ صفحة", role: "reader", hint: "url [question]", make: (a) => `Read this page and extract what matters (format "url [question]"): ${a}. Use fetch_page; report the key points that answer the question, with short quotes. ${NEVER_INVENT}` },
  verifier: { title: "متحقق", role: "reader", hint: "claim | optional source", make: (a) => `Verify this claim against real sources (format "claim | optional source or repo"): ${a}. Search / read what is needed, then give a verdict: CONFIRMED, NOT CONFIRMED or NOT FOUND, with the evidence and where you saw it. ${NEVER_INVENT}` },
  issue_digest: { title: "ملخّص القضايا", role: "reader", hint: "owner/name", make: (a) => `Digest the open work of ${a}: list open pull requests and open issues, group them by theme, and report the 5 most important with number, title and one line each, plus anything that looks stuck or conflicting. ${NEVER_INVENT}` },
  runner: { title: "منفّذ أوامر", role: "tester", hint: "owner/name | commands", make: (a) => `Run commands in your private VM (format "owner/name | commands"): ${a}. sandbox_clone the repository, install what the commands need, run them (sandbox_wait for long ones) and report the exact commands, their key output lines and PASS/FAIL. You cannot write to GitHub. ${NEVER_INVENT}` },
};
export const HELPER_IDS = Object.keys(HELPERS);

export type AgentTask = { title: string; task: string; role: AgentRole };

/** Accepts {tasks:[{title,task}|string]} or a single {task}. At most AGENT_MAX, empty ones dropped. */
export function normalizeTasks(a: Record<string, unknown>, owner = false, depth = 0): AgentTask[] {
  const sub = depth >= 1;          // started by an agent: read-only helpers only, fewer of them
  const raw: unknown[] = Array.isArray(a.tasks) ? a.tasks : a.task ? [a] : [];
  const out: AgentTask[] = [];
  let testers = 0;
  for (const x of raw) {
    const o = (typeof x === "string" ? { task: x } : x) as Record<string, unknown> | null;
    let task = String(o?.task ?? o?.prompt ?? o?.instruction ?? "").trim().slice(0, 2000);
    const preset = sub ? HELPERS[String(o?.helper || "").toLowerCase()] : undefined;       // a helper's job: the server writes the instruction from the template
    if (preset) {
      const arg = String(o?.arg ?? o?.task ?? "").trim().slice(0, 600);
      if (!arg) continue;
      if (preset.role === "tester" && testers >= 1) continue;      // one VM per call
      task = preset.make(arg);
    }
    if (!task) continue;
    const want = String(o?.role || "").toLowerCase();
    const role: AgentRole = preset ? preset.role : sub ? "reader" : want === "worker" ? "worker" : want === "tester" && testers < 1 ? "tester" : want === "sham" && owner ? "sham" : "reader";   // one tester per call (its VM is the costly part); Sham is the owner's only; helpers of an agent only read
    if (role === "tester") testers++;
    const title = preset ? `${preset.title}: ${String(o?.arg ?? o?.task ?? "")}`.trim().replace(/\s+/g, " ").slice(0, 80) : String(o?.title || task).trim().replace(/\s+/g, " ").slice(0, 80);
    out.push({ title: role === "sham" ? `Sham: ${title}`.slice(0, 80) : title, task, role });
    if (out.length >= (sub ? SUB_AGENT_MAX : AGENT_MAX)) break;
  }
  return out;
}

/** Every agent's report has the same shape and covers ONLY its own job; the parent (or the worker that started a helper) is the one who combines reports for the user. */
export const REPORT_RULES = (lang: "ar" | "en"): string => [
  "REPORT RULES (strict). Your report is about YOUR job only, in your own words about what YOU did. Never answer the user's overall request, never write a final answer for the user, never describe other agents or the parent's wider task. Reports from helpers you started are inputs: use them, do not paste them.",
  `Write exactly these four lines (the labels stay in English, the content is in ${lang === "ar" ? "Arabic" : "English"}). Use as much room as the job really needs: a small job gets a short report, a big job gets a full one with every file, name and number. Never pad, never cut a finding to be short:`,
  "JOB: <the job you were given, one short line>",
  "DONE: <what you actually did or found: names, paths, versions, sources; only what a tool showed you>",
  "NOT DONE: <what you could not do, was declined or denied, or did not find; write nothing if all was done>",
  "OUTPUT: <branches / pull requests / files / commands you produced; write none if none>",
].join("\n");

export const AGENT_SYSTEM = (now: string, lang: "ar" | "en", role: AgentRole = "reader", depth = 1) => role === "worker" ? [
  "You are a worker agent of Nova AI. A parent agent gave you ONE job; do it completely with your tools (read, search, edit files, branches, pull requests, tests in your VM, connected services).",
  "You have the SAME permissions and the SAME settings as the user's main assistant: anything consequential (delete, merge, push to the main branch, settings, releases, connected-service writes) is asked of the USER on their phone, who answers ✅ or ❌. If a step is declined or denied, do not retry it: continue without it and say so in your report.",
  `You may start at most ${SUB_AGENT_MAX} read-only helper agents with the delegate tool for parts of your job${depth >= AGENT_MAX_DEPTH ? " (not available to you: you are already a helper level)" : ""}. Give each helper a job name and ONE argument (helper + arg), the server writes the recipe: ${Object.entries(HELPERS).map(([id, h]) => `${id}(${h.hint})`).join(", ")}. runner is the only one with a VM (one per call). You cannot ask the user free questions.`,
  "Tools come in groups: call load_tools with the group you need (github, computer, web, memory, schedule, connectors); its tools are there from the next step.",
  `You have at most ${WORKER_MAX_STEPS} steps; on your last step stop calling tools and write the report.`,
  `Current date (UTC): ${now}. ${lang === "ar" ? "Write the report in Arabic; code, paths and identifiers stay in English." : "Write the report in English."}`,
  REPORT_RULES(lang),
].join("\n") : role === "tester" ? [
  "You are a test-runner sub-agent of Nova AI. A parent agent gave you ONE job: run the project's own checks in YOUR private, disposable Linux VM and report what happened.",
  "Typical steps: sandbox_clone the repository, install dependencies (npm ci / pip install -r …), run the test / lint / build command the task names (or the project's own: look at package.json scripts, Makefile, CI workflow files), read the output.",
  "You cannot change the user's repository: no pushing, no pull requests, no GitHub writes (the VM is thrown away when you finish). You cannot ask the user or start other agents; commands that need a confirmation are refused.",
  `You have at most ${TESTER_MAX_STEPS} steps; long commands: use sandbox_wait instead of repeating them. On your last step stop calling tools and write the report.`,
  "For a test run, DONE holds the exact command(s), PASS or FAIL, the failing test names and key error lines; never claim a pass you did not see in the output.",
  `Current date (UTC): ${now}. ${lang === "ar" ? "Write the report in Arabic; commands, paths and test names stay in English." : "Write the report in English."}`,
  REPORT_RULES(lang),
].join("\n") : [
  "You are a read-only research sub-agent of Nova AI. A parent agent gave you ONE investigation; nobody else will answer questions for you.",
  "Use your tools (read files, search code, list issues/PRs, search the web) to find the facts. You cannot write, run commands, ask the user or start other agents.",
  `You have at most ${AGENT_MAX_STEPS} steps. Never repeat a call. When you have enough (or on your last step), STOP calling tools and write the final report.`,
  `Current date (UTC): ${now}. ${lang === "ar" ? "Write the report in Arabic; code, paths and identifiers stay in English." : "Write the report in English."}`,
  REPORT_RULES(lang),
].join("\n");

export type AgentResult = { status: string; text: string; at?: number };

export type ParsedReport = { job: string; done: string; notDone: string; output: string };
/** The four labelled lines of an agent report, or null when it does not follow the format (a raw answer, an empty or cut-off report). */
export function parseAgentReport(text: string): ParsedReport | null {
  const r: Record<string, string> = {};
  let cur = "";
  for (const line of String(text || "").split("\n")) {
    const m = /^\s*(JOB|DONE|NOT DONE|OUTPUT)\s*[:：]\s*(.*)$/i.exec(line);
    if (m) { cur = m[1].toUpperCase(); r[cur] = m[2].trim(); }
    else if (cur) r[cur] = `${r[cur]}\n${line}`.trim();
  }
  if (!r.DONE && !r["NOT DONE"] && !r.JOB) return null;
  return { job: r.JOB || "", done: r.DONE || "", notDone: r["NOT DONE"] || "", output: r.OUTPUT || "" };
}
const none = (x: string) => !x || /^(none|nothing|لا شيء|لا يوجد|بلا|-)\.?$/i.test(x.trim());

/**
 * The tool message the parent receives: one block per agent, in order, each in the same shape. The harness organises them (no model call: a
 * "collector" model step would be slow and would not know the user's request); the parent writes the one answer for the user.
 * NOTHING is cut here: every report arrives exactly as its agent wrote it.
 */
export function composeResults(items: { title: string; result?: AgentResult }[]): string {
  const head = `Reports of ${items.length} agent${items.length === 1 ? "" : "s"}. Each covers ONLY that agent's own job. The user's request is yours: combine them, resolve conflicts between them, say plainly what was NOT DONE, and never present an agent's NOT DONE as done.`;
  const blocks = items.map((it, i) => {
    const r = it.result;
    const title = `## Agent ${i + 1}: ${it.title}`;
    if (!r) return `${title}\n[status: no report — it did not finish in time]`;
    const status = `[status: ${r.status}]`;
    const p = parseAgentReport(r.text);
    if (!p) return `${title}\n${status} (not in the report format)\n${r.text}`;
    return [title, status, `JOB: ${p.job || it.title}`, `NOT DONE: ${none(p.notDone) ? "nothing" : p.notDone}`, `OUTPUT: ${none(p.output) ? "none" : p.output}`, `DONE: ${p.done || "(empty)"}`].join("\n");
  });
  return `${head}\n\n${blocks.join("\n\n")}`;
}

/**
 * The one situation in which the system decides something about report size: all reports together would not fit the model's context at all
 * (the call would fail). Then the longest report is not cut but CONDENSED by the model, asked to keep every name, path, number and the NOT DONE
 * part, and marked as condensed; repeated on the next longest until the total fits. A failed condensing leaves the report as it was.
 */
export async function fitReports(items: { title: string; result?: AgentResult }[], condense: (text: string) => Promise<string>, hard = agentReportsHard()): Promise<{ title: string; result?: AgentResult }[]> {
  const out = items.map((it) => ({ ...it, result: it.result ? { ...it.result } : undefined }));
  const total = () => out.reduce((n, it) => n + (it.result?.text.length || 0), 0);
  const tried = new Set<number>();
  while (total() > hard) {
    let k = -1;
    out.forEach((it, i) => { if (!tried.has(i) && it.result && (k < 0 || it.result.text.length > out[k].result!.text.length)) k = i; });
    if (k < 0) break;
    tried.add(k);
    const text = out[k].result!.text;
    const short = (await condense(text).catch(() => "")).trim();
    if (short && short.length < text.length) out[k].result!.text = `${short}\n[condensed by the system because all the reports together were too long for the model; the full text is in the agent's own task log]`;
  }
  return out;
}
