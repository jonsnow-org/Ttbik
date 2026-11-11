// Shared helpers for the promo generators (videos, cards and campaign copy).
import fs from "node:fs";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const dataUri = (file) => { const b = fs.readFileSync(file); return `data:image/${/\.png$/i.test(file) ? "png" : "jpeg"};base64,${b.toString("base64")}`; };
export const site = () => JSON.parse(fs.readFileSync("deploy/hosting/site.json", "utf8")).gateUrl;
export const loadProjects = () => JSON.parse(fs.readFileSync("scripts/promo/projects.json", "utf8")).projects;
export const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
export const ARABIC_FONTS = "'Noto Naskh Arabic','Noto Sans Arabic','DejaVu Sans',sans-serif";
export const LATIN_FONTS = "'Noto Sans','DejaVu Sans',sans-serif";

/** Coin-channel materials must stay English-only; all other public campaign material is bilingual. */
export const projectLanguage = (p) => p.channel === "coins" ? "en" : "both";
export const projectName = (p, lang = "en") => {
  const parts = String(p.name || "").split(" · ");
  return (lang === "ar" ? parts[1] : parts[0])?.trim() || String(p.name || "").trim();
};
export const pairText = (p, pair, lang = projectLanguage(p)) =>
  lang === "en" ? String(pair?.[0] || "") : lang === "ar" ? String(pair?.[1] || pair?.[0] || "") : `${pair?.[0] || ""} · ${pair?.[1] || ""}`;
export const logoMarkup = (p, className = "logo") => p.logo
  ? `<img class="${className}" src="${dataUri(p.logo)}" alt="${esc(p.name || "project")}">`
  : `<div class="${className} monogram" aria-label="${esc(p.name || "project")}">${esc(p.brandMark || projectName(p).slice(0, 2).toUpperCase())}</div>`;
export const fineLine = (p, lang = projectLanguage(p)) =>
  p.fine ? (lang === "en" ? "Not financial advice" : lang === "ar" ? "ليست نصيحة مالية" : "Not financial advice · ليست نصيحة مالية") : "";

export const narrationText = (p) => {
  const lang = projectLanguage(p) === "en" ? "en" : "ar";
  const index = lang === "en" ? 0 : 1;
  return [
    projectName(p, lang),
    p.tagline?.[index],
    ...(p.points || []).map((point) => point?.[index]),
    ...(p.shots || []).map((shot) => shot.caption?.[index]),
    p.cta?.[index],
  ].filter((value) => typeof value === "string" && value.trim()).join(". ");
};
