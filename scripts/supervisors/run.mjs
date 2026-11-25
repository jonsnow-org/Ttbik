// Section supervisors that run on GitHub Actions (no Claude session needed): zenobia, palmyra-launch, telegram-bots, site-content, athar.
// Read-only by design: each section gets ONE rolling issue "Supervisor report: <section>" (label supervisor-<section>), rewritten every run;
// no workflow is ever dispatched or rerun by this supervisor.
// Usage: node scripts/supervisors/run.mjs <section>   (env: GITHUB_REPOSITORY, GITHUB_TOKEN, FROZEN_CHECK=ok|fail optional, SITE_JSON optional)
import fs from "node:fs";

const ok200 = () => true;
const json = (f) => (t) => { try { return f(JSON.parse(t)); } catch { return false; } };
const hasDigits = (t) => /\d/.test(t) && t.length > 50;
const REQUIRED_PROMO_ARTIFACTS = ["promo-videos", "promo-images", "promo-copy", "promo-handoff"];

// [label, path-on-public-origin, base ("gate"|"standby"), predicate, info(not a failure)]
export const SECTIONS = {
  zenobia: {
    site: [["coin pictures page", "/zenobia/coins.html", "gate", ok200], ["trade page", "/zenobia/trade.html", "gate", ok200], ["journey page", "/zenobia/journey.html", "gate", ok200],
      ["oracle status", "/api/ops/oracle-status", "gate", ok200, true], ["coins index API", "/api/zenobia/coins/index", "gate", json((j) => Array.isArray(j.coins))]],
    workflows: [["znbt-guard.yml", "ZNBt guard", 12], ["zenobia-watch.yml", "Zenobia watch", 12], ["zenobia-season.yml", "Zenobia season", 30], ["znbt-index.yml", "Coin index", 12]],
    errorWords: /zenobia|znb/i, frozen: true,
  },
  "palmyra-launch": {
    site: [["coins page", "/zenobia/coins.html", "gate", ok200], ["create page", "/zenobia/create.html", "gate", ok200], ["portfolio page", "/zenobia/portfolio.html", "gate", ok200],
      ["journey page", "/zenobia/journey.html", "gate", ok200], ["swap page", "/zenobia/swap.html", "gate", ok200, true], ["coins index API", "/api/zenobia/coins/index", "gate", json((j) => Array.isArray(j.coins))]],
    workflows: [["znbt-index.yml", "Coin index", 12], ["referral-sync.yml", "Invite reward sync", 12], ["coins-channel-post.yml", "Coins channel posts", 30]],
    errorWords: /palmyra|launch|coin|referral|stars/i, frozen: true,
  },
  "telegram-bots": {
    site: [["bots directory", "/bots", "gate", ok200], ["home", "/", "gate", ok200], ["Vercel standby (diagnostic only)", "/", "standby", ok200, true]],
    workflows: [["ci.yml", "CI (typecheck + tests)", 72], ["monitor.yml", "Monitor (this report)", 4]],
    errorWords: /bot|telegram|webhook|stars|match|jobs|confession|mini ?app/i, botsHealth: true,
  },
  "site-content": {
    site: [["home", "/", "gate", ok200], ["free tools", "/free-tools", "gate", ok200], ["channels", "/channels", "gate", ok200], ["channel audit", "/channel-audit", "gate", ok200], ["khatma", "/khatma", "gate", ok200], ["contests", "/contests", "gate", ok200], ["shop", "/shop", "gate", ok200], ["remit", "/remit", "gate", ok200], ["markets", "/markets", "gate", ok200], ["news", "/news", "gate", ok200], ["articles", "/articles", "gate", ok200], ["events", "/events", "gate", ok200], ["health API", "/api/health", "gate", json((j) => j.ok === true)], ["prices", "/prices", "gate", ok200],
      ["English desk", "/en", "gate", ok200], ["markets API", "/api/markets", "gate", hasDigits], ["markets API (English)", "/api/markets-en", "gate", hasDigits, true],
      ["sitemap", "/sitemap.xml", "gate", (t) => t.includes("<urlset") && t.includes("/free-tools/")], ["llms.txt", "/llms.txt", "gate", ok200, true]],
    workflows: [["ci.yml", "CI (typecheck + tests)", 72]],
    errorWords: /news|article|price|market|ticker|tool|seo|sitemap|ad/i,
  },
  promo: {
    site: [],
    workflows: [["channel-post.yml", "Channel posts", 12], ["promo-remotion.yml", "Promo videos", 100], ["promo-projects.yml", "Promo images", 200, ["schedule", "workflow_dispatch"], ["claude/free-services-marketplace-h6rwk2"]]],
    errorWords: /promo|channel|youtube|video|post/i,
  },
  athar: {
    site: [["Athar health (mirror)", "/api/ops/athar-health", "gate", json((j) => j.alive === true && Object.entries(j.checks || {}).every(([k, c]) => c.ok || k === "mirrorImg"))], // mirrorImg probes the Vercel standby: down (HTTP 402) while Vercel is paused, which is not an Athar fault
      ["Athar app (Oracle)", "/", "oracle", ok200, true], ["Athar pictures via the mirror", "/api/athar/img/1.svg", "gate", (t) => t.includes("<svg")]],
    workflows: [["athar-mints.yml", "Athar mints", 12], ["athar-stars.yml", "Athar Stars", 12]],
    errorWords: /athar/i,
  },
};
// Automatic workflow reruns are intentionally disabled. This supervisor only reads and reports.
export const RERUN_OK = new Set();
export function decideRerun() {
  return { ok: false, why: "automatic workflow reruns are disabled" };
}
const hours = (iso, now) => (now - Date.parse(iso)) / 3600_000;

/** Pure: facts -> checks. level: ok | warn | fail | info */
export function evaluate(d, now = Date.now(), currentRunId = null) {
  const out = [], add = (name, level, detail) => out.push({ name, level, detail });
  for (const s of d.site || []) add(`Page: ${s.label}`, s.ok ? "ok" : s.info ? "info" : "fail", s.ok ? `HTTP ${s.status} via ${s.via || "unknown"}` : `HTTP ${s.status || "no answer"} via ${s.via || "unknown"}${s.status === 200 ? " · unexpected content" : ""}`);
  for (const w of d.workflows || []) {
    const [, name, maxH] = w.def;
    if (w.error) { add(`Workflow: ${name}`, "warn", `could not read runs (${w.error})`); continue; }
    // A PR validation for promo-projects only checks generator code; it does not create review assets.
    // Optional allowed events in def[3] keep validation-only runs out of the generation freshness signal.
    // GitHub includes the monitor's own in-progress run in this list. Exclude it so the
    // report measures the previous completed monitor run instead of reporting itself as fresh.
    const runs = (w.runs || []).filter((r) =>
      (!currentRunId || String(r.id) !== String(currentRunId)) &&
      (!w.def[3] || w.def[3].includes(r.event)) &&
      (!w.def[4] || w.def[4].includes(r.head_branch))
    );
    const active = runs.find((r) => r.status === "in_progress" || r.status === "queued" || r.status === "waiting" || r.status === "requested" || r.status === "pending");
    if (active) {
      const startedAt = active.run_started_at || active.created_at || active.updated_at;
      const activeAge = startedAt ? hours(startedAt, now) : Infinity;
      const elapsed = Number.isFinite(activeAge) ? Math.max(0, Math.round(activeAge * 10) / 10) + "h" : "an unknown time";
      add(`Workflow: ${name}`, activeAge > maxH ? "warn" : "ok", `run ${active.status} for ${elapsed}: ${active.html_url || "GitHub Actions"}`);
      continue;
    }
    const completed = runs.filter((r) => r.status === "completed" || r.conclusion);
    const last = completed[0], good = completed.find((r) => r.conclusion === "success");
    if (!last) { add(`Workflow: ${name}`, "warn", "no completed run yet"); continue; }
    const age = good ? hours(good.updated_at, now) : Infinity;
    if (age > maxH) add(`Workflow: ${name}`, "fail", `no successful run for ${good ? Math.round(age) + "h" : "ever"} (limit ${maxH}h). Last: ${last.conclusion} ${last.html_url}`);
    else if (last.conclusion !== "success" && (!good || Date.parse(last.updated_at) > Date.parse(good.updated_at))) add(`Workflow: ${name}`, "warn", `latest run ${last.conclusion}: ${last.html_url} (last success ${Math.round(age)}h ago)`);
    else add(`Workflow: ${name}`, "ok", `last success ${Math.round(age)}h ago`);
  }
  if (d.promoArtifacts) {
    const a = d.promoArtifacts;
    if (a.error) {
      add("Promo review artifacts", "warn", `could not read artifact list for ${a.runUrl || "the latest production run"} (${a.error})`);
    } else if (a.conclusion !== "success") {
      add("Promo review artifacts", "info", `latest production run ${a.conclusion || "unknown"}: ${a.runUrl || "GitHub Actions"}; artifact check deferred because the run did not succeed`);
    } else {
      const present = new Set((a.artifacts || []).filter((x) => !x.expired && Number(x.size_in_bytes) > 0).map((x) => x.name));
      const missing = REQUIRED_PROMO_ARTIFACTS.filter((name) => !present.has(name));
      add("Promo review artifacts", missing.length ? "fail" : "ok",
        missing.length
          ? `latest successful production run is missing, expired or empty: ${missing.join(", ")} (${a.runUrl || "GitHub Actions"})`
          : `all required review artifacts are present and non-empty: ${REQUIRED_PROMO_ARTIFACTS.join(", ")} (${a.runUrl || "GitHub Actions"})`);
    }
  }
  if (d.bots) {
    if (d.bots.error) add("Bots: live webhook check", "warn", `could not read /api/ops/bots-health (${d.bots.error})`);
    else {
      const bad = (d.bots.bots || []).filter((b) => b.active && (!b.tokenValid || !b.webhookOk));
      const stuck = (d.bots.bots || []).filter((b) => b.active && b.tokenValid && b.webhookOk && (b.pending > 100 || (b.lastError && b.lastErrorAgoMin != null && b.lastErrorAgoMin < 180)));
      const nm = (b) => `@${b.username || b.template}${!b.tokenValid ? " (token invalid)" : !b.webhookOk ? " (webhook not set)" : b.pending > 100 ? ` (${b.pending} pending)` : ` (${b.lastError})`}`;
      add("Bots: live webhook check", bad.length ? "fail" : stuck.length ? "warn" : "ok",
        bad.length ? `${bad.length} of ${d.bots.checked} broken: ${bad.slice(0, 8).map(nm).join(", ")}` : stuck.length ? `${stuck.length} with recent delivery problems: ${stuck.slice(0, 8).map(nm).join(", ")}` : `${d.bots.checked} bots checked, all webhooks fine`);
    }
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

async function http(url, ms = 20000, options = {}) {
  try { const r = await fetch(url, { ...options, signal: AbortSignal.timeout(ms), redirect: "follow" }); return { status: r.status, text: await r.text().catch(() => "") }; }
  catch { return { status: 0, text: "" }; }}

/** Read-only Gate probe with Oracle fallback on network/5xx errors only. */
async function publicSiteHttp(site, path, ms = 20000, options = {}) {
  const gate = (site.gateUrl || site.engineUrl || "").replace(/\/$/, "");
  const oracle = (site.oracleUrl || "").replace(/\/$/, "");
  const primary = gate ? await http(`${gate}${path}`, ms, options) : { status: 0, text: "" };
  if (primary.status > 0 && primary.status < 500) return { ...primary, via: "gate" };
  if (!oracle) return { ...primary, via: "gate" };
  const backup = await http(`${oracle}${path}`, ms, options);
  return backup.status > 0 ? { ...backup, via: "oracle", gateStatus: primary.status } : { ...primary, via: "gate", oracleStatus: backup.status };
}

// Mail control (owner's order 2026-11-01): a GitHub comment is an e-mail. Only a real outage reaches the owner:
// status "fail" that has lasted NOTIFY_AFTER_H hours (one comment), then one comment when it recovers. Blips and warnings stay silent.
export const NOTIFY_AFTER_H = 6;
export function notifyDecision(prevBody, status, nowMs = Date.now()) {
  const m = /<!-- since:(\S+) notified:([01]) -->/.exec(prevBody || "");
  const prevBad = /<!-- status:(warn|fail) -->/.test(prevBody || "");
  const since = status !== "ok" ? (prevBad && m ? m[1] : new Date(nowMs).toISOString()) : "";
  const wasNotified = prevBad && m?.[2] === "1";
  const longEnough = status === "fail" && since && nowMs - Date.parse(since) >= NOTIFY_AFTER_H * 3600e3;
  const comment = status === "ok" ? (wasNotified ? "Recovered: everything is OK again." : null) : (longEnough && !wasNotified ? `Still failing for ${NOTIFY_AFTER_H}+ hours. See the report above.` : null);
  const notified = status !== "ok" && (wasNotified || !!comment);
  return { comment, marker: status === "ok" ? "" : `\n<!-- since:${since} notified:${notified ? 1 : 0} -->\n` };
}

/** Pure: one report for every section: the overall status first, then each section's checks. Nothing here is per-event. */
export function renderAll(parts, date) {
  const icon = { ok: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };
  const all = parts.flatMap((p) => p.checks), st = overall(all);
  const lines = parts.map((p) => `- ${icon[overall(p.checks)]} **${p.section}**: ${p.checks.filter((c) => c.level === "fail" || c.level === "warn").map((c) => `${c.name} — ${c.detail}`).join("; ") || "all good"}`);
  const detail = parts.map((p) => `<details><summary>${p.section}</summary>\n\n${p.checks.map((c) => `- ${icon[c.level]} ${c.name}: ${c.detail}`).join("\n")}\n</details>`);
  const acted = parts.flatMap((p) => p.acted || []), skipped = parts.flatMap((p) => p.skipped || []);
  return `<!-- status:${st} -->\n# Monitoring: all systems · ${date} (UTC)\n\nOverall: ${st === "ok" ? "✅ all good" : st === "warn" ? "⚠️ needs a look" : "❌ something is broken"}\n\n${lines.join("\n")}\n\n${detail.join("\n")}${acted.length ? `\nAutomatic actions: ${acted.join("; ")}\n` : ""}${skipped.length ? `\nNot touched (conflict rules): ${skipped.join("; ")}\n` : ""}\nThis is the ONE monitoring report: edited in place every run, and a comment (an e-mail) is added only for an outage of ${NOTIFY_AFTER_H}+ hours and for its recovery.\n`;
}

async function main() {
  const arg = process.argv[2];
  const names = arg === "all" ? Object.keys(SECTIONS) : [arg];
  if (names.some((n) => !SECTIONS[n])) { console.error(`unknown section: ${arg}`); process.exit(2); }
  const repo = process.env.GITHUB_REPOSITORY || "jonsnow-org/Ttbik", token = process.env.GITHUB_TOKEN || "";
  const site = JSON.parse(fs.readFileSync(process.env.SITE_JSON || "deploy/hosting/site.json", "utf8"));
  // Gate is the public primary; Oracle is a read-only fallback when Gate cannot be reached. Vercel is diagnostic only.
  const base = { gate: site.gateUrl || site.engineUrl, standby: site.vercelUrl, oracle: site.oracleUrl };
  const gh = async (path, init = {}) => {
    const r = await fetch(`https://api.github.com${path}`, { ...init, headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "content-type": "application/json" }, signal: AbortSignal.timeout(30000) }).catch(() => ({ status: 0, json: async () => null }));
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
  };
  // shared facts (one read for all sections)
  const er = await gh(`/repos/${repo}/issues?state=open&labels=auto-error&per_page=50`);
  const parts = [];
  for (const section of names) {
    const cfg = SECTIONS[section];
    const data = { site: [], workflows: [], frozen: cfg.frozen ? (process.env.FROZEN_CHECK === "ok" ? "ok" : "fail") : undefined };
    for (const [label, path, b, pred, info] of cfg.site) { const r = b === "gate" ? await publicSiteHttp(site, path) : await http(base[b] + path); data.site.push({ label, status: r.status, ok: r.status === 200 && pred(r.text), info: !!info, via: r.via || b }); }
    for (const def of cfg.workflows) { const perPage = def[3] ? 100 : 10; const r = await gh(`/repos/${repo}/actions/workflows/${def[0]}/runs?per_page=${perPage}`); data.workflows.push(r.status === 200 ? { def, runs: r.body.workflow_runs || [] } : { def, runs: [], error: `HTTP ${r.status}` }); }
    if (section === "promo") {
      const promoWorkflow = data.workflows.find((entry) => entry.def[0] === "promo-projects.yml");
      if (promoWorkflow && !promoWorkflow.error) {
        const productionRuns = (promoWorkflow.runs || []).filter((r) =>
          (!promoWorkflow.def[3] || promoWorkflow.def[3].includes(r.event)) &&
          (!promoWorkflow.def[4] || promoWorkflow.def[4].includes(r.head_branch))
        );
        const active = productionRuns.find((r) => r.status === "in_progress" || r.status === "queued" || r.status === "waiting" || r.status === "requested" || r.status === "pending");
        const latest = productionRuns.find((r) => r.status === "completed" || r.conclusion);
        if (!active && latest) {
          if (latest.conclusion === "success") {
            const artifacts = await gh(`/repos/${repo}/actions/runs/${latest.id}/artifacts?per_page=100`);
            data.promoArtifacts = artifacts.status === 200
              ? { conclusion: "success", runUrl: latest.html_url, artifacts: artifacts.body?.artifacts || [] }
              : { conclusion: "success", runUrl: latest.html_url, error: `HTTP ${artifacts.status}` };
          } else {
            data.promoArtifacts = { conclusion: latest.conclusion || latest.status, runUrl: latest.html_url, artifacts: [] };
          }
        }
      }
    }
    if (cfg.botsHealth && process.env.CRON_SECRET) {   // live webhook check of every hosted bot (read-only; the endpoint hides tokens)
      try {
        const r = await publicSiteHttp(site, "/api/ops/bots-health", 60000, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
        data.bots = r.status === 200 ? await JSON.parse(r.text) : { error: `HTTP ${r.status} via ${r.via || "unknown"}` };
      } catch (e) { data.bots = { error: "no answer" }; }
    }
    if (er.status === 200) data.errors = er.body.filter((i) => !i.pull_request && cfg.errorWords.test(`${i.title}`)).slice(0, 5).map((i) => `#${i.number} ${String(i.title).slice(0, 60)}`);
    parts.push({ section, checks: evaluate(data, Date.now(), process.env.GITHUB_RUN_ID) });
  }
  const date = new Date().toISOString().slice(0, 10);
  const checks = parts.flatMap((p) => p.checks), status = overall(checks);
  const body = arg === "all" ? renderAll(parts, date) : render(arg, parts[0].checks, date);
  console.log(body);
  if (!token) return;
  const label = arg === "all" ? "supervisor-all" : `supervisor-${arg}`, title = arg === "all" ? "Monitoring: all systems" : `Supervisor report: ${arg}`;
  for (const [name, color] of [[label, "0e8a16"], ["needs-attention", "d93f0b"]]) await gh(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify({ name, color }) });
  const labels = [label, ...(status === "ok" ? [] : ["needs-attention"])];
  const found = await gh(`/repos/${repo}/issues?state=open&labels=${label}&per_page=5`);
  const issue = found.status === 200 ? found.body.find((i) => !i.pull_request) : null;
  if (!issue) { await gh(`/repos/${repo}/issues`, { method: "POST", body: JSON.stringify({ title, body, labels }) }); return; }
  const nd = notifyDecision(issue.body, status);
  await gh(`/repos/${repo}/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ body: body + nd.marker, labels }) });
  if (nd.comment) await gh(`/repos/${repo}/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body: nd.comment }) });
}
if (process.argv[1] && process.argv[1].endsWith("run.mjs")) main().catch((e) => { console.error(String(e)); process.exit(1); });
