// Build ready-to-publish text packs from the same verified manifest as promo videos and cards.
// No model/API calls: platform variants are deterministic, reviewable templates.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arg, loadProjects, projectLanguage, projectName, site } from "./common.mjs";

const OUT_DEFAULT = "promo-copy";
const SKIP_PROJECT_IDS = new Set(["athar"]); // protected project: leave its copy and campaigns to its owner/session
const TAGS = {
  "sham-ai": "#ShamAI #FreeTools #Telegram",
  "literium": "#Literium #ArabicWriting #Reading",
  "zenobia": "#Zenobia #TON",
  "palmyra-launch": "#PalmyraLaunch #TON",
  "media-downloader": "#TelegramBot #VideoDownloader",
  "jobs-and-store": "#TelegramBots #Jobs",
  "dating-marriage": "#TelegramBot #Marriage",
  "confessions": "#TelegramBot #AnonymousMessages",
};

const clean = (s) => String(s || "").replace(/[ \t]+/g, " ").trim();
const pageUrl = (p) => {
  const first = p.shots?.[0];
  if (first?.url) return first.url;
  if (first?.path) return site().replace(/\/$/, "") + first.path;
  return site();
};
const handleUrl = (handle) => /^https?:\/\//i.test(handle) ? handle : /^t\.me\//i.test(handle) ? "https://" + handle : "";

export function buildCampaign(p) {
  const englishOnly = projectLanguage(p) === "en";
  const titleEn = projectName(p, "en");
  const titleAr = projectName(p, "ar");
  const bulletsEn = (p.points || []).map((x) => `• ${clean(x[0])}`).join("\n");
  const bulletsAr = (p.points || []).map((x) => `• ${clean(x[1])}`).join("\n");
  const url = pageUrl(p);
  const botLink = handleUrl(p.handle);
  const tags = TAGS[p.id] || "#Ttbik #Telegram";
  const ctaEn = `${clean(p.cta?.[0])}: ${p.handle}`;
  const introEn = clean(p.tagline?.[0]);
  const introAr = clean(p.tagline?.[1]);
  const en = [
    titleEn,
    "",
    introEn,
    "",
    bulletsEn,
    "",
    ctaEn,
    url,
    ...(botLink && botLink !== url ? [botLink] : []),
    tags,
  ].join("\n");
  const ar = [
    titleAr,
    "",
    introAr,
    "",
    bulletsAr,
    "",
    `${clean(p.cta?.[1])}: ${p.handle}`,
    url,
    ...(botLink && botLink !== url ? [botLink] : []),
    tags,
  ].join("\n");
  const bilingual = englishOnly ? en : `${en}\n\n────────\n\n${ar}`;
  const instagram = bilingual + (englishOnly ? "" : "\n\n#شام_AI");
  const tiktok = englishOnly
    ? `${titleEn}: ${introEn} ${ctaEn} · ${url} · ${tags}`
    : `${titleEn}: ${introEn}\n${titleAr}: ${introAr}\n${clean(p.cta?.[1])} · ${url}${botLink && botLink !== url ? ` · ${botLink}` : ""} · ${tags} #شام_AI`;
  const youtubeTitle = clean(`${titleEn} | ${introEn}`).slice(0, 100);
  const youtubeDescription = bilingual;
  return {
    id: p.id,
    language: englishOnly ? "en" : "en+ar",
    pageUrl: url,
    telegram: bilingual,
    instagram,
    tiktok,
    youtubeTitle,
    youtubeDescription,
  };
}

export function renderCampaign(p) {
  const c = buildCampaign(p);
  return [
    `# ${projectName(p, "en")} — Campaign pack`,
    "",
    `- Language: ${c.language}`,
    `- Landing page: ${c.pageUrl}`,
    "",
    "## Telegram",
    "",
    c.telegram,
    "",
    "## Instagram / Facebook",
    "",
    c.instagram,
    "",
    "## TikTok / Reels",
    "",
    c.tiktok,
    "",
    "## YouTube Shorts",
    "",
    `**Title:** ${c.youtubeTitle}`,
    "",
    "**Description:**",
    "",
    c.youtubeDescription,
    "",
  ].join("\n");
}

export function generateCampaignPacks({ only = "", out = OUT_DEFAULT } = {}) {
  const all = loadProjects();
  if (only && !all.some((p) => p.id === only)) throw new Error(`unknown campaign id: ${only}`);
  const projects = all.filter((p) => !SKIP_PROJECT_IDS.has(p.id) && (!only || p.id === only));
  fs.mkdirSync(out, { recursive: true });
  const index = ["# Promotion packs", "", "Generated from scripts/promo/projects.json. Review the copy before publishing.", "", "Protected campaign entries are intentionally omitted.", ""];
  for (const p of projects) {
    const file = path.join(out, `${p.id}.md`);
    fs.writeFileSync(file, renderCampaign(p), "utf8");
    index.push(`- [${projectName(p, "en")}](./${path.basename(file)}) — ${buildCampaign(p).language}`);
  }
  fs.writeFileSync(path.join(out, "README.md"), index.join("\n") + "\n", "utf8");
  return projects.map((p) => p.id);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ids = generateCampaignPacks({ only: arg("only", ""), out: arg("out", OUT_DEFAULT) });
  console.log(`generated ${ids.length} campaign packs: ${ids.join(", ")}`);
}
