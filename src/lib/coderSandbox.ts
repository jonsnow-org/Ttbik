// A virtual computer per task for the coder agent: an isolated Vercel Sandbox microVM (zero cost on the Hobby plan: a monthly free
// allotment, hard-capped — when it runs out, creation pauses until the next cycle, nothing is billed). One VM per user per task
// (the name carries the salted chat hash and the run id), stopped when the task ends, and it times out on its own anyway.
// Tools: sandbox_clone, sandbox_exec (+ sandbox_wait for long commands), sandbox_write_file, sandbox_read_file.
// Commands run inside the VM only, so they are auto-allowed for both tiers. The user's GitHub token is used just for the clone
// (as a one-off header, never written into the repo's config) and scrubbed from every output; pushes still go through the guarded
// GitHub tools. No dark-web tooling (tor/i2p/.onion) is run.
import { createHash, randomUUID } from "crypto";

export type ExecResult = { exitCode: number | null; stdout: string; stderr: string };
export interface SbxHandle {
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

let driverOverride: SbxDriver | null = null;
export function setSandboxDriver(d: SbxDriver | null): void {
  driverOverride = d;
}
const driver = () => driverOverride || vercelDriver();

export type SbxCtx = { chatKey?: string; runId?: string; githubToken?: string | null };

async function open(ctx: SbxCtx): Promise<{ sb: SbxHandle; fresh: boolean }> {
  if (!ctx.chatKey || !ctx.runId) throw new Error("no task context for a sandbox");
  const name = sandboxName(ctx.chatKey, ctx.runId);
  const d = driver();
  const got = await d.get(name);
  if (got) {
    await got.extend(10 * 60000);
    return { sb: got, fresh: false };
  }
  const sb = await d.create(name, { timeoutMs: timeoutMin() * 60000, vcpus: vcpus(), tags: { app: "coder", chat: name.split("-")[1], run: String(ctx.runId).slice(0, 16) } });
  return { sb, fresh: true };
}

/** Stops the task's VM (task ended). Best-effort. */
export async function stopSandbox(chatKey: string, runId: string): Promise<void> {
  try {
    const sb = await driver().get(sandboxName(chatKey, runId));
    if (sb) await sb.stop();
  } catch {
    /* it times out on its own */
  }
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const WAIT_MS = () => Math.max(3000, Math.min(30000, Number(process.env.CODER_SANDBOX_WAIT_MS || 25000)));

/** Runs a shell command detached, writing output + exit code to files, then waits up to the leg's budget. */
async function startAndWait(sb: SbxHandle, command: string, cwd: string, secrets: string[]): Promise<string> {
  const id = randomUUID().slice(0, 8);
  const dir = `/tmp/coder-cmd`;
  const script = `mkdir -p ${dir}; cd ${sh(cwd)} 2>/dev/null || cd ${HOME}; ( ${command} ) > ${dir}/${id}.out 2>&1; echo $? > ${dir}/${id}.exit`;
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
    const { sb, fresh } = await open(ctx);
    const note = fresh ? `[new sandbox: Linux microVM, ${vcpus()} vCPU, node24 + python3 + git, home ${HOME}, auto-stops after ${timeoutMin()} min idle limit]\n` : "";
    switch (name) {
      case "sandbox_clone": {
        const repo = String(a.repo || "");
        if (!REPO_RX.test(repo)) return "error: repo must be owner/name";
        const dir = resolvePath(String(a.dir || repo.split("/")[1]));
        const branch = String(a.branch || "");
        const auth = ctx.githubToken ? `-c http.extraHeader=${sh(`Authorization: Basic ${Buffer.from(`x-access-token:${ctx.githubToken}`).toString("base64")}`)} ` : "";
        const cmd = `rm -rf ${sh(dir)} && git ${auth}clone --depth ${Math.max(1, Math.min(200, Number(a.depth) || 50))} ${branch ? `--branch ${sh(branch)} ` : ""}https://github.com/${repo}.git ${sh(dir)} && cd ${sh(dir)} && git log --oneline -1 && ls`;
        secrets.push(Buffer.from(`x-access-token:${ctx.githubToken || ""}`).toString("base64"));
        return note + `cloned into ${dir}\n` + (await startAndWait(sb, cmd, HOME, secrets));
      }
      case "sandbox_exec": {
        const command = String(a.command || "").trim();
        if (!command) return "error: command is required";
        return note + (await startAndWait(sb, command, resolvePath(String(a.cwd || HOME)), secrets));
      }
      case "sandbox_wait":
        return note + (await waitFor(sb, String(a.id || ""), secrets, WAIT_MS()));
      case "sandbox_write_file": {
        const path = resolvePath(String(a.path || ""), String(a.cwd || HOME));
        const content = String(a.content ?? "");
        if (content.length > 2_000_000) return "error: file too large (2 MB max per write)";
        const dir = path.slice(0, path.lastIndexOf("/")) || "/";
        await sb.exec("mkdir", ["-p", dir], { timeoutMs: 10000 });
        await sb.write([{ path, content: Buffer.from(content, "utf8") }]);
        return `${note}wrote ${path} (${Buffer.byteLength(content)} bytes)`;
      }
      case "sandbox_read_file": {
        const path = resolvePath(String(a.path || ""), String(a.cwd || HOME));
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
    if (/quota|limit|exceeded|paused|402|429/i.test(m)) return `error: the free sandbox allowance is used up or rate-limited right now (${m.slice(0, 160)}). Continue without running code, or try again later.`;
    if (/oidc|token|unauthori[sz]ed|forbidden|401|403/i.test(m)) return `error: the sandbox is not available on this deployment (${m.slice(0, 160)}).`;
    return `error: sandbox ${name} failed: ${scrub(m, secrets).slice(0, 300)}`;
  }
}
