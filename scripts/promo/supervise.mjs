// Promo supervisor (read-mostly): checks that the promotion systems are alive and writes ONE rolling report (a GitHub issue).
// Safe by design: it never posts to a channel, never merges or edits code. Its only writes are the report issue + its labels, and a single
// "rerun failed jobs" for the idempotent workflows listed in RERUN_OK. See promo/README.md ("what the supervisor may do").
// Usage: node scripts/promo/supervise.mjs        (env: GITHUB_REPOSITORY, GITHUB_TOKEN, CRON_SECRET optional, SITE_JSON path optional)
import fs from "node:fs";

export const WORKFLOWS = [
  // [file, name, max hours since the last successful run]  (schedules: see promo/README.md)
  ["channel-post.yml", "General channel posts", 13],
  ["coins-channel-post.yml", "Coins channel posts", 16],
  ["promo-remotion.yml", "Promo videos (Remotion)", 100],
  ["promo-projects.yml", "Project videos", 192],
  ["error-triage.yml", "Error triage", 3],
];
export const RERUN_OK = new Set(["promo-projects.yml", "error-triage.yml"]);   // idempotent: re-rendering / re-reading never posts anything
const ARABIC = /[؀-ۿ]/;
const hours = (iso, now) => (now - Date.parse(iso)) / 3600_000;

/** Pure: turns collected facts into a list of checks. level: ok | warn | fail | info */
export function evaluate(d, now = Date.now()) {
  const out = [];
  const add = (name, level, detail) => out.push({ name, level, detail });
  for (const s of d.site || []) add(`Site: ${s.label}`, s.ok ? "ok" : s.info ? "info" : "fail", s.ok ? `HTTP ${s.status}` : `HTTP ${s.status || "no answer"}${s.note ? " · " + s.note : ""}`);
  for (const w of d.workflows || []) {
    const [file, name, maxH] = w.def;
    if (w.error) { add(`Workflow: ${name}`, "warn", `could not read runs (${w.error})`); continue; }
    const last = w.runs[0], ok = w.runs.find((r) => r.conclusion === "success");
    if (!last) { add(`Workflow: ${name}`, "warn", "no completed run yet"); continue; }
    const age = ok ? hours(ok.updated_at, now) : Infinity;
    if (age > maxH) add(`Workflow: ${name}`, "fail", `no successful run for ${ok ? Math.round(age) + "h" : "ever"} (limit ${maxH}h). Last run: ${last.conclusion} ${last.html_url}`);
    else if (last.conclusion !== "success" && Date.parse(last.updated_at) > Date.parse(ok.updated_at)) add(`Workflow: ${name}`, "warn", `latest run ${last.conclusion}: ${last.html_url} (last success ${Math.round(age)}h ago)`);
    else add(`Workflow: ${name}`, "ok", `last success ${Math.round(age)}h ago`);
  }
  for (const p of d.previews || []) {
    if (p.skipped) { add(`Preview: ${p.label}`, "info", p.skipped); continue; }
    if (p.status === 401) { add(`Preview: ${p.label}`, "fail", "CRON_SECRET does not match between GitHub and the site"); continue; }
    if (p.status !== 200) { add(`Preview: ${p.label}`, "fail", `HTTP ${p.status || "no answer"}`); continue; }
    if (p.coins && ARABIC.test(String(p.text || ""))) { add(`Preview: ${p.label}`, "fail", "the coins channel text contains Arabic (rule: English only)"); continue; }
    add(`Preview: ${p.label}`, "ok", p.reason ? `next post: ${p.reason}` : p.topic ? `next post: ${p.topic}` : "ok");
  }
  if (d.release) {
    const age = hours(d.release.published_at, now) / 24;
    add("Latest promo video release", age > 6 ? "warn" : "ok", `${d.release.tag_name} (${age.toFixed(1)} days old)`);
  } else if (d.release === null) add("Latest promo video release", "warn", "no promo-ep-* release found");
  if (typeof d.errors === "number") add("Open auto-error issues", d.errors === 0 ? "ok" : "warn", d.errors === 0 ? "none" : `${d.errors} open: ${(d.errorTitles || []).join(" | ")}`);
  return out;
}

export function overall(checks) { return checks.some((c) => c.level === "fail") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "ok"; }

export function render(checks, date) {
  const icon = { ok: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };
  const st = overall(checks);
  const lines = checks.map((c) => `- ${icon[c.level]} **${c.name}**: ${c.detail}`);
  return `<!-- status:${st} -->\n# Promo supervisor report · ${date} (UTC)\n\nOverall: ${st === "ok" ? "✅ all good" : st === "warn" ? "⚠️ needs a look" : "❌ something is broken"}\n\n${lines.join("\n")}\n\n_Automatic report from \`scripts/promo/supervise.mjs\`. It only reads and reports; the supervisor session decides what to fix. Rules and what it may do: \`promo/README.md\`._\n`;
}

async function http(url, ms = 20000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "follow" });
    const text = await r.text().catch(() => "");
    return { status: r.status, text };
  } catch { return { status: 0, text: "" }; }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || "jonsnow-org/Ttbik";
  const token = process.env.GITHUB_TOKEN || "";
  const site = JSON.parse(fs.readFileSync(process.env.SITE_JSON || "deploy/hosting/site.json", "utf8"));
  const gate = site.gateUrl || site.engineUrl, standby = site.vercelUrl;
  const gh = async (path, init = {}) => {
    const r = await fetch(`https://api.github.com${path}`, { ...init, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
    const body = r.status === 204 ? null : await r.json().catch(() => null);
    return { status: r.status, body };
  };
  const data = { site: [], workflows: [], previews: [] };
  for (const [label, url, check, info] of [
    ["home (gate)", `${gate}/`, () => true], ["platform coins page", `${gate}/zenobia/coins.html`, () => true],
    ["coins index API", `${gate}/api/zenobia/coins/index`, (t) => { try { return Array.isArray(JSON.parse(t).coins); } catch { return false; } }],
    ["Vercel standby", `${standby}/`, () => true, true],
  ]) {
    const r = await http(url);
    data.site.push({ label, status: r.status, ok: r.status === 200 && check(r.text), info: !!info, note: r.status === 200 ? "unexpected body" : "" });
  }
  for (const def of WORKFLOWS) {
    const r = await gh(`/repos/${repo}/actions/workflows/${def[0]}/runs?per_page=10&status=completed`);
    data.workflows.push(r.status === 200 ? { def, runs: r.body.workflow_runs || [] } : { def, error: `HTTP ${r.status}` });
  }
  const secret = process.env.CRON_SECRET || "";
  for (const [label, path, coins] of [["general channel", "telegram-post", false], ["coins channel", "coins-channel-post", true]]) {
    if (!secret) { data.previews.push({ label, skipped: "CRON_SECRET is not available to this job" }); continue; }
    const r = await http(`${gate}/api/cron/${path}?secret=${encodeURIComponent(secret)}&dry=1`);
    let j = {}; try { j = JSON.parse(r.text); } catch {}
    data.previews.push({ label, status: r.status, coins, text: j.text, topic: j.topic, reason: j.reason });
  }
  const rel = await gh(`/repos/${repo}/releases?per_page=30`);
  data.release = rel.status === 200 ? (rel.body.find((x) => /^promo-ep-/.test(x.tag_name)) || null) : undefined;
  const er = await gh(`/repos/${repo}/issues?state=open&labels=auto-error&per_page=20`);
  if (er.status === 200) { data.errors = er.body.filter((i) => !i.pull_request).length; data.errorTitles = er.body.slice(0, 5).map((i) => `#${i.number} ${String(i.title).slice(0, 60)}`); }

  // the one safe automatic action: rerun the failed jobs of idempotent workflows, once
  const acted = [];
  for (const w of data.workflows) {
    const last = w.runs?.[0];
    if (last && last.conclusion === "failure" && last.run_attempt === 1 && RERUN_OK.has(w.def[0])) {
      const r = await gh(`/repos/${repo}/actions/runs/${last.id}/rerun-failed-jobs`, { method: "POST" });
      acted.push(`reran failed jobs of ${w.def[1]} (HTTP ${r.status})`);
    }
  }
  const checks = evaluate(data);
  let body = render(checks, new Date().toISOString().slice(0, 10));
  if (acted.length) body += `\nAutomatic actions: ${acted.join("; ")}\n`;
  console.log(body);
  if (!token) return;
  const status = overall(checks);
  for (const [name, color] of [["promo-supervisor", "0e8a16"], ["needs-attention", "d93f0b"]]) await gh(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify({ name, color }) });   // 422 when it exists: fine
  const found = await gh(`/repos/${repo}/issues?state=open&labels=promo-supervisor&per_page=5`);
  const issue = found.status === 200 ? found.body.find((i) => !i.pull_request) : null;
  const labels = ["promo-supervisor", ...(status === "ok" ? [] : ["needs-attention"])];
  if (!issue) { await gh(`/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title: "Promo supervisor: daily report", body, labels }) }); return; }
  const prev = /<!-- status:(\w+) -->/.exec(issue.body || "")?.[1] || "ok";
  await gh(`/repos/${repo}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ body, labels }) });
  const rank = { ok: 0, warn: 1, fail: 2 };
  if (rank[status] > rank[prev]) await gh(`/repos/${repo}/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: `Status changed ${prev} -> ${status}. See the report above.` }) });
}

if (process.argv[1] && process.argv[1].endsWith("supervise.mjs")) main().catch((e) => { console.error(String(e)); process.exit(1); });
