// Builds the supervisor handoff sheet: for every product, the platforms still to be posted by hand and the ready text.
// Usage: node scripts/promo/handoff.mjs [--out promo-handoff.md] ; needs promo-copy packs logic from copy.mjs (no network).
import fs from "node:fs";
import { arg, loadProjects, projectName } from "./common.mjs";
import { buildCampaign } from "./copy.mjs";

const catalog = JSON.parse(fs.readFileSync("promo/catalog.json", "utf8"));
const ledger = JSON.parse(fs.readFileSync("promo/handoff/LEDGER.json", "utf8")).entries || [];
const PLAT = { instagram: "instagram", facebook: "instagram", tiktok: "tiktok", x: "tiktok" }; // which pack text fits each platform

export function buildHandoff(today = new Date().toISOString().slice(0, 10)) {
  const projects = Object.fromEntries(loadProjects().map((p) => [p.id, p]));
  const lines = ["# Handoff sheet · ورقة التسليم للمشرفين", "", `Generated ${today}. Post oldest-first, then add a line to promo/handoff/LEDGER.json.`, "", "| Product | Platform | Last posted | Days |", "|---|---|---|---|"];
  const todo = [];
  for (const item of catalog.products) {
    const p = projects[item.campaign];
    if (!p || item.owner) continue;
    for (const platform of item.handoff) {
      const last = ledger.filter((e) => e.id === item.id && e.platform === platform).map((e) => e.date).sort().pop();
      const days = last ? Math.floor((Date.parse(today) - Date.parse(last)) / 864e5) : 9999;
      todo.push({ id: item.id, platform, last: last || "never", days });
    }
  }
  todo.sort((a, b) => b.days - a.days || a.id.localeCompare(b.id));
  for (const t of todo) lines.push(`| ${t.id} | ${t.platform} | ${t.last} | ${t.days === 9999 ? "–" : t.days} |`);
  lines.push("", "## Ready text", "");
  for (const item of catalog.products) {
    const p = projects[item.campaign];
    if (!p || item.owner || !item.handoff.length) continue;
    const c = buildCampaign(p);
    lines.push(`### ${projectName(p, "en")} (${item.id})`, "", "```", PLAT[item.handoff[0]] === "tiktok" ? c.tiktok : c.instagram, "```", "");
  }
  return { markdown: lines.join("\n") + "\n", todo };
}

if (process.argv[1] && process.argv[1].endsWith("handoff.mjs")) {
  const { markdown, todo } = buildHandoff();
  fs.writeFileSync(arg("out", "promo-handoff.md"), markdown);
  console.log(`handoff: ${todo.length} items`);
}
