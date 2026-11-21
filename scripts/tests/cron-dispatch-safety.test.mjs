import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("scheduled cron runner chooses Gate/Oracle once and never retries side effects", () => {
  const source = read("scripts/hosting/run-crons.mjs");
  assert.match(source, /select-site-base\.sh/);
  assert.match(source, /execFileSync/);
  assert.match(source, /code >= 200 && code < 300/);
  assert.doesNotMatch(source, /for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*3/);
  assert.equal((source.match(/await fetch\(/g) || []).length, 1);
});

test("coder schedule tick makes one post after Gate/Oracle preflight", () => {
  const source = read(".github/workflows/coder-schedules.yml");
  assert.match(source, /select-site-base\.sh/);
  assert.match(source, /\$SITE_BASE\/api\/coder\/schedules\/tick/);
  assert.doesNotMatch(source, /for i in 1 2 3/);
  assert.equal((source.match(/curl .*api\/coder\/schedules\/tick/g) || []).length, 1);
});

test("monitor never dispatches or reruns Actions", () => {
  const workflow = read(".github/workflows/monitor.yml");
  const source = read("scripts/supervisors/run.mjs");
  assert.match(workflow, /actions:\s*read/);
  assert.doesNotMatch(workflow, /actions:\s*write/);
  assert.match(workflow, /select-site-base\.sh/);
  assert.doesNotMatch(source, /rerun-failed-jobs/);
  assert.match(source, /RERUN_OK = new Set\(\)/);
});

test("Remotion validates only existing channels and selects origin after choosing episode", () => {
  const workflow = read(".github/workflows/promo-remotion.yml");
  const pick = workflow.indexOf("id: pick");
  const select = workflow.indexOf("select public origin (Gate first, Oracle fallback)");
  assert.ok(pick >= 0 && select > pick);
  assert.match(workflow, /remotion_publish\.py episode\.json/);
  assert.doesNotMatch(workflow, /vercelUrl/);
});
