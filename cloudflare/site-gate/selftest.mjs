// Run: node cloudflare/site-gate/selftest.mjs   (no network: fake origins, fake KV)
import assert from "node:assert/strict";
import gate, { _state } from "./worker.js";

const kvData = new Map();
const env = { GATE: { get: async (k) => kvData.get(k) ?? null, put: async (k, v) => { kvData.set(k, v); } }, GATE_KEY: "k3y", ALERT_BOT_TOKEN: "T", ALERT_CHAT_ID: "1" };
const P = "https://89-168-89-15.sslip.io", S = "https://ttbik.vercel.app";
let calls = [], script = {}, alerts = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/")) { alerts++; return new Response("{}"); }
  calls.push({ url: u, method: init.method || "GET", body: init.body, headers: init.headers });
  const o = u.startsWith(P) ? "oracle" : "vercel";
  const s = script[o] ?? (() => new Response(o + " ok"));
  return s(u, init);
};
const ctx = { waitUntil: (p) => p };
const reset = (mode = "auto") => { calls = []; script = {}; alerts = 0; kvData.clear(); kvData.set("mode", mode); _state.modeAt = 0; _state.downUntil = 0; };
const get = (path, init) => gate.fetch(new Request("https://gate.test" + path, init), env, ctx);

reset();
let r = await get("/hello?x=1");
assert.equal(await r.text(), "oracle ok"); assert.equal(r.headers.get("x-gate-origin"), "oracle");
assert.equal(calls[0].url, P + "/hello?x=1");
assert.equal(new Headers(calls[0].headers).get("x-forwarded-host"), "gate.test");

reset(); script.oracle = () => { throw new TypeError("refused"); };
r = await get("/a"); assert.equal(await r.text(), "vercel ok"); assert.equal(r.headers.get("x-gate-origin"), "vercel");
assert.ok(_state.downUntil > Date.now()); assert.equal(alerts, 1);
calls = []; await get("/b"); assert.equal(calls[0].url, S + "/b", "primary is skipped while marked down");
await get("/c"); assert.equal(alerts, 1, "one alert per 10 minutes");

reset(); script.oracle = () => new Response("bad gateway", { status: 502 });
r = await get("/x"); assert.equal(await r.text(), "vercel ok");

reset(); script.oracle = () => new Response("boom", { status: 500 });
r = await get("/x"); assert.equal(r.status, 500); assert.equal(calls.length, 1, "an application error is not retried elsewhere");

reset(); script.oracle = () => { const e = new Error("t"); e.name = "AbortError"; throw e; };
r = await get("/hook", { method: "POST", body: "{}" }); assert.equal(r.status, 504); assert.equal(calls.length, 1, "a timed-out write is never replayed");

reset(); script.oracle = () => { throw new TypeError("refused"); };
r = await get("/hook", { method: "POST", body: '{"u":1}', headers: { "x-telegram-bot-api-secret-token": "s" } });
assert.equal(await r.text(), "vercel ok"); assert.equal(calls[1].body.byteLength, 7, "body replayed on the standby");
assert.equal(new Headers(calls[1].headers).get("x-telegram-bot-api-secret-token"), "s");

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

reset();
r = await get("/__gate/status"); assert.equal(r.status, 401);
r = await get("/__gate"); assert.equal(r.status, 200); assert.match(await r.text(), /Gate/);
script.oracle = () => new Response("{}"); script.vercel = () => new Response("{}", { status: 200 });
r = await get("/__gate/status", { headers: { "x-gate-key": "k3y" } }); let j = await r.json();
assert.equal(j.mode, "auto"); assert.equal(j.oracle.ok, true);
r = await get("/__gate/mode", { method: "POST", headers: { "x-gate-key": "k3y" }, body: JSON.stringify({ mode: "vercel" }) });
assert.equal(r.status, 200); assert.equal(kvData.get("mode"), "vercel");
r = await get("/__gate/mode", { method: "POST", headers: { "x-gate-key": "k3y" }, body: JSON.stringify({ mode: "nope" }) });
assert.equal(r.status, 400);
calls = []; await get("/after"); assert.ok(calls[0].url.startsWith(S), "the new mode applies at once");
console.log("site-gate selftest: all checks passed");
