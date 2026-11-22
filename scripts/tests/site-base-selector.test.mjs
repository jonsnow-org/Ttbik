import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = path.resolve("scripts/hosting/select-site-base.sh");

function runProbe(gateStatus, oracleStatus) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-base-test-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(dir, "site.json"), JSON.stringify({
      gateUrl: "https://gate.example",
      engineUrl: "https://engine.example",
      oracleUrl: "https://oracle.example",
      vercelUrl: "https://vercel.example",
    }));
    fs.writeFileSync(path.join(bin, "jq"), `#!/bin/sh
case "$*" in
  *gateUrl*) echo "https://gate.example" ;;
  *oracleUrl*) echo "https://oracle.example" ;;
  *) exit 2 ;;
esac
`);
    fs.writeFileSync(path.join(bin, "curl"), `#!/bin/sh
case "$*" in
  *gate.example*) printf '%s' "${gateStatus}" ;;
  *oracle.example*) printf '%s' "${oracleStatus}" ;;
  *) printf '000' ;;
esac
`);
    fs.chmodSync(path.join(bin, "jq"), 0o755);
    fs.chmodSync(path.join(bin, "curl"), 0o755);
    const result = spawnSync("bash", [script, path.join(dir, "site.json")], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
    });
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("selects Gate first and never probes Oracle when Gate is healthy", () => {
  const r = runProbe("200", "200");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SITE_BASE=https:\/\/gate\.example/);
  assert.match(r.stdout, /SITE_BASE_SOURCE=gate/);
});

test("falls back to Oracle only after Gate fails its read-only probe", () => {
  const r = runProbe("530", "200");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SITE_BASE=https:\/\/oracle\.example/);
  assert.match(r.stdout, /SITE_BASE_SOURCE=oracle/);
});

test("fails closed when neither configured origin is healthy", () => {
  const r = runProbe("000", "503");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Neither configured public origin/);
});
