// Cloudflare Worker: the permanent front door of Athar's token pictures and metadata.
// Its address is written into the token contract at launch, so it must never depend on one host of ours: this Worker asks our own
// server first, then the Vercel mirror, and if both are down it serves the last good copy it kept (up to 7 days). No account setting
// needed beyond pasting this file. Routes:  /collection   /m/<index>.json   /img/<file>.svg
const ORIGINS = [
  (p) => "https://athar.89-168-89-15.sslip.io/api" + p,       // 1) our server (Oracle)
  (p) => "https://ttbik.vercel.app/api/athar" + p,             // 2) the Vercel mirror (asks Oracle, else draws by itself)
];
const TIMEOUT_MS = 8000;             // the public chain API is slow when many people ask at once: wait for it
// a copy younger than this is served at once (spares our servers and the chain API when a market asks for many tokens together)
const FRESH = (path) => (path.startsWith("/img/") ? 3600 : 300);   // data changes now and then (age stage, owners): 5 minutes; pictures are fixed by their parameters: 1 hour
const KEEP_SECONDS = 7 * 24 * 3600;

const ok = /^\/(collection|m\/\d{1,5}(\.json)?|img\/[A-Za-z0-9._-]{1,40})$/;

async function tryOrigin(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "*/*" }, cf: { cacheTtl: 0 } });
    return r.ok ? r : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export default {
  async fetch(request, env, ctx) {
    const cors = { "access-control-allow-origin": "*" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: cors });
    const u = new URL(request.url);
    if (!ok.test(u.pathname)) return new Response("not found", { status: 404, headers: cors });
    const path = u.pathname + u.search;
    const cache = caches.default;
    const key = new Request("https://athar-keep.invalid" + path);

    const kept0 = await cache.match(key);
    if (kept0) {
      const at = Number(kept0.headers.get("x-kept-at") || 0);
      if (at && Date.now() / 1000 - at < FRESH(u.pathname)) {
        return new Response(await kept0.arrayBuffer(), { headers: { ...cors, "content-type": kept0.headers.get("content-type") || "application/octet-stream", "cache-control": "public, max-age=60", "x-athar-served-by": "recent-copy" } });
      }
    }
    for (const make of ORIGINS) {
      const r = await tryOrigin(make(path));
      if (!r) continue;
      const body = await r.arrayBuffer();
      const type = r.headers.get("content-type") || "application/octet-stream";
      // keep a long-lived copy for the day every origin is down
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { "content-type": type, "cache-control": `public, max-age=${KEEP_SECONDS}`, "x-kept-at": String(Math.floor(Date.now() / 1000)) } })));
      return new Response(body, { headers: { ...cors, "content-type": type, "cache-control": "public, max-age=60", "x-athar-served-by": "live" } });
    }
    const kept = await cache.match(key);
    if (kept) {
      const body = await kept.arrayBuffer();
      return new Response(body, { headers: { ...cors, "content-type": kept.headers.get("content-type") || "application/octet-stream", "cache-control": "public, max-age=30", "x-athar-served-by": "kept-copy" } });
    }
    return new Response("temporarily unavailable", { status: 503, headers: { ...cors, "retry-after": "30" } });
  },
};
