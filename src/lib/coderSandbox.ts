// A virtual computer per task. Zero-cost placement policy:
//   1. ModelScope: first choice, inside the selected model's OWN media Studio only.
//   2. Oracle: second Linux worker when that Studio is unavailable or at capacity.
//   3. Light: last-resort QuickJS/WASM for simple JS when neither Linux worker can accept the task.
// GitHub Actions remains an artifact-based batch lane for builds/tests, not a persistent shell or live desktop.
// No worker may borrow another model's Studio or weights. ModelScope admission is Studio-wide and memory-gated.
// Tools: sandbox_clone, sandbox_exec (+ sandbox_wait for long commands), sandbox_write_file, sandbox_read_file.
// The GitHub token is used only for an explicit clone/push and scrubbed from output. No dark-web tooling is run.
import { createHash, randomUUID } from "crypto";
import { oracleConfigured } from "@/lib/coderSandboxRunner";
import { browserStudioFor } from "@/lib/browserComputer";

export type ExecResult = { exitCode: number | null; stdout: string; stderr: string };
export interface SbxHandle {
  home?: string;                                                                                     // working dir (default HOME)
  exec(cmd: string, args: string[], opts: { cwd?: string; timeoutMs: number; detached?: boolean; sudo?: boolean }): Promise<ExecResult>;
  write(files: { path: string; content: Buffer }[]): Promise<void>;
  read(path: string): Promise<Buffer | null>;
  extend(ms: number): Promise<void>;
  stop(): Promise<void>;
}
export interface SbxDriver {
  get(name: string): Promise<SbxHandle | null>;
  create(name: string, o: { timeoutMs: number; vcpus: number; tags: Record<string, string> }): Promise<SbxHandle>;
}

export const SANDBOX_TOOLS = new Set(["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_write_file", "sandbox_edit_file", "sandbox_search", "sandbox_read_file", "sandbox_push"]);
export const sandboxEnabled = () => (process.env.CODER_SANDBOX || "on").trim().toLowerCase() !== "off";
const timeoutMin = () => Math.max(5, Math.min(45, Number(process.env.CODER_SANDBOX_TIMEOUT_MIN || 30)));   // Hobby: 45 min per session
const vcpus = () => Math.max(1, Math.min(4, Number(process.env.CODER_SANDBOX_VCPUS || 2)));             // Hobby: up to 4
export const HOME = "/vercel/sandbox";
const DARK = /(^|[\s;&|(`$])(tor|torsocks|torify|proxychains\S*|i2pd?|obfs4proxy|onionshare\S*|lokinet)(\s|$)|\.onion\b|\.i2p\b/i;

export function sandboxName(chatKey: string, runId: string): string {
  return `coder-${createHash("sha256").update(chatKey).digest("hex").slice(0, 10)}-${String(runId).replace(/[^a-z0-9-]/gi, "").slice(0, 16)}`.toLowerCase();
}

/** Removes the given secrets and anything shaped like a GitHub / Vercel token from text the model will see. */
export function scrub(text: string, secrets: string[] = []): string {
  let t = text;
  for (const s of secrets) if (s && s.length >= 8) t = t.split(s).join("***");
  return t.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "***").replace(/(x-access-token:)[^@\s]+@/g, "$1***@");
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.floor(n * 0.3))}\n…[${s.length - n} chars cut]…\n${s.slice(-Math.floor(n * 0.7))}` : s);
export function resolvePath(p: string, cwd = HOME): string {
  const raw = String(p || "").trim();
  if (!raw) throw new Error("path is required");
  const abs = raw.startsWith("/") ? raw : `${cwd.replace(/\/+$/, "")}/${raw}`;
  const out: string[] = [];
  for (const seg of abs.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

// ---------------------------------------------------------------- the real driver (@vercel/sandbox, OIDC credentials of the deployment)
export function vercelDriver(): SbxDriver {
  const wrap = (sb: any): SbxHandle => ({
    async exec(cmd, args, o) {
      if (o.detached) {
        await sb.runCommand({ cmd, args, cwd: o.cwd, sudo: o.sudo, detached: true });
        return { exitCode: null, stdout: "", stderr: "" };
      }
      const r = await sb.runCommand({ cmd, args, cwd: o.cwd, sudo: o.sudo, signal: AbortSignal.timeout(o.timeoutMs) });
      const [stdout, stderr] = await Promise.all([r.stdout().catch(() => ""), r.stderr().catch(() => "")]);
      return { exitCode: r.exitCode, stdout, stderr };
    },
    async write(files) {
      await sb.writeFiles(files);
    },
    async read(path) {
      return (await sb.readFileToBuffer({ path })) as Buffer | null;
    },
    async extend(ms) {
      await sb.extendTimeout(ms).catch(() => null);
    },
    async stop() {
      await sb.stop().catch(() => null);
    },
  });
  return {
    async get(name) {
      const { Sandbox } = await import("@vercel/sandbox");
      try {
        const sb: any = await Sandbox.get({ name } as any);
        if (sb?.status && !["running", "pending"].includes(String(sb.status))) return null;
        return wrap(sb);
      } catch {
        return null;
      }
    },
    async create(name, o) {
      const { Sandbox } = await import("@vercel/sandbox");
      const sb: any = await Sandbox.create({ name, timeout: o.timeoutMs, resources: { vcpus: o.vcpus }, runtime: "node24", tags: o.tags } as any);
      return wrap(sb);
    },
  };
}

// ---------------------------------------------------------------- backend selection + fallback
export type Backend = { id: string; driver: SbxDriver };
/** Backend ids in order of use; unknown ids in SANDBOX_BACKEND (comma list) are ignored. */
/**
 * Zero-cost three-tier policy (2026-11-02):
 * The selected model's own free ModelScope Studio is the first Linux worker.
 * Oracle is the second Linux worker and yields to Sham's protected memory reserve.
 * GitHub Actions is reserved for short-lived CI/build/test batches that return artifacts.
 * Metered and personal-credit desktop providers remain disabled.
 */
export const VM_BACKENDS = ["oracle"] as const;
export const DISABLED_METERED_BACKENDS = ["vercel", "codesandbox", "codespaces", "e2b"] as const;
const RUNNER_BACKENDS = new Set(["oracle"]);
export function backendConfigured(id: string): boolean {
  return id === "oracle" && oracleConfigured();
}
/** Oracle is the only external Linux VM permitted by the zero-cost policy. */
export function backendOrder(env = (process.env.SANDBOX_BACKEND || "oracle").trim().toLowerCase()): string[] {
  if (!env || env === "auto" || env === "oracle") return backendConfigured("oracle") ? ["oracle"] : [];
  if (env === "off" || env === "none" || env === "light") return [];
  return env.split(",").map((x) => x.trim()).includes("oracle") && backendConfigured("oracle") ? ["oracle"] : [];
}
export const lightEnabled = () => (process.env.CODER_LIGHT || "on").trim().toLowerCase() !== "off";
function driverFor(id: string): SbxDriver {
  if (id !== "oracle" || !RUNNER_BACKENDS.has(id)) {
    throw new Error("Backend " + id + " is disabled by the zero-cost execution policy.");
  }
  return {
    get: async (n) => (await import("@/lib/coderSandboxRunner")).oracleDriver().get(n),
    create: async (n, o) => (await import("@/lib/coderSandboxRunner")).oracleDriver().create(n, o),
  };
}
let driverOverride: SbxDriver | null = null;
let backendsOverride: Backend[] | null = null;
/** Tests: one driver for everything (or null to reset). */
export function setSandboxDriver(d: SbxDriver | null): void {
  driverOverride = d;
}
/** Tests: an explicit backend list (to exercise the fallback). */
export function setSandboxBackends(b: Backend[] | null): void {
  backendsOverride = b;
  cooling.clear();
}
// a backend that said "quota / capacity" is skipped for a while (per server instance)
const cooling = new Map<string, number>();
const COOL_MS = () => Math.max(60000, Number(process.env.CODER_SANDBOX_COOLDOWN_MS || 3600000));
export const isQuotaError = (m: string) => /quota|limit|exceeded|paused|capacity|insufficient|credit|402|429|503/i.test(m);
const SHORT_COOL_MS = 5 * 60000;                                                                      // network / 5xx hiccups
/** The chain as the status page shows it. */
export function sandboxHealth(now = Date.now()): { id: string; configured: boolean; ok: boolean; coolingUntil: number | null; disabledReason?: string }[] {
  const ids = backendsOverride ? backendsOverride.map((b) => b.id) : [...new Set([...VM_BACKENDS, ...DISABLED_METERED_BACKENDS])];
  const rows = ids.map((id) => {
    const until = cooling.get(id) || 0;
    const disabled = !backendsOverride && (DISABLED_METERED_BACKENDS as readonly string[]).includes(id);
    const configured = backendsOverride ? true : !disabled && backendConfigured(id);
    return { id, configured, ok: configured && until <= now, coolingUntil: until > now ? until : null, ...(disabled ? { disabledReason: "disabled_by_zero_cost_policy" } : {}) };
  });
  rows.push({ id: "light", configured: lightEnabled(), ok: lightEnabled(), coolingUntil: null });
  return rows;
}

export type SbxCtx = {
  chatKey?: string;
  runId?: string;
  modelId?: string;
  userId?: number | string;
  githubToken?: string | null;
  owner?: boolean;
  db?: import("@/lib/coderAuth").Db;
  fetchImpl?: typeof fetch;
};

/** Each task gets a private workspace inside its selected model's own Studio. No generic/shared Studio fallback exists. */
function modelScopeDriver(ctx: SbxCtx): SbxDriver {
  const modelId = String(ctx.modelId || "");
  const session = "task:" + createHash("sha256")
    .update([String(ctx.chatKey || ""), modelId, String(ctx.runId || "")].join("|"))
    .digest("hex");
  const taskJobs = new Map<string, string>();
  const call = async (args: Record<string, unknown>): Promise<Record<string, any>> => {
    const { boxRaw } = await import("@/lib/computerBox");
    return boxRaw(modelId, session, args as any, ctx.fetchImpl);
  };
  const shellQuote = (value: unknown) => "'" + String(value).replace(/'/g, "'\\''") + "'";
  const handle = (): SbxHandle => ({
    home: "/",
    async exec(cmd, args, opts) {
      const command = [cmd, ...args].map(shellQuote).join(" ");
      const tailMarker = "/tmp/coder-cmd/";
      const tailIndex = command.indexOf(tailMarker);
      const tailPath = tailIndex >= 0 ? command.slice(tailIndex).split(" ")[0] : "";
      // Only intercept the explicit short tail read used by waitFor().
      // The detached start script itself also contains /tmp/coder-cmd/*.out;
      // treating that as a read suppresses job_start and silently skips work.
      if (tailPath && command.includes("tail -c")) {
        const result = await call({ action: "read", path: tailPath });
        return { exitCode: result?.ok ? 0 : 1, stdout: String(result?.text || ""), stderr: String(result?.error || "") };
      }
      if (opts.detached) {
        const id = command.match(/\/tmp\/coder-cmd\/([a-f0-9]{8})\.out/)?.[1] || "";
        const result = await call({ action: "job_start", command, name: id ? "task-" + id : "sandbox-task" });
        if (!result?.ok || !result.id) throw new Error(String(result?.error || "ModelScope refused the background task"));
        if (id) taskJobs.set(id, String(result.id));
        return { exitCode: null, stdout: "", stderr: "" };
      }
      const result = await call({ action: "run", command, cwd: opts.cwd || ".", timeout: Math.min(90, Math.max(1, Math.ceil(opts.timeoutMs / 1000))) });
      return {
        exitCode: typeof result?.exit_code === "number" ? result.exit_code : result?.ok ? 0 : 1,
        stdout: String(result?.output || ""),
        stderr: String(result?.error || ""),
      };
    },
    async write(files) {
      for (const file of files) {
        const result = await call({ action: "write", path: file.path, content: file.content.toString("utf8") });
        if (!result?.ok) throw new Error(String(result?.error || "ModelScope file write failed"));
      }
    },
    async read(path) {
      const result = await call({ action: "read", path });
      if (!result?.ok || result.kind !== "file") return null;
      return Buffer.from(String(result.text || ""), "utf8");
    },
    async extend() {
      // The ModelScope workspace belongs to a Studio; it is not a separately billed VM.
    },
    async stop() {
      const listing = await call({ action: "job_list" }).catch(() => null);
      const jobs = Array.isArray(listing?.jobs) ? listing.jobs : [];
      for (const job of jobs) {
        if (job?.running && typeof job.id === "string") await call({ action: "job_stop", id: job.id }).catch(() => null);
      }
      taskJobs.clear();
    },
  });
  return {
    async get(name) {
      const expected = sandboxName(String(ctx.chatKey || ""), String(ctx.runId || ""));
      if (name !== expected) return null;
      const status = await call({ action: "status" }).catch(() => null);
      if (!status?.ok) return null;
      if (Number(status.your_disk_mb || 0) > 0 || Number(status.jobs_running || 0) > 0) return handle();
      return null;
    },
    async create(name) {
      const expected = sandboxName(String(ctx.chatKey || ""), String(ctx.runId || ""));
      if (name !== expected) throw new Error("ModelScope task identity mismatch");
      const status = await call({ action: "status" });
      if (!status?.ok) throw new Error(String(status?.error || "ModelScope computer is not ready"));
      if (status.capacity?.can_accept !== true) {
        throw new Error(String(status?.capacity?.reason || "ModelScope Studio is busy or below its safe memory reserve"));
      }
      return handle();
    },
  };
}

function backends(ctx?: SbxCtx): Backend[] {
  if (backendsOverride) return backendsOverride;
  if (driverOverride) return [{ id: "vercel", driver: driverOverride }];
  // Oracle is the primary, independently provisioned Linux worker. It has
  // its own capacity gate and protects Sham's machine when the model is busy.
  const oracle = backendOrder().map((id) => ({ id, driver: driverFor(id) }));
  // On Oracle refusal, fall back only to this selected model's own Studio.
  // That admission check reads live free memory and the Studio-wide slot.
  const modelScope: Backend[] = (
    ctx?.modelId && ctx.chatKey && ctx.runId &&
    browserStudioFor(ctx.modelId) &&
    (process.env.MODELSCOPE_API_TOKEN || "").trim()
  ) ? [{ id: "modelscope", driver: modelScopeDriver(ctx) }] : [];
  return [...oracle, ...modelScope];
}

async function open(ctx: SbxCtx): Promise<{ sb: SbxHandle; fresh: boolean; backend: Backend["id"] }> {
  if (!ctx.chatKey || !ctx.runId) throw new Error("no task context for a sandbox");
  const name = sandboxName(ctx.chatKey, ctx.runId);
  const list = backends(ctx);
  for (const b of list) {
    const got = await b.driver.get(name).catch((e) => {
      if (isQuotaError(String((e as Error)?.message || e))) cooling.set(b.id, Date.now() + COOL_MS());
      return null;
    });
    if (got) {
      await got.extend(10 * 60000);
      return { sb: got, fresh: false, backend: b.id };
    }
  }
  const tags: Record<string, string> = { app: "coder", chat: name.split("-")[1], run: String(ctx.runId).slice(0, 16) };
  if (ctx.owner) tags.priority = "owner";
  let lastErr: unknown = null;
  const now = Date.now();
  const usable = list.filter((b) => (cooling.get(b.id) || 0) <= now);
  for (const b of usable.length ? usable : list) {
    try {
      const sb = await b.driver.create(name, { timeoutMs: timeoutMin() * 60000, vcpus: vcpus(), tags });
      return { sb, fresh: true, backend: b.id };
    } catch (e) {
      lastErr = e;
      const m = String((e as Error)?.message || e);
      if (isQuotaError(m) || /oidc|unauthori[sz]ed|forbidden|401|403|not configured/i.test(m)) cooling.set(b.id, Date.now() + COOL_MS());
      else cooling.set(b.id, Date.now() + SHORT_COOL_MS);
      // try the next backend
    }
  }
  throw lastErr || new Error("no sandbox backend");
}

/** The bytes of a file in the task's VM (for send_file); null when the VM or the file is not there. Never creates a new VM. */
export async function readSandboxFile(ctx: SbxCtx, path: string, cwd?: string): Promise<{ path: string; bytes: Buffer } | null> {
  if (!ctx.chatKey || !ctx.runId) return null;
  const name = sandboxName(ctx.chatKey, ctx.runId);
  for (const b of backends(ctx)) {
    const sb = await b.driver.get(name).catch(() => null);
    if (!sb) continue;
    const full = resolvePath(path, resolvePath(cwd || sb.home || HOME, sb.home || HOME));
    const buf = await sb.read(full).catch(() => null);
    return buf ? { path: full, bytes: buf } : null;
  }
  return null;
}

/** Stops the task's VM (task ended), on whichever backend has it. Best-effort. */
export async function stopSandbox(chatKey: string, runId: string, modelId?: string): Promise<void> {
  if (lightEnabled()) await import("@/lib/coderSandboxLight").then((m) => m.clearLight(sandboxName(chatKey, runId))).catch(() => null);
  for (const b of backends({ chatKey, runId, modelId })) {
    try {
      const sb = await b.driver.get(sandboxName(chatKey, runId));
      if (sb) await sb.stop();
    } catch {
      /* it times out on its own */
    }
  }
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const WAIT_MS = () => Math.max(3000, Math.min(30000, Number(process.env.CODER_SANDBOX_WAIT_MS || 25000)));

/** Runs a shell command detached, writing output + exit code to files, then waits up to the leg's budget. */
async function startAndWait(sb: SbxHandle, command: string, cwd: string, secrets: string[]): Promise<string> {
  const id = randomUUID().slice(0, 8);
  const dir = `/tmp/coder-cmd`;
  const script = `mkdir -p ${dir}; cd ${sh(cwd)} 2>/dev/null || cd ${sh(sb.home || HOME)}; ( ${command} ) > ${dir}/${id}.out 2>&1; echo $? > ${dir}/${id}.exit`;
  await sb.exec("bash", ["-lc", script], { detached: true, timeoutMs: 10000 });
  return waitFor(sb, id, secrets, WAIT_MS());
}

async function waitFor(sb: SbxHandle, id: string, secrets: string[], waitMs: number): Promise<string> {
  if (!/^[a-f0-9]{8}$/.test(id)) return "error: bad command id";
  const t0 = Date.now();
  let delay = 400;
  for (;;) {
    const exit = await sb.read(`/tmp/coder-cmd/${id}.exit`).catch(() => null);
    if (exit) {
      const out = (await sb.read(`/tmp/coder-cmd/${id}.out`).catch(() => null))?.toString("utf8") || "";
      return `exit code ${exit.toString().trim()}\n${clip(scrub(out, secrets), 12000) || "(no output)"}`;
    }
    if (Date.now() - t0 + delay > waitMs) {
      const tail = (await sb.exec("bash", ["-lc", `tail -c 3000 /tmp/coder-cmd/${id}.out 2>/dev/null`], { timeoutMs: 8000 }).catch(() => null))?.stdout || "";
      return `still running (command id ${id}). Output so far:\n${scrub(tail, secrets) || "(none yet)"}\n\nCall sandbox_wait with {"id":"${id}"} to keep waiting.`;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(2000, delay * 1.5);
  }
}

const REPO_RX = /^[\w.-]+\/[\w.-]+$/;

/** The sandbox tools. Returns null when `name` is not a sandbox tool. */
export async function runSandboxTool(name: string, a: any, ctx: SbxCtx): Promise<string | null> {
  if (!SANDBOX_TOOLS.has(name)) return null;
  if (!sandboxEnabled()) return "error: the sandbox is switched off on this server (CODER_SANDBOX=off).";
  const secrets = [ctx.githubToken || ""];
  try {
    if (name === "sandbox_exec" && DARK.test(String(a.command || ""))) return "error: dark-web / anonymity-network tools are not allowed.";
    let opened: Awaited<ReturnType<typeof open>>;
    try {
      opened = await open(ctx);
    } catch (e) {
      // every Linux VM backend is out: the light JavaScript runner keeps simple work going
      if (!lightEnabled() || !ctx.chatKey || !ctx.runId) throw e;
      const why = String((e as Error)?.message || e).slice(0, 120);
      const { runLightTool } = await import("@/lib/coderSandboxLight");
      return await runLightTool(name, a, sandboxName(ctx.chatKey, ctx.runId), HOME, scrub(why, secrets), ctx.db);
    }
    const { sb, fresh, backend } = opened;
    const home = sb.home || HOME;
    const label = backend === "modelscope" ? "model-owned ModelScope Linux workspace (capacity-gated)" :
      backend === "vercel" ? "Vercel Linux microVM" : backend === "e2b" ? "E2B Linux microVM"
      : backend === "oracle" ? "capped Linux container on Oracle" : backend === "codesandbox" ? "CodeSandbox Linux VM" : backend === "codespaces" ? "GitHub Codespace" : backend;
    const note = fresh ? `[new sandbox (${label}): node + python3 + git, home ${home}, auto-stops after ${timeoutMin()} min]\n` : "";
    switch (name) {
      case "sandbox_clone": {
        const repo = String(a.repo || "");
        if (!REPO_RX.test(repo)) return "error: repo must be owner/name";
        const dir = resolvePath(String(a.dir || repo.split("/")[1]), home);
        const branch = String(a.branch || "");
        const auth = ctx.githubToken ? `-c http.extraHeader=${sh(`Authorization: Basic ${Buffer.from(`x-access-token:${ctx.githubToken}`).toString("base64")}`)} ` : "";
        const cmd = `rm -rf ${sh(dir)} && git ${auth}clone --depth ${Math.max(1, Math.min(200, Number(a.depth) || 50))} ${branch ? `--branch ${sh(branch)} ` : ""}https://github.com/${repo}.git ${sh(dir)} && cd ${sh(dir)} && git log --oneline -1 && ls`;
        secrets.push(Buffer.from(`x-access-token:${ctx.githubToken || ""}`).toString("base64"));
        return note + `cloned into ${dir}\n` + (await startAndWait(sb, cmd, home, secrets));
      }
      case "sandbox_push": {
        // the VM's changes go back to GitHub: commit everything changed in the clone and push it to a branch (never forced). The token is in the command only for this push (an http header, not stored in the repo config) and is scrubbed from the output.
        const repo = String(a.repo || "");
        if (!REPO_RX.test(repo)) return "error: repo must be owner/name";
        const branch = String(a.branch || "").trim();
        if (!/^[\w][\w./-]{0,99}$/.test(branch) || branch.includes("..")) return "error: branch must be a plain branch name (letters, digits, - _ . /)";
        if (!ctx.githubToken) return "error: GitHub is not connected in this chat, so nothing can be pushed";
        const dir = resolvePath(String(a.dir || repo.split("/")[1]), home);
        const message = String(a.message || "update").replace(/\s+/g, " ").trim().slice(0, 200) || "update";
        const auth = `-c http.extraHeader=${sh(`Authorization: Basic ${Buffer.from(`x-access-token:${ctx.githubToken}`).toString("base64")}`)} `;
        secrets.push(Buffer.from(`x-access-token:${ctx.githubToken}`).toString("base64"));
        const who = `-c user.name="Nova AI" -c user.email="nova-ai@users.noreply.github.com"`;
        const cmd = `cd ${sh(dir)} && git checkout -B ${sh(branch)} && printf '__pycache__/\\n.pytest_cache/\\n*.pyc\\nnode_modules/\\n.venv/\\n.next/\\ndist/\\n' >> .git/info/exclude && git add -A && { git diff --cached --quiet && { echo "NOTHING TO PUSH: no file changed in ${dir}"; exit 3; }; true; } && git ${who} commit -q -m ${sh(message)} && git show --stat --format='commit %h %s' HEAD | head -n 20 && git ${auth}push origin HEAD:refs/heads/${branch} 2>&1 | tail -n 5 && echo "PUSHED to ${repo} branch ${branch}"`;
        return note + (await startAndWait(sb, cmd, home, secrets));
      }
      case "sandbox_exec": {
        const command = String(a.command || "").trim();
        if (!command) return "error: command is required";
        return note + (await startAndWait(sb, command, resolvePath(String(a.cwd || home), home), secrets));
      }
      case "sandbox_wait":
        return note + (await waitFor(sb, String(a.id || ""), secrets, WAIT_MS()));
      case "sandbox_write_file": {
        const path = resolvePath(String(a.path || ""), resolvePath(String(a.cwd || home), home));
        const content = String(a.content ?? "");
        if (content.length > 2_000_000) return "error: file too large (2 MB max per write)";
        const dir = path.slice(0, path.lastIndexOf("/")) || "/";
        await sb.exec("mkdir", ["-p", dir], { timeoutMs: 10000 });
        await sb.write([{ path, content: Buffer.from(content, "utf8") }]);
        return `${note}wrote ${path} (${Buffer.byteLength(content)} bytes)`;
      }
      case "sandbox_edit_file": {
        const path = resolvePath(String(a.path || ""), resolvePath(String(a.cwd || home), home));
        const oldT = String(a.old ?? ""), newT = String(a.new ?? "");
        if (!oldT) return `${note}error: old (the exact text to replace) is required`;
        const buf = await sb.read(path);
        if (!buf) return `${note}error: ${path} not found`;
        const text = buf.toString("utf8");
        const count = text.split(oldT).length - 1;
        if (count === 0) return `${note}error: the text to replace was not found in ${path} (copy it exactly, including spaces and line breaks)`;
        if (count > 1 && a.replace_all !== true) return `${note}error: the text occurs ${count} times in ${path}: make it longer so it is unique, or set replace_all`;
        const out = a.replace_all === true ? text.split(oldT).join(newT) : text.replace(oldT, () => newT);
        await sb.write([{ path, content: Buffer.from(out, "utf8") }]);
        return `${note}edited ${path} (${a.replace_all === true ? count : 1} replacement${count > 1 && a.replace_all === true ? "s" : ""})`;
      }
      case "sandbox_search": {
        const pattern = String(a.pattern || "").trim(), glob = String(a.glob || "").trim();
        if (!pattern && !glob) return `${note}error: give a pattern (text inside files) or a glob (file names)`;
        const where = sh(String(a.path || "."));
        const max = Math.max(1, Math.min(300, Number(a.max) || 60));
        const skip = "--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next --exclude-dir=dist";
        const cmd = pattern
          ? `grep -rnIE ${skip} ${glob ? `--include=${sh(glob)} ` : ""}-e ${sh(pattern)} ${where} 2>/dev/null | head -n ${max}`
          : `find ${where} \\( -name node_modules -o -name .git -o -name .next -o -name dist \\) -prune -o -name ${sh(glob)} -print 2>/dev/null | head -n ${max}`;
        return note + ((await startAndWait(sb, cmd, resolvePath(String(a.cwd || home), home), secrets)) || "(no matches)");
      }
      case "sandbox_read_file": {
        const path = resolvePath(String(a.path || ""), resolvePath(String(a.cwd || home), home));
        const buf = await sb.read(path);
        if (!buf) return `${note}error: ${path} not found`;
        const text = buf.toString("utf8");
        const from = Math.max(1, Number(a.start_line) || 1);
        const lines = text.split("\n");
        const part = lines.slice(from - 1, from - 1 + Math.max(1, Math.min(4000, Number(a.max_lines) || 800)));
        return `${note}${path} (${lines.length} lines; showing ${from}-${from + part.length - 1})\n` + clip(scrub(part.join("\n"), secrets), 20000);
      }
    }
    return null;
  } catch (e) {
    const m = String((e as Error)?.message || e);
    if (isQuotaError(m)) return `error: the free sandbox allowance is used up or rate-limited right now (${m.slice(0, 160)}). Continue without running code, or try again later.`;
    if (/oidc|token|unauthori[sz]ed|forbidden|401|403/i.test(m)) return `error: the sandbox is not available on this deployment (${m.slice(0, 160)}).`;
    return `error: sandbox ${name} failed: ${scrub(m, secrets).slice(0, 300)}`;
  }
}
