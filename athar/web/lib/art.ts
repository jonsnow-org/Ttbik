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
<clipPath id="disc"><circle cx="400" cy="400" r="392"/></clipPath>
<circle cx="400" cy="400" r="392" fill="url(#bg)"/>
<g clip-path="url(#disc)">${shapes}</g>${rings}${halo}${dots}
<text x="400" y="470" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="230" font-weight="700" fill="${a.sealed ? accent : pal.ink}">${esc(label)}</text>
<text x="400" y="540" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" letter-spacing="8" fill="${accent}">${esc(sub)}</text>
<text x="400" y="590" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="30" fill="${pal.ink}" opacity="0.85">${esc(ar)}</text>
${occ ? `<g transform="translate(400 188) scale(0.8)">${emblem(occ.id, accent)}</g>` : ""}
<text x="400" y="120" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" letter-spacing="10" fill="${accent}">ATHAR · أثر</text>
<text x="400" y="716" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="6" fill="${accent}" opacity="0.9">${tierText} · S${a.season}${a.engravings ? ` · ✎${a.engravings}` : ""}</text>
</svg>`;
}


/**
 * A token whose picture is a real photo (any shape: face, full figure, group). The token is a circle on a transparent
 * square canvas; the photo sits whole (never cropped) inside a smaller circle at its centre, and everything that gives the
 * token its provenance (date, rarity, season, edition seal, age rings, one dot per hand) stays visible around it.
 * The result is ONE self-contained SVG (the photo is embedded), small enough to be stored permanently for free (< 100 KiB).
 */
export function photoBox(w: number, h: number, r: number): { iw: number; ih: number } {
  // The photo keeps its own aspect ratio and is enlarged to fill the circle: a clearly tall or wide photo gets its long side
  // equal to the circle's diameter (only the far corners of that long edge touch the rim); a near-square photo is
  // enlarged less so its corners are not lost. The space the photo does not reach is painted by a blurred copy of itself.
  const asp = w / h, tall = Math.min(1, Math.abs(Math.log(asp)) / Math.log(2));
  const L = 2 * r * (0.86 + 0.14 * tall);
  const k = L / Math.max(w, h);
  return { iw: Math.floor(w * k), ih: Math.floor(h * k) };
}

export function renderPhotoArt(a: ArtInput, photoDataUri: string, dims?: { w: number; h: number }): string {
  const { y, m, d } = ymd(a.index);
  const pal = PALETTES[a.season] || PALETTES[1];
  const occ = occasionById(a.occasion ?? 0);
  const mythic = a.tier === 2, rare = a.tier === 1;
  const accent = mythic || occ?.gold ? GOLD : pal.accent;
  const W = 800;
  const stroke = mythic ? 9 : rare ? 6 : 4;
  const PR = 240;                                   // photo circle radius
  const { iw, ih } = photoBox(dims && dims.w > 0 && dims.h > 0 ? dims.w : 1, dims && dims.h > 0 ? dims.h : 1, PR - 3);
  const ix = Math.round(400 - iw / 2), iy = Math.round(400 - ih / 2);
  let rings = "";
  for (let i = 0; i <= a.stage; i++) rings += `<circle cx="400" cy="400" r="${PR + 14 + i * 14}" fill="none" stroke="${accent}" stroke-width="${i === a.stage ? 2.5 : 1.1}" opacity="${(0.25 + i * 0.12).toFixed(2)}"/>`;
  let dots = "";
  const hd = Math.min(a.hands, 24);
  for (let i = 0; i < hd; i++) {
    const ang = (i / Math.max(hd, 1)) * Math.PI * 2 - Math.PI / 2;
    dots += `<circle cx="${(400 + Math.cos(ang) * 350).toFixed(1)}" cy="${(400 + Math.sin(ang) * 350).toFixed(1)}" r="5" fill="${accent}"/>`;
  }
  const rim = mythic
    ? `<circle cx="400" cy="400" r="378" fill="none" stroke="${GOLD}" stroke-width="6"/><circle cx="400" cy="400" r="368" fill="none" stroke="${GOLD}" stroke-width="1.5" stroke-dasharray="2 10"/>`
    : rare
    ? `<circle cx="400" cy="400" r="378" fill="none" stroke="${accent}" stroke-width="4"/><circle cx="400" cy="400" r="368" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="1 7"/>`
    : `<circle cx="400" cy="400" r="378" fill="none" stroke="${accent}" stroke-width="2" opacity="0.8"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg1}"/><stop offset="1" stop-color="${pal.bg2}"/></linearGradient>
<clipPath id="win"><circle cx="400" cy="400" r="${PR - 3}"/></clipPath>
<filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="22"/></filter>
<image id="ph" href="${photoDataUri}" xlink:href="${photoDataUri}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid meet"/>
</defs>
<circle cx="400" cy="400" r="392" fill="url(#bg)"/>
${rings}${rim}${dots}
<circle cx="400" cy="400" r="${PR}" fill="#050914" stroke="${accent}" stroke-width="${stroke}"/>
<g clip-path="url(#win)">
<g filter="url(#soft)"><use href="#ph" xlink:href="#ph" transform="translate(400 400) scale(${(Math.max(1, (2 * PR) / Math.min(iw, ih)) * 1.15).toFixed(3)}) translate(-400 -400)"/></g>
<rect x="${400 - PR}" y="${400 - PR}" width="${2 * PR}" height="${2 * PR}" fill="#050914" opacity="0.28"/>
<use href="#ph" xlink:href="#ph"/>
</g>
<g transform="translate(634 604)"><circle r="58" fill="${pal.bg1}" stroke="${accent}" stroke-width="${Math.max(3, stroke - 2)}"/>
<text y="10" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="50" font-weight="700" fill="${pal.ink}">${String(d).padStart(2, "0")}</text>
<text y="34" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="1" fill="${accent}">${MONTHS_EN[m - 1]} ${y}</text></g>
${occ ? `<g transform="translate(166 604) scale(0.6)">${emblem(occ.id, accent)}</g>` : ""}
<text x="400" y="86" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="10" fill="${accent}">ATHAR · أثر</text>
<text x="400" y="736" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="6" fill="${accent}" opacity="0.9">${["COMMON", "RARE", "MYTHIC"][a.tier]} · S${a.season}</text>
</svg>`;
}
