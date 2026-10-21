// Backends of the coder sandbox chain (src/lib/coderSandbox.ts) that talk to our own runner (coder-sandbox/runner.mjs) over HTTP.
// Each is OFF until its settings are present, so nothing changes for the live bot until the owner provides them.
//   oracle      — the capped runner on the Oracle VM (an ephemeral container per task: 1 CPU, 2 GiB, 256 PIDs, tmpfs disk).
//                 CODER_SANDBOX_ORACLE_URL + CODER_SANDBOX_ORACLE_SECRET. Refuses new work (503) while Sham needs the machine.
//   codesandbox — a CodeSandbox VM (free Build plan: 400 VM credits a month ≈ 40 Nano hours, frozen — never billed — when used up),
//                 forked from the owner's template that starts the runner in local mode on port 8790.
//                 CSB_API_KEY + CODER_CSB_TEMPLATE + CODER_CSB_RUNNER_SECRET (the template keeps it in .runner-secret: files are copied
//                 by a fork, env set in a session is not). Pico tier (1 CPU, 2 GB, half the credits of Nano) unless CODER_CSB_TIER;
//                 every fork is deleted when its task ends (a shutdown alone can leave the VM listed as running for a while).
//   codespaces  — a GitHub Codespace on the owner's personal account (free 120 core-hours a month; the personal spending limit is $0
//                 by default, so it stops instead of billing), from a repo holding coder-sandbox/codespaces/.devcontainer + runner.mjs.
//                 CODER_CODESPACES_TOKEN (fine-grained PAT: Codespaces read/write + Codespaces lifecycle admin) + CODER_CODESPACES_REPO
//                 (owner/name) + CODER_CODESPACES_RUNNER_SECRET (the repo's Codespaces secret CODER_SANDBOX_SECRET).
import type { ExecResult, SbxDriver, SbxHandle } from "@/lib/coderSandbox";

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
let sleepImpl: ((ms: number) => Promise<void>) | null = null;
/** Tests: a fake fetch (and an instant sleep); null resets. */
export function setRunnerFetch(f: Fetch | null, sleep: ((ms: number) => Promise<void>) | null = null): void {
  fetchImpl = f;
  sleepImpl = sleep;
}
const f: Fetch = (...a) => (fetchImpl || fetch)(...a);
const sleep = (ms: number) => (sleepImpl ? sleepImpl(ms) : new Promise<void>((r) => setTimeout(r, ms)));
const env = (k: string) => (process.env[k] || "").trim();
async function must(r: Response, what: string): Promise<Response> {
  if (r.ok) return r;
  const body = (await r.text().catch(() => "")).slice(0, 200);
  throw new Error(`${what}: ${r.status} ${body}`);
}

// ---------------------------------------------------------------- the runner protocol (shared by all three)
export type RunnerTarget = { base: string; headers: Record<string, string>; label: string };
export function runnerHandle(t: RunnerTarget, name: string, home: string): SbxHandle {
  const url = (p: string) => `${t.base.replace(/\/+$/, "")}/v1/boxes/${encodeURIComponent(name)}${p}`;
  const json = { ...t.headers, "Content-Type": "application/json" };
  return {
    home,
    async exec(cmd, args, o): Promise<ExecResult> {
      const r = await must(
        await f(url("/exec"), { method: "POST", headers: json, body: JSON.stringify({ cmd, args, cwd: o.cwd, timeoutMs: o.timeoutMs, detached: !!o.detached }), signal: AbortSignal.timeout((o.detached ? 15000 : o.timeoutMs) + 10000) }),
        `${t.label} exec`,
      );
      const j = (await r.json()) as { exitCode?: number | null; stdout?: string; stderr?: string };
      return { exitCode: typeof j.exitCode === "number" ? j.exitCode : null, stdout: j.stdout || "", stderr: j.stderr || "" };
    },
    async write(files) {
      for (const file of files) {
        await must(await f(url("/files"), { method: "PUT", headers: json, body: JSON.stringify({ path: file.path, contentB64: file.content.toString("base64") }), signal: AbortSignal.timeout(60000) }), `${t.label} write`);
      }
    },
    async read(path) {
      const r = await f(`${url("/files")}?path=${encodeURIComponent(path)}`, { headers: t.headers, signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 400) return null;
      await must(r, `${t.label} read`);
      return Buffer.from(await r.arrayBuffer());
    },
    async extend(ms) {
      await f(url("/extend"), { method: "POST", headers: json, body: JSON.stringify({ ms }), signal: AbortSignal.timeout(15000) }).catch(() => null);
    },
    async stop() {
      await f(url(""), { method: "DELETE", headers: t.headers, signal: AbortSignal.timeout(20000) }).catch(() => null);
    },
  };
}
/** An existing box on a runner, or null. */
export async function runnerGet(t: RunnerTarget, name: string): Promise<SbxHandle | null> {
  const r = await f(`${t.base.replace(/\/+$/, "")}/v1/boxes/${encodeURIComponent(name)}`, { headers: t.headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { home?: string };
  return runnerHandle(t, name, j.home || "/work");
}
/** A new box (the runner answers 503 "not accepting" when Sham needs the machine or it is full: the chain moves on). */
export async function runnerCreate(t: RunnerTarget, name: string, timeoutMs: number): Promise<SbxHandle> {
  const r = await f(`${t.base.replace(/\/+$/, "")}/v1/boxes`, { method: "POST", headers: { ...t.headers, "Content-Type": "application/json" }, body: JSON.stringify({ name, timeoutMs }), signal: AbortSignal.timeout(90000) });
  if (r.status === 503) throw new Error(`${t.label}: capacity — ${(await r.text().catch(() => "")).slice(0, 120)}`);
  await must(r, `${t.label} create`);
  const j = (await r.json()) as { home?: string };
  return runnerHandle(t, name, j.home || "/work");
}
/** Waits until the runner's /health answers (a freshly started VM needs a few seconds). */
async function waitHealthy(t: RunnerTarget, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const r = await f(`${t.base.replace(/\/+$/, "")}/health`, { headers: t.headers, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (r?.ok) return;
    await sleep(2000);
  }
  throw new Error(`${t.label}: runner did not come up`);
}

// ---------------------------------------------------------------- 1. Oracle (capped containers)
export const oracleConfigured = () => Boolean(env("CODER_SANDBOX_ORACLE_URL") && env("CODER_SANDBOX_ORACLE_SECRET"));
export function oracleDriver(): SbxDriver {
  const target = (): RunnerTarget => {
    if (!oracleConfigured()) throw new Error("oracle sandbox not configured");
    return { base: env("CODER_SANDBOX_ORACLE_URL"), headers: { "x-runner-key": env("CODER_SANDBOX_ORACLE_SECRET") }, label: "oracle sandbox" };
  };
  return {
    async get(name) {
      return oracleConfigured() ? runnerGet(target(), name).catch(() => null) : null;
    },
    async create(name, o) {
      return runnerCreate(target(), name, o.timeoutMs);
    },
  };
}

// ---------------------------------------------------------------- 2. CodeSandbox (REST API: fork the template, start its VM, talk to the runner on the public preview host)
export const codesandboxConfigured = () => Boolean(env("CSB_API_KEY") && env("CODER_CSB_TEMPLATE") && env("CODER_CSB_RUNNER_SECRET"));
const CSB_PORT = 8790;
const csbTag = (name: string) => `cx-${name}`.slice(0, 60);
export function codesandboxDriver(): SbxDriver {
  const api = () => (env("CSB_API_URL") || "https://api.codesandbox.io").replace(/\/+$/, "");
  const hdr = (): Record<string, string> => {
    if (!codesandboxConfigured()) throw new Error("codesandbox not configured");
    return { Authorization: `Bearer ${env("CSB_API_KEY")}`, "Content-Type": "application/json" };
  };
  const target = (id: string): RunnerTarget => ({
    base: `https://${id}-${CSB_PORT}.${env("CSB_PREVIEW_DOMAIN") || "csb.app"}`,
    headers: { "x-runner-key": env("CODER_CSB_RUNNER_SECRET") },
    label: "codesandbox",
  });
  // the VM itself is the box: stopping the box shuts the VM down and deletes the fork (credits stop counting, nothing piles up)
  const withShutdown = (h: SbxHandle, id: string): SbxHandle => ({
    ...h,
    async stop() {
      await h.stop();
      await f(`${api()}/vm/${id}/shutdown`, { method: "POST", headers: hdr(), body: "{}", signal: AbortSignal.timeout(20000) }).catch(() => null);
      await f(`${api()}/vm/${id}`, { method: "DELETE", headers: hdr(), signal: AbortSignal.timeout(20000) }).catch(() => null);
    },
  });
  const tier = () => (/^(Pico|Nano|Micro|Small)$/.test(env("CODER_CSB_TIER")) ? env("CODER_CSB_TIER") : "Pico");
  return {
    async get(name) {
      if (!codesandboxConfigured()) return null;
      const r = await f(`${api()}/sandbox?tags=${encodeURIComponent(csbTag(name))}&status=running&page_size=5`, { headers: hdr(), signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { data?: { sandboxes?: { id: string }[] } };
      const id = j?.data?.sandboxes?.[0]?.id;
      if (!id) return null;
      const h = await runnerGet(target(id), name).catch(() => null);
      return h ? withShutdown(h, id) : null;
    },
    async create(name, o) {
      const r = await must(
        await f(`${api()}/sandbox/${encodeURIComponent(env("CODER_CSB_TEMPLATE"))}/fork`, {
          method: "POST",
          headers: hdr(),
          body: JSON.stringify({
            title: name, tags: [csbTag(name)], privacy: 2, private_preview: false,
            start_options: { tier: tier(), hibernation_timeout_seconds: Math.min(86400, Math.max(300, Math.ceil(o.timeoutMs / 1000))), automatic_wakeup_config: { http: false, websocket: false } },
          }),
          signal: AbortSignal.timeout(60000),
        }),
        "codesandbox fork",
      );
      const j = (await r.json()) as { data?: { id?: string } };
      const id = j?.data?.id;
      if (!id) throw new Error("codesandbox fork: no sandbox id");
      const t = target(id);
      try {
        await waitHealthy(t);
        return withShutdown(await runnerCreate(t, name, o.timeoutMs), id);
      } catch (e) {
        // never leave a fork behind when it could not take the task
        await withShutdown(runnerHandle(t, name, "/"), id).stop();
        throw e;
      }
    },
  };
}

// ---------------------------------------------------------------- 3. GitHub Codespaces (REST API on the owner's personal account)
export const codespacesConfigured = () => Boolean(env("CODER_CODESPACES_TOKEN") && /^[\w.-]+\/[\w.-]+$/.test(env("CODER_CODESPACES_REPO")) && env("CODER_CODESPACES_RUNNER_SECRET"));
const CS_PORT = 8790;
const csDisplay = (name: string) => name.slice(0, 48);
export function codespacesDriver(): SbxDriver {
  const gh = (p: string) => `${(env("GITHUB_API_URL") || "https://api.github.com").replace(/\/+$/, "")}${p}`;
  const hdr = (): Record<string, string> => {
    if (!codespacesConfigured()) throw new Error("codespaces not configured");
    return { Authorization: `Bearer ${env("CODER_CODESPACES_TOKEN")}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
  };
  // the forwarded port stays private unless the devcontainer could make it public; X-Github-Token lets the owner's token through either way
  const target = (cs: { name: string }): RunnerTarget => ({
    base: `https://${cs.name}-${CS_PORT}.app.github.dev`,
    headers: { "x-runner-key": env("CODER_CODESPACES_RUNNER_SECRET"), "X-Github-Token": env("CODER_CODESPACES_TOKEN") },
    label: "codespaces",
  });
  const withDelete = (h: SbxHandle, csName: string): SbxHandle => ({
    ...h,
    async stop() {
      await h.stop();
      await f(gh(`/user/codespaces/${encodeURIComponent(csName)}`), { method: "DELETE", headers: hdr(), signal: AbortSignal.timeout(20000) }).catch(() => null);
    },
  });
  type Cs = { name: string; state?: string; display_name?: string };
  const find = async (name: string): Promise<Cs | null> => {
    const r = await f(gh("/user/codespaces?per_page=50"), { headers: hdr(), signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { codespaces?: Cs[] };
    return (j.codespaces || []).find((c) => c.display_name === csDisplay(name)) || null;
  };
  const waitAvailable = async (cs: Cs): Promise<Cs> => {
    let cur = cs;
    for (let i = 0; i < 60 && cur.state !== "Available"; i++) {
      if (/Failed|Deleted|ShuttingDown/i.test(String(cur.state))) throw new Error(`codespaces: codespace ${cur.state}`);
      await sleep(3000);
      const r = await f(gh(`/user/codespaces/${encodeURIComponent(cur.name)}`), { headers: hdr(), signal: AbortSignal.timeout(15000) });
      if (r.ok) cur = (await r.json()) as Cs;
    }
    if (cur.state !== "Available") throw new Error("codespaces: codespace did not start in time");
    return cur;
  };
  return {
    async get(name) {
      if (!codespacesConfigured()) return null;
      const cs = await find(name).catch(() => null);
      if (!cs || cs.state !== "Available") return null;
      const h = await runnerGet(target(cs), name).catch(() => null);
      return h ? withDelete(h, cs.name) : null;
    },
    async create(name, o) {
      const repo = await must(await f(gh(`/repos/${env("CODER_CODESPACES_REPO")}`), { headers: hdr(), signal: AbortSignal.timeout(15000) }), "codespaces repo");
      const { id } = (await repo.json()) as { id: number };
      const r = await must(
        await f(gh("/user/codespaces"), {
          method: "POST",
          headers: hdr(),
          body: JSON.stringify({
            repository_id: id, machine: env("CODER_CODESPACES_MACHINE") || "basicLinux32gb", display_name: csDisplay(name),
            idle_timeout_minutes: Math.min(240, Math.max(5, Math.ceil(o.timeoutMs / 60000))), retention_period_minutes: 60,
          }),
          signal: AbortSignal.timeout(60000),
        }),
        "codespaces create",
      );
      const cs = await waitAvailable((await r.json()) as Cs);
      const t = target(cs);
      await waitHealthy(t);
      return withDelete(await runnerCreate(t, name, o.timeoutMs), cs.name);
    },
  };
}
