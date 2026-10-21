#!/usr/bin/env node
// Capped sandbox runner for the SHAM AI coder bot (src/lib/coderSandboxRunner.ts is its client).
// One small HTTP server; every task ("box") gets its own throw-away environment:
//   RUNNER_MODE=docker  (Oracle VM)  an ephemeral container per box with hard limits: 1 CPU, 2 GiB RAM (no swap), 256 PIDs,
//                       read-only root, size-capped tmpfs for /work and /tmp, no capabilities, no new privileges, no host mounts,
//                       its own bridge network with inter-container traffic off, and a hard expiry (reaped automatically).
//   RUNNER_MODE=local   (a VM that is already disposable: CodeSandbox / Codespaces)  a directory per box on that VM.
// It yields to Sham: when the flag file SHAM_FLAG_FILE exists, or free host memory is below RUNNER_MIN_FREE_MB, or RUNNER_MAX_BOXES
// boxes are running, new boxes are refused with 503 so the bot's failover moves to the next backend.
// Auth: header x-runner-key must equal RUNNER_SECRET (constant-time compare). No secret = refuses to start.
// API (JSON): GET /health · POST /v1/boxes {name,timeoutMs} · GET /v1/boxes/:name · DELETE /v1/boxes/:name
//   POST /v1/boxes/:name/exec {cmd,args,cwd,timeoutMs,detached} · PUT /v1/boxes/:name/files {path,contentB64}
//   GET /v1/boxes/:name/files?path=… (raw bytes) · POST /v1/boxes/:name/extend {ms}
import http from "node:http";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, promises as fsp } from "node:fs";
import path from "node:path";

export function config(env = process.env) {
  const num = (k, d, lo, hi) => Math.max(lo, Math.min(hi, Number(env[k] || d) || d));
  return {
    mode: (env.RUNNER_MODE || "docker").trim() === "local" ? "local" : "docker",
    secret: (env.RUNNER_SECRET || "").trim(),
    port: num("RUNNER_PORT", 8790, 1, 65535),
    host: env.RUNNER_HOST || "127.0.0.1",
    image: env.RUNNER_IMAGE || "coder-sandbox-box:latest",
    network: env.RUNNER_NETWORK || "coder-sbx-net",
    bridge: env.RUNNER_BRIDGE || "br-coder-sbx",
    cpus: String(num("RUNNER_CPUS", 1, 0.25, 2)),
    memoryMb: num("RUNNER_MEMORY_MB", 2048, 512, 3072),
    pids: num("RUNNER_PIDS", 256, 64, 1024),
    workMb: num("RUNNER_WORK_MB", 1024, 128, 2048),
    tmpMb: num("RUNNER_TMP_MB", 256, 64, 1024),
    maxBoxes: num("RUNNER_MAX_BOXES", 2, 1, 6),
    maxTimeoutMs: num("RUNNER_MAX_TIMEOUT_MIN", 45, 5, 120) * 60000,
    execMaxMs: num("RUNNER_EXEC_MAX_SEC", 300, 10, 1800) * 1000,
    minFreeMb: num("RUNNER_MIN_FREE_MB", 3000, 0, 64000),
    shamFlag: env.SHAM_FLAG_FILE || "/host-flags/SHAM_ON",
    localRoot: env.RUNNER_LOCAL_ROOT || "/tmp/coder-boxes",
    maxReadBytes: 5 * 1024 * 1024,
  };
}

export const NAME_RX = /^[a-z0-9][a-z0-9-]{2,62}$/;
export const containerName = (name) => `csbx-${name}`;

/** Free host memory in MB from /proc/meminfo (null when unknown). */
export function freeMemMb(text) {
  const m = /MemAvailable:\s+(\d+)\s+kB/.exec(text || "");
  return m ? Math.round(Number(m[1]) / 1024) : null;
}

/** Why a new box must be refused right now (null = accept). */
export function refusal(cfg, state) {
  if (state.shamOn) return "sham-busy";
  if (state.freeMb !== null && state.freeMb < cfg.minFreeMb) return "low-memory";
  if (state.active >= cfg.maxBoxes) return "capacity";
  return null;
}

/** docker run arguments for one box: every limit in one place. */
export function dockerRunArgs(cfg, name, expiresAt) {
  return [
    "run", "-d", "--name", containerName(name),
    "--label", "coder-sandbox=1", "--label", `coder-sandbox.expires=${expiresAt}`,
    "--cpus", cfg.cpus, "--memory", `${cfg.memoryMb}m`, "--memory-swap", `${cfg.memoryMb}m`, "--pids-limit", String(cfg.pids),
    "--read-only",
    "--tmpfs", `/work:rw,exec,nosuid,size=${cfg.workMb}m,uid=1000,gid=1000,mode=0755`,
    "--tmpfs", `/tmp:rw,exec,nosuid,size=${cfg.tmpMb}m,mode=1777`,
    "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--network", cfg.network, "--dns", "1.1.1.1", "--dns", "8.8.8.8", "--workdir", "/work", "-e", "HOME=/work",
    "--stop-timeout", "2", "--restart", "no",
    cfg.image, "sleep", "infinity",
  ];
}

/** Runs a program, collecting output (capped), killing it after timeoutMs. */
export function runProc(cmd, args, { input, timeoutMs = 60000, cwd, maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let out = Buffer.alloc(0);
    let err = "";
    let done = false;
    const p = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const t = setTimeout(() => { if (!done) { err += `\n[killed after ${Math.round(timeoutMs / 1000)}s]`; p.kill("SIGKILL"); } }, timeoutMs);
    p.stdout.on("data", (d) => { if (out.length < maxBytes) out = Buffer.concat([out, d]).subarray(0, maxBytes); });
    p.stderr.on("data", (d) => { if (err.length < 200000) err += d.toString(); });
    p.on("error", (e) => { err += String(e.message || e); });
    p.on("close", (code) => { done = true; clearTimeout(t); resolve({ code, out, err }); });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const line = (cmd, args) => [cmd, ...(args || [])].map((x) => (/^[\w@%+=:,./-]+$/.test(String(x)) ? String(x) : sh(x))).join(" ");

/** The box backend. `run` is injectable for tests. */
export function makeBoxes(cfg, run = runProc, now = () => Date.now()) {
  const local = new Map(); // local mode: name -> { expiresAt }
  const extended = new Map(); // docker mode: name -> extended expiry
  const home = (name) => (cfg.mode === "docker" ? "/work" : path.join(cfg.localRoot, name));
  const api = {
    home,
    async list() {
      if (cfg.mode === "local") return [...local.entries()].map(([name, b]) => ({ name, expiresAt: b.expiresAt }));
      const r = await run("docker", ["ps", "-a", "--filter", "label=coder-sandbox=1", "--format", '{{.Names}} {{.Label "coder-sandbox.expires"}}'], { timeoutMs: 15000 });
      return r.out.toString().split("\n").map((l) => l.trim().split(" ")).filter((p) => p[0]?.startsWith("csbx-"))
        .map(([n, e]) => ({ name: n.slice(5), expiresAt: Number(e) || 0 }));
    },
    async get(name) {
      return (await api.list()).find((b) => b.name === name) || null;
    },
    async ensureNetwork() {
      if (cfg.mode !== "docker") return;
      const r = await run("docker", ["network", "inspect", cfg.network], { timeoutMs: 15000 });
      if (r.code === 0) return;
      await run("docker", ["network", "create", "--driver", "bridge", "--opt", "com.docker.network.bridge.enable_icc=false", "--opt", `com.docker.network.bridge.name=${cfg.bridge}`, "--label", "coder-sandbox=1", cfg.network], { timeoutMs: 20000 });
    },
    async create(name, timeoutMs) {
      const expiresAt = now() + Math.min(cfg.maxTimeoutMs, Math.max(60000, Number(timeoutMs) || cfg.maxTimeoutMs));
      if (cfg.mode === "local") {
        await fsp.mkdir(home(name), { recursive: true });
        local.set(name, { expiresAt });
        return { name, expiresAt, home: home(name) };
      }
      await api.ensureNetwork();
      const r = await run("docker", dockerRunArgs(cfg, name, expiresAt), { timeoutMs: 60000 });
      if (r.code !== 0) throw new Error(`docker run failed: ${r.err.slice(0, 200)}`);
      return { name, expiresAt, home: home(name) };
    },
    async exec(name, b) {
      const timeoutMs = Math.min(cfg.execMaxMs, Math.max(1000, Number(b.timeoutMs) || 60000));
      const cmdline = line(String(b.cmd || "bash"), Array.isArray(b.args) ? b.args.map(String) : []);
      const cwd = b.cwd ? String(b.cwd) : home(name);
      if (cfg.mode === "local") {
        const full = b.detached ? `nohup ${cmdline} >/dev/null 2>&1 &` : cmdline;
        const r = await run("bash", ["-c", full], { timeoutMs: b.detached ? 10000 : timeoutMs, cwd: existsSync(cwd) ? cwd : home(name) });
        return { exitCode: b.detached ? null : r.code, stdout: b.detached ? "" : r.out.toString(), stderr: b.detached ? "" : r.err };
      }
      const args = ["exec", ...(b.detached ? ["-d"] : []), "-w", cwd, containerName(name), "bash", "-c", cmdline];
      const r = await run("docker", args, { timeoutMs: b.detached ? 15000 : timeoutMs + 5000 });
      return { exitCode: b.detached ? null : r.code, stdout: b.detached ? "" : r.out.toString(), stderr: b.detached ? "" : r.err };
    },
    async write(name, p, content) {
      if (cfg.mode === "local") {
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, content);
        return;
      }
      const r = await run("docker", ["exec", "-i", containerName(name), "sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", p], { input: content, timeoutMs: 60000 });
      if (r.code !== 0) throw new Error(`write failed: ${r.err.slice(0, 200)}`);
    },
    async read(name, p) {
      if (cfg.mode === "local") {
        try {
          const st = await fsp.stat(p);
          if (!st.isFile()) return null;
          const fh = await fsp.open(p, "r");
          try { const buf = Buffer.alloc(Math.min(st.size, cfg.maxReadBytes)); await fh.read(buf, 0, buf.length, 0); return buf; } finally { await fh.close(); }
        } catch { return null; }
      }
      const r = await run("docker", ["exec", containerName(name), "sh", "-c", 'test -f "$1" && head -c ' + cfg.maxReadBytes + ' "$1"', "sh", p], { timeoutMs: 30000, maxBytes: cfg.maxReadBytes });
      return r.code === 0 ? r.out : null;
    },
    async extend(name, ms) {
      const b = await api.get(name);
      if (!b) return false;
      const next = Math.min(now() + cfg.maxTimeoutMs, Math.max(b.expiresAt, now() + Math.max(0, Number(ms) || 0)));
      if (cfg.mode === "local") { local.get(name).expiresAt = next; return true; }
      // labels cannot change on a running container: extensions live in the runner's memory (never inside the box, so a job cannot
      // extend itself); after a runner restart the label's original expiry applies again
      extended.set(name, next);
      return true;
    },
    async remove(name) {
      if (cfg.mode === "local") {
        local.delete(name);
        await fsp.rm(home(name), { recursive: true, force: true }).catch(() => null);
        return;
      }
      await run("docker", ["rm", "-f", containerName(name)], { timeoutMs: 30000 });
      extended.delete(name);
    },
    /** Removes every expired box. */
    async reap() {
      const removed = [];
      for (const b of await api.list()) {
        let exp = b.expiresAt;
        if (cfg.mode === "docker") exp = Math.max(exp, extended.get(b.name) || 0);
        if (!exp || exp <= now()) { await api.remove(b.name); extended.delete(b.name); removed.push(b.name); }
      }
      return removed;
    },
  };
  return api;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Host state used for the yield decision. */
export async function hostState(cfg, boxes) {
  let freeMb = null;
  try { freeMb = freeMemMb(readFileSync("/proc/meminfo", "utf8")); } catch { /* unknown */ }
  return { shamOn: existsSync(cfg.shamFlag), freeMb, active: (await boxes.list()).length };
}

export function makeHandler(cfg, boxes, state = () => hostState(cfg, boxes)) {
  const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  const body = (req, max = 4 * 1024 * 1024) => new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on("data", (d) => { size += d.length; if (size > max) { reject(new Error("too large")); req.destroy(); } else parts.push(d); });
    req.on("end", () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
  return async (req, res) => {
    try {
      const u = new URL(req.url, "http://runner");
      if (!safeEqual(req.headers["x-runner-key"] || "", cfg.secret)) return json(res, 401, { error: "unauthorized" });
      if (u.pathname === "/health") {
        const s = await state();
        const why = refusal(cfg, s);
        return json(res, 200, { ok: true, mode: cfg.mode, accepting: !why, reason: why, active: s.active, max: cfg.maxBoxes, freeMb: s.freeMb,
          limits: { cpus: cfg.cpus, memoryMb: cfg.memoryMb, pids: cfg.pids, workMb: cfg.workMb, tmpMb: cfg.tmpMb, maxTimeoutMin: cfg.maxTimeoutMs / 60000 } });
      }
      const m = /^\/v1\/boxes(?:\/([^/]+))?(\/exec|\/files|\/extend)?$/.exec(u.pathname);
      if (!m) return json(res, 404, { error: "not found" });
      const name = m[1] ? decodeURIComponent(m[1]) : "";
      const sub = m[2] || "";
      if (!name && req.method === "POST") {
        const b = await body(req);
        const n = String(b.name || "");
        if (!NAME_RX.test(n)) return json(res, 400, { error: "bad name" });
        if (await boxes.get(n)) return json(res, 200, { name: n, home: boxes.home(n), existed: true });
        const why = refusal(cfg, await state());
        if (why) return json(res, 503, { error: `not accepting new boxes: ${why}` });
        return json(res, 201, await boxes.create(n, b.timeoutMs));
      }
      if (!NAME_RX.test(name)) return json(res, 400, { error: "bad name" });
      const box = await boxes.get(name);
      if (!box) return json(res, 404, { error: "no such box" });
      if (!sub && req.method === "GET") return json(res, 200, { name, home: boxes.home(name), expiresAt: box.expiresAt });
      if (!sub && req.method === "DELETE") { await boxes.remove(name); return json(res, 200, { ok: true }); }
      if (sub === "/exec" && req.method === "POST") return json(res, 200, await boxes.exec(name, await body(req)));
      if (sub === "/extend" && req.method === "POST") return json(res, 200, { ok: await boxes.extend(name, (await body(req)).ms) });
      if (sub === "/files" && req.method === "PUT") {
        const b = await body(req, 4 * 1024 * 1024);
        const p = String(b.path || "");
        if (!p.startsWith("/")) return json(res, 400, { error: "absolute path required" });
        await boxes.write(name, p, Buffer.from(String(b.contentB64 || ""), "base64"));
        return json(res, 200, { ok: true });
      }
      if (sub === "/files" && req.method === "GET") {
        const p = String(u.searchParams.get("path") || "");
        if (!p.startsWith("/")) return json(res, 400, { error: "absolute path required" });
        const buf = await boxes.read(name, p);
        if (!buf) return json(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(buf);
      }
      return json(res, 405, { error: "method not allowed" });
    } catch (e) {
      return json(res, /too large|bad json/.test(String(e?.message)) ? 400 : 500, { error: String(e?.message || e).slice(0, 300) });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = config();
  if (!cfg.secret || cfg.secret.length < 24) { console.error("RUNNER_SECRET (24+ chars) is required"); process.exit(1); }
  const boxes = makeBoxes(cfg);
  await boxes.ensureNetwork().catch((e) => console.error("network:", e.message));
  await boxes.reap().catch(() => null);
  setInterval(() => { boxes.reap().catch(() => null); }, 60000).unref();
  http.createServer(makeHandler(cfg, boxes)).listen(cfg.port, cfg.host, () => console.log(`coder-sandbox runner (${cfg.mode}) on ${cfg.host}:${cfg.port}`));
}
