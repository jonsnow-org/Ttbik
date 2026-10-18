// Preloaded with NODE_OPTIONS=--require: reroutes api.telegram.org (and any
// non-local host) to the local mock so QA can never reach real services.
const http = require("http");
const https = require("https");
const MOCK = `http://127.0.0.1:${process.env.TG_MOCK_PORT || 54400}`;
const isLocal = (h) => /^(127\.0\.0\.1|localhost|::1)$/.test(String(h || "").replace(/^\[|\]$/g, ""));
function reroute(u) {
  try {
    const url = new URL(u);
    if (isLocal(url.hostname)) return null;
    if (url.hostname === "api.telegram.org") return MOCK + url.pathname + url.search;
    return MOCK + "/__external" + url.pathname; // everything else (supabase, payments…) is stubbed too
  } catch { return null; }
}
const origFetch = globalThis.fetch;
if (origFetch) {
  globalThis.fetch = (input, init) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const r = u && reroute(u);
    if (!r) return origFetch(input, init);
    if (typeof input === "object" && !(input instanceof URL)) return origFetch(new Request(r, input), init);
    return origFetch(r, init);
  };
}
const origReq = https.request;
https.request = function (opts, ...rest) {
  const host = typeof opts === "string" || opts instanceof URL ? new URL(opts).hostname : opts.hostname || opts.host;
  if (!isLocal(host)) {
    const path = typeof opts === "string" || opts instanceof URL ? new URL(opts).pathname + new URL(opts).search : opts.path;
    const target = new URL(MOCK);
    const o = typeof opts === "object" && !(opts instanceof URL) ? { ...opts } : {};
    Object.assign(o, { protocol: "http:", hostname: target.hostname, host: target.hostname, port: target.port, path: host === "api.telegram.org" ? path : "/__external" + path, agent: undefined });
    return http.request(o, ...rest.filter((x) => typeof x === "function"));
  }
  return origReq.call(https, opts, ...rest);
};
