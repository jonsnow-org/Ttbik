// sham-mesh: rendezvous + relay for the Sham terminal mesh (ai-system/terminal/mesh_net.py is the client).
//
// What it does:  node register/heartbeat + presence, store-and-forward mailboxes (long-poll), the lesson index, the adapter index,
//                poisoned-lesson reports, rate limits.
// What it never does: run anything, read files, see results. A peer only PROPOSES; the asker vets and runs in its own sandbox.
// Trust: the relay is NOT trusted. Every request is signed by the node's ed25519 key (node id = public key, base64url), and every message
//        body / lesson / adapter entry carries its own end-to-end signature that the receiving node re-verifies.
//
// Request auth headers:  x-mesh-node: <id>   x-mesh-ts: <unix ms>   x-mesh-sig: ed25519(<METHOD>\n<path?query>\n<ts>\n<sha256hex(body)>)
// Routes (all under /m/<mesh>/, mesh = [a-z0-9-]{1,32}):
//   POST hello {slots, caps}  -> {peers, now, lessons_seq, adapters_seq}       POST bye
//   GET  peers                                                                POST send {to:[id..]|"*", kind, body}
//   GET  poll?wait=<s>  (long-poll, <= 25 s)                                   POST lessons {lesson}   GET lessons?since=&limit=
//   POST report {h, why}  (3 distinct reporters hide a lesson)                 POST adapters {adapter} GET adapters?since=
//   GET  /health  /m/<mesh>/health   (no auth)

const SKEW_MS = 120_000;
const ONLINE_MS = 75_000;
const MAX_BODY = 262_144;
const MAX_TO = 16;
const MAILBOX = 256;
const MSG_TTL_MS = 180_000;
const BUCKET = { cap: 180, perSec: 3 };           // per node
const NEW_NODES_PER_IP_HOUR = 40;
const LESSONS_PER_NODE_DAY = 1000;
const LESSONS_MAX = 50_000;
const ADAPTERS_PER_NODE_DAY = 50;
const HIDE_AFTER_REPORTS = 3;
const KINDS = new Set(["propose", "proposal", "job", "job_result", "adapter_get", "adapter_chunk", "ping", "pong"]);

const enc = new TextEncoder();

export function b64uToBytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function signingString(method, pathq, ts, bodyHash) {
  return `${method}\n${pathq}\n${ts}\n${bodyHash}`;
}

export async function verifyEd25519(nodeId, msg, sigB64u) {
  let pub, sig;
  try {
    pub = b64uToBytes(nodeId);
    sig = b64uToBytes(sigB64u);
  } catch {
    return false;
  }
  if (pub.length !== 32 || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, typeof msg === "string" ? enc.encode(msg) : msg);
  } catch {
    return false;
  }
}

export async function authenticate(request, bodyBytes, now = Date.now()) {
  const node = request.headers.get("x-mesh-node") || "";
  const ts = request.headers.get("x-mesh-ts") || "";
  const sig = request.headers.get("x-mesh-sig") || "";
  if (!node || !ts || !sig) return { ok: false, why: "unsigned" };
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(now - t) > SKEW_MS) return { ok: false, why: "clock skew or stale request" };
  const u = new URL(request.url);
  const msg = signingString(request.method, u.pathname + u.search, ts, await sha256hex(bodyBytes));
  if (!(await verifyEd25519(node, msg, sig))) return { ok: false, why: "bad signature" };
  return { ok: true, node, sig };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// Browser nodes (the Telegram Mini App, src/lib/meshNode.ts) call the relay directly. Auth is the ed25519 request signature, never a cookie,
// so any origin may call it; the preflight only has to allow the signature headers.
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-mesh-node, x-mesh-ts, x-mesh-sig",
  "access-control-max-age": "86400",
};

function withCors(resp) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return withCors(await handle(request, env));
  },
};

async function handle(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/" || u.pathname === "") {
      return new Response("sham-mesh relay: presence, mailboxes, lesson and adapter index. It runs nothing. See ai-system/terminal/mesh_net.py\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const m = u.pathname.match(/^\/m\/([a-z0-9-]{1,32})\/([a-z_]+)$/) || (u.pathname === "/health" ? [null, "sham2", "health"] : null);
    if (!m) return json({ error: "not found" }, 404);
    const [, mesh, route] = m;
    const stub = env.HUB.get(env.HUB.idFromName(mesh));
    if (route === "health") return stub.fetch(new Request("https://hub/health", { method: "GET" }));
    const body = request.method === "GET" ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());
    if (body.length > MAX_BODY) return json({ error: "body too large" }, 413);
    const a = await authenticate(request, body);
    if (!a.ok) return json({ error: a.why }, 401);
    const h = new Headers({ "x-mesh-verified": a.node, "x-mesh-sig": a.sig, "x-mesh-ip": request.headers.get("cf-connecting-ip") || "", "content-type": "application/json" });
    return stub.fetch(new Request(`https://hub/${route}${u.search}`, { method: request.method, headers: h, body: request.method === "GET" ? undefined : body }));
}

export class MeshHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.nodes = new Map();      // id -> {id, slots, caps, first, last}
    this.boxes = new Map();      // id -> [msg]
    this.waiters = new Map();    // id -> Set(resolve)
    this.buckets = new Map();    // id -> {tokens, at}
    this.ipNew = new Map();      // ip -> {count, hour}
    this.seenSigs = new Map();   // sig -> ts (replay guard)
    this.daily = new Map();      // `${kind}:${id}:${day}` -> count
    this.mseq = 0;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lessons (seq INTEGER PRIMARY KEY AUTOINCREMENT, h TEXT UNIQUE, by TEXT, body TEXT, ts INTEGER, hidden INTEGER DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (h TEXT, by TEXT, why TEXT, ts INTEGER, PRIMARY KEY (h, by))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS adapters (seq INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT UNIQUE, by TEXT, body TEXT, ts INTEGER)`);
  }

  one(q, ...args) {
    const r = this.sql.exec(q, ...args).toArray();
    return r.length ? r[0] : null;
  }

  online(now) {
    return [...this.nodes.values()].filter((n) => now - n.last < ONLINE_MS);
  }

  take(id, now, cost = 1) {
    const b = this.buckets.get(id) || { tokens: BUCKET.cap, at: now };
    b.tokens = Math.min(BUCKET.cap, b.tokens + ((now - b.at) / 1000) * BUCKET.perSec);
    b.at = now;
    this.buckets.set(id, b);
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  dailyOk(kind, id, limit, now) {
    const k = `${kind}:${id}:${Math.floor(now / 86_400_000)}`;
    const c = (this.daily.get(k) || 0) + 1;
    if (c > limit) return false;
    this.daily.set(k, c);
    if (this.daily.size > 20_000) this.daily.clear();
    return true;
  }

  deliver(to, msg, now) {
    const box = (this.boxes.get(to) || []).filter((x) => now - x.ts < MSG_TTL_MS);
    box.push(msg);
    while (box.length > MAILBOX) box.shift();
    this.boxes.set(to, box);
    const ws = this.waiters.get(to);
    if (ws) {
      for (const r of ws) r();
      this.waiters.delete(to);
    }
  }

  drain(id, now) {
    const box = (this.boxes.get(id) || []).filter((x) => now - x.ts < MSG_TTL_MS);
    this.boxes.set(id, []);
    return box;
  }

  async fetch(request) {
    const u = new URL(request.url);
    const route = u.pathname.slice(1);
    const now = Date.now();
    if (route === "health") {
      const l = this.one("SELECT COUNT(*) AS n FROM lessons WHERE hidden = 0");
      const a = this.one("SELECT COUNT(*) AS n FROM adapters");
      return json({ ok: true, nodes_online: this.online(now).length, lessons: l ? l.n : 0, adapters: a ? a.n : 0, now });
    }
    const id = request.headers.get("x-mesh-verified");
    const sig = request.headers.get("x-mesh-sig");
    const ip = request.headers.get("x-mesh-ip") || "";
    if (!id) return json({ error: "unsigned" }, 401);
    for (const [s, t] of this.seenSigs) if (now - t > 2 * SKEW_MS) this.seenSigs.delete(s);
    if (this.seenSigs.has(sig)) return json({ error: "replayed request" }, 409);
    this.seenSigs.set(sig, now);
    if (!this.take(id, now)) return json({ error: "rate limited" }, 429);
    let body = {};
    if (request.method !== "GET") {
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
    }
    if (!this.nodes.has(id) && route !== "hello" && route !== "health") return json({ error: "say hello first" }, 403);

    switch (route) {
      case "hello": {
        if (!this.nodes.has(id) && ip) {
          const hour = Math.floor(now / 3_600_000);
          const e = this.ipNew.get(ip);
          const c = e && e.hour === hour ? e.count + 1 : 1;
          if (c > NEW_NODES_PER_IP_HOUR) return json({ error: "too many new nodes from this address" }, 429);
          this.ipNew.set(ip, { count: c, hour });
          if (this.ipNew.size > 10_000) this.ipNew.clear();
        }
        const prev = this.nodes.get(id);
        const caps = body.caps && typeof body.caps === "object" ? body.caps : {};
        this.nodes.set(id, {
          id,
          slots: Math.max(0, Math.min(64, Number(body.slots) | 0)),
          caps: { propose: !!caps.propose, jobs: !!caps.jobs, adapters: !!caps.adapters },
          first: prev ? prev.first : now,
          last: now,
        });
        const peers = this.online(now).filter((n) => n.id !== id).map(({ id, slots, caps, last }) => ({ id, slots, caps, last }));
        const ls = this.one("SELECT MAX(seq) AS s FROM lessons");
        const as = this.one("SELECT MAX(seq) AS s FROM adapters");
        return json({ peers, now, lessons_seq: (ls && ls.s) || 0, adapters_seq: (as && as.s) || 0 });
      }
      case "bye": {
        this.nodes.delete(id);
        this.boxes.delete(id);
        return json({ ok: true });
      }
      case "peers": {
        const n = this.nodes.get(id);
        if (n) n.last = now;
        return json({ peers: this.online(now).filter((x) => x.id !== id).map(({ id, slots, caps, last }) => ({ id, slots, caps, last })), now });
      }
      case "send": {
        const kind = String(body.kind || "");
        if (!KINDS.has(kind)) return json({ error: "unknown kind" }, 400);
        let to = body.to === "*" ? this.online(now).filter((x) => x.id !== id).map((x) => x.id).slice(0, MAX_TO) : body.to;
        if (!Array.isArray(to) || !to.length || to.length > MAX_TO) return json({ error: "bad recipients" }, 400);
        if (!this.take(id, now, to.length - 1 > 0 ? to.length - 1 : 0)) return json({ error: "rate limited" }, 429);
        let delivered = 0;
        for (const t of to) {
          if (typeof t !== "string" || !this.nodes.has(t)) continue;
          this.deliver(t, { mid: ++this.mseq, from: id, kind, body: body.body ?? null, ts: now }, now);
          delivered++;
        }
        return json({ delivered });
      }
      case "poll": {
        const n = this.nodes.get(id);
        if (n) n.last = now;
        let msgs = this.drain(id, now);
        const wait = Math.max(0, Math.min(25, Number(u.searchParams.get("wait")) || 0));
        if (!msgs.length && wait > 0) {
          await new Promise((resolve) => {
            const set = this.waiters.get(id) || new Set();
            let done = false;
            const fin = () => {
              if (done) return;
              done = true;
              set.delete(fin);
              resolve();
            };
            set.add(fin);
            this.waiters.set(id, set);
            setTimeout(fin, wait * 1000);
          });
          const nn = this.nodes.get(id);
          if (nn) nn.last = Date.now();
          msgs = this.drain(id, Date.now());
        }
        return json({ msgs });
      }
      case "lessons": {
        if (request.method === "GET") {
          const since = Number(u.searchParams.get("since")) || 0;
          const limit = Math.max(1, Math.min(500, Number(u.searchParams.get("limit")) || 200));
          const rows = this.sql.exec("SELECT seq, body FROM lessons WHERE seq > ? AND hidden = 0 ORDER BY seq LIMIT ?", since, limit).toArray();
          const mx = this.one("SELECT MAX(seq) AS s FROM lessons");
          return json({ lessons: rows.map((r) => ({ seq: r.seq, ...JSON.parse(r.body) })), seq: rows.length ? rows[rows.length - 1].seq : since, max: (mx && mx.s) || 0 });
        }
        const L = body.lesson;
        if (!L || typeof L !== "object" || L.by !== id || typeof L.sig !== "string" || typeof L.h !== "string" || !/^[0-9a-f]{16,64}$/.test(L.h))
          return json({ error: "a lesson must be signed by its sender" }, 400);
        if (typeof L.task !== "string" || typeof L.command !== "string" || L.task.length > 500 || L.command.length > 1000) return json({ error: "bad lesson" }, 400);
        if (!this.dailyOk("lesson", id, LESSONS_PER_NODE_DAY, now)) return json({ error: "daily lesson limit" }, 429);
        if (this.one("SELECT h FROM lessons WHERE h = ?", L.h)) return json({ ok: true, duplicate: true });
        this.sql.exec("INSERT INTO lessons (h, by, body, ts) VALUES (?, ?, ?, ?)", L.h, id, JSON.stringify(L), now);
        const c = this.one("SELECT COUNT(*) AS n FROM lessons");
        if (c && c.n > LESSONS_MAX) this.sql.exec("DELETE FROM lessons WHERE seq IN (SELECT seq FROM lessons ORDER BY seq LIMIT ?)", c.n - LESSONS_MAX);
        const s = this.one("SELECT seq FROM lessons WHERE h = ?", L.h);
        return json({ ok: true, seq: s ? s.seq : 0 });
      }
      case "report": {
        const h = String(body.h || "");
        if (!/^[0-9a-f]{16,64}$/.test(h)) return json({ error: "bad hash" }, 400);
        this.sql.exec("INSERT OR IGNORE INTO reports (h, by, why, ts) VALUES (?, ?, ?, ?)", h, id, String(body.why || "").slice(0, 200), now);
        const r = this.one("SELECT COUNT(*) AS n FROM reports WHERE h = ?", h);
        if (r && r.n >= HIDE_AFTER_REPORTS) this.sql.exec("UPDATE lessons SET hidden = 1 WHERE h = ?", h);
        return json({ ok: true, reports: r ? r.n : 0 });
      }
      case "adapters": {
        if (request.method === "GET") {
          const since = Number(u.searchParams.get("since")) || 0;
          const rows = this.sql.exec("SELECT seq, body FROM adapters WHERE seq > ? ORDER BY seq LIMIT 200", since).toArray();
          return json({ adapters: rows.map((r) => ({ seq: r.seq, ...JSON.parse(r.body) })), seq: rows.length ? rows[rows.length - 1].seq : since });
        }
        const A = body.adapter;
        if (!A || typeof A !== "object" || A.by !== id || typeof A.sig !== "string" || !/^[0-9a-f]{64}$/.test(String(A.sha256 || "")))
          return json({ error: "an adapter entry must be signed by its sender and carry sha256" }, 400);
        if (!this.dailyOk("adapter", id, ADAPTERS_PER_NODE_DAY, now)) return json({ error: "daily adapter limit" }, 429);
        const k = `${id}:${A.fam}:${A.vid}:${A.sha256}`;
        if (this.one("SELECT k FROM adapters WHERE k = ?", k)) return json({ ok: true, duplicate: true });
        this.sql.exec("INSERT INTO adapters (k, by, body, ts) VALUES (?, ?, ?, ?)", k, id, JSON.stringify(A), now);
        return json({ ok: true });
      }
      default:
        return json({ error: "not found" }, 404);
    }
  }
}
