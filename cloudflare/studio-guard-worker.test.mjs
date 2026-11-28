// node cloudflare/studio-guard-worker.test.mjs — the wake rules of the Worker (no network).
import assert from "node:assert/strict";
import { decide, norm, pass, STUDIOS } from "./studio-guard-worker.js";

assert.equal(norm("Sleeping"), "sleeping");
assert.equal(norm("BuildFailed"), "failed");
assert.equal(decide("Sleeping", "warm", 30), "wake");
assert.equal(decide("Stopped", "warm", 30), "");
assert.equal(decide("Stopped", "train", 30), "wake");
assert.equal(decide("RunFailed", "runner", 5), "wake");
assert.equal(decide("RunFailed", "runner", 35), "");
assert.equal(decide("Running", "train", 0), "");
assert.equal(decide("Building", "train", 0), "");
assert.ok(!STUDIOS.some(([, , n]) => /nova-inference-server|athar/i.test(n)));
for (const n of ["sham2-tldm", "sham-v2-server", "lfm25-inference-server"]) assert.ok(STUDIOS.some(([s, , m]) => s === "cn" && m === n), n);
assert.equal(STUDIOS.find(([, , m]) => m === "sham-v2-server")[3], "warm");
const seen = [];
globalThis.fetch = async (url, opt) => {
  seen.push([opt.method, url]);
  if (url.endsWith("/deploy")) return new Response("{}", { status: 200 });
  const st = url.includes(".cn/") && url.endsWith("/sham-trainer-1") ? "Sleeping" : url.endsWith("/coder-inference-server-16") ? "Stopped" : "Running";
  return new Response(JSON.stringify({ data: { runtime: { status: st } } }), { status: 200 });
};
const res = await pass({ MS_TOKEN_CN: "c", MS_TOKEN_AI: "a" }, true, new Date("2026-11-18T04:33:00Z"));
const deploys = seen.filter(([m]) => m === "POST").map(([, u]) => u);
assert.deepEqual(deploys, ["https://www.modelscope.cn/openapi/v1/studios/novaai2026/sham-trainer-1/deploy"]);
assert.equal(res.results.find((r) => r.studio === "ai/Jonjithup/coder-inference-server-16").action, "");
seen.length = 0;
await pass({ MS_TOKEN_CN: "c", MS_TOKEN_AI: "a" }, false);
assert.equal(seen.filter(([m]) => m === "POST").length, 0);
console.log("studio-guard worker test OK");
// owner 2026-11-25: no trainer on the international site; Nova's reader is kept warm there
assert.ok(!STUDIOS.some(([s, , m, r]) => s === "ai" && r === "train" && m !== "sham-trainer-2"));   // ai sham-trainer-2 = Nova's computer hub (kept up like a trainer), not a trainer
for (const n of ["sham-tldm-writer", "sham-trainer-tools"]) assert.ok(STUDIOS.some(([s, , m, r]) => s === "cn" && m === n && r === "train"), n);
assert.ok(STUDIOS.some(([s, , m, r]) => s === "ai" && m === "nova-tldm-reader" && r === "warm"));
