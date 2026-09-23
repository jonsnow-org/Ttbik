// Cloudflare Worker: streams media-app videos from Telegram so the bytes
// never pass through Vercel (see docs in cloudflare/README.md).
//
// Needs ONE secret in the Worker settings:  BOT_TOKEN  (the media bot's token)
// Usage:  https://<worker>.workers.dev/?id=<post id>

const SITE = "https://ttbik.vercel.app";

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "range",
      "access-control-expose-headers": "content-length, content-range, accept-ranges",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: cors });

    const url = new URL(request.url);
    const id = (url.searchParams.get("id") || "").trim();
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return new Response("id required", { status: 400, headers: cors });
    if (!env.BOT_TOKEN) return new Response("BOT_TOKEN secret missing", { status: 500, headers: cors });

    // 1) post id -> Telegram file_path (cached at Cloudflare for 50 minutes)
    const cache = caches.default;
    const pathKey = new Request(`${SITE}/api/media-path?id=${encodeURIComponent(id)}`);
    let pathResp = await cache.match(pathKey);
    if (!pathResp) {
      pathResp = await fetch(pathKey);
      if (!pathResp.ok) return new Response("not available", { status: pathResp.status === 404 ? 404 : 502, headers: cors });
      const copy = new Response(pathResp.clone().body, pathResp);
      copy.headers.set("cache-control", "public, max-age=3000");
      ctx.waitUntil(cache.put(pathKey, copy));
    }
    const { file_path, media_type } = await pathResp.json();
    if (!file_path) return new Response("not available", { status: 404, headers: cors });

    // 2) stream the file itself from Telegram, forwarding Range so players can seek
    const upstreamHeaders = {};
    const range = request.headers.get("range");
    if (range) upstreamHeaders.range = range;
    const media = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file_path}`, {
      headers: upstreamHeaders,
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    if (!media.ok && media.status !== 206) return new Response("media download failed", { status: 502, headers: cors });

    const fallbackType = media_type === "audio" || media_type === "voice" ? "audio/mpeg" : "video/mp4";
    const headers = new Headers(cors);
    headers.set("content-type", media.headers.get("content-type") && media.headers.get("content-type") !== "application/octet-stream" ? media.headers.get("content-type") : fallbackType);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "public, max-age=86400");
    for (const h of ["content-length", "content-range"]) {
      const v = media.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(request.method === "HEAD" ? null : media.body, { status: media.status, headers });
  },
};
