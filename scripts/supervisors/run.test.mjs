import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, overall, render, SECTIONS, decideRerun } from "./run.mjs";

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

test("tier-1 rerun: only after 15 min, once, when nobody fixed it and nobody is working", () => {
  const f = (m, extra = {}) => ({ conclusion: "failure", run_attempt: 1, updated_at: new Date(NOW - m * 60000).toISOString(), ...extra });
  const base = (over) => ({ file: "znbt-index.yml", runs: [f(30)], active: [], lastPushAt: new Date(NOW - 60 * 60000).toISOString(), paused: false, ...over });
  assert.equal(decideRerun(base({}), NOW).ok, true);
  assert.equal(decideRerun(base({ runs: [f(10)] }), NOW).ok, false);                       // too fresh
  assert.equal(decideRerun(base({ runs: [f(30, { run_attempt: 2 })] }), NOW).ok, false);   // already retried
  assert.equal(decideRerun(base({ runs: [f(30), { conclusion: "success", updated_at: new Date(NOW - 5 * 60000).toISOString() }] }), NOW).ok, false);
  assert.equal(decideRerun(base({ runs: [{ conclusion: "success", updated_at: new Date(NOW - 5 * 60000).toISOString() }, f(30)] }), NOW).ok, false);   // latest is a success
  assert.equal(decideRerun(base({ active: [{ id: 1 }] }), NOW).ok, false);                  // someone re-dispatched
  assert.equal(decideRerun(base({ lastPushAt: new Date(NOW - 5 * 60000).toISOString() }), NOW).ok, false);   // someone is pushing
  assert.equal(decideRerun(base({ paused: true }), NOW).ok, false);                         // bots-pause label
  assert.equal(decideRerun(base({ file: "athar-mints.yml" }), NOW).ok, false);              // never money / posting workflows
  assert.equal(decideRerun(base({ file: "channel-post.yml" }), NOW).ok, false);
});
