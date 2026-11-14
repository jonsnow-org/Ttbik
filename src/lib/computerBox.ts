// Shared 16 GB computer-only Studio (ai-system/modelscope-media/computer_box.py): shell, persistent files and background jobs.
// The host is common; the session key includes the verified user+model identity and the Studio gives every session a private UID/home.
import { browserStudioFor, studioCall } from "@/lib/browserComputer";
import { DEFAULT_URL, DEFAULT_V2_URL } from "@/lib/shamStudio";

/** Where a model's terminal / files / jobs live. Sham and Sham v2 have NO computer Studio at all (owner's order 2026-11-08): their computer is part of the model's own loop and runs inside
 *  its serving code (sham_embedded_tools.py). The hub is Nova's only. */
export function boxStudioFor(modelId: string | undefined): string | null {
  if (modelId === "sham" || modelId === "sham_v2") return null;
  return browserStudioFor(modelId);
}

export type BoxArgs = {
  action?: string; signed_url?: string; command?: string; cwd?: string; timeout?: number; path?: string; content?: string; id?: string; name?: string; tail?: number; since?: number; limit?: number; url?: string; ref?: string; pattern?: string; glob?: string; old?: string; new?: string; replace_all?: boolean; edits?: { old: string; new: string; replace_all?: boolean }[]; repo?: string; dir?: string; diff?: string; steps?: BoxArgs[]; continue_on_error?: boolean;
};

const ACTIONS = new Set(["run", "write", "read", "job_start", "job_log", "job_stop", "job_list", "repo", "search", "edit", "changes", "status", "activity", "patch", "test", "tools", "batch"]);
const BATCH_TOOLS = new Set(["computer_run", "computer_write", "computer_read", "computer_edit", "computer_search", "computer_patch", "computer_test", "computer_tools", "computer_job", "computer_repo"]);

/** The tool names a model sees → what the Studio understands. */
export function boxActionFor(tool: string, a: Record<string, unknown>): BoxArgs | null {
  if (tool === "computer_run") return { action: "run", command: a.command as string, cwd: a.cwd as string, timeout: a.timeout as number };
  if (tool === "computer_write") return { action: "write", path: a.path as string, content: a.content as string };
  if (tool === "computer_read") return { action: "read", path: (a.path as string) || "." };
  if (tool === "computer_edit") return { action: "edit", path: a.path as string, old: a.old as string, new: a.new as string, replace_all: Boolean(a.replace_all), edits: Array.isArray(a.edits) ? (a.edits as any[]) : undefined };
  if (tool === "computer_repo") return { action: "repo", url: a.url as string, ref: a.ref as string, signed_url: a.signed_url as string };
  if (tool === "computer_search") return { action: "search", pattern: a.pattern as string, path: (a.path as string) || ".", glob: a.glob as string };
  if (tool === "computer_patch") return { action: "patch", diff: a.diff as string, cwd: (a.cwd as string) || "." };
  if (tool === "computer_test") return { action: "test", cwd: (a.cwd as string) || ".", command: (a.command as string) || "" };
  if (tool === "computer_tools") return { action: "tools" };
  if (tool === "computer_batch") {
    // several computer actions in ONE round trip: each step is {tool: "computer_run"|..., ...its arguments}
    const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, 8).map((st: any) => {
      const t = String(st?.tool || "");
      const m = BATCH_TOOLS.has(t) ? boxActionFor(t, st || {}) : null;
      return m ? { ...m, ...(st?.continue_on_error ? { continue_on_error: true } : {}) } : null;
    });
    if (!steps.length || steps.some((x) => !x)) return null;
    return { action: "batch", steps: steps as BoxArgs[] };
  }
  if (tool === "computer_job") {
    const sub = String(a.action || "").toLowerCase();
    if (!["start", "log", "stop", "list"].includes(sub)) return null;
    return { action: "job_" + sub, command: a.command as string, name: a.name as string, id: a.id as string, tail: a.tail as number };
  }
  return null;
}

/** Exactly the fields the Studio understands, bounded; anything else is dropped. */
export function cleanBoxArgs(a: BoxArgs): Record<string, unknown> | null {
  const action = String(a.action || "").toLowerCase();
  if (!ACTIONS.has(action)) return null;
  const out: Record<string, unknown> = { action };
  if (a.command !== undefined) out.command = String(a.command).slice(0, 8000);
  if (a.cwd !== undefined) out.cwd = String(a.cwd).slice(0, 300);
  if (a.timeout !== undefined && Number.isFinite(Number(a.timeout))) out.timeout = Math.max(1, Math.min(300, Math.trunc(Number(a.timeout))));
  if (a.path !== undefined) out.path = String(a.path).slice(0, 500);
  if (a.content !== undefined) out.content = String(a.content).slice(0, 1_000_000);
  if (a.id !== undefined) out.id = String(a.id).slice(0, 20);
  if (a.name !== undefined) out.name = String(a.name).slice(0, 60);
  if (a.tail !== undefined && Number.isFinite(Number(a.tail))) out.tail = Math.max(1, Math.min(400, Math.trunc(Number(a.tail))));
  if (a.since !== undefined && Number.isFinite(Number(a.since))) out.since = Math.max(0, Math.trunc(Number(a.since)));
  if (a.limit !== undefined && Number.isFinite(Number(a.limit))) out.limit = Math.max(1, Math.min(40, Math.trunc(Number(a.limit))));
  if (a.url !== undefined) out.url = String(a.url).slice(0, 300);
  if (a.ref !== undefined) out.ref = String(a.ref).slice(0, 100);
  if (typeof a.signed_url === "string" && /^https:\/\/codeload\.github\.com\//.test(a.signed_url)) out.signed_url = a.signed_url.slice(0, 1500);
  if (a.pattern !== undefined) out.pattern = String(a.pattern).slice(0, 300);
  if (a.glob !== undefined) out.glob = String(a.glob).slice(0, 100);
  if (a.old !== undefined) out.old = String(a.old).slice(0, 200_000);
  if (a.new !== undefined) out.new = String(a.new).slice(0, 200_000);
  if (a.replace_all) out.replace_all = true;
  if (Array.isArray(a.edits)) out.edits = a.edits.slice(0, 40).map((e) => ({ old: String(e?.old ?? "").slice(0, 200_000), new: String(e?.new ?? "").slice(0, 200_000), ...(e?.replace_all ? { replace_all: true } : {}) }));
  if (a.repo !== undefined) out.repo = String(a.repo).slice(0, 200);
  if (a.dir !== undefined) out.dir = String(a.dir).slice(0, 300);
  if (a.diff !== undefined) out.diff = String(a.diff).slice(0, 400_000);
  if (a.continue_on_error) out.continue_on_error = true;
  if (action === "batch") {
    const steps = (a.steps || []).slice(0, 8).map((st) => (String(st?.action || "") === "batch" ? null : cleanBoxArgs(st)));
    if (!steps.length || steps.some((x) => !x)) return null;
    out.steps = steps;
  }
  return out;
}

/** What the model reads back. */
export function renderBoxReply(action: string, r: Record<string, any>): string {
  if (!r || r.ok === false) return "error: " + String(r?.error || "the computer did not answer").slice(0, 400) + (r?.output ? "\n" + String(r.output).slice(0, 500) : "");
  const tips = r.tips ? `\n\n${String(r.tips).slice(0, 1500)}` : "";      // the playbook, once per session (first result only)
  return renderBody(action, r) + tips;
}

function renderBody(action: string, r: Record<string, any>): string {
  switch (action) {
    case "edit":
      return `edited ${r.path}: ${r.edits} change(s), first at line ${r.first_line}`;
    case "repo":
      return r.job ? String(r.message) : `repository ready in ~/${r.path} (${r.seconds}s)\n${r.summary}\nSearch it with computer_search, read files with computer_read.`;
    case "search":
      if (r.running) return [`still searching in the background as job ${r.id} · ${r.seconds}s so far`, String(r.matches || "(nothing yet)"), r.hint ? `\n${r.hint}` : ""].join("\n").trim();
      return String(r.matches || "(no matches)");
    case "run":
      if (r.running) return [`still running in the background as job ${r.id} · ${r.seconds}s so far · in ${r.cwd}`, String(r.output || "(no output yet)"), r.hint ? `\n${r.hint}` : ""].join("\n").trim();
      return [`exit ${r.exit_code}${r.timed_out ? " (stopped: too long)" : ""} · ${r.seconds}s · in ${r.cwd}`, String(r.output || "(no output)"), r.hint ? `\n${r.hint}` : ""].join("\n").trim();
    case "write":
      return `wrote ${r.path} (${r.bytes} bytes)`;
    case "read":
      if (r.kind === "folder") return `folder ${r.path}:\n` + ((r.entries as string[]) || []).join("\n") || "(empty)";
      return String(r.text ?? "") + (r.cut ? "\n…(file continues; read part of it with `sed -n 'A,Bp'` through computer_run)" : "");
    case "job_start":
      return `job ${r.id} started. Read it with computer_job action=log id=${r.id}.`;
    case "job_log":
      return `job ${r.id} ${r.running ? "running" : "finished with exit " + r.exit_code} · ${r.seconds}s\n${r.output || "(no output yet)"}`;
    case "job_stop":
      return `job ${r.id} ${r.running ? "still running" : "stopped"}`;
    case "patch":
      return `patch applied to ${((r.files as string[]) || []).join(", ") || "the files"}\n${String(r.output || "").slice(0, 1500)}`.trim();
    case "test":
      return `tests started as job ${r.id} (${r.command} in ${r.cwd}). Read the result with computer_job action=log id=${r.id}; the last line is TESTS_EXIT=<code>.`;
    case "tools":
      return "installed: " + Object.entries((r.tools as Record<string, boolean>) || {}).filter(([, v]) => v).map(([k]) => k).join(" ") + `\nnot yet: ${Object.entries((r.tools as Record<string, boolean>) || {}).filter(([, v]) => !v).map(([k]) => k).join(" ") || "-"}\nbackground install: ${typeof r.devtools === "string" ? r.devtools : JSON.stringify(r.devtools || "").slice(0, 200)}`;
    case "batch":
      return [`${((r.results as any[]) || []).length} step(s) in one call · ${r.seconds}s`, ...((r.results as any[]) || []).map((x, i) => `[${i + 1}] ${x.action}: ${x.skipped ? "not run (" + x.error + ")" : x.ok === false ? "error: " + String(x.error || "").slice(0, 300) + (x.output ? "\n" + String(x.output).slice(0, 400) : "") : renderBody(String(x.action), x)}`)].join("\n\n").slice(0, 12000);
    case "job_list":
      return ((r.jobs as any[]) || []).map((j) => `${j.id} ${j.running ? "running" : "exit " + j.exit_code} ${j.name ? j.name + " · " : ""}${j.command}`).join("\n") || "(no jobs)";
    default:
      return JSON.stringify(r).slice(0, 1500);
  }
}

export async function boxDo(modelId: string | undefined, session: string, args: BoxArgs, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const base = boxStudioFor(modelId);                 // the same per-model media Studio hosts the browser and the computer
  if (!base) return "error: this model has no computer Studio";
  const clean = cleanBoxArgs(args);
  if (!clean) return "error: unknown computer action";
  try {
    // a command may take up to 90 s inside the Studio; the read window is a little longer
    const reply = await studioCall(base, "box_do", { ...clean, session }, fetchImpl, 110_000);
    // Speed: a clone or a running job used to hand the model a job id and the model polled it step after step (8 model steps ~ 4 minutes measured on the repo-reading task).
    // The wait now happens HERE, in the tool, with no model step in between; a job that outlasts the budget is still reported as running, as before.
    if (clean.action === "repo" && reply && reply.ok !== false && reply.job) {
      const done = await waitJob(base, session, String(reply.job), fetchImpl);
      if (done && !done.running) {
        return done.exit_code === 0 || done.exit_code === undefined
          ? `repository ready in ~/${reply.path} (download finished while the tool waited)\nSearch it with computer_search, read files with computer_read.`
          : renderBoxReply("job_log", done);
      }
    }
    if (clean.action === "job_log" && reply && reply.ok !== false && reply.running) {
      const done = await waitJob(base, session, String(clean.id || reply.id), fetchImpl, Number(clean.tail) || undefined);
      if (done) return renderBoxReply("job_log", done);
    }
    return renderBoxReply(String(clean.action), reply);
  } catch (error) {
    return "error: " + String((error as Error)?.message || error).slice(0, 240);
  }
}

/** Poll a job inside the tool until it stops or the budget (BOX_JOB_WAIT_MS, default 60 s) runs out. Returns the last job_log reply. */
async function waitJob(base: string, session: string, id: string, fetchImpl: typeof fetch, tail?: number): Promise<Record<string, any> | null> {
  const budget = Math.max(0, Number(process.env.BOX_JOB_WAIT_MS ?? 60_000));
  const gap = budget >= 3000 ? 3000 : 0;
  const until = Date.now() + budget;
  let last: Record<string, any> | null = null;
  while (Date.now() < until || last === null) {
    if (last !== null && gap) await new Promise((r) => setTimeout(r, gap));
    try {
      last = await studioCall(base, "box_do", { action: "job_log", id: id.slice(0, 20), tail: tail || 40, session }, fetchImpl, 30_000);
    } catch {
      return last;
    }
    if (!last || last.ok === false || !last.running) return last;
    if (!gap && budget === 0) return last;
  }
  return last;
}

/** Raw reply for the Mini App terminal/files screens: same shared hub and private user+model session; never a token. */
export async function boxRaw(modelId: string | undefined, session: string, args: BoxArgs, fetchImpl: typeof fetch = globalThis.fetch): Promise<Record<string, any>> {
  if (modelId === "sham" || modelId === "sham_v2") {
    // The owner's Mini App screen of a Sham's computer stays useful WITHOUT any command API: a READ-ONLY view (files, a file, jobs, a job log, what the model just did) served by the
    // model's own app. Commands are run only by the model itself, inside its loop.
    const map: Record<string, string> = { list: "list", ls: "list", read: "read", job_list: "job_list", job_log: "job_log", activity: "activity", env: "env" };
    const action = map[String((args as { action?: string })?.action || "")];
    if (!action) return { ok: false, error: "the Shams' computer screen is read-only: the model itself runs its commands (you can see its files, jobs and what it just did)" };
    const own = (modelId === "sham_v2" ? process.env.SHAM_V2_URL || DEFAULT_V2_URL : process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).split(",")[0].trim().replace(/\/+$/, "");
    try {
      return await studioCall(own, "computer_view", { action, path: (args as { path?: string }).path || "", id: (args as { id?: string }).id || "", session }, fetchImpl, 60_000);
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message || error).slice(0, 240) };
    }
  }
  const base = boxStudioFor(modelId);
  if (!base) return { ok: false, error: "this model has no computer Studio" };
  const clean = cleanBoxArgs(args);
  if (!clean) return { ok: false, error: "unknown computer action" };
  try {
    return await studioCall(base, "box_do", { ...clean, session }, fetchImpl, 110_000);
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error).slice(0, 240) };
  }
}

export type BoxChanges = { ok: true; repo: string; base: string; files: { path: string; content: string }[]; deleted: string[]; skipped: { path: string; why: string }[] } | { ok: false; error: string };

/** Changed files are read from this user+model session on the computer hub. The GitHub token never goes there: the app commits what comes back. */
export async function boxCollect(modelId: string | undefined, session: string, args: { repo: string; dir?: string }, fetchImpl: typeof fetch = globalThis.fetch): Promise<BoxChanges> {
  if (modelId === "sham" || modelId === "sham_v2") {
    // The Shams' computer is inside the model (no computer Studio). Publishing needs only the READ-ONLY list of changed files from the model's own serving app (computer_changes).
    const own = (modelId === "sham_v2" ? process.env.SHAM_V2_URL || DEFAULT_V2_URL : process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).split(",")[0].trim().replace(/\/+$/, "");
    try {
      const r = await studioCall(own, "computer_changes", { repo: String(args.repo).slice(0, 200), dir: String(args.dir || "").slice(0, 300), session }, fetchImpl, 110_000);
      if (!r || r.ok === false) return { ok: false, error: String(r?.error || "the computer did not answer").slice(0, 300) };
      return { ok: true, repo: String(r.repo), base: String(r.base || ""), files: Array.isArray(r.files) ? r.files : [], deleted: Array.isArray(r.deleted) ? r.deleted.map(String) : [], skipped: Array.isArray(r.skipped) ? r.skipped : [] };
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message || error).slice(0, 240) };
    }
  }
  const base = boxStudioFor(modelId);
  if (!base) return { ok: false, error: "this model has no computer Studio" };
  try {
    const r = await studioCall(base, "box_do", { action: "changes", repo: String(args.repo).slice(0, 200), dir: String(args.dir || "").slice(0, 300), session }, fetchImpl, 110_000);
    if (!r || r.ok === false) return { ok: false, error: String(r?.error || "the computer did not answer").slice(0, 300) };
    return { ok: true, repo: String(r.repo), base: String(r.base || ""), files: Array.isArray(r.files) ? r.files : [], deleted: Array.isArray(r.deleted) ? r.deleted.map(String) : [], skipped: Array.isArray(r.skipped) ? r.skipped : [] };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error).slice(0, 240) };
  }
}

/** A private (or public) repository for the computer WITHOUT putting the GitHub token there: GitHub answers the tarball request with a redirect to a short-lived codeload address; only that address is handed to the computer. */
export async function signedTarball(token: string, repo: string, ref: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string | null> {
  if (!token || !/^[A-Za-z0-9_-][\w.-]*\/(?!\.\.?$)[\w.-]+$/.test(repo)) return null;
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/tarball/${encodeURIComponent(ref || "HEAD")}`.replace("%2F", "/"), { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "coder-bot" }, redirect: "manual", signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get("location") || "";
    return r.status >= 300 && r.status < 400 && /^https:\/\/codeload\.github\.com\//.test(loc) ? loc : null;
  } catch { return null; }
}
