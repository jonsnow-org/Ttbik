// Section supervisors that run on GitHub Actions (no Claude session needed): zenobia, palmyra-launch, telegram-bots, site-content, athar.
// Read-mostly by design: each section gets ONE rolling issue "Supervisor report: <section>" (label supervisor-<section>), rewritten every run;
// a comment is added only when the status changes. The only automatic action is one "rerun failed jobs" for the idempotent workflows in RERUN_OK.
// Usage: node scripts/supervisors/run.mjs <section>   (env: GITHUB_REPOSITORY, GITHUB_TOKEN, FROZEN_CHECK=ok|fail optional, SITE_JSON optional)
import fs from "node:fs";

const ok200 = () => true;
const json = (f) => (t) => { try { return f(JSON.parse(t)); } catch { return false; } };
const hasDigits = (t) => /\d/.test(t) && t.length > 50;

// [label, path-on-gate-or-vercel, base ("gate"|"vercel"|"oracle"), predicate, info(not a failure)]
export const SECTIONS = {
  zenobia: {
    site: [["coin pictures page", "/zenobia/coins.html", "gate", ok200], ["trade page", "/zenobia/trade.html", "gate", ok200], ["journey page", "/zenobia/journey.html", "gate", ok200],
      ["oracle status", "/api/ops/oracle-status", "gate", ok200, true], ["coins index API", "/api/zenobia/coins/index", "gate", json((j) => Array.isArray(j.coins))]],
    workflows: [["znbt-guard.yml", "ZNBt guard", 3], ["zenobia-watch.yml", "Zenobia watch", 12], ["zenobia-season.yml", "Zenobia season", 30], ["znbt-index.yml", "Coin index", 12]],
    errorWords: /zenobia|znb/i, frozen: true,
  },
  "palmyra-launch": {
    site: [["coins page", "/zenobia/coins.html", "gate", ok200], ["create page", "/zenobia/create.html", "gate", ok200], ["portfolio page", "/zenobia/portfolio.html", "gate", ok200],
      ["journey page", "/zenobia/journey.html", "gate", ok200], ["swap page", "/zenobia/swap.html", "gate", ok200, true], ["coins index API", "/api/zenobia/coins/index", "gate", json((j) => Array.isArray(j.coins))]],
    workflows: [["znbt-index.yml", "Coin index", 12], ["referral-sync.yml", "Invite reward sync", 12], ["coins-channel-post.yml", "Coins channel posts", 16]],
    errorWords: /palmyra|launch|coin|referral|stars/i, frozen: true,
  },
  "telegram-bots": {
    site: [["bots directory", "/bots", "vercel", ok200], ["home", "/", "vercel", ok200]],
    workflows: [["ci.yml", "CI (typecheck + tests)", 72], ["error-triage.yml", "Error triage", 3]],
    errorWords: /bot|telegram|webhook|stars|match|jobs|confession|mini ?app/i,
  },
  "site-content": {
    site: [["home", "/", "vercel", ok200], ["news", "/news", "vercel", ok200], ["articles", "/articles", "vercel", ok200], ["prices", "/prices", "vercel", ok200],
      ["markets", "/markets", "vercel", ok200], ["English desk", "/en", "vercel", ok200], ["markets API", "/api/markets", "vercel", hasDigits], ["markets API (English)", "/api/markets-en", "vercel", hasDigits, true],
      ["sitemap", "/sitemap.xml", "vercel", (t) => t.includes("<urlset") && t.includes("/free-tools/")], ["llms.txt", "/llms.txt", "vercel", ok200, true]],
    workflows: [["ci.yml", "CI (typecheck + tests)", 72], ["error-triage.yml", "Error triage", 3]],
    errorWords: /news|article|price|market|ticker|tool|seo|sitemap|ad/i,
  },
  athar: {
    site: [["Athar health (mirror)", "/api/ops/athar-health", "vercel", json((j) => j.alive === true && Object.values(j.checks || {}).every((c) => c.ok))],
      ["Athar app (Oracle)", "/", "oracle", ok200, true], ["Athar pictures via the mirror", "/api/athar/img/1.svg", "vercel", (t) => t.includes("<svg")]],
    workflows: [["athar-mints.yml", "Athar mints", 12], ["athar-stars.yml", "Athar Stars", 12]],
    errorWords: /athar/i,
  },
};
export const RERUN_OK = new Set(["znbt-index.yml", "error-triage.yml"]);   // idempotent; never anything that mints, pays or posts
const hours = (iso, now) => (now - Date.parse(iso)) / 3600_000;

/** Pure: facts -> checks. level: ok | warn | fail | info */
export function evaluate(d, now = Date.now()) {
  const out = [], add = (name, level, detail) => out.push({ name, level, detail });
  for (const s of d.site || []) add(`Page: ${s.label}`, s.ok ? "ok" : s.info ? "info" : "fail", s.ok ? `HTTP ${s.status}` : `HTTP ${s.status || "no answer"}${s.status === 200 ? " · unexpected content" : ""}`);
  for (const w of d.workflows || []) {
    const [, name, maxH] = w.def;
    if (w.error) { add(`Workflow: ${name}`, "warn", `could not read runs (${w.error})`); continue; }
    const last = w.runs[0], good = w.runs.find((r) => r.conclusion === "success");
    if (!last) { add(`Workflow: ${name}`, "warn", "no completed run yet"); continue; }
    const age = good ? hours(good.updated_at, now) : Infinity;
    if (age > maxH) add(`Workflow: ${name}`, "fail", `no successful run for ${good ? Math.round(age) + "h" : "ever"} (limit ${maxH}h). Last: ${last.conclusion} ${last.html_url}`);
    else if (last.conclusion !== "success" && Date.parse(last.updated_at) > Date.parse(good.updated_at)) add(`Workflow: ${name}`, "warn", `latest run ${last.conclusion}: ${last.html_url} (last success ${Math.round(age)}h ago)`);
    else add(`Workflow: ${name}`, "ok", `last success ${Math.round(age)}h ago`);
  }
  if (d.frozen) add("Coin facts frozen check", d.frozen === "ok" ? "ok" : "fail", d.frozen === "ok" ? "address, master, owner and salt unchanged" : "scripts/znbt-frozen-check.mjs FAILED - something frozen changed");
  const errs = d.errors || [];
  add("Open auto-error issues (this section)", errs.length ? "warn" : "ok", errs.length ? errs.join(" | ") : "none");
  return out;
}
export const overall = (c) => (c.some((x) => x.level === "fail") ? "fail" : c.some((x) => x.level === "warn") ? "warn" : "ok");
export function render(section, checks, date) {
  const icon = { ok: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" }, st = overall(checks);
  return `<!-- status:${st} -->\n# Supervisor report: ${section} · ${date} (UTC)\n\nOverall: ${st === "ok" ? "✅ all good" : st === "warn" ? "⚠️ needs a look" : "❌ something is broken"}\n\n${checks.map((c) => `- ${icon[c.level]} **${c.name}**: ${c.detail}`).join("\n")}\n\n_Automatic report from \`scripts/supervisors/run.mjs\` (GitHub Actions, no AI session needed). It only reads and reports; charter: \`docs/agents/${section}.md\`._\n`;
}

async function http(url, ms = 20000) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "follow" }); return { status: r.status, text: await r.text().catch(() => "") }; }
  catch { return { status: 0, text: "" }; }
}

async function main() {
  const section = process.argv[2], cfg = SECTIONS[section];
  if (!cfg) { console.error(`unknown section: ${section}`); process.exit(2); }
  const repo = process.env.GITHUB_REPOSITORY || "jonsnow-org/Ttbik", token = process.env.GITHUB_TOKEN || "";
  const site = JSON.parse(fs.readFileSync(process.env.SITE_JSON || "deploy/hosting/site.json", "utf8"));
  const base = { gate: site.gateUrl || site.engineUrl, vercel: site.vercelUrl, oracle: site.oracleUrl };
  const gh = async (path, init = {}) => {
    const r = await fetch(`https://api.github.com${path}`, { ...init, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
  };
  const data = { site: [], workflows: [], frozen: cfg.frozen ? (process.env.FROZEN_CHECK === "ok" ? "ok" : "fail") : undefined };
  for (const [label, path, b, pred, info] of cfg.site) { const r = await http(base[b] + path); data.site.push({ label, status: r.status, ok: r.status === 200 && pred(r.text), info: !!info }); }
  for (const def of cfg.workflows) { const r = await gh(`/repos/${repo}/actions/workflows/${def[0]}/runs?per_page=10&status=completed`); data.workflows.push(r.status === 200 ? { def, runs: r.body.workflow_runs || [] } : { def, error: `HTTP ${r.status}` }); }
  const er = await gh(`/repos/${repo}/issues?state=open&labels=auto-error&per_page=50`);
  if (er.status === 200) data.errors = er.body.filter((i) => !i.pull_request && cfg.errorWords.test(`${i.title}`)).slice(0, 5).map((i) => `#${i.number} ${String(i.title).slice(0, 60)}`);
  const acted = [];
  for (const w of data.workflows) { const last = w.runs?.[0]; if (last && last.conclusion === "failure" && last.run_attempt === 1 && RERUN_OK.has(w.def[0])) acted.push(`reran failed jobs of ${w.def[1]} (HTTP ${(await gh(`/repos/${repo}/actions/runs/${last.id}/rerun-failed-jobs`, { method: "POST" })).status})`); }
  const checks = evaluate(data), status = overall(checks);
  let body = render(section, checks, new Date().toISOString().slice(0, 10));
  if (acted.length) body += `\nAutomatic actions: ${acted.join("; ")}\n`;
  console.log(body);
  if (!token) return;
  const label = `supervisor-${section}`;
  for (const [name, color] of [[label, "0e8a16"], ["needs-attention", "d93f0b"]]) await gh(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify({ name, color }) });
  const labels = [label, ...(status === "ok" ? [] : ["needs-attention"])];
  const found = await gh(`/repos/${repo}/issues?state=open&labels=${label}&per_page=5`);
  const issue = found.status === 200 ? found.body.find((i) => !i.pull_request) : null;
  if (!issue) { await gh(`/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title: `Supervisor report: ${section}`, body, labels }) }); return; }
  const prev = /<!-- status:(\w+) -->/.exec(issue.body || "")?.[1] || "ok";
  await gh(`/repos/${repo}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ body, labels }) });
  if (prev !== status) await gh(`/repos/${repo}/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: `Status changed ${prev} -> ${status}. See the report above.` }) });
}
if (process.argv[1] && process.argv[1].endsWith("run.mjs")) main().catch((e) => { console.error(String(e)); process.exit(1); });
