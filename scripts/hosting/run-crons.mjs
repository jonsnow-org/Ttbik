// Runs the scheduled jobs of vercel.json against the selected public site origin.
// Usage: node scripts/hosting/run-crons.mjs "<cron expression>" | --all | --path /api/cron/x
// Needs CRON_SECRET. Gate is primary, Oracle is a read-only fallback. Each job is called once only.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function selectSiteBase() {
  if (process.env.SITE_BASE && !/\.vercel\.app$/i.test(process.env.SITE_BASE)) {
    return process.env.SITE_BASE.replace(/\/$/, "");
  }
  const output = execFileSync("bash", ["scripts/hosting/select-site-base.sh", "deploy/hosting/site.json"], { encoding: "utf8" });
  const value = output.split(/\r?\n/).find((line) => line.startsWith("SITE_BASE="));
  if (!value) throw new Error("The Gate/Oracle selector returned no public origin.");
  return value.slice("SITE_BASE=".length).replace(/\/$/, "");
}
const SITE = selectSiteBase();
const secret = process.env.CRON_SECRET || "";
if (!secret) { console.error("CRON_SECRET is missing"); process.exit(1); }
const crons = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).crons || [];
const arg = process.argv[2] || "";
const jobs = arg === "--all" ? crons : arg === "--path" ? crons.filter((c) => c.path === process.argv[3] || c.path.split("?")[0] === process.argv[3]) : crons.filter((c) => c.schedule === arg);
if (!jobs.length) { console.log("no jobs for " + JSON.stringify(arg)); process.exit(0); }

let failed = 0;
for (const j of jobs) {
  let code = 0, text = "";
  try {
    // One request only. A timeout after a committed side effect must never cause a duplicate retry.
    const r = await fetch(SITE + j.path, { method: "GET", headers: { authorization: "Bearer " + secret }, signal: AbortSignal.timeout(120_000) });
    code = r.status; text = (await r.text()).slice(0, 200);
  } catch (e) { code = 0; text = String(e && e.message || e); }
  console.log((code >= 200 && code < 300 ? "ok  " : "FAIL") + " " + j.path + " -> " + code + " " + text.replace(/\s+/g, " "));
  if (!(code >= 200 && code < 300)) failed++;
}
process.exit(failed ? 1 : 0);
