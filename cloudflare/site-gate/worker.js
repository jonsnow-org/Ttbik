// Cloudflare Worker "ttbik-gate": the one permanent public address of the site, the bots' webhooks and the mini apps.
// It forwards every request to the PRIMARY server (Oracle) and, when that is down, to the STANDBY (Vercel). Telegram, TonConnect and every
// link point at the gate's own address, so switching servers never means re-registering webhooks or changing links.
//
//   mode (kept in KV key "mode", changed from the page /__gate):   auto = Oracle first, Vercel when Oracle is down (default)
//                                                                   oracle = Oracle only      vercel = Vercel only
// Settings (Worker > Settings): KV binding GATE; variables PRIMARY_ORIGIN, SECONDARY_ORIGIN, ALERT_CHAT_ID; secrets GATE_KEY, ALERT_BOT_TOKEN.
// Free-plan facts: 100,000 requests a day for the whole account, 10 ms CPU each (this code uses about 1 ms; waiting for the origin is free).

const DEFAULT_PRIMARY = "https://89-168-89-15.sslip.io";
const DEFAULT_SECONDARY = "https://ttbik.vercel.app";
const MODES = ["auto", "oracle", "vercel"];
const DOWN_MS = 30_000;                 // after a failure, the primary is skipped for this long, then tried again
const MODE_TTL_MS = 15_000;             // each server instance re-reads the mode from KV at most this often
const BUFFER_LIMIT = 5 * 1024 * 1024;   // request bodies up to this size can be replayed on the standby
const ALERT_GAP_S = 600;                // at most one alert message per 10 minutes
const STREAM_PATHS = ["/api/media-stream"];
const state = { mode: "auto", modeAt: 0, downUntil: 0 };

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
  if (now - state.modeAt < MODE_TTL_MS) return state.mode;
  let m = "auto";
  try { const v = env.GATE ? await env.GATE.get("mode") : null; if (MODES.includes(v)) m = v; } catch { m = state.mode; }
  state.mode = m; state.modeAt = now;
  return m;
}

/** Which servers to try, in order. `down` = the primary failed less than DOWN_MS ago. */
export function plan(mode, down) {
  if (mode === "oracle") return ["oracle"];
  if (mode === "vercel") return ["vercel"];
  return down ? ["vercel", "oracle"] : ["oracle", "vercel"];
}

function forwardHeaders(request, gateHost) {
  const h = new Headers(request.headers);
  for (const k of [...h.keys()]) if (k.startsWith("cf-") || k.startsWith("x-gate")) h.delete(k);
  h.delete("host");
  h.set("x-forwarded-host", gateHost);
  h.set("x-forwarded-proto", "https");
  h.set("x-gate", "1");
  return h;
}

async function callOrigin(base, request, body, gateHost, timeoutMs, extra) {
  const u = new URL(request.url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const init = { method: request.method, headers: forwardHeaders(request, gateHost), redirect: "manual", signal: ctl.signal, ...(extra || {}) };
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

async function alertOwner(env, text, now = Date.now()) {
  try {
    if (!env.ALERT_BOT_TOKEN || !env.ALERT_CHAT_ID || !env.GATE) return;
    const last = Number(await env.GATE.get("alert_at")) || 0;
    if (now / 1000 - last < ALERT_GAP_S) return;
    await env.GATE.put("alert_at", String(Math.floor(now / 1000)));
    await fetch(`https://api.telegram.org/bot${env.ALERT_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: env.ALERT_CHAT_ID, text }) });
  } catch { /* an alert must never break a request */ }
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
      const r = await callOrigin(bases[name], request, body, gate.host, timeout, extra);
      // a static file the other build does not have (the two servers can be on different builds): ask the other server
      if (isAsset && r.status === 404 && more) { last = r; continue; }
      // the server answered but is down behind its proxy (Caddy answers 502/503/504 when the app is not running)
      if ([502, 503, 504].includes(r.status) && more) {
        if (name === "oracle" && mode === "auto") { state.downUntil = Date.now() + DOWN_MS; ctx.waitUntil(alertOwner(env, `⚠️ Oracle did not answer (HTTP ${r.status}); the gate is serving from Vercel. الخادم الأساسي لا يرد، تُخدَم الطلبات من Vercel.`)); }
        last = r; continue;
      }
      return finish(r, name, bases, gate.origin);
    } catch (e) {
      const timedOut = e && e.name === "AbortError";
      // never replay a request that may already be running (a timeout on a write); a refused connection never reached the server
      if (more && (!timedOut || safe)) {
        if (name === "oracle" && mode === "auto") { state.downUntil = Date.now() + DOWN_MS; ctx.waitUntil(alertOwner(env, "⚠️ Oracle is unreachable; the gate is serving from Vercel. الخادم الأساسي غير متاح، تُخدَم الطلبات من Vercel.")); }
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
<h1>البوابة · Gate</h1><input id="k" type="password" placeholder="مفتاح البوابة · gate key" autocomplete="off">
<button id="go">عرض الحالة · Status</button><div id="b" style="display:none"><button data-m="auto">تلقائي · Auto (Oracle ثم Vercel)</button><button data-m="oracle">Oracle فقط</button><button data-m="vercel">Vercel فقط (الاحتياطي)</button></div><pre id="o"></pre>
<script>
const $=id=>document.getElementById(id);const K='gate_key';$('k').value=sessionStorage.getItem(K)||'';
const call=async(p,o={})=>{const r=await fetch(p,{...o,headers:{'content-type':'application/json','x-gate-key':$('k').value}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j};
async function show(){try{sessionStorage.setItem(K,$('k').value);const s=await call('/__gate/status');$('o').textContent=JSON.stringify(s,null,2);$('b').style.display='block';document.querySelectorAll('[data-m]').forEach(b=>b.className=b.dataset.m===s.mode?'on':'')}catch(e){$('o').textContent='Error: '+e.message}}
$('go').onclick=show;document.querySelectorAll('[data-m]').forEach(b=>b.onclick=async()=>{try{await call('/__gate/mode',{method:'POST',body:JSON.stringify({mode:b.dataset.m})});await show()}catch(e){$('o').textContent='Error: '+e.message}});
if($('k').value)show();
</script></body></html>`;

async function probe(base, path) {
  const t0 = Date.now();
  try { const r = await fetch(base + path, { signal: AbortSignal.timeout(4000), redirect: "manual" }); return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 }; }
  catch (e) { return { ok: false, status: 0, ms: Date.now() - t0 }; }
}

async function admin(request, env) {
  const u = new URL(request.url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (u.pathname === "/__gate" || u.pathname === "/__gate/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (!env.GATE_KEY || !safeEqual(request.headers.get("x-gate-key") || "", env.GATE_KEY)) return json({ error: "unauthorized" }, 401);
  if (u.pathname === "/__gate/status" && request.method === "GET") {
    state.modeAt = 0;
    const mode = await getMode(env), bases = origins(env);
    const [oracle, vercel] = await Promise.all([probe(bases.oracle, "/api/health"), probe(bases.vercel, "/api/health")]);
    return json({ mode, effective: plan(mode, state.downUntil > Date.now()), oracle, vercel, origins: bases, alerts: !!(env.ALERT_BOT_TOKEN && env.ALERT_CHAT_ID), kv: !!env.GATE });
  }
  if (u.pathname === "/__gate/mode" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!MODES.includes(b.mode)) return json({ error: "bad mode" }, 400);
    if (!env.GATE) return json({ error: "KV binding GATE is missing" }, 500);
    await env.GATE.put("mode", b.mode);
    state.mode = b.mode; state.modeAt = Date.now(); state.downUntil = 0;
    return json({ ok: true, mode: b.mode });
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
