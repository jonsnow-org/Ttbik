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

export type AgentTask = { title: string; task: string; role: AgentRole };

/** Accepts {tasks:[{title,task}|string]} or a single {task}. At most AGENT_MAX, empty ones dropped. */
export function normalizeTasks(a: Record<string, unknown>, owner = false, depth = 0): AgentTask[] {
  const sub = depth >= 1;          // started by an agent: read-only helpers only, fewer of them
  const raw: unknown[] = Array.isArray(a.tasks) ? a.tasks : a.task ? [a] : [];
  const out: AgentTask[] = [];
  let testers = 0;
  for (const x of raw) {
    const o = (typeof x === "string" ? { task: x } : x) as Record<string, unknown> | null;
    const task = String(o?.task ?? o?.prompt ?? o?.instruction ?? "").trim().slice(0, 2000);
    if (!task) continue;
    const want = String(o?.role || "").toLowerCase();
    const role: AgentRole = sub ? "reader" : want === "worker" ? "worker" : want === "tester" && testers < 1 ? "tester" : want === "sham" && owner ? "sham" : "reader";   // one tester per call (its VM is the costly part); Sham is the owner's only; helpers of an agent only read
    if (role === "tester") testers++;
    const title = String(o?.title || task).trim().replace(/\s+/g, " ").slice(0, 80);
    out.push({ title: role === "sham" ? `Sham: ${title}`.slice(0, 80) : title, task, role });
    if (out.length >= (sub ? SUB_AGENT_MAX : AGENT_MAX)) break;
  }
  return out;
}

export const AGENT_SYSTEM = (now: string, lang: "ar" | "en", role: AgentRole = "reader", depth = 1) => role === "worker" ? [
  "You are a worker agent of Nova AI. A parent agent gave you ONE job; do it completely with your tools (read, search, edit files, branches, pull requests, tests in your VM, connected services).",
  "You have the SAME permissions and the SAME settings as the user's main assistant: anything consequential (delete, merge, push to the main branch, settings, releases, connected-service writes) is asked of the USER on their phone, who answers ✅ or ❌. If a step is declined or denied, do not retry it: continue without it and say so in your report.",
  `You may start at most ${SUB_AGENT_MAX} read-only helper agents with the delegate tool for parts of your job${depth >= AGENT_MAX_DEPTH ? " (not available to you: you are already a helper level)" : ""}. You cannot ask the user free questions.`,
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
