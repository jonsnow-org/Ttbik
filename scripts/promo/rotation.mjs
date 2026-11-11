// Select one public campaign each week. The older Remotion pipeline owns Athar,
// Zenobia/Palmyra Launch and individual free-tool episodes; this rotation owns
// Sham AI overview, Literium and the four public utility/community bots.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadProjects, projectLanguage, projectName, arg } from "./common.mjs";

export const PUBLISHABLE_CAMPAIGN_IDS = Object.freeze([
  "sham-ai",
  "literium",
  "media-downloader",
  "jobs-and-store",
  "dating-marriage",
  "confessions",
]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_SLOT = Date.UTC(2026, 10, 16); // Monday 16 Nov 2026, first new weekly slot

export function eligibleCampaigns(projects = loadProjects()) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return PUBLISHABLE_CAMPAIGN_IDS.map((id) => {
    const project = byId.get(id);
    if (!project) throw new Error(`campaign missing from manifest: ${id}`);
    return project;
  });
}

export function chooseCampaign({ date = new Date().toISOString().slice(0, 10), only = "" } = {}) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`invalid campaign date: ${date}`);
  }
  const campaigns = eligibleCampaigns();
  const project = only
    ? campaigns.find((item) => item.id === only)
    : campaigns[Math.max(0, Math.floor((Date.parse(`${date}T00:00:00Z`) - FIRST_SLOT) / WEEK_MS)) % campaigns.length];
  if (!project) throw new Error(`unknown or excluded campaign: ${only}`);
  const day = date.replaceAll("-", "");
  const channel = project.channel === "coins" ? "coins" : "general";
  const lang = projectLanguage(project) === "en" ? "en" : "ar";
  return {
    id: project.id,
    tag: `promo-campaign-${project.id}-${day}`,
    channel,
    lang,
    title: projectName(project, lang),
    asset: `${project.id}-vertical.mp4`,
    date,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = chooseCampaign({ date: arg("date", new Date().toISOString().slice(0, 10)), only: arg("only", "") });
  for (const [key, value] of Object.entries(result)) console.log(`${key}=${value}`);
}
