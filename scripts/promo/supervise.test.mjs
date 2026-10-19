import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, overall, render, WORKFLOWS } from "./supervise.mjs";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const run = (conclusion, hoursAgo) => ({ conclusion, updated_at: new Date(NOW - hoursAgo * 3600_000).toISOString(), html_url: "https://example/run", run_attempt: 1 });
const wf = (i, runs) => ({ def: WORKFLOWS[i], runs });
const healthy = () => ({
  site: [{ label: "home", status: 200, ok: true }],
  workflows: WORKFLOWS.map((_, i) => wf(i, [run("success", 1)])),
  previews: [{ label: "coins channel", status: 200, coins: true, text: "Launch your own coin", reason: "nothing-due" }],
  release: { tag_name: "promo-ep-3", published_at: new Date(NOW - 2 * 86400_000).toISOString() }, errors: 0,
});

test("a healthy system is all ok", () => { assert.equal(overall(evaluate(healthy(), NOW)), "ok"); });
test("a site that does not answer is a failure; the Vercel standby only informs", () => {
  const d = healthy(); d.site = [{ label: "home", status: 0, ok: false }, { label: "standby", status: 429, ok: false, info: true }];
  const c = evaluate(d, NOW);
  assert.equal(c[0].level, "fail"); assert.equal(c[1].level, "info"); assert.equal(overall(c), "fail");
});
test("no recent success is a failure, a newer failure after a success is a warning", () => {
  const d = healthy(); d.workflows[0] = wf(0, [run("failure", 1), run("success", 30)]);
  assert.equal(evaluate(d, NOW).find((c) => c.name.includes("General")).level, "fail");
  d.workflows[0] = wf(0, [run("failure", 1), run("success", 3)]);
  assert.equal(evaluate(d, NOW).find((c) => c.name.includes("General")).level, "warn");
});
test("Arabic in the coins channel preview breaks the English-only rule", () => {
  const d = healthy(); d.previews = [{ label: "coins channel", status: 200, coins: true, text: "Hello مرحبا" }];
  assert.equal(evaluate(d, NOW).find((c) => c.name.startsWith("Preview")).level, "fail");
});
test("a wrong CRON_SECRET and a missing one are told apart", () => {
  const d = healthy(); d.previews = [{ label: "a", status: 401 }, { label: "b", skipped: "no secret" }];
  const c = evaluate(d, NOW);
  assert.equal(c.find((x) => x.name === "Preview: a").level, "fail"); assert.match(c.find((x) => x.name === "Preview: a").detail, /CRON_SECRET/);
  assert.equal(c.find((x) => x.name === "Preview: b").level, "info");
});
test("an old promo video and open auto-error issues warn", () => {
  const d = healthy(); d.release = { tag_name: "promo-ep-1", published_at: new Date(NOW - 9 * 86400_000).toISOString() }; d.errors = 2; d.errorTitles = ["#1 x", "#2 y"];
  const c = evaluate(d, NOW);
  assert.equal(c.find((x) => x.name.includes("release")).level, "warn"); assert.equal(c.find((x) => x.name.includes("auto-error")).level, "warn");
});
test("the report carries a machine-readable status marker", () => {
  const md = render(evaluate(healthy(), NOW), "2026-10-19");
  assert.match(md, /^<!-- status:ok -->/); assert.match(md, /all good/);
});
