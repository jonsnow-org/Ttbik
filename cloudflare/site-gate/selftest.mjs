// Run: node cloudflare/site-gate/selftest.mjs   (no network: fake origins, fake KV)
import assert from "node:assert/strict";
import gate, { _state } from "./worker.js";

const kvData = new Map();
const env = { GATE: { get: async (k) => kvData.get(k) ?? null, put: async (k, v) => { kvData.set(k, v); } } };
const P = "https://89-168-89-15.sslip.io", S = "https://ttbik.vercel.app";
const NONCE = "a".repeat(32);
let calls = [], script = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method || "GET", body: init.body, headers: init.headers });
  const o = u.startsWith(P) ? "oracle" : "vercel";
  const s = script[o] ?? (() => new Response(o + " ok"));
  return s(u, init);
};
const ctx = { waitUntil: (p) => p };
const reset = (mode = "auto") => { calls = []; script = {}; kvData.clear(); kvData.set("mode", mode); _state.modeAt = 0; _state.downUntil = 0; _state.until = 0; };
const get = (path, init, e = env) => gate.fetch(new Request("https://gate.test" + path, init), e, ctx);
const hdr = (i) => new Headers(calls[i].headers);

// a tiny in-memory Cache API for the icon tests
const store = new Map();
globalThis.caches = { default: { match: async (r) => { const v = store.get(r.url); return v ? v.clone() : undefined; }, put: async (r, v) => { store.set(r.url, v.clone()); } } };
const WEBP = (u) => new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80]), { headers: { "content-type": "image/webp" } });

// --- forwarding
reset();
let r = await get("/hello?x=1");
assert.equal(await r.text(), "oracle ok"); assert.equal(r.headers.get("x-gate-origin"), "oracle");
assert.equal(calls[0].url, P + "/hello?x=1");
assert.equal(hdr(0).get("x-forwarded-host"), "gate.test"); assert.equal(hdr(0).get("x-gate-served"), "oracle"); assert.equal(hdr(0).get("x-gate-failover"), null);

reset(); script.oracle = () => { throw new TypeError("refused"); };
r = await get("/a"); assert.equal(await r.text(), "vercel ok"); assert.equal(r.headers.get("x-gate-origin"), "vercel");
assert.equal(hdr(1).get("x-gate-failover"), "1", "the standby is told it is serving because Oracle is down");
assert.ok(_state.downUntil > Date.now());
calls = []; await get("/b"); assert.equal(calls[0].url, S + "/b", "primary is skipped while marked down");
assert.equal(hdr(0).get("x-gate-failover"), "1");

reset(); script.oracle = () => new Response("bad gateway", { status: 502 });
r = await get("/x"); assert.equal(await r.text(), "vercel ok");

reset(); script.oracle = () => new Response("boom", { status: 500 });
r = await get("/x"); assert.equal(r.status, 500); assert.equal(calls.length, 1, "an application error is not retried elsewhere");

reset(); script.oracle = () => { const e = new Error("t"); e.name = "AbortError"; throw e; };
r = await get("/hook", { method: "POST", body: "{}" }); assert.equal(r.status, 504); assert.equal(calls.length, 1, "a timed-out write is never replayed");

reset(); script.oracle = () => { throw new TypeError("refused"); };
r = await get("/hook", { method: "POST", body: '{"u":1}', headers: { "x-telegram-bot-api-secret-token": "s" } });
assert.equal(await r.text(), "vercel ok"); assert.equal(calls[1].body.byteLength, 7, "body replayed on the standby");
assert.equal(hdr(1).get("x-telegram-bot-api-secret-token"), "s");

reset("vercel"); await get("/m"); assert.equal(calls.length, 1); assert.ok(calls[0].url.startsWith(S));
reset("oracle"); script.oracle = () => { throw new TypeError("refused"); };
r = await get("/m"); assert.equal(r.status, 502); assert.equal(calls.length, 1, "oracle-only mode never falls back");

reset(); script.oracle = () => new Response(null, { status: 302, headers: { location: P + "/login?next=/a" } });
r = await get("/p"); assert.equal(r.headers.get("location"), "https://gate.test/login?next=/a");

reset(); script.oracle = () => new Response("missing", { status: 404 });
r = await get("/_next/static/chunks/a.js"); assert.equal(await r.text(), "vercel ok", "a static file missing on one build is asked of the other");

reset(); r = await get("/api/media-stream?id=1");
assert.equal(r.status, 307); assert.equal(r.headers.get("location"), P + "/api/media-stream?id=1"); assert.equal(calls.length, 0, "streams are redirected, never carried");
reset("vercel"); r = await get("/api/media-stream?id=1"); assert.equal(r.headers.get("location"), S + "/api/media-stream?id=1");

// a client can never forge the gate's own headers
reset(); await get("/z", { headers: { "x-gate-failover": "1", "x-gate-served": "vercel" } });
assert.equal(hdr(0).get("x-gate-failover"), null); assert.equal(hdr(0).get("x-gate-served"), "oracle");

// --- the public state and the nonce flow (no secret anywhere)
reset();
r = await get("/__gate"); assert.equal(r.status, 200); assert.match(await r.text(), /Gate/);
r = await get("/__gate/state"); let j = await r.json(); assert.equal(j.mode, "auto"); assert.equal(j.kv, true);

script.oracle = (u) => u.includes("/api/ops/gate-verify") ? Response.json({ ok: true, action: "mode:vercel" }) : new Response("x");
r = await get("/__gate/apply", { method: "POST", body: JSON.stringify({ nonce: NONCE }) }); j = await r.json();
assert.equal(r.status, 200); assert.equal(j.mode, "vercel"); assert.equal(kvData.get("mode"), "vercel"); assert.ok(Number(kvData.get("until")) > Date.now());
assert.ok(calls.some((c) => c.url === P + "/api/ops/gate-verify?nonce=" + NONCE));
calls = []; await get("/after"); assert.ok(calls[0].url.startsWith(S), "the new mode applies at once");

// a nonce the servers do not know changes nothing
reset(); script.oracle = () => Response.json({ ok: false }); script.vercel = () => Response.json({ ok: false });
r = await get("/__gate/apply", { method: "POST", body: JSON.stringify({ nonce: NONCE }) }); assert.equal(r.status, 403); assert.equal(kvData.get("mode"), "auto");
// malformed nonce is refused before any server is asked
reset(); r = await get("/__gate/apply", { method: "POST", body: JSON.stringify({ nonce: "../x" }) }); assert.equal(r.status, 400); assert.equal(calls.length, 0);
// an unrelated action is not a mode
reset(); script.oracle = () => Response.json({ ok: true, action: "env-window" });
r = await get("/__gate/apply", { method: "POST", body: JSON.stringify({ nonce: NONCE }) }); assert.equal(r.status, 403);
// Oracle down: the other server (same database) answers the verification
reset(); script.oracle = () => new Response("down", { status: 502 }); script.vercel = () => Response.json({ ok: true, action: "mode:auto" });
r = await get("/__gate/apply", { method: "POST", body: JSON.stringify({ nonce: NONCE }) }); assert.equal(r.status, 200);

// a pinned mode returns to auto after its time
reset("vercel"); kvData.set("until", String(Date.now() - 1000));
calls = []; await get("/exp"); assert.ok(calls[0].url.startsWith(P), "an expired pin is auto again (Oracle first)");

// optional key path still works when a GATE_KEY exists, and is closed when it does not
reset(); r = await get("/__gate/status"); assert.equal(r.status, 401);
const keyed = { ...env, GATE_KEY: "k3y" };
r = await get("/__gate/mode", { method: "POST", headers: { "x-gate-key": "k3y" }, body: JSON.stringify({ mode: "oracle" }) }, keyed); assert.equal(r.status, 200); assert.equal(kvData.get("mode"), "oracle");
r = await get("/__gate/mode", { method: "POST", headers: { "x-gate-key": "nope" }, body: JSON.stringify({ mode: "vercel" }) }, keyed); assert.equal(r.status, 401);
// --- the coin icon: never fails
const ICON = "/api/zenobia/znbt/icon";
store.clear(); reset(); script.oracle = WEBP;
r = await get(ICON); assert.equal(r.headers.get("content-type"), "image/webp"); assert.equal(r.headers.get("x-gate-origin"), "oracle"); assert.equal((await r.arrayBuffer()).byteLength, 12);
calls = []; r = await get(ICON); assert.equal(r.headers.get("x-gate-origin"), "kept-fresh"); assert.equal(calls.length, 0, "a fresh copy spares the servers");
// both servers down, an old copy exists -> the old copy
for (const v of store.values()) { /* age the kept copy */ }
store.set("https://znbt-icon.invalid/icon", new Response(new Uint8Array([1, 2, 3]), { headers: { "x-kept-at": String(Math.floor(Date.now() / 1000) - 3600) } }));
reset(); script.oracle = () => { throw new TypeError("down"); }; script.vercel = () => new Response("nope", { status: 502 });
r = await get(ICON); assert.equal(r.headers.get("x-gate-origin"), "kept-old"); assert.equal((await r.arrayBuffer()).byteLength, 3);
// nothing kept and both down -> the picture inside the Worker (a real webp)
store.clear(); r = await get(ICON); assert.equal(r.headers.get("x-gate-origin"), "builtin");
const bytes = new Uint8Array(await r.arrayBuffer()); assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF"); assert.equal(String.fromCharCode(...bytes.slice(8, 12)), "WEBP");
// a server answering with something that is not an image is not trusted as the icon
store.clear(); reset(); script.oracle = () => new Response("<html>", { headers: { "content-type": "text/html" } }); script.vercel = () => WEBP();
r = await get(ICON); assert.equal(r.headers.get("x-gate-origin"), "vercel");
console.log("site-gate selftest: all checks passed");
