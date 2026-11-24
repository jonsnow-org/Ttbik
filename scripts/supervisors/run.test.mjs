import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, overall, render, SECTIONS, decideRerun, RERUN_OK } from "./run.mjs";

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
test("promo-projects pull-request validation is not counted as generated assets", () => {
  const promoDef = ["promo-projects.yml", "Promo images", 200, ["schedule", "workflow_dispatch"], ["claude/free-services-marketplace-h6rwk2"]];
  const prSuccess = {
    event: "pull_request",
    head_branch: "dependabot/github_actions/example",
    status: "completed",
    conclusion: "success",
    updated_at: new Date(NOW - 10 * 60000).toISOString(),
    html_url: "pr-validation-only",
  };
  const featureDispatch = {
    event: "workflow_dispatch",
    head_branch: "feature/promo-preview",
    status: "completed",
    conclusion: "success",
    updated_at: new Date(NOW - 5 * 60000).toISOString(),
    html_url: "feature-branch-render",
  };
  const scheduledFailure = {
    event: "schedule",
    head_branch: "claude/free-services-marketplace-h6rwk2",
    status: "completed",
    conclusion: "failure",
    updated_at: new Date(NOW - 4 * 3600_000).toISOString(),
    html_url: "scheduled-generator-failure",
  };
  const failed = evaluate({ workflows: [{ def: promoDef, runs: [prSuccess, featureDispatch, scheduledFailure] }] }, NOW)
    .find((c) => c.name === "Workflow: Promo images");
  assert.equal(failed.level, "fail");
  assert.match(failed.detail, /scheduled-generator-failure/);
  assert.doesNotMatch(failed.detail, /pr-validation-only/);
  assert.doesNotMatch(failed.detail, /feature-branch-render/);

  const scheduledSuccess = {
    ...scheduledFailure,
    conclusion: "success",
    updated_at: new Date(NOW - 2 * 3600_000).toISOString(),
    html_url: "scheduled-assets-created",
  };
  const healthy = evaluate({ workflows: [{ def: promoDef, runs: [prSuccess, scheduledSuccess] }] }, NOW)
    .find((c) => c.name === "Workflow: Promo images");
  assert.equal(healthy.level, "ok");
  assert.match(healthy.detail, /last success 2h ago/);
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

test("supervisor is strictly read-only and never reruns a workflow", () => {
  const failed = { conclusion: "failure", run_attempt: 1, updated_at: new Date(NOW - 24 * 3600_000).toISOString() };
  assert.equal(RERUN_OK.size, 0);
  for (const file of ["znbt-index.yml", "znbt-guard.yml", "promo-projects.yml", "channel-post.yml", "coins-channel-post.yml", "promo-remotion.yml", "athar-stars.yml"]) {
    assert.equal(decideRerun({ file, runs: [failed], active: [], paused: false }, NOW).ok, false, file);
  }
});

test("a running workflow is reported as running, not as a stale missing success", () => {
  const recent = { status: "in_progress", created_at: new Date(NOW - 5 * 60000).toISOString(), html_url: "active-run" };
  const checks = evaluate({ workflows: [{ def, runs: [recent, run("success", 10)] }] }, NOW);
  const c = checks.find((x) => x.name === "Workflow: A");
  assert.equal(c.level, "ok");
  assert.match(c.detail, /in_progress/);
  const old = { ...recent, created_at: new Date(NOW - 8 * 3600_000).toISOString() };
  const oldCheck = evaluate({ workflows: [{ def, runs: [old, run("success", 10)] }] }, NOW).find((x) => x.name === "Workflow: A");
  assert.equal(oldCheck.level, "warn");
});

test("site checks include the route used for the public origin", () => {
  const c = evaluate({ site: [{ label: "home", status: 200, ok: true, via: "oracle" }] });
  assert.match(c[0].detail, /via oracle/);
});

test("bots live check: broken webhook fails, healthy passes, unreadable warns", () => {
  const mk = (bots) => evaluate({ bots: { checked: bots.length, bots } }, Date.now()).find((c) => c.name.startsWith("Bots"));
  const good = { template: "x", username: "a_bot", active: true, tokenValid: true, webhookOk: true, pending: 0, lastError: null };
  assert.equal(mk([good]).level, "ok");
  assert.equal(mk([good, { ...good, webhookOk: false }]).level, "fail");
  assert.equal(mk([{ ...good, lastError: "timeout", lastErrorAgoMin: 5 }]).level, "warn");
  assert.equal(evaluate({ bots: { error: "HTTP 401" } }).find((c) => c.name.startsWith("Bots")).level, "warn");

});
import { notifyDecision } from "./run.mjs";
test("mail control: blips are silent, 6h outage mails once, recovery mails once", () => {
  const t0 = Date.parse("2026-11-01T00:00:00Z");
  let a = notifyDecision("<!-- status:ok -->", "fail", t0);
  assert.equal(a.comment, null);
  let b = notifyDecision("<!-- status:fail -->" + a.marker, "ok", t0 + 3600e3);
  assert.equal(b.comment, null);                       // blip healed: no mail
  let c = notifyDecision("<!-- status:fail -->" + a.marker, "fail", t0 + 7 * 3600e3);
  assert.match(c.comment, /Still failing/);            // long outage: one mail
  let d = notifyDecision("<!-- status:fail -->" + c.marker, "fail", t0 + 8 * 3600e3);
  assert.equal(d.comment, null);                       // not repeated
  assert.match(notifyDecision("<!-- status:fail -->" + c.marker, "ok", t0 + 9 * 3600e3).comment, /Recovered/);
  assert.equal(notifyDecision("<!-- status:ok -->", "warn", t0).comment, null);   // warnings never mail
});

import { renderAll } from "./run.mjs";
test("the ONE monitoring report: every section in one body, overall status first, no per-event noise", () => {
  const good = evaluate({ site: [{ label: "p", status: 200, ok: true }] }, NOW);
  const bad = evaluate({ site: [{ label: "p", status: 500, ok: false }] }, NOW);
  const all = renderAll([{ section: "athar", checks: good }, { section: "promo", checks: bad }], "2026-11-14");
  assert.match(all, /<!-- status:fail -->/);
  assert.match(all, /# Monitoring: all systems/);
  assert.match(all, /❌ \*\*promo\*\*/);
  assert.match(all, /✅ \*\*athar\*\*: all good/);
  assert.match(renderAll([{ section: "athar", checks: good }], "d"), /<!-- status:ok -->/);
  for (const k of ["zenobia", "palmyra-launch", "telegram-bots", "site-content", "athar", "promo"]) assert.ok(SECTIONS[k]);
  // the monitor never includes the removed supervisor as a separate workflow.
  assert.ok(!JSON.stringify(SECTIONS).includes("error-triage"));
  assert.equal(RERUN_OK.size, 0);
});

test("promotion operations documentation points to the unified monitor and retired workflows stay out of the runbook", () => {
  const notebook = readFileSync(new URL("../../docs/REPO_NOTEBOOK.md", import.meta.url), "utf8");
  const promoGuide = readFileSync(new URL("../../docs/agents/promo.md", import.meta.url), "utf8");
  assert.match(notebook, /monitor.*hourly at minute 11 UTC/);
  assert.match(notebook, /Monitoring: all systems/);
  assert.doesNotMatch(notebook, /promo-supervisor\.yml|error-triage\.yml/);
  assert.match(promoGuide, /scripts\/supervisors\/run\.mjs/);
  assert.match(promoGuide, /Monitoring: all systems/);
  assert.match(promoGuide, /promo-projects.*production-branch runs/);
  assert.match(promoGuide, /do not dispatch or rerun any workflow/);
  assert.doesNotMatch(promoGuide, /promo-supervisor\.yml|error-triage\.yml/);
});
