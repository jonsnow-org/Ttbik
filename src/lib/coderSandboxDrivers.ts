// Extra zero-cost VM backends for the coder sandbox (src/lib/coderSandbox.ts). Each is OFF until its key is set, so the live bot never
// depends on them. None shares a quota with Sham (no GitHub Actions, Kaggle, Lightning, ModelScope).
//   daytona — Daytona Cloud: free compute credit on sign-up, no card (DAYTONA_API_KEY; DAYTONA_API_URL optional). Full Linux, sudo.
//   e2b     — E2B Hobby: free one-time credit, no card (E2B_API_KEY). Full Linux (Firecracker microVM), 1 h sessions.
// When a credit runs out the provider refuses new sandboxes (402/403/quota): the chain cools that backend and moves on; nothing is billed
// unless the owner adds a card there himself.
import type { ExecResult, SbxDriver, SbxHandle } from "@/lib/coderSandbox";

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const cmdLine = (cmd: string, args: string[]) => [cmd, ...args].map((x) => (/^[\w@%+=:,./-]+$/.test(x) ? x : sh(x))).join(" ");
type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Tests: a fake fetch for the HTTP drivers (null resets). */
export function setDriverFetch(f: Fetch | null): void {
  fetchImpl = f;
}
const f: Fetch = (...a) => (fetchImpl || fetch)(...a);
async function must(r: Response, what: string): Promise<Response> {
  if (r.ok) return r;
  const body = (await r.text().catch(() => "")).slice(0, 200);
  throw new Error(`${what}: ${r.status} ${body}`);
}

// ---------------------------------------------------------------- Daytona (REST: app API + per-sandbox toolbox proxy)
export const daytonaConfigured = () => Boolean((process.env.DAYTONA_API_KEY || "").trim());
export function daytonaDriver(): SbxDriver {
  const api = () => (process.env.DAYTONA_API_URL || "https://app.daytona.io/api").replace(/\/+$/, "");
  const hdr = (): Record<string, string> => {
    const key = (process.env.DAYTONA_API_KEY || "").trim();
    if (!key) throw new Error("daytona not configured");
    return { Authorization: `Bearer ${key}` };
  };
  const wrap = (sb: { id: string; toolboxProxyUrl?: string }): SbxHandle => {
    const tb = `${(sb.toolboxProxyUrl || "https://proxy.app.daytona.io/toolbox").replace(/\/+$/, "")}/${sb.id}`;
    const run = async (command: string, cwd: string | undefined, timeoutMs: number): Promise<ExecResult> => {
      const r = await must(
        await f(`${tb}/process/execute`, {
          method: "POST",
          headers: { ...hdr(), "Content-Type": "application/json" },
          body: JSON.stringify({ command, cwd, timeout: Math.max(1, Math.ceil(timeoutMs / 1000)) }),
          signal: AbortSignal.timeout(timeoutMs + 5000),
        }),
        "daytona exec",
      );
      const j = (await r.json()) as { exitCode?: number; result?: string };
      return { exitCode: typeof j.exitCode === "number" ? j.exitCode : null, stdout: j.result || "", stderr: "" };
    };
    return {
      home: "/home/daytona",
      async exec(cmd, args, o) {
        const line = cmdLine(cmd, args);
        if (o.detached) {
          await run(`bash -c ${sh(`nohup ${line} >/dev/null 2>&1 &`)}`, o.cwd, 10000);
          return { exitCode: null, stdout: "", stderr: "" };
        }
        return run(`bash -c ${sh(o.sudo ? `sudo ${line}` : line)}`, o.cwd, o.timeoutMs);
      },
      async write(files) {
        for (const file of files) {
          const form = new FormData();
          form.append("file", new Blob([new Uint8Array(file.content)]), file.path.split("/").pop() || "file");
          await must(await f(`${tb}/files/upload-v2?path=${encodeURIComponent(file.path)}`, { method: "POST", headers: hdr(), body: form, signal: AbortSignal.timeout(30000) }), "daytona upload");
        }
      },
      async read(path) {
        const r = await f(`${tb}/files/download?path=${encodeURIComponent(path)}`, { headers: hdr(), signal: AbortSignal.timeout(20000) });
        if (r.status === 404 || r.status === 400) return null;
        await must(r, "daytona download");
        return Buffer.from(await r.arrayBuffer());
      },
      async extend() {
        /* auto-stop counts from the last activity */
      },
      async stop() {
        await f(`${api()}/sandbox/${sb.id}`, { method: "DELETE", headers: hdr(), signal: AbortSignal.timeout(15000) }).catch(() => null);
      },
    };
  };
  return {
    async get(name) {
      if (!daytonaConfigured()) return null;
      const r = await f(`${api()}/sandbox/${encodeURIComponent(name)}`, { headers: hdr(), signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const sb = (await r.json()) as { id: string; state?: string; toolboxProxyUrl?: string };
      return sb?.id && String(sb.state || "") === "started" ? wrap(sb) : null;
    },
    async create(name, o) {
      if (!daytonaConfigured()) throw new Error("daytona not configured");
      const r = await must(
        await f(`${api()}/sandbox`, {
          method: "POST",
          headers: { ...hdr(), "Content-Type": "application/json" },
          body: JSON.stringify({ name, labels: o.tags, cpu: Math.min(2, o.vcpus), memory: 2, disk: 5, autoStopInterval: Math.ceil(o.timeoutMs / 60000), autoDeleteInterval: 0 }),
          signal: AbortSignal.timeout(30000),
        }),
        "daytona create",
      );
      let sb = (await r.json()) as { id: string; state?: string; toolboxProxyUrl?: string };
      for (let i = 0; i < 30 && sb.state !== "started"; i++) {
        if (/error|failed/.test(String(sb.state))) throw new Error(`daytona sandbox ${sb.state}`);
        await new Promise((res) => setTimeout(res, 1000));
        const g = await f(`${api()}/sandbox/${sb.id}`, { headers: hdr(), signal: AbortSignal.timeout(10000) });
        if (g.ok) sb = (await g.json()) as typeof sb;
      }
      if (sb.state !== "started") throw new Error("daytona sandbox did not start in time");
      return wrap(sb);
    },
  };
}

// ---------------------------------------------------------------- E2B (REST control plane + envd: REST files, Connect-JSON process)
export const e2bConfigured = () => Boolean((process.env.E2B_API_KEY || "").trim());
/** Connect streaming envelopes: [flags:1][len:4 BE][json]. */
export function parseEnvelopes(buf: Uint8Array): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const len = (buf[i + 1] << 24) | (buf[i + 2] << 16) | (buf[i + 3] << 8) | buf[i + 4];
    const body = buf.slice(i + 5, i + 5 + len);
    i += 5 + len;
    try {
      out.push(JSON.parse(new TextDecoder().decode(body)));
    } catch {
      /* skip */
    }
  }
  return out;
}
function envelope(obj: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(obj));
  const out = new Uint8Array(5 + body.length);
  new DataView(out.buffer).setUint32(1, body.length);
  out.set(body, 5);
  return out;
}
export function e2bDriver(): SbxDriver {
  const api = () => (process.env.E2B_API_URL || "https://api.e2b.dev").replace(/\/+$/, "");
  const domain = () => (process.env.E2B_DOMAIN || "e2b.app").trim();
  const hdr = (): Record<string, string> => {
    const key = (process.env.E2B_API_KEY || "").trim();
    if (!key) throw new Error("e2b not configured");
    return { "X-API-KEY": key };
  };
  const wrap = (sb: { sandboxID: string; envdAccessToken?: string }): SbxHandle => {
    const base = `https://49983-${sb.sandboxID}.${domain()}`;
    const h = (): Record<string, string> => ({ Authorization: `Basic ${Buffer.from("user:").toString("base64")}`, ...(sb.envdAccessToken ? { "X-Access-Token": sb.envdAccessToken } : {}) });
    const start = async (line: string, cwd: string | undefined, timeoutMs: number): Promise<ExecResult> => {
      const r = await must(
        await f(`${base}/process.Process/Start`, {
          method: "POST",
          headers: { ...h(), "Content-Type": "application/connect+json", "Connect-Protocol-Version": "1", "Connect-Timeout-Ms": String(timeoutMs) },
          body: envelope({ process: { cmd: "/bin/bash", args: ["-l", "-c", line], envs: {}, cwd } }) as unknown as BodyInit,
          signal: AbortSignal.timeout(timeoutMs + 5000),
        }),
        "e2b exec",
      );
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      for (const m of parseEnvelopes(new Uint8Array(await r.arrayBuffer())) as any[]) {
        const ev = m?.event;
        if (ev?.data?.stdout) stdout += Buffer.from(ev.data.stdout, "base64").toString("utf8");
        if (ev?.data?.stderr) stderr += Buffer.from(ev.data.stderr, "base64").toString("utf8");
        if (ev?.end) exitCode = typeof ev.end.exitCode === "number" ? ev.end.exitCode : 0;
        if (m?.error) throw new Error(`e2b exec: ${String(m.error.message || m.error.code || "error").slice(0, 200)}`);
      }
      return { exitCode, stdout, stderr };
    };
    return {
      home: "/home/user",
      async exec(cmd, args, o) {
        const line = cmdLine(cmd, args);
        if (o.detached) {
          await start(`nohup ${line} >/dev/null 2>&1 &`, o.cwd, 10000);
          return { exitCode: null, stdout: "", stderr: "" };
        }
        return start(o.sudo ? `sudo ${line}` : line, o.cwd, o.timeoutMs);
      },
      async write(files) {
        for (const file of files) {
          const form = new FormData();
          form.append("file", new Blob([new Uint8Array(file.content)]), file.path);
          await must(await f(`${base}/files?path=${encodeURIComponent(file.path)}&username=user`, { method: "POST", headers: h(), body: form, signal: AbortSignal.timeout(30000) }), "e2b upload");
        }
      },
      async read(path) {
        const r = await f(`${base}/files?path=${encodeURIComponent(path)}&username=user`, { headers: h(), signal: AbortSignal.timeout(20000) });
        if (r.status === 404 || r.status === 400) return null;
        await must(r, "e2b download");
        return Buffer.from(await r.arrayBuffer());
      },
      async extend(ms) {
        await f(`${api()}/sandboxes/${sb.sandboxID}/timeout`, { method: "POST", headers: { ...hdr(), "Content-Type": "application/json" }, body: JSON.stringify({ timeout: Math.ceil(ms / 1000) }) }).catch(() => null);
      },
      async stop() {
        await f(`${api()}/sandboxes/${sb.sandboxID}`, { method: "DELETE", headers: hdr(), signal: AbortSignal.timeout(15000) }).catch(() => null);
      },
    };
  };
  return {
    async get(name) {
      if (!e2bConfigured()) return null;
      const r = await f(`${api()}/sandboxes?metadata=${encodeURIComponent(`coder=${name}`)}`, { headers: hdr(), signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const list = (await r.json()) as { sandboxID: string; metadata?: Record<string, string>; envdAccessToken?: string }[];
      const hit = Array.isArray(list) ? list.find((x) => x?.metadata?.coder === name) : null;
      if (!hit) return null;
      // the list omits the envd access token; the detail has it
      const d = await f(`${api()}/sandboxes/${hit.sandboxID}`, { headers: hdr(), signal: AbortSignal.timeout(15000) });
      return d.ok ? wrap({ ...hit, ...((await d.json()) as object) }) : null;
    },
    async create(name, o) {
      if (!e2bConfigured()) throw new Error("e2b not configured");
      const r = await must(
        await f(`${api()}/sandboxes`, {
          method: "POST",
          headers: { ...hdr(), "Content-Type": "application/json" },
          body: JSON.stringify({ templateID: process.env.E2B_TEMPLATE || "base", timeout: Math.min(3600, Math.ceil(o.timeoutMs / 1000)), metadata: { coder: name, ...o.tags }, secure: true }),
          signal: AbortSignal.timeout(30000),
        }),
        "e2b create",
      );
      return wrap((await r.json()) as { sandboxID: string; envdAccessToken?: string });
    },
  };
}
