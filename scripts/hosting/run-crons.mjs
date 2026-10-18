// Runs the scheduled jobs of vercel.json against the site's public address (the gate), so they follow whichever server is active.
// Usage: node scripts/hosting/run-crons.mjs "<cron expression>"   (the jobs of that schedule)   |   --all   |   --path /api/cron/x
// Needs CRON_SECRET; SITE_BASE defaults to the Vercel address. Exit code 1 when any job fails (after two retries on a 5xx or a network error).
import { readFileSync } from "node:fs";

const SITE = (process.env.SITE_BASE || "https://ttbik.vercel.app").replace(/\/$/, "");
const secret = process.env.CRON_SECRET || "";
if (!secret) { console.error("CRON_SECRET is missing"); process.exit(1); }
const crons = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).crons || [];
const arg = process.argv[2] || "";
const jobs = arg === "--all" ? crons : arg === "--path" ? crons.filter((c) => c.path === process.argv[3] || c.path.split("?")[0] === process.argv[3]) : crons.filter((c) => c.schedule === arg);
if (!jobs.length) { console.log(`no jobs for "${arg}"`); process.exit(0); }

let failed = 0;
for (const j of jobs) {
  let code = 0, text = "";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(SITE + j.path, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120_000) });
      code = r.status; text = (await r.text()).slice(0, 200);
      if (code < 500) break;
    } catch (e) { code = 0; text = String(e && e.message || e); }
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
  console.log(`${code >= 200 && code < 500 ? "ok  " : "FAIL"} ${j.path} -> ${code} ${text.replace(/\s+/g, " ")}`);
  if (!(code >= 200 && code < 500)) failed++;
}
process.exit(failed ? 1 : 0);
