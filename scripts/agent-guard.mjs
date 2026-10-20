// Lists protected paths (deploy/hosting/protected-paths.json) touched by a change, so autonomous agents notice when they left their territory.
//   node scripts/agent-guard.mjs --base origin/main          compare HEAD with the merge base of origin/main (default)
//   node scripts/agent-guard.mjs --files "M a/b.ts,D c.png"   explicit list of "<status> <path>" (tests)
//   --approved   a human reviewed it (CI sets this from the PR label `owner-approved`): blocks become warnings
// Exit 1 when a 'block' rule is hit by a modified/deleted/renamed file (added files only warn) and the change is not approved. No dependencies.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url).pathname;

export function classify(changes, rules, approved = false) {
  const hits = [];
  for (const { status, path } of changes) {
    for (const rule of rules) {
      if (!rule.paths.some((p) => path === p || (p.endsWith("/") ? path.startsWith(p) : path.startsWith(p)))) continue;
      const added = status === "A";
      const blocking = rule.level === "block" && !added && !approved;
      hits.push({ id: rule.id, path, status, level: blocking ? "block" : "warn", why: rule.why });
    }
  }
  return hits;
}

export function parseNameStatus(text) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/\s+/);
    const status = parts[0][0];
    return { status, path: parts[parts.length - 1] };   // renames: the new path (the old one is reported as a D by git when --no-renames)
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const rules = JSON.parse(readFileSync(root + "deploy/hosting/protected-paths.json", "utf8")).rules;
  const approved = argv.includes("--approved") || process.env.AGENT_GUARD_APPROVED === "1";
  let changes;
  if (get("--files")) changes = get("--files").split(",").map((s) => { const [status, ...p] = s.trim().split(/\s+/); return { status: status[0], path: p.join(" ") }; });
  else {
    const base = get("--base") || "origin/main";
    const out = execFileSync("git", ["diff", "--name-status", "--no-renames", `${base}...HEAD`], { cwd: root, encoding: "utf8" });
    changes = parseNameStatus(out);
  }
  const hits = classify(changes, rules, approved);
  for (const h of hits) console.log(`${h.level === "block" ? "✗ BLOCK" : "• warn "} [${h.id}] ${h.status} ${h.path} — ${h.why}`);
  const blocked = hits.filter((h) => h.level === "block");
  if (!hits.length) console.log("agent-guard: no protected path touched");
  else if (blocked.length) console.log(`\nagent-guard: ${blocked.length} protected path(s) changed. Revert them, or ask the owner (label the PR \`owner-approved\` after his OK).`);
  process.exit(blocked.length ? 1 : 0);
}
