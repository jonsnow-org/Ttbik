// Every route under src/app/api/cron must have a scheduler: an entry in vercel.json `crons` (run by site-crons.yml) or a workflow that calls it.
// Why: at the 2026-10-18 hosting cutover 20 entries were dropped from vercel.json and 12 jobs (prayer and streak reminders, capsules, retention ...)
// silently stopped for 26 days, because nothing checked that each job still had a schedule. Run: node --test scripts/tests/cron-coverage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routes = fs.readdirSync("src/app/api/cron", { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const vercel = fs.readFileSync("vercel.json", "utf8");
const workflows = fs.readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f)).map((f) => fs.readFileSync(path.join(".github/workflows", f), "utf8")).join("\n");
// Routes that are meant to be triggered by hand or by another job, not by a clock (say why next to each).
const MANUAL_ONLY = {};

test("every cron route has a scheduler", () => {
  const missing = routes.filter((r) => !MANUAL_ONLY[r] && !vercel.includes(`/api/cron/${r}`) && !workflows.includes(`api/cron/${r}`));
  assert.deepEqual(missing, [], `no schedule for: ${missing.join(", ")}. Add it to vercel.json "crons" (site-crons.yml runs it) or to MANUAL_ONLY with the reason.`);
});

test("every scheduled time in vercel.json is a trigger of site-crons.yml (otherwise that job never runs)", () => {
  const sc = fs.readFileSync(".github/workflows/site-crons.yml", "utf8");
  const triggers = new Set([...sc.matchAll(/cron: "([^"]+)"/g)].map((m) => m[1]));
  const crons = JSON.parse(vercel).crons || [];
  const lost = crons.filter((c) => !triggers.has(c.schedule)).map((c) => `${c.path} @ ${c.schedule}`);
  assert.deepEqual(lost, [], `schedules without a site-crons.yml trigger: ${lost.join("; ")}`);
});
