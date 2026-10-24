// Sub-agents ("delegate"): the parent run hands up to 3 independent, READ-ONLY investigations to child runs and goes on when their
// reports are in. Each child is an ordinary coder run in its own state slot ("a:<parentRunId>:<i>") on OUR Studio model, so it gets the
// same legs, hand-offs, heartbeats and orphan recovery as any run. A child is quiet (nothing reaches the chat), may use only the
// read-only tools below (enforced on the server, not just in the prompt), has a small step budget, and leaves its report in its own
// state row (`agentResult`). The parent only polls those rows, so there is no shared write and no race between finishing children.
// CODER_AGENTS=off removes the tool.

export const AGENT_MAX = 5;          // agents one run can start at once
export const SUB_AGENT_MAX = 2;      // sub-agents ONE "worker" agent can start (read-only helpers, one level only)
export const AGENT_MAX_DEPTH = 2;    // run (0) → agents (1) → sub-agents (2); sub-agents cannot start anything
export const AGENT_MAX_STEPS = 6;
export const TESTER_MAX_STEPS = 10;
export const WORKER_MAX_STEPS = 12;
export type AgentRole = "reader" | "tester" | "sham" | "worker";   // worker = full tools, the parent's own permission settings, asks the user like the parent does; sham = the owner's own model, raw answer, owner only
export const agentMaxSteps = (role?: AgentRole): number => (role === "tester" ? TESTER_MAX_STEPS : role === "worker" ? WORKER_MAX_STEPS : role === "sham" ? 1 : AGENT_MAX_STEPS);
export const AGENT_TIMEOUT_MS = 25 * 60000;
export const AGENT_REPORT_MAX = 4000;

export const agentsEnabled = (): boolean => (process.env.CODER_AGENTS || "").toLowerCase() !== "off";

/** The only tools a sub-agent may call. Anything else is refused by the runner. */
export const AGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "github_repo_info", "github_list_files", "github_read_file", "github_search_code", "github_search_repos", "github_list_branches", "github_list_prs", "github_list_issues",
  "web_search", "fetch_page", "memory_search",
]);

/** What the "tester" role adds: run the project's own tests in its own disposable VM. Never write files into the repo, never push. */
export const TESTER_TOOL_NAMES: ReadonlySet<string> = new Set(["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_read_file"]);
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

export const AGENT_SYSTEM = (now: string, lang: "ar" | "en", role: AgentRole = "reader", depth = 1) => role === "worker" ? [
  "You are a worker agent of Nova AI. A parent agent gave you ONE job; do it completely with your tools (read, search, edit files, branches, pull requests, tests in your VM, connected services).",
  "You have the SAME permissions and the SAME settings as the user's main assistant: anything consequential (delete, merge, push to the main branch, settings, releases, connected-service writes) is asked of the USER on their phone, who answers ✅ or ❌. If a step is declined or denied, do not retry it: continue without it and say so in your report.",
  `You may start at most ${SUB_AGENT_MAX} read-only helper agents with the delegate tool for parts of your job${depth >= AGENT_MAX_DEPTH ? " (not available to you: you are already a helper level)" : ""}. Give each helper a job name and ONE argument (helper + arg), the server writes the recipe: ${Object.entries(HELPERS).map(([id, h]) => `${id}(${h.hint})`).join(", ")}. runner is the only one with a VM (one per call). You cannot ask the user free questions.`,
  "Tools come in groups: call load_tools with the group you need (github, computer, web, memory, schedule, connectors); its tools are there from the next step.",
  `You have at most ${WORKER_MAX_STEPS} steps; on your last step stop calling tools and write the report.`,
  "REPORT: plain text, at most 350 words: what you did (exact repo / branch / PR / file names), what the user approved or declined, what remains. Never claim something you did not see succeed.",
  `Current date (UTC): ${now}. ${lang === "ar" ? "Write the report in Arabic; code, paths and identifiers stay in English." : "Write the report in English."}`,
].join("\n") : role === "tester" ? [
  "You are a test-runner sub-agent of Nova AI. A parent agent gave you ONE job: run the project's own checks in YOUR private, disposable Linux VM and report what happened.",
  "Typical steps: sandbox_clone the repository, install dependencies (npm ci / pip install -r …), run the test / lint / build command the task names (or the project's own: look at package.json scripts, Makefile, CI workflow files), read the output.",
  "You cannot change the user's repository: no pushing, no pull requests, no GitHub writes (the VM is thrown away when you finish). You cannot ask the user or start other agents; commands that need a confirmation are refused.",
  `You have at most ${TESTER_MAX_STEPS} steps; long commands: use sandbox_wait instead of repeating them. On your last step stop calling tools and write the report.`,
  "REPORT: plain text, at most 350 words: the exact command(s) you ran, PASS or FAIL, the names of failing tests and the key error lines, and what you could not run and why. Never claim a pass you did not see in the output.",
  `Current date (UTC): ${now}. ${lang === "ar" ? "Write the report in Arabic; commands, paths and test names stay in English." : "Write the report in English."}`,
].join("\n") : [
  "You are a read-only research sub-agent of Nova AI. A parent agent gave you ONE investigation; nobody else will answer questions for you.",
  "Use your tools (read files, search code, list issues/PRs, search the web) to find the facts. You cannot write, run commands, ask the user or start other agents.",
  `You have at most ${AGENT_MAX_STEPS} steps. Never repeat a call. When you have enough (or on your last step), STOP calling tools and write the final report.`,
  "REPORT: plain text, at most 350 words: the facts you found (file paths and line numbers, versions, names), what you could not find, and nothing invented. No preamble.",
  `Current date (UTC): ${now}. ${lang === "ar" ? "Write the report in Arabic; code, paths and identifiers stay in English." : "Write the report in English."}`,
].join("\n");

export type AgentResult = { status: string; text: string; at?: number };

/** The tool message the parent receives: one block per agent, in order. */
export function composeResults(items: { title: string; result?: AgentResult }[]): string {
  const per = Math.floor(AGENT_REPORT_MAX * 1.5 / Math.max(1, items.length));
  return items
    .map((it, i) => {
      const r = it.result;
      const head = `## Agent ${i + 1}: ${it.title}`;
      if (!r) return `${head}\n(did not finish in time; no report)`;
      return `${head}\n${r.status === "done" ? "" : `(ended: ${r.status}) `}${r.text.slice(0, per)}`;
    })
    .join("\n\n");
}
