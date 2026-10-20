import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, overall, render, SECTIONS } from "./run.mjs";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const run = (c, h) => ({ conclusion: c, updated_at: new Date(NOW - h * 3600_000).toISOString(), html_url: "u" });
const def = ["a.yml", "A", 6];

test("healthy section is ok", () => {
  const c = evaluate({ site: [{ label: "p", status: 200, ok: true }], workflows: [{ def, runs: [run("success", 1)] }], errors: [] }, NOW);
  assert.equal(overall(c), "ok");
});
test("stale workflow fails, newer failure after success warns", () => {
  assert.equal(overall(evaluate({ workflows: [{ def, runs: [run("success", 9)] }] }, NOW)), "fail");
  assert.equal(overall(evaluate({ workflows: [{ def, runs: [run("failure", 1), run("success", 3)] }] }, NOW)), "warn");
});
test("page down fails; info page down does not", () => {
  assert.equal(overall(evaluate({ site: [{ label: "p", status: 500, ok: false }] }, NOW)), "fail");
  assert.equal(overall(evaluate({ site: [{ label: "p", status: 0, ok: false, info: true }] }, NOW)), "ok");
});
test("frozen check failure is a fail; open errors warn", () => {
  assert.equal(overall(evaluate({ frozen: "fail" }, NOW)), "fail");
  assert.equal(overall(evaluate({ errors: ["#1 x"] }, NOW)), "warn");
});
test("render carries the status marker and every section has config", () => {
  assert.match(render("athar", evaluate({}, NOW), "2026-10-20"), /<!-- status:ok -->/);
  for (const k of ["zenobia", "palmyra-launch", "telegram-bots", "site-content", "athar"]) assert.ok(SECTIONS[k].site.length && SECTIONS[k].workflows.length);
});
