// node --test coder-sandbox/runner.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config, dockerRunArgs, freeMemMb, refusal, makeBoxes, makeHandler, safeEqual } from "./runner.mjs";

const SECRET = "s".repeat(32);

test("limits: every docker box is capped and isolated", () => {
  const cfg = config({ RUNNER_SECRET: SECRET });
  const a = dockerRunArgs(cfg, "coder-abc-1", 123).join(" ");
  for (const want of ["--cpus 1", "--memory 2048m", "--memory-swap 2048m", "--pids-limit 256", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--network coder-sbx-net", "--user 1000:1000", "/work:rw,exec,nosuid,size=1024m", "/tmp:rw,exec,nosuid,size=256m", "coder-sandbox.expires=123", "--restart no"]) {
    assert.ok(a.includes(want), want);
  }
  assert.ok(!/(^|\s)(-v|--volume|--mount|--privileged)(\s|$)/.test(a), "no host mounts / privileged");
  // limits cannot be raised past the hard caps by env
  const big = config({ RUNNER_SECRET: SECRET, RUNNER_MEMORY_MB: "99999", RUNNER_CPUS: "16", RUNNER_MAX_BOXES: "50" });
  assert.equal(big.memoryMb, 3072);
  assert.equal(big.cpus, "2");
  assert.equal(big.maxBoxes, 6);
});

test("yields to Sham, to memory pressure and to capacity", () => {
  const cfg = config({ RUNNER_SECRET: SECRET });
  assert.equal(refusal(cfg, { shamOn: true, freeMb: 9000, active: 0 }), "sham-busy");
  assert.equal(refusal(cfg, { shamOn: false, freeMb: 1000, active: 0 }), "low-memory");
  assert.equal(refusal(cfg, { shamOn: false, freeMb: 9000, active: 2 }), "capacity");
  assert.equal(refusal(cfg, { shamOn: false, freeMb: 9000, active: 1 }), null);
  assert.equal(config({ RUNNER_SECRET: SECRET, RUNNER_MIN_FREE_MB: "0" }).minFreeMb, 0, "explicit 0 turns the memory check off");
  assert.equal(config({ RUNNER_SECRET: SECRET, RUNNER_MIN_FREE_MB: "abc" }).minFreeMb, 3000);
  assert.equal(freeMemMb("MemTotal: 1 kB\nMemAvailable:    4096000 kB\n"), 4000);
});

test("reaper removes expired docker boxes; extensions live in the runner only", async () => {
  let t = 1_000_000;
  const NEW_EXP = t + 600000;
  const calls = [];
  const live = new Map([["csbx-old", 999999], ["csbx-new", NEW_EXP], ["other", 1]]);
  const fake = async (cmd, args) => {
    calls.push(args.join(" "));
    if (args[0] === "rm") live.delete(args[2]);
    if (args[0] === "ps") return { code: 0, out: Buffer.from([...live].map(([n, e]) => `${n} ${e}`).join("\n")), err: "" };
    return { code: 0, out: Buffer.alloc(0), err: "" };
  };
  const boxes = makeBoxes(config({ RUNNER_SECRET: SECRET }), fake, () => t);
  assert.deepEqual(await boxes.reap(), ["old"]);
  assert.ok(calls.includes("rm -f csbx-old"));
  t += 500000;
  await boxes.extend("new", 30 * 60000);
  t += 200000; // past the label's expiry, inside the extension
  assert.deepEqual(await boxes.reap(), [], "extended box survives");
  t += 30 * 60000;
  assert.deepEqual(await boxes.reap(), ["new"], "and is reaped after the extension");
});

async function serve(handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

test("HTTP API in local mode: auth, create, exec, files, 503 when not accepting, delete", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "csbx-"));
  const cfg = config({ RUNNER_SECRET: SECRET, RUNNER_MODE: "local", RUNNER_LOCAL_ROOT: root, RUNNER_MAX_BOXES: "1" });
  const boxes = makeBoxes(cfg);
  let sham = false;
  const { srv, base } = await serve(makeHandler(cfg, boxes, async () => ({ shamOn: sham, freeMb: null, active: (await boxes.list()).length })));
  const H = { "x-runner-key": SECRET, "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal((await fetch(`${base}/health`, { headers: { "x-runner-key": "wrong" } })).status, 401);
    const h = await (await fetch(`${base}/health`, { headers: H })).json();
    assert.equal(h.accepting, true);
    assert.equal((await fetch(`${base}/v1/boxes`, { method: "POST", headers: H, body: JSON.stringify({ name: "../etc" }) })).status, 400);
    const c = await fetch(`${base}/v1/boxes`, { method: "POST", headers: H, body: JSON.stringify({ name: "coder-a1-r1", timeoutMs: 600000 }) });
    assert.equal(c.status, 201);
    const home = (await c.json()).home;
    const e = await (await fetch(`${base}/v1/boxes/coder-a1-r1/exec`, { method: "POST", headers: H, body: JSON.stringify({ cmd: "bash", args: ["-c", "echo hi && pwd"], timeoutMs: 10000 }) })).json();
    assert.equal(e.exitCode, 0);
    assert.equal(e.stdout, `hi\n${home}\n`);
    const p = `${home}/x/y.txt`;
    assert.equal((await fetch(`${base}/v1/boxes/coder-a1-r1/files`, { method: "PUT", headers: H, body: JSON.stringify({ path: p, contentB64: Buffer.from("héllo").toString("base64") }) })).status, 200);
    assert.equal(await (await fetch(`${base}/v1/boxes/coder-a1-r1/files?path=${encodeURIComponent(p)}`, { headers: H })).text(), "héllo");
    assert.equal((await fetch(`${base}/v1/boxes/coder-a1-r1/files?path=${encodeURIComponent(home + "/nope")}`, { headers: H })).status, 404);
    // full (max 1 box) and Sham busy: refused so the caller fails over
    assert.equal((await fetch(`${base}/v1/boxes`, { method: "POST", headers: H, body: JSON.stringify({ name: "coder-a2-r2" }) })).status, 503);
    assert.equal((await fetch(`${base}/v1/boxes/coder-a1-r1`, { method: "DELETE", headers: H })).status, 200);
    sham = true;
    assert.equal((await fetch(`${base}/v1/boxes`, { method: "POST", headers: H, body: JSON.stringify({ name: "coder-a2-r2" }) })).status, 503);
    assert.equal((await fetch(`${base}/v1/boxes/coder-a1-r1`, { headers: H })).status, 404);
  } finally {
    srv.close();
  }
});

test("constant-time key compare", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});
