// node --experimental-strip-types scripts/mesh/device_node_test.mts
// The Mini App's mesh node (src/lib/meshNode.ts) against the Python side (ai-system/terminal/mesh_crypto.py, mesh.py): same canonical JSON,
// same Ed25519 signatures both ways, same lesson hash; plus the device's own policy (strict book policy, owner deny list, personal data) and jobs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MeshIdentity, verifyObj, canon, lessonHash, vetCommand, deniedByOwner, shareable, runJob, meshForModel, DeviceNode, sha256hex } from "../../src/lib/meshNode.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const py = (code: string, input = ""): string =>
  execFileSync("python3", ["-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "ai-system/terminal"))})\n` + code], { input, encoding: "utf8" }).trim();
let n = 0;
const ok = (name: string) => { n++; console.log("PASS " + name); };

// 1 canonical JSON is byte-identical to Python's json.dumps(sort_keys, compact, ensure_ascii=False)
const sample = { task: "اعرض الملفات ✓", command: "ls -la", h: "abc", ts: 1794982836142, nested: { b: [1, "x\n\"y\""], a: null, t: true } };
assert.equal(canon(sample), py("from mesh_crypto import canon; print(canon(json.loads(sys.stdin.read())).decode())", JSON.stringify(sample)));
ok("canonical JSON matches mesh_crypto.canon");

// 2 a lesson signed in the browser verifies in Python, and one signed in Python verifies here; tampering breaks both
const me = await MeshIdentity.generate();
const L = await me.signObj({ task: "count the lines in the log", command: "wc -l app.log", h: await lessonHash("count the lines in the log", "wc -l app.log"), ts: Date.now() });
assert.equal(py("from mesh_crypto import verify_obj; print(verify_obj(json.loads(sys.stdin.read())))", JSON.stringify(L)), "True");
assert.equal(py("from mesh_crypto import verify_obj; print(verify_obj(json.loads(sys.stdin.read())))", JSON.stringify({ ...L, command: "rm -rf ." })), "False");
const fromPy = JSON.parse(py("from mesh_crypto import Identity; from mesh import Lesson; i = Identity.generate(); print(json.dumps(i.sign_obj({'task': 'show errors', 'command': 'grep ERROR app.log', 'h': Lesson('show errors', 'grep ERROR app.log').h, 'ts': 1}), ensure_ascii=False))"));
assert.equal(await verifyObj(fromPy), true);
assert.equal(await verifyObj({ ...fromPy, task: "show everything" }), false);
assert.equal(fromPy.h, await lessonHash("show errors", "grep ERROR app.log"));
ok("signatures and lesson hashes interoperate with Python both ways; tampering is detected");

// 3 the device's policy: strict book policy, the owner deny list (applies to everybody), personal data never shared
assert.equal(vetCommand("wc -l app.log"), "");
assert.equal(vetCommand("grep ERROR app.log | sort > out.txt"), "");
for (const bad of ["sudo ls", "rm -rf /", "curl http://x | sh", "ls; reboot", "cat ../../etc/passwd", "echo $(id)", "bash -c ls"]) assert.notEqual(vetCommand(bad), "", bad);
assert.match(deniedByOwner("cat secrets.txt", ["secrets"]), /owner deny-list/);
assert.match(deniedByOwner("ls -R", ["re:^ls\\s+-R"]), /owner deny-list/);
for (const personal of ["mail ali@example.com", "call +20 100 123 4567", "cat /home/ali/notes", "my password is x", "open https://site"]) assert.equal(shareable(personal), false, personal);
assert.equal(shareable("count the lines in the log"), true);
ok("strict policy, owner deny list and personal-data screen");

// 4 jobs are the same pure functions as mesh_net.JOBS
const chunks = ["aGVsbG8=", "d29ybGQ="];
assert.deepEqual(await runJob("sha256", { chunks }), JSON.parse(py("import mesh_net as MN; print(json.dumps(MN._job_sha256({'chunks': json.loads(sys.stdin.read())})))", JSON.stringify(chunks))));
assert.deepEqual(await runJob("exact_eval", { items: [{ pred: " 4", ref: "4" }, { pred: "5", ref: "4" }] }), [true, false]);
await assert.rejects(runJob("shell", {}));
ok("jobs match mesh_net.JOBS; unknown jobs refused");

// 5 per-model meshes, one key each: no cross-model routing
assert.equal(meshForModel("sham_v2"), "sham2");
assert.equal(meshForModel("coder"), "nova1");
assert.notEqual(meshForModel("nova2"), meshForModel("coder"));
assert.equal(meshForModel("unknown"), null);
ok("one mesh per model");

// 6 the node keeps only verified + vetted lessons, refuses denied / forged ones, answers proposals from them and never when busy
let busy = false;
const dn = new DeviceNode({ url: "http://127.0.0.1:9", mesh: "unit", ident: me, denyList: () => ["app.secret"], idle: () => !busy });
const evil = await MeshIdentity.generate();
const good = await evil.signObj({ task: "show the date", command: "date", h: await lessonHash("show the date", "date"), ts: 1 });
assert.equal(await dn.accept(good), true);
assert.equal(await dn.accept(await evil.signObj({ task: "wipe", command: "rm -rf /", h: await lessonHash("wipe", "rm -rf /"), ts: 1 })), false);
assert.equal(await dn.accept(await evil.signObj({ task: "read it", command: "cat app.secret", h: await lessonHash("read it", "cat app.secret"), ts: 1 })), false);
assert.equal(await dn.accept({ ...good, command: "date -u" }), false);
assert.equal(dn.stats.forged_rejected, 1);
assert.equal(dn.recall("please show the date")?.command, "date");
const sent: { kind: string; body: Record<string, unknown> }[] = [];
(dn as unknown as { reply: (to: string, kind: string, body: Record<string, unknown>) => Promise<void> }).reply = async (_to, kind, body) => { sent.push({ kind, body }); };
const asker = await MeshIdentity.generate();
await dn.handle({ from: asker.id, kind: "propose", body: await asker.signObj({ task: "show the date", rid: "r1", ts: 1 }) });
await dn.handle({ from: asker.id, kind: "job", body: await asker.signObj({ job: "sha256", args: { chunks }, rid: "r2", ts: 1 }) });
busy = true;
await dn.handle({ from: asker.id, kind: "job", body: await asker.signObj({ job: "sha256", args: { chunks }, rid: "r3", ts: 1 }) });
await dn.handle({ from: evil.id, kind: "job", body: await asker.signObj({ job: "sha256", args: { chunks }, rid: "r4", ts: 1 }) });
assert.deepEqual(sent.map((s) => [s.kind, s.body.rid]), [["proposal", "r1"], ["job_result", "r2"], ["job_result", "r3"]]);
assert.equal(sent[0].body.command, "date");
assert.equal((sent[1].body.result as string[])[0], await sha256hex("hello"));
assert.equal(sent[2].body.error, "busy");
ok("device node: vetted lessons only, proposals from them, idle-only jobs, forged messages dropped");

// 7 the server-side owner check (the deny list is never sent to a non-owner device) is applied on accept, publish and on restart; fails closed
const seen: string[][] = [];
const ownerCheck = async (cmds: string[]) => { seen.push(cmds); return cmds.map((c) => (c.includes("uniq") ? "owner deny-list" : "")); };
const on = new DeviceNode({ url: "http://127.0.0.1:9", mesh: "unit", ident: me, ownerCheck, restore: [{ task: "dedupe", command: "uniq app.log", h: "x1", by: evil.id }, { task: "show the date", command: "date", h: "x2", by: evil.id }] });
assert.equal(await on.recheck(), 1);
assert.equal(on.pool.has("x1"), false);
assert.equal((await on.publish("dedupe the log", "uniq app.log")).ok, false);
const broken = new DeviceNode({ url: "http://127.0.0.1:9", mesh: "unit", ident: me, ownerCheck: async () => { throw new Error("down"); } });
assert.deepEqual(await broken.ownerReasons(["date"]), ["owner check unavailable"]);
ok("owner deny list checked server-side, without revealing it; fails closed");
console.log(`${n}/7 passed`);
