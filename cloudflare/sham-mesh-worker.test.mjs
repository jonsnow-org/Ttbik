// node cloudflare/sham-mesh-worker.test.mjs -> request authentication of the sham-mesh relay (Ed25519 over METHOD\npath\nts\nsha256(body)).
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker, { authenticate, sha256hex, signingString, b64uToBytes, CORS } from "./sham-mesh-worker.js";

globalThis.crypto ??= webcrypto;
const b64u = (u8) => Buffer.from(u8).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const id = b64u(pub);
assert.deepEqual(b64uToBytes(id), pub);

async function req(body, { ts = Date.now(), node = id, path = "/m/sham2/hello", tamper = false } = {}) {
  const bytes = new TextEncoder().encode(body);
  const msg = signingString("POST", path, String(ts), await sha256hex(bytes));
  const sig = b64u(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(msg))));
  const r = new Request("https://sham-mesh.example" + path, { method: "POST", body, headers: { "x-mesh-node": node, "x-mesh-ts": String(ts), "x-mesh-sig": sig } });
  return authenticate(r, tamper ? new TextEncoder().encode(body + " ") : bytes);
}

assert.equal((await req('{"slots":1}')).ok, true, "a signed request passes");
assert.equal((await req('{"slots":1}', { tamper: true })).why, "bad signature", "a changed body fails");
assert.equal((await req('{"slots":1}', { ts: Date.now() - 600_000 })).why, "clock skew or stale request");
const other = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign"])).publicKey)));
assert.equal((await req('{"slots":1}', { node: other })).why, "bad signature", "another node's id cannot be claimed");
assert.equal((await authenticate(new Request("https://x/m/sham2/hello", { method: "POST", body: "{}" }), new Uint8Array())).why, "unsigned");
// browser nodes (src/lib/meshNode.ts): the preflight allows the signature headers, and every answer (even a refusal) carries CORS
const pre = await worker.fetch(new Request("https://x/m/sham2/hello", { method: "OPTIONS" }), {});
assert.equal(pre.status, 204);
assert.match(pre.headers.get("access-control-allow-headers"), /x-mesh-sig/);
const unsigned = await worker.fetch(new Request("https://x/m/sham2/hello", { method: "POST", body: "{}" }), { HUB: { idFromName: () => 0, get: () => ({}) } });
assert.equal(unsigned.status, 401);
assert.equal(unsigned.headers.get("access-control-allow-origin"), CORS["access-control-allow-origin"]);
console.log("sham-mesh worker auth + CORS: 7/7 ok");
