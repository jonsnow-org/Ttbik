// Guards the recurring "revision pin drift" bug: every ModelScope app declares an APP_REVISION that deploy
// workflows, preflight scripts, docs and TS guards assert. When the app bumps, ALL of them must move together
// or the deploy / readiness checks fail closed ("deploying" forever) with no test catching it. This test reads
// the app revision and asserts every pin agrees.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const appRevision = (source) => (source.match(/^APP_REVISION\s*=\s*"([^"]+)"/m) || [])[1];
const all = (source, re) => [...source.matchAll(re)].map((m) => m[1] ?? m[0]);

test("computer hub revision is pinned identically everywhere", () => {
  const revision = appRevision(read("ai-system/modelscope-media/computer_studio_app.py"));
  assert.ok(revision, "computer_studio_app.py must declare APP_REVISION");

  const workflow = read(".github/workflows/deploy-minicpmo-big.yml");
  const workflowPins = all(workflow, /computer-hub-16gb-[0-9a-z-]+/g);
  assert.ok(workflowPins.length >= 2, "deploy-minicpmo-big.yml must assert the computer revision (build + status)");
  for (const pin of workflowPins) assert.equal(pin, revision, `deploy-minicpmo-big.yml pins ${pin}, app declares ${revision}`);

  const preflight = read("scripts/ops/modelscope_computer_hub_preflight.py");
  const preflightPins = all(preflight, /computer-hub-16gb-[0-9a-z-]+/g);
  assert.ok(preflightPins.length >= 1, "modelscope_computer_hub_preflight.py must assert the computer revision");
  for (const pin of preflightPins) assert.equal(pin, revision, `preflight pins ${pin}, app declares ${revision}`);

  const doc = read("docs/MODELS_AND_COMPUTER.md");
  const docPins = all(doc, /computer-hub-16gb-[0-9a-z-]+/g);
  for (const pin of docPins) assert.equal(pin, revision, `docs/MODELS_AND_COMPUTER.md pins ${pin}, app declares ${revision}`);
});

