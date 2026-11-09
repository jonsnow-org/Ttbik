// Shared helpers for the promo generators (make.mjs = videos, cards.mjs = still images).
import fs from "node:fs";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const dataUri = (file) => { const b = fs.readFileSync(file); return `data:image/${/\.png$/i.test(file) ? "png" : "jpeg"};base64,${b.toString("base64")}`; };
export const site = () => JSON.parse(fs.readFileSync("deploy/hosting/site.json", "utf8")).gateUrl;
export const loadProjects = () => JSON.parse(fs.readFileSync("scripts/promo/projects.json", "utf8")).projects;
export const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
export const ARABIC_FONTS = "'Noto Naskh Arabic','Noto Sans Arabic','DejaVu Sans',sans-serif";
export const LATIN_FONTS = "'Noto Sans','DejaVu Sans',sans-serif";
/** Only the coin projects carry the "not financial advice" line; it is noise on a reading or tools app. */
export const fineLine = (p) => (p.fine ? "Not financial advice · ليست نصيحة مالية" : "");
