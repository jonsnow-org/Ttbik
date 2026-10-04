// Deterministic generative art. The same inputs always give the same picture, so nothing needs to be stored:
// date -> shape, tier -> frame and halo, season -> palette, age stage -> rings, hands -> orbiting dots.
import { MONTHS_AR, MONTHS_EN, ymd } from "./dates";
import { emblem, occasionById } from "./occasions";

const PALETTES: Record<number, { bg1: string; bg2: string; ink: string; accent: string }> = {
  1: { bg1: "#0b1226", bg2: "#1a2b5c", ink: "#eaf0ff", accent: "#7aa2ff" },
  2: { bg1: "#1a0b26", bg2: "#4a1b6b", ink: "#f6eaff", accent: "#c78bff" },
  3: { bg1: "#0b2620", bg2: "#145a4a", ink: "#eafff6", accent: "#6af0c0" },
};
const GOLD = "#ffd36a";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export type ArtInput = { index: number; tier: number; season: number; stage: number; hands: number; engravings: number; sealed?: boolean; occasion?: number };

export function renderArt(a: ArtInput): string {
  const { y, m, d } = ymd(a.index);
  const pal = PALETTES[a.season] || PALETTES[1];
  const r = rng(a.index * 7919 + a.season);
  const mythic = a.tier === 2, rare = a.tier === 1;
  const occ = occasionById(a.occasion ?? 0);
  const accent = mythic || occ?.gold ? GOLD : pal.accent;
  const W = 800;

  // soft shapes derived from the date
  let shapes = "";
  const n = 6 + (d % 5) + a.stage;
  for (let i = 0; i < n; i++) {
    const cx = 120 + r() * 560, cy = 120 + r() * 560, rad = 40 + r() * 150;
    shapes += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="${accent}" opacity="${(0.04 + r() * 0.07).toFixed(3)}"/>`;
  }
  // age rings: one more ring per stage
  let rings = "";
  for (let i = 0; i <= a.stage; i++) rings += `<circle cx="400" cy="400" r="${250 + i * 16}" fill="none" stroke="${accent}" stroke-width="${i === a.stage ? 3 : 1.2}" opacity="${(0.25 + i * 0.12).toFixed(2)}"/>`;
  // one dot per hand that held the token (capped), orbiting
  let dots = "";
  const hd = Math.min(a.hands, 24);
  for (let i = 0; i < hd; i++) {
    const ang = (i / Math.max(hd, 1)) * Math.PI * 2 - Math.PI / 2;
    dots += `<circle cx="${(400 + Math.cos(ang) * 318).toFixed(1)}" cy="${(400 + Math.sin(ang) * 318).toFixed(1)}" r="5" fill="${accent}"/>`;
  }
  const halo = mythic
    ? `<circle cx="400" cy="400" r="330" fill="url(#halo)"/><circle cx="400" cy="400" r="292" fill="none" stroke="${GOLD}" stroke-width="5"/><circle cx="400" cy="400" r="282" fill="none" stroke="${GOLD}" stroke-width="1.5" stroke-dasharray="2 10"/>`
    : rare
    ? `<circle cx="400" cy="400" r="292" fill="none" stroke="${accent}" stroke-width="3"/><circle cx="400" cy="400" r="282" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="1 7"/>`
    : `<circle cx="400" cy="400" r="292" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.7"/>`;
  const tierText = ["COMMON", "RARE", "MYTHIC"][a.tier];
  const label = a.sealed ? "؟" : String(d).padStart(2, "0");
  const sub = a.sealed ? "SEALED" : `${MONTHS_EN[m - 1]} ${y}`;
  const ar = a.sealed ? "تذكرة مختومة" : `${MONTHS_AR[m - 1]} ${y}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg1}"/><stop offset="1" stop-color="${pal.bg2}"/></linearGradient>
<radialGradient id="halo"><stop offset="0.55" stop-color="${GOLD}" stop-opacity="0"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.35"/></radialGradient>
</defs>
<rect width="${W}" height="${W}" rx="56" fill="url(#bg)"/>
${shapes}${rings}${halo}${dots}
<text x="400" y="470" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="230" font-weight="700" fill="${a.sealed ? accent : pal.ink}">${esc(label)}</text>
<text x="400" y="540" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" letter-spacing="8" fill="${accent}">${esc(sub)}</text>
<text x="400" y="590" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="30" fill="${pal.ink}" opacity="0.85">${esc(ar)}</text>
${occ ? `<g transform="translate(400 188) scale(0.8)">${emblem(occ.id, accent)}</g>` : ""}
<text x="400" y="120" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" letter-spacing="10" fill="${accent}">ATHAR · أثر</text>
<text x="400" y="716" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="6" fill="${accent}" opacity="0.9">${tierText} · S${a.season}${a.engravings ? ` · ✎${a.engravings}` : ""}</text>
</svg>`;
}


/**
 * A token whose picture is a real photo (any shape: face, full figure, group). The photo is shown whole, never cropped,
 * inside a framed window; the date becomes a small badge in the corner. The result is ONE self-contained SVG
 * (the photo is embedded), small enough to be stored permanently on Arweave for free (< 100 KiB).
 */
export function renderPhotoArt(a: ArtInput, photoDataUri: string): string {
  const { y, m, d } = ymd(a.index);
  const pal = PALETTES[a.season] || PALETTES[1];
  const occ = occasionById(a.occasion ?? 0);
  const mythic = a.tier === 2, rare = a.tier === 1;
  const accent = mythic || occ?.gold ? GOLD : pal.accent;
  const W = 800;
  const stroke = mythic ? 9 : rare ? 6 : 4;
  let stage = "";
  for (let i = 1; i <= a.stage; i++) stage += `<rect x="${60 - i * 7}" y="${104 - i * 7}" width="${680 + i * 14}" height="${572 + i * 14}" rx="${44 + i * 7}" fill="none" stroke="${accent}" stroke-width="1.2" opacity="${(0.55 - i * 0.08).toFixed(2)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg1}"/><stop offset="1" stop-color="${pal.bg2}"/></linearGradient>
<clipPath id="win"><rect x="72" y="116" width="656" height="548" rx="34"/></clipPath>
</defs>
<rect width="${W}" height="${W}" rx="56" fill="url(#bg)"/>
${stage}
<rect x="66" y="110" width="668" height="560" rx="40" fill="#050914" stroke="${accent}" stroke-width="${stroke}"/>
<image href="${photoDataUri}" xlink:href="${photoDataUri}" x="72" y="116" width="656" height="548" preserveAspectRatio="xMidYMid meet" clip-path="url(#win)"/>
<g transform="translate(646 650)"><circle r="74" fill="${pal.bg1}" stroke="${accent}" stroke-width="${Math.max(4, stroke - 2)}"/>
<text y="14" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="68" font-weight="700" fill="${pal.ink}">${String(d).padStart(2, "0")}</text>
<text y="44" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" letter-spacing="2" fill="${accent}">${MONTHS_EN[m - 1]} ${y}</text></g>
${occ ? `<g transform="translate(140 740) scale(0.7)">${emblem(occ.id, accent)}</g>` : ""}
<text x="400" y="72" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="10" fill="${accent}">ATHAR · أثر</text>
<text x="400" y="760" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="6" fill="${accent}" opacity="0.9">${["COMMON", "RARE", "MYTHIC"][a.tier]} · S${a.season}</text>
</svg>`;
}
