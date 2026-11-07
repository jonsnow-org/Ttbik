import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, parseNameStatus } from "./agent-guard.mjs";

const rules = JSON.parse(readFileSync(new URL("../deploy/hosting/protected-paths.json", import.meta.url), "utf8")).rules;
const run = (list, approved = false) => classify(parseNameStatus(list), rules, approved);

test("changing a coin image or the frozen registry blocks", () => {
  assert.equal(run("M\tpublic/zenobia/znbt-coin.webp").some((h) => h.level === "block"), true);
  assert.equal(run("M\tpublic/zenobia/stage-2-queen.jpg").some((h) => h.level === "block"), true);
  assert.equal(run("D\tdeploy/hosting/znbt-frozen.json").some((h) => h.level === "block"), true);
  assert.equal(run("M\tsrc/app/api/zenobia/znbt/icon/route.ts").some((h) => h.level === "block"), true);
});
test("contracts, Athar, Oracle and the gate block", () => {
  for (const p of ["contracts/zenobia-curve/contracts/curve.tolk", "athar/build/x.boc", "deploy/oracle/agent/BRANCH", "cloudflare/site-gate/worker.js", "src/lib/atharBotLogic.ts", "src/lib/znbtPayout.ts"])
    assert.equal(run(`M\t${p}`).some((h) => h.level === "block"), true, p);
});
test("a NEW file in a protected folder only warns; ordinary files are untouched", () => {
  assert.deepEqual(run("A\tpublic/zenobia/anim/new.webp").map((h) => h.level), ["warn"]);
  assert.deepEqual(run("M\tsrc/lib/freeTools.ts\nM\tsrc/components/AdsterraSlot.tsx"), []);
});
test("pins, workflows and schema warn but never block", () => {
  const hits = run("M\tpackage.json\nM\t.github/workflows/ci.yml\nM\tprisma/schema.prisma");
  assert.equal(hits.length, 3);
  assert.equal(hits.every((h) => h.level === "warn"), true);
});
test("the Sham AI model and the general notices are NOT protected (owner's order 2026-11-06: only Athar is hands-off)", () => {
  // No hands-off rule, and no Sham-specific rule: only the generic workflows caution may remain for a workflow file.
  for (const p of ["ai-system/colab/sham_small/x.py", ".github/workflows/sham-lightning.yml", ".github/workflows/deploy-kaggle-notebook.yml", "docs/SHAM_NOTES.md", "CLAUDE.md", "AGENTS.md", "docs/agents/COMMON.md", "scripts/agent-guard.mjs", "src/lib/shamStudio.ts", "src/lib/shamMemory.ts"])
    assert.equal(run(`M\t${p}`).every((h) => h.level === "warn"), true, p);
  // None of them is a block, and none carries a Sham-specific id any more.
  for (const p of ["ai-system/colab/sham_small/x.py", "docs/SHAM_NOTES.md", "CLAUDE.md", "src/lib/shamStudio.ts"])
    assert.equal(run(`M\t${p}`).some((h) => h.id === "sham-model" || h.id === "sham-interface" || h.id === "notices"), false, p);
});
test("owner approval turns blocks into warnings", () => {
  assert.equal(run("M\tpublic/zenobia/znbt-coin.webp", true).every((h) => h.level === "warn"), true);
});
test("this session's own kind of change passes", () => {
  assert.deepEqual(run("M\tsrc/lib/matchBotLogic.ts\nA\tsrc/lib/__tests__/x.test.ts\nM\tdocs/agents/zenobia.md\nM\tpromo/platform-features.json"), []);
});
