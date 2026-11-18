/**
 * A user's own device (the Telegram Mini App / browser, or any JS runtime) as a node of the terminal mesh.
 * Same wire protocol as ai-system/terminal/mesh_net.py and the relay cloudflare/sham-mesh-worker.js; no server code, no dependencies,
 * WebCrypto Ed25519 only (node id = base64url public key). Written so `node --experimental-strip-types` can run it as is (CI e2e).
 *
 * Rules (owner, 2026-11-18):
 *  - governed only by the owner's one switch (src/lib/meshPolicy.ts, default off) and silent to users (no notice, badge or log);
 *    one mesh per model with its own key, so switching the model switches the mesh (no cross-model routing);
 *  - local-first: the key, the lessons and the counters live on the device only; with no relay everything is simply off;
 *  - the device never runs a shell command for anybody: it gives (a) idle compute = pure, verifiable jobs (sha256 / exact_eval) only while
 *    the app is visible and idle, the requester re-checks every shard; (b) knowledge = it answers a peer's `propose` only from lessons it
 *    has itself verified (signature + hash) and vetted (strict book policy + the owner deny list, which applies to everybody), zero model calls;
 *  - no personal data leaves the device: a lesson is published only when task and command pass the same secret/PII screen as mesh.py;
 *    a peer's task that looks personal is not answered.
 */

export const MESH_URL = "https://sham-mesh.jonsnowx1r.workers.dev";

/** One mesh per model. A model that is not listed has no mesh. */
export const MODEL_MESH: Record<string, string> = { sham_v2: "sham2", sham: "sham1", coder: "nova1", nova2: "nova2" };
export function meshForModel(model: string): string | null {
  return MODEL_MESH[String(model || "")] || null;
}

const enc = new TextEncoder();
const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) throw new Error("WebCrypto is not available");
  return c.subtle;
};

// ------------------------------------------------------------------ encoding
export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export async function sha256hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const d = new Uint8Array(await subtle().digest("SHA-256", bytes as BufferSource));
  let out = "";
  for (const b of d) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Python's json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False): the exact bytes that are signed. */
export function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error("signed objects carry ints only");
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  }
  throw new Error("unsupported value");
}

// ------------------------------------------------------------------ identity
export type SavedKey = { id: string; jwk: JsonWebKey };

export class MeshIdentity {
  readonly id: string;
  private key: CryptoKey;

  private constructor(id: string, key: CryptoKey) {
    this.id = id;
    this.key = key;
  }

  static async generate(): Promise<MeshIdentity> {
    const kp = (await subtle().generateKey({ name: "Ed25519" } as Algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = new Uint8Array(await subtle().exportKey("raw", kp.publicKey));
    return new MeshIdentity(b64u(pub), kp.privateKey);
  }

  static async load(saved: SavedKey): Promise<MeshIdentity> {
    const key = await subtle().importKey("jwk", saved.jwk, { name: "Ed25519" } as Algorithm, true, ["sign"]);
    return new MeshIdentity(saved.id, key);
  }

  async save(): Promise<SavedKey> {
    return { id: this.id, jwk: await subtle().exportKey("jwk", this.key) };
  }

  async sign(msg: Uint8Array | string): Promise<string> {
    const bytes = typeof msg === "string" ? enc.encode(msg) : msg;
    return b64u(new Uint8Array(await subtle().sign({ name: "Ed25519" } as Algorithm, this.key, bytes as BufferSource)));
  }

  /** obj + {by, sig}: the signature covers canon(obj without sig). Same as mesh_crypto.Identity.sign_obj. */
  async signObj<T extends Record<string, unknown>>(obj: T): Promise<T & { by: string; sig: string }> {
    const body: Record<string, unknown> = { ...obj };
    delete body.sig;
    body.by = this.id;
    body.sig = await this.sign(canon(body));
    return body as T & { by: string; sig: string };
  }
}

export async function verify(nodeId: string, msg: Uint8Array | string, sig: string): Promise<boolean> {
  try {
    const pub = unb64u(nodeId);
    const s = unb64u(sig);
    if (pub.length !== 32 || s.length !== 64) return false;
    const key = await subtle().importKey("raw", pub as BufferSource, { name: "Ed25519" } as Algorithm, false, ["verify"]);
    return await subtle().verify({ name: "Ed25519" } as Algorithm, key, s as BufferSource, (typeof msg === "string" ? enc.encode(msg) : msg) as BufferSource);
  } catch {
    return false;
  }
}

export async function verifyObj(obj: unknown, by?: string): Promise<boolean> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.sig !== "string" || typeof o.by !== "string") return false;
  if (by !== undefined && o.by !== by) return false;
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (k !== "sig") body[k] = o[k];
  try {
    return await verify(o.by, canon(body), o.sig);
  } catch {
    return false;
  }
}

/** True when WebCrypto Ed25519 works here (older Telegram WebViews lack it: the switch is then shown as unsupported). */
export async function ed25519Supported(): Promise<boolean> {
  try {
    const id = await MeshIdentity.generate();
    return await verify(id.id, "x", await id.sign("x"));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ lessons and policy (ports of mesh.py / sandbox_terminal.py)
export async function lessonHash(task: string, command: string): Promise<string> {
  return (await sha256hex(task.trim().toLowerCase() + "\n" + command.trim())).slice(0, 16);
}

const FILLER = new Set(["please", "kindly", "now", "the", "a", "an", "me", "my", "can", "you", "could", "للتو", "لو", "سمحت", "فضلك", "من", "ممكن", "الآن"]);
export function norm(task: string): Set<string> {
  const words = (String(task || "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).filter((w) => !FILLER.has(w));
  return new Set(words);
}
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** mesh.py SECRETISH + the obvious personal data: e-mails, links, long tokens, credentials words, phone / card-like digit runs, home paths. */
const SECRETISH = /(@[\w.-]+\.\w+|https?:\/\/|\b[A-Za-z0-9_-]{28,}\b|password|passwd|token|secret|كلمة المرور|رمز)/i;
const PII = /(\+?\d[\d\s-]{7,}\d|\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
export function shareable(text: string): boolean {
  const t = String(text || "");
  return !!t.trim() && !SECRETISH.test(t) && !PII.test(t);
}

const ALLOWED = new Set(["ls", "cat", "echo", "pwd", "head", "tail", "wc", "grep", "sort", "uniq", "touch", "date", "seq", "tr", "cut", "basename", "dirname", "stat", "python3", "true", "false"]);
const CONFIRM = new Set(["rm", "mv", "cp", "mkdir"]);

/** The strict book policy (sandbox_terminal.SandboxTerminal.vet, simplified): '' = acceptable as a lesson, else why not. */
export function vetCommand(command: string): string {
  const c = String(command || "").trim();
  if (!c) return "empty";
  if (c.length > 500) return "too long";
  if (/[;&`\n\r]|\$\(|\|\||<\(/.test(c)) return "shell control characters";
  const stages = c.split(/\s*\|\s*/);
  for (let i = 0; i < stages.length; i++) {
    let st = stages[i];
    const red = st.match(/\s*(>>?)\s*(\S+)\s*$/);
    if (red) {
      if (i !== stages.length - 1) return "redirect before a pipe";
      if (!inside(red[2])) return `redirect target '${red[2]}' is outside the working directory`;
      st = st.slice(0, red.index);
    }
    const argv = st.trim().split(/\s+/);
    const cmd = argv[0] || "";
    if (!ALLOWED.has(cmd) && !CONFIRM.has(cmd)) return `${cmd} is not allowed`;
    for (const a of argv.slice(1)) if (!a.startsWith("-") && !inside(a.replace(/^['"]|['"]$/g, ""))) return `path '${a}' is outside the working directory`;
  }
  return "";
}
function inside(p: string): boolean {
  return !p.startsWith("/") && !p.startsWith("~") && !p.split("/").includes("..");
}

/** The owner deny list (src/lib/tldmPolicy.ts tldmDeniedByOwner): case-insensitive substring, or re:<regex>. Applies to every user. */
export function deniedByOwner(command: string, patterns: string[]): string {
  const cmd = String(command || "");
  for (const pat of patterns || []) {
    if (pat.toLowerCase().startsWith("re:")) {
      try {
        if (new RegExp(pat.slice(3), "i").test(cmd)) return `owner deny-list: ${pat}`;
      } catch {
        continue;
      }
    } else if (pat && cmd.toLowerCase().includes(pat.toLowerCase())) return `owner deny-list: ${pat}`;
  }
  return "";
}

// ------------------------------------------------------------------ relay client
export class MeshError extends Error {}

export class RelayClient {
  readonly base: string;
  readonly root: string;
  private ident: MeshIdentity;

  constructor(url: string, mesh: string, ident: MeshIdentity) {
    if (!/^[a-z0-9-]{1,32}$/.test(mesh)) throw new Error("bad mesh name");
    this.root = url.replace(/\/+$/, "");
    this.base = this.root + "/m/" + mesh + "/";
    this.ident = ident;
  }

  async req(method: "GET" | "POST", route: string, body?: unknown, query = "", timeoutMs = 20000): Promise<Record<string, any>> {
    const data = body === undefined ? "" : JSON.stringify(body);
    const url = this.base + route + (query ? "?" + query : "");
    const pathq = new URL(url).pathname + (query ? "?" + query : "");
    const ts = String(Date.now());
    const sig = await this.ident.sign(`${method}\n${pathq}\n${ts}\n${await sha256hex(enc.encode(method === "GET" ? "" : data))}`);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method,
        body: method === "GET" ? undefined : data,
        headers: { "content-type": "application/json", "x-mesh-node": this.ident.id, "x-mesh-ts": ts, "x-mesh-sig": sig },
        signal: ctl.signal,
        cache: "no-store",
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, any>;
      if (!r.ok) throw new MeshError(`${r.status} ${j.error || ""}`.trim());
      return j;
    } catch (e) {
      if (e instanceof MeshError) throw e;
      throw new MeshError("offline");
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<Record<string, any>> {
    const r = await fetch(this.base + "health", { cache: "no-store" });
    return (await r.json()) as Record<string, any>;
  }
  hello(slots: number, caps: Record<string, boolean>) { return this.req("POST", "hello", { slots, caps }); }
  bye() { return this.req("POST", "bye", {}); }
  send(to: string[] | "*", kind: string, body: unknown) { return this.req("POST", "send", { to, kind, body }); }
  poll(wait = 20) { return this.req("GET", "poll", undefined, `wait=${wait}`, (wait + 15) * 1000); }
  lessons(since = 0, limit = 200) { return this.req("GET", "lessons", undefined, `since=${since}&limit=${limit}`); }
  putLesson(lesson: unknown) { return this.req("POST", "lessons", { lesson }); }
  report(h: string, why: string) { return this.req("POST", "report", { h, why }); }
}

// ------------------------------------------------------------------ pure jobs (mesh_net.JOBS): deterministic, the requester can recompute any item
export async function runJob(job: string, args: Record<string, any>): Promise<unknown[]> {
  if (job === "sha256") {
    const out: string[] = [];
    for (const c of (args.chunks || []) as string[]) {
      const bin = atob(String(c));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      out.push(await sha256hex(bytes));
    }
    return out;
  }
  if (job === "exact_eval") return ((args.items || []) as { pred: unknown; ref: unknown }[]).map((it) => String(it.pred).trim() === String(it.ref).trim());
  throw new Error("unknown job");
}

// ------------------------------------------------------------------ the device node
export type Lesson = { task: string; command: string; h: string; by: string };
export type MeshStats = { online: boolean; peers: number; lessons: number; lessons_rejected: number; forged_rejected: number; jobs_served: number; proposals_served: number; lessons_out: number };

export type DeviceNodeOptions = {
  url?: string;
  mesh: string;
  ident: MeshIdentity;
  /** owner deny list patterns, when the caller may see them (tests, the owner's own tools). */
  denyList?: () => string[];
  /** the owner deny list checked server-side without revealing it (Mini App: op mesh_vet): one reason per command, '' = allowed. */
  ownerCheck?: (commands: string[]) => Promise<string[]>;
  /** false while the user is busy / the app is hidden: no jobs, no proposals are served then (idle compute only). */
  idle?: () => boolean;
  /** persisted lessons (local-first): restore and save hooks. */
  restore?: Lesson[];
  persist?: (lessons: Lesson[]) => void;
  heartbeatMs?: number;
  pollWait?: number;
};

export class DeviceNode {
  readonly relay: RelayClient;
  readonly ident: MeshIdentity;
  readonly mesh: string;
  online = false;
  peers: { id: string; slots: number; caps: Record<string, boolean> }[] = [];
  pool = new Map<string, Lesson>();
  rejected = new Map<string, string>();
  stats = { lessons_rejected: 0, forged_rejected: 0, jobs_served: 0, proposals_served: 0, lessons_out: 0 };
  private cursor = 0;
  private stopped = false;
  private opts: DeviceNodeOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: DeviceNodeOptions) {
    this.opts = opts;
    this.ident = opts.ident;
    this.mesh = opts.mesh;
    this.relay = new RelayClient(opts.url || MESH_URL, opts.mesh, opts.ident);
    for (const L of opts.restore || []) this.pool.set(L.h, L);
  }

  caps() {
    return { propose: true, jobs: true, adapters: false };
  }

  status(): MeshStats {
    return { online: this.online, peers: this.peers.length, lessons: this.pool.size, ...this.stats };
  }

  private idle(): boolean {
    return this.opts.idle ? this.opts.idle() : true;
  }

  async start(): Promise<DeviceNode> {
    this.stopped = false;
    if (this.pool.size) await this.recheck();
    await this.join();
    void this.pollLoop();
    const beat = async () => {
      if (this.stopped) return;
      await this.join();
      this.timer = setTimeout(beat, this.opts.heartbeatMs ?? 25000);
    };
    this.timer = setTimeout(beat, this.opts.heartbeatMs ?? 25000);
    return this;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.online) await this.relay.bye().catch(() => null);
    this.online = false;
  }

  async join(): Promise<boolean> {
    try {
      const info = await this.relay.hello(1, this.caps());
      this.online = true;
      this.peers = ((info.peers || []) as typeof this.peers).filter((p) => p.id !== this.ident.id);
      if (Number(info.lessons_seq || 0) > this.cursor) await this.syncLessons();
      return true;
    } catch {
      this.online = false;
      this.peers = [];
      return false;
    }
  }

  /** Pull the lesson index; every lesson is re-verified (signature + hash) and vetted here before it is kept. -> lessons accepted now. */
  async syncLessons(): Promise<number> {
    let got = 0;
    for (;;) {
      let r: Record<string, any>;
      try {
        r = await this.relay.lessons(this.cursor);
      } catch {
        return got;
      }
      const rows = (r.lessons || []) as Record<string, any>[];
      const fresh = rows.map((row) => { const L: Record<string, any> = { ...row }; delete L.seq; return L; })
        .filter((L) => L.by !== this.ident.id && !this.pool.has(L.h) && !this.rejected.has(L.h));
      const owner = await this.ownerReasons(fresh.map((L) => String(L.command || "").trim()));
      for (let i = 0; i < fresh.length; i++) if (await this.accept(fresh[i], owner[i])) got++;
      this.cursor = Math.max(this.cursor, Number(r.seq || this.cursor));
      if (rows.length < 200) break;
    }
    this.opts.persist?.([...this.pool.values()]);
    return got;
  }

  vet(task: string, command: string): string {
    const why = vetCommand(command);
    if (why) return "policy: " + why;
    const d = deniedByOwner(command, this.opts.denyList ? this.opts.denyList() : []);
    if (d) return "deny: " + d;
    if (!shareable(task) || !shareable(command)) return "personal data";
    return "";
  }

  /** The owner deny list for many commands at once ('' = allowed). Fails closed: if the check cannot run, nothing is accepted or shared. */
  async ownerReasons(commands: string[]): Promise<string[]> {
    if (!commands.length || !this.opts.ownerCheck) return commands.map(() => "");
    try {
      const r = await this.opts.ownerCheck(commands);
      return commands.map((_, i) => (typeof r[i] === "string" ? r[i] : "owner check unavailable"));
    } catch {
      return commands.map(() => "owner check unavailable");
    }
  }

  /** Re-check the kept lessons against the current owner deny list (it may have changed since they were kept). */
  async recheck(): Promise<number> {
    const all = [...this.pool.values()];
    const reasons = await this.ownerReasons(all.map((L) => L.command));
    let dropped = 0;
    all.forEach((L, i) => {
      if (reasons[i]) { this.pool.delete(L.h); this.rejected.set(L.h, "deny: " + reasons[i]); dropped++; }
    });
    if (dropped) this.opts.persist?.([...this.pool.values()]);
    return dropped;
  }

  async accept(L: Record<string, any>, ownerReason = ""): Promise<boolean> {
    const task = String(L.task || "").trim();
    const command = String(L.command || "").trim();
    if (!(await verifyObj(L)) || L.h !== (await lessonHash(String(L.task || ""), String(L.command || "")))) {
      this.stats.forged_rejected++;
      return false;
    }
    if (this.pool.has(L.h)) return true;
    if (this.rejected.has(L.h)) return false;
    const why = this.vet(task, command) || (ownerReason ? "deny: " + ownerReason : "");
    if (why) {
      this.rejected.set(L.h, why);
      this.stats.lessons_rejected++;
      await this.relay.report(L.h, why).catch(() => null);
      return false;
    }
    this.pool.set(L.h, { task, command, h: L.h, by: String(L.by) });
    return true;
  }

  recall(task: string, threshold = 0.8): Lesson | null {
    const q = norm(task);
    let best: Lesson | null = null;
    let score = 0;
    for (const L of this.pool.values()) {
      const s = similarity(q, norm(L.task));
      if (s > score) { best = L; score = s; }
    }
    if (!best || score < threshold) return null;
    return this.vet(best.task, best.command) ? null : best;     // the deny list may have changed since the lesson was kept
  }

  /** Publish a lesson from the user's OWN successful work (the caller decides; e.g. the user tapped "share"). Refused when it looks personal. */
  async publish(task: string, command: string): Promise<{ ok: boolean; why?: string }> {
    const why = this.vet(task, command) || (await this.ownerReasons([command.trim()]))[0];
    if (why) return { ok: false, why };
    const L = await this.ident.signObj({ task: task.trim(), command: command.trim(), h: await lessonHash(task, command), ts: Date.now() });
    try {
      await this.relay.putLesson(L);
      this.pool.set(L.h, { task: L.task, command: L.command, h: L.h, by: this.ident.id });
      this.stats.lessons_out++;
      this.opts.persist?.([...this.pool.values()]);
      return { ok: true };
    } catch (e) {
      return { ok: false, why: String((e as Error).message || e) };
    }
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      if (!this.online) {
        await sleep(2000);
        continue;
      }
      let msgs: Record<string, any>[] = [];
      try {
        msgs = ((await this.relay.poll(this.opts.pollWait ?? 20)).msgs || []) as Record<string, any>[];
      } catch (e) {
        if (String((e as Error).message).startsWith("403")) await this.join();
        else await sleep(2000);
        continue;
      }
      for (const m of msgs) void this.handle(m);
    }
  }

  async handle(m: Record<string, any>): Promise<void> {
    const frm = String(m.from || "");
    const kind = String(m.kind || "");
    const body = m.body as Record<string, any>;
    if (!(await verifyObj(body, frm))) {
      this.stats.forged_rejected++;
      return;
    }
    const rid = body.rid;
    if (kind === "ping") {
      await this.reply(frm, "pong", { rid });
    } else if (kind === "propose") {
      const task = String(body.task || "").slice(0, 500);
      let command = "";
      if (this.idle() && shareable(task)) {
        const L = this.recall(task);
        command = L ? L.command : "";
        this.stats.proposals_served++;
      }
      await this.reply(frm, "proposal", { rid, command });
    } else if (kind === "job") {
      let result: unknown[] | null = null;
      let error = "";
      if (!this.idle()) error = "busy";
      else {
        try {
          result = await runJob(String(body.job), (body.args || {}) as Record<string, any>);
          this.stats.jobs_served++;
        } catch (e) {
          error = (e as Error).message === "unknown job" ? "unknown job" : "error";
        }
      }
      await this.reply(frm, "job_result", { rid, result, error });
    }
  }

  private async reply(to: string, kind: string, body: Record<string, unknown>): Promise<void> {
    try {
      await this.relay.send([to], kind, await this.ident.signObj(body));
    } catch {
      /* offline: the asker times out and runs it itself */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
