// A virtual computer per task for the coder agent: an isolated Vercel Sandbox microVM (zero cost on the Hobby plan: a monthly free
// allotment, hard-capped — when it runs out, creation pauses until the next cycle, nothing is billed). One VM per user per task
// (the name carries the salted chat hash and the run id), stopped when the task ends, and it times out on its own anyway.
// Tools: sandbox_clone, sandbox_exec (+ sandbox_wait for long commands), sandbox_write_file, sandbox_read_file.
// Commands run inside the VM only, so they are auto-allowed for both tiers. The user's GitHub token is used just for the clone
// (as a one-off header, never written into the repo's config) and scrubbed from every output; pushes still go through the guarded
// GitHub tools. No dark-web tooling (tor/i2p/.onion) is run.
// Backends (failover chain, SANDBOX_BACKEND to reorder/limit; all zero cost, none shares a quota with Sham — no GitHub Actions):
//   0. oracle      — capped container per task on the Oracle VM (coder-sandbox/runner.mjs), with CODER_SANDBOX_ORACLE_URL + _SECRET;
//                    it refuses new work while Sham needs the machine.                                  (src/lib/coderSandboxRunner.ts)
//   0b. codesandbox / codespaces — the same runner on a CodeSandbox VM or a personal GitHub Codespace (free monthly allowances), each
//                    only with its keys; they sit between vercel and daytona.                           (src/lib/coderSandboxRunner.ts)
//   1. vercel  — Vercel Sandbox microVM (Hobby free allowance, hard-capped), on Vercel deployments (OIDC).
//   2. daytona — Daytona Cloud sandbox (free sign-up credit, no card), only with DAYTONA_API_KEY.        (src/lib/coderSandboxDrivers.ts)
//   3. e2b     — E2B Firecracker sandbox (free one-time credit, no card), only with E2B_API_KEY.          (src/lib/coderSandboxDrivers.ts)
//   4. light   — in-process QuickJS/WebAssembly JavaScript runner: always there, no shell (src/lib/coderSandboxLight.ts). CODER_LIGHT=off.
// A task sticks to the backend that holds its VM. A backend that failed (quota / capacity / auth / network) is skipped for a cool-down
// and the next one is used; sandboxHealth() reports the chain for the status page.
import { createHash, randomUUID } from "crypto";

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

export const SANDBOX_TOOLS = new Set(["sandbox_clone", "sandbox_exec", "sandbox_wait", "sandbox_write_file", "sandbox_read_file"]);
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
export const VM_BACKENDS = ["oracle", "vercel", "codesandbox", "codespaces", "daytona", "e2b"] as const;
const RUNNER_BACKENDS = new Set(["oracle", "codesandbox", "codespaces"]);
export function backendConfigured(id: string): boolean {
  if (id === "vercel") return Boolean(process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN);
  if (id === "daytona") return Boolean((process.env.DAYTONA_API_KEY || "").trim());
  if (id === "e2b") return Boolean((process.env.E2B_API_KEY || "").trim());
  if (id === "oracle") return Boolean((process.env.CODER_SANDBOX_ORACLE_URL || "").trim() && (process.env.CODER_SANDBOX_ORACLE_SECRET || "").trim());
  if (id === "codesandbox") return Boolean((process.env.CSB_API_KEY || "").trim() && (process.env.CODER_CSB_TEMPLATE || "").trim() && (process.env.CODER_CSB_RUNNER_SECRET || "").trim());
  if (id === "codespaces") return Boolean((process.env.CODER_CODESPACES_TOKEN || "").trim() && (process.env.CODER_CODESPACES_REPO || "").trim() && (process.env.CODER_CODESPACES_RUNNER_SECRET || "").trim());
  return false;
}
/** VM backend ids in order of use: SANDBOX_BACKEND (comma list) or auto = every configured one in the default order. */
export function backendOrder(env = (process.env.SANDBOX_BACKEND || "auto").trim().toLowerCase()): string[] {
  const known = new Set<string>(VM_BACKENDS);
  const want = env === "auto" || !env ? [...VM_BACKENDS].filter(backendConfigured) : env.split(",").map((x) => x.trim()).filter((x) => known.has(x));
  return want.length ? want : ["vercel"];
}
export const lightEnabled = () => (process.env.CODER_LIGHT || "on").trim().toLowerCase() !== "off";
function driverFor(id: string): SbxDriver {
  if (RUNNER_BACKENDS.has(id)) {
    // lazy, like the other extra drivers
    const pick = async () => {
      const m = await import("@/lib/coderSandboxRunner");
      return id === "oracle" ? m.oracleDriver() : id === "codesandbox" ? m.codesandboxDriver() : m.codespacesDriver();
    };
    return { get: async (n) => (await pick()).get(n), create: async (n, o) => (await pick()).create(n, o) };
  }
  if (id === "daytona" || id === "e2b") {
    // lazy so the extra drivers cost nothing unless used
    return {
      get: async (n) => (await import("@/lib/coderSandboxDrivers"))[id === "daytona" ? "daytonaDriver" : "e2bDriver"]().get(n),
      create: async (n, o) => (await import("@/lib/coderSandboxDrivers"))[id === "daytona" ? "daytonaDriver" : "e2bDriver"]().create(n, o),
    };
  }
  return vercelDriver();
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
function backends(): Backend[] {
  if (backendsOverride) return backendsOverride;
  if (driverOverride) return [{ id: "vercel", driver: driverOverride }];
  return backendOrder().map((id) => ({ id, driver: driverFor(id) }));
}
// a backend that said "quota / capacity" is skipped for a while (per server instance)
const cooling = new Map<string, number>();
const COOL_MS = () => Math.max(60000, Number(process.env.CODER_SANDBOX_COOLDOWN_MS || 3600000));
export const isQuotaError = (m: string) => /quota|limit|exceeded|paused|capacity|insufficient|credit|402|429|503/i.test(m);
const SHORT_COOL_MS = 5 * 60000;                                                                      // network / 5xx hiccups
/** The chain as the status page shows it. */
export function sandboxHealth(now = Date.now()): { id: string; configured: boolean; ok: boolean; coolingUntil: number | null }[] {
  const ids = backendsOverride ? backendsOverride.map((b) => b.id) : [...new Set([...backendOrder(), ...VM_BACKENDS])];
  const rows = ids.map((id) => {
    const until = cooling.get(id) || 0;
    const configured = backendsOverride ? true : backendConfigured(id) && backendOrder().includes(id);
    return { id, configured, ok: configured && until <= now, coolingUntil: until > now ? until : null };
  });
  rows.push({ id: "light", configured: lightEnabled(), ok: lightEnabled(), coolingUntil: null });
  return rows;
}

export type SbxCtx = { chatKey?: string; runId?: string; githubToken?: string | null; owner?: boolean; db?: import("@/lib/coderAuth").Db };

async function open(ctx: SbxCtx): Promise<{ sb: SbxHandle; fresh: boolean; backend: Backend["id"] }> {
  if (!ctx.chatKey || !ctx.runId) throw new Error("no task context for a sandbox");
  const name = sandboxName(ctx.chatKey, ctx.runId);
  const list = backends();
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

/** Stops the task's VM (task ended), on whichever backend has it. Best-effort. */
export async function stopSandbox(chatKey: string, runId: string): Promise<void> {
  if (lightEnabled()) await import("@/lib/coderSandboxLight").then((m) => m.clearLight(sandboxName(chatKey, runId))).catch(() => null);
  for (const b of backends()) {
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
    const label = backend === "vercel" ? "Vercel Linux microVM" : backend === "daytona" ? "Daytona Linux sandbox" : backend === "e2b" ? "E2B Linux microVM"
      : backend === "oracle" ? "capped Linux container (1 CPU, 2 GB)" : backend === "codesandbox" ? "CodeSandbox Linux VM" : backend === "codespaces" ? "GitHub Codespace" : backend;
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
