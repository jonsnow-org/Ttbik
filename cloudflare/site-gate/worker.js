// (build trigger 2026-10-18: first Git-connected deploy of the gate)
// Cloudflare Worker "ttbik-gate": the one permanent public address of the site, the bots' webhooks and the mini apps.
// It forwards every request to the PRIMARY server (Oracle) and, when that is down, to the STANDBY (Vercel). Telegram, TonConnect and every
// link point at the gate's own address, so switching servers never means re-registering webhooks or changing links.
//
//   mode (kept in KV key "mode"):  auto = Oracle first, Vercel when Oracle is down (default)  |  oracle = Oracle only  |  vercel = Vercel only
//   a pinned mode ("oracle"/"vercel") lasts PIN_HOURS and then returns to auto by itself.
// NO SECRET lives here. A mode change is authorised by our own database: the owner's bot creates a one-time nonce, then asks the gate to
// apply it; the gate asks the servers (/api/ops/gate-verify) whether that nonce is valid and what it allows. Nobody else can create one.
// Settings: KV binding GATE (wrangler.jsonc) and optional variables PRIMARY_ORIGIN, SECONDARY_ORIGIN; optional secret GATE_KEY (the page /__gate).
// Free-plan facts: 100,000 requests a day for the whole account, 10 ms CPU each (this code uses about 1 ms; waiting for the origin is free).

const DEFAULT_PRIMARY = "https://89-168-89-15.sslip.io";
const DEFAULT_SECONDARY = "https://ttbik.vercel.app";
const MODES = ["auto", "oracle", "vercel"];
const DOWN_MS = 30_000;                 // after a failure, the primary is skipped for this long, then tried again
const MODE_TTL_MS = 15_000;             // each server instance re-reads the mode from KV at most this often
const BUFFER_LIMIT = 5 * 1024 * 1024;   // request bodies up to this size can be replayed on the standby
const PIN_HOURS = 12;                   // a pinned mode returns to auto after this long
const STREAM_PATHS = ["/api/media-stream"];
const state = { mode: "auto", until: 0, modeAt: 0, downUntil: 0 };

const enc = new TextEncoder();
function safeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const origins = (env) => ({
  oracle: String(env.PRIMARY_ORIGIN || DEFAULT_PRIMARY).replace(/\/$/, ""),
  vercel: String(env.SECONDARY_ORIGIN || DEFAULT_SECONDARY).replace(/\/$/, ""),
});

export async function getMode(env, now = Date.now()) {
  if (now - state.modeAt >= MODE_TTL_MS) {
    let m = "auto", until = 0;
    try {
      if (env.GATE) { const v = await env.GATE.get("mode"); if (MODES.includes(v)) m = v; until = Number(await env.GATE.get("until")) || 0; }
    } catch { m = state.mode; until = state.until; }
    state.mode = m; state.until = until; state.modeAt = now;
  }
  return state.mode !== "auto" && state.until && now > state.until ? "auto" : state.mode;
}

/** Which servers to try, in order. `down` = the primary failed less than DOWN_MS ago. */
export function plan(mode, down) {
  if (mode === "oracle") return ["oracle"];
  if (mode === "vercel") return ["vercel"];
  return down ? ["vercel", "oracle"] : ["oracle", "vercel"];
}

function forwardHeaders(request, gateHost, served, failover) {
  const h = new Headers(request.headers);
  for (const k of [...h.keys()]) if (k.startsWith("cf-") || k.startsWith("x-gate")) h.delete(k);
  h.delete("host");
  h.set("x-forwarded-host", gateHost);
  h.set("x-forwarded-proto", "https");
  h.set("x-gate", "1");
  h.set("x-gate-served", served);
  if (failover) h.set("x-gate-failover", "1");   // the standby tells the owner (it holds the bot tokens), the gate holds none
  return h;
}

async function callOrigin(base, request, body, gateHost, timeoutMs, extra, served, failover) {
  const u = new URL(request.url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const init = { method: request.method, headers: forwardHeaders(request, gateHost, served, failover), redirect: "manual", signal: ctl.signal, ...(extra || {}) };
    if (body !== undefined && request.method !== "GET" && request.method !== "HEAD") init.body = body;
    return await fetch(base + u.pathname + u.search, init);
  } finally { clearTimeout(timer); }
}

function finish(resp, name, bases, gateOrigin) {
  const h = new Headers(resp.headers);
  const loc = h.get("location");
  if (loc) for (const b of Object.values(bases)) if (loc.startsWith(b)) { h.set("location", gateOrigin + loc.slice(b.length)); break; }
  h.set("x-gate-origin", name);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

async function proxy(request, env, ctx) {
  const gate = new URL(request.url), bases = origins(env);
  const mode = await getMode(env);
  const now = Date.now();
  const order = plan(mode, state.downUntil > now);
  const safe = request.method === "GET" || request.method === "HEAD";
  // video and audio are never carried through the gate (bandwidth, Range requests, Cloudflare's rules on streaming): the browser is sent straight to the active server
  if (safe && STREAM_PATHS.some((p) => gate.pathname.startsWith(p))) return Response.redirect(bases[order[0]] + gate.pathname + gate.search, 307);
  const isAsset = safe && gate.pathname.startsWith("/_next/static/");
  const len = Number(request.headers.get("content-length") || 0);
  let body;
  if (!safe) body = len > BUFFER_LIMIT ? request.body : await request.arrayBuffer();
  const replayable = safe || len <= BUFFER_LIMIT;
  let last = null;
  for (let i = 0; i < order.length; i++) {
    const name = order[i], more = i < order.length - 1 && replayable;
    const timeout = safe ? 20_000 : 50_000;
    try {
      const extra = isAsset ? { cf: { cacheEverything: true, cacheTtl: 31536000 } } : undefined;
      const r = await callOrigin(bases[name], request, body, gate.host, timeout, extra, name, name === "vercel" && mode === "auto" && state.downUntil > Date.now());
      // a static file the other build does not have (the two servers can be on different builds): ask the other server
      if (isAsset && r.status === 404 && more) { last = r; continue; }
      // the server answered but is down behind its proxy (Caddy answers 502/503/504 when the app is not running)
      if ([502, 503, 504].includes(r.status) && more) {
        if (name === "oracle" && mode === "auto") state.downUntil = Date.now() + DOWN_MS;
        last = r; continue;
      }
      return finish(r, name, bases, gate.origin);
    } catch (e) {
      const timedOut = e && e.name === "AbortError";
      // never replay a request that may already be running (a timeout on a write); a refused connection never reached the server
      if (more && (!timedOut || safe)) {
        if (name === "oracle" && mode === "auto") state.downUntil = Date.now() + DOWN_MS;
        continue;
      }
      return new Response("upstream unavailable", { status: timedOut ? 504 : 502, headers: { "x-gate-origin": name, "cache-control": "no-store" } });
    }
  }
  return last ? finish(last, "fallback", bases, gate.origin) : new Response("no upstream", { status: 502 });
}

// ---------- the switch page ----------
const PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Gate</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:520px;margin:0 auto;padding:16px;background:#0f1424;color:#eef}button,input{font:inherit;width:100%;box-sizing:border-box;padding:12px;margin:6px 0;border-radius:10px;border:1px solid #4a5688;background:#1b2340;color:#eef}button{cursor:pointer;font-weight:700}button.on{background:#2e7d32;border-color:#2e7d32}pre{background:#1b2340;padding:12px;border-radius:10px;white-space:pre-wrap;direction:ltr}</style></head><body>
<h1>البوابة · Gate</h1><div class="mut">التحويل من لوحة «الاستضافة» في بوت أثر. المفتاح اختياري (لمن يملك GATE_KEY). · Switch from the Hosting panel of the Athar bot; the key is optional.</div><pre id="s"></pre><input id="k" type="password" placeholder="مفتاح البوابة (اختياري) · gate key (optional)" autocomplete="off">
<button id="go">عرض الحالة الكاملة · Full status</button><div id="b" style="display:none"><button data-m="auto">تلقائي · Auto (Oracle ثم Vercel)</button><button data-m="oracle">Oracle فقط</button><button data-m="vercel">Vercel فقط (الاحتياطي)</button></div><pre id="o"></pre>
<script>
const $=id=>document.getElementById(id);const K='gate_key';$('k').value=sessionStorage.getItem(K)||'';
const call=async(p,o={})=>{const r=await fetch(p,{...o,headers:{'content-type':'application/json','x-gate-key':$('k').value}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j};
async function show(){try{sessionStorage.setItem(K,$('k').value);const s=await call('/__gate/status');$('o').textContent=JSON.stringify(s,null,2);$('b').style.display='block';document.querySelectorAll('[data-m]').forEach(b=>b.className=b.dataset.m===s.mode?'on':'')}catch(e){$('o').textContent='Error: '+e.message}}
$('go').onclick=show;document.querySelectorAll('[data-m]').forEach(b=>b.onclick=async()=>{try{await call('/__gate/mode',{method:'POST',body:JSON.stringify({mode:b.dataset.m})});await show()}catch(e){$('o').textContent='Error: '+e.message}});
fetch('/__gate/state').then(r=>r.json()).then(j=>{$('s').textContent=JSON.stringify(j,null,2)});if($('k').value)show();
</script></body></html>`;

async function probe(base, path) {
  const t0 = Date.now();
  try { const r = await fetch(base + path, { signal: AbortSignal.timeout(4000), redirect: "manual" }); return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, status: 0, ms: Date.now() - t0 }; }
}

async function setMode(env, mode) {
  if (!env.GATE) throw new Error("KV binding GATE is missing");
  const until = mode === "auto" ? 0 : Date.now() + PIN_HOURS * 3600_000;
  await env.GATE.put("mode", mode);
  await env.GATE.put("until", String(until));
  state.mode = mode; state.until = until; state.modeAt = Date.now(); state.downUntil = 0;
  return until;
}

// Ask the servers whether this one-time nonce was created by the owner's bot (they consume it) and what it allows: "mode:auto|oracle|vercel".
async function verifyNonce(env, nonce) {
  const bases = origins(env);
  for (const name of ["oracle", "vercel"]) {
    try {
      const r = await fetch(`${bases[name]}/api/ops/gate-verify?nonce=${encodeURIComponent(nonce)}`, { signal: AbortSignal.timeout(6000), headers: { "x-gate": "verify" } });
      if (r.status >= 500) continue;           // that server is down: ask the other one (they share the database)
      const j = await r.json().catch(() => ({}));
      return j && j.ok && typeof j.action === "string" ? j.action : null;
    } catch { /* try the next server */ }
  }
  return null;
}

async function admin(request, env) {
  const u = new URL(request.url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (u.pathname === "/__gate" || u.pathname === "/__gate/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  // public and harmless: which mode is active and which server is tried first
  if (u.pathname === "/__gate/state" && request.method === "GET") {
    state.modeAt = 0;
    const mode = await getMode(env);
    return json({ mode, until: state.until || 0, effective: plan(mode, state.downUntil > Date.now()), downUntil: state.downUntil || 0, kv: !!env.GATE });
  }
  // the owner's bot created a nonce in our database and asks the gate to apply it
  if (u.pathname === "/__gate/apply" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const nonce = String(b.nonce || "");
    if (!/^[0-9a-f]{32,64}$/.test(nonce)) return json({ error: "bad nonce" }, 400);
    const action = await verifyNonce(env, nonce);
    const m = /^mode:(auto|oracle|vercel)$/.exec(action || "");
    if (!m) return json({ error: "not authorised" }, 403);
    try { const until = await setMode(env, m[1]); return json({ ok: true, mode: m[1], until }); } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
  }
  // optional extra control for someone holding the (optional) secret GATE_KEY
  if (!env.GATE_KEY || !safeEqual(request.headers.get("x-gate-key") || "", env.GATE_KEY)) return json({ error: "unauthorized" }, 401);
  if (u.pathname === "/__gate/status" && request.method === "GET") {
    state.modeAt = 0;
    const mode = await getMode(env), bases = origins(env);
    const [oracle, vercel] = await Promise.all([probe(bases.oracle, "/api/health"), probe(bases.vercel, "/api/health")]);
    return json({ mode, until: state.until || 0, effective: plan(mode, state.downUntil > Date.now()), oracle, vercel, origins: bases, kv: !!env.GATE });
  }
  if (u.pathname === "/__gate/mode" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!MODES.includes(b.mode)) return json({ error: "bad mode" }, 400);
    try { await setMode(env, b.mode); return json({ ok: true, mode: b.mode }); } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === "/__gate" || u.pathname.startsWith("/__gate/")) return admin(request, env);
    return proxy(request, env, ctx);
  },
};
export const _state = state;
