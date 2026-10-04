// Deterministic generative art. The same inputs always give the same picture, so nothing needs to be stored:
// date -> shape, tier -> frame and halo, season -> palette, age stage -> rings, hands -> orbiting dots.
import { MONTHS_AR, MONTHS_EN, ymd } from "./dates";
import { emblem, occasionById } from "./occasions";
import { tierSupply } from "./meta";

const PALETTES: Record<number, { bg1: string; bg2: string; ink: string; accent: string }> = {
  1: { bg1: "#0b1226", bg2: "#1a2b5c", ink: "#eaf0ff", accent: "#9dbbff" },
  2: { bg1: "#1a0b26", bg2: "#4a1b6b", ink: "#f6eaff", accent: "#c78bff" },
  3: { bg1: "#0b2620", bg2: "#145a4a", ink: "#eafff6", accent: "#6af0c0" },
};
const GOLD = "#ffd36a";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export type ArtInput = { index: number; tier: number; season: number; stage: number; hands: number; engravings: number; sealed?: boolean; occasion?: number };

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const PAIRS: [number, number][] = [[7, 2], [8, 3], [9, 4], [10, 3], [11, 4], [12, 5], [13, 4], [11, 3], [9, 2], [13, 5], [7, 3], [10, 7]];

/** One closed spirograph curve (hypotrochoid), scaled so its widest point reaches `reach`. */
function spiro(R: number, r: number, dRatio: number, reach: number, rot: number): string {
  const d = r * dRatio, period = (2 * Math.PI * r) / gcd(R, r);
  const steps = Math.min(720, Math.round((period / (2 * Math.PI)) * 160));
  const k = reach / (R - r + d);
  let path = "";
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * period;
    const x = (R - r) * Math.cos(th) + d * Math.cos(((R - r) / r) * th);
    const y = (R - r) * Math.sin(th) - d * Math.sin(((R - r) / r) * th);
    const c = Math.cos(rot), sn = Math.sin(rot);
    path += `${i ? "L" : "M"}${(400 + (x * c - y * sn) * k).toFixed(1)} ${(400 + (x * sn + y * c) * k).toFixed(1)}`;
  }
  return path + "Z";
}

/** The picture at the heart of a token that carries no photo: a guilloche rosette that belongs to its date alone.
 *  Common dates get two curves, rare three and fine rays, mythic ones add a golden halo; the date itself sits in the badge. */
function rosette(a: ArtInput, accent: string, ink: string): { defs: string; body: string } {
  const r = rng(a.index * 7919 + 13);
  const layers = 3, copies = [2, 3, 4][a.tier];
  const dim = a.tier !== 1; // plain dates read dark on the navy: draw their lines thicker and brighter
  let body = `<circle cx="400" cy="400" r="236" fill="url(#core)"/>`;
  // a ring of beads and, for rarer dates, fine rays: the "banknote" border of the picture
  const beads = 90;
  for (let i = 0; i < beads; i++) {
    const an = (i / beads) * Math.PI * 2;
    body += `<circle cx="${(400 + Math.cos(an) * 222).toFixed(1)}" cy="${(400 + Math.sin(an) * 222).toFixed(1)}" r="${i % 5 === 0 ? 2.8 : 1.6}" fill="${accent}" opacity="${i % 5 === 0 ? 1 : dim ? 0.8 : 0.55}"/>`;
  }
  if (a.tier >= 1) {
    const n = a.tier === 2 ? 96 : 60;
    for (let i = 0; i < n; i++) {
      const an = (i / n) * Math.PI * 2;
      body += `<line x1="${(400 + Math.cos(an) * 196).toFixed(1)}" y1="${(400 + Math.sin(an) * 196).toFixed(1)}" x2="${(400 + Math.cos(an) * 212).toFixed(1)}" y2="${(400 + Math.sin(an) * 212).toFixed(1)}" stroke="${accent}" stroke-width="${i % 4 === 0 ? 1.8 : 0.9}" opacity="${a.tier === 2 ? 0.85 : 0.55}"/>`;
    }
  }
  const h = Math.floor(r() * PAIRS.length);
  let defs = "";
  for (let k = 0; k < layers; k++) {
    const [R, q] = PAIRS[(h + k * 5) % PAIRS.length];
    const reach = 188 - k * 40;
    const dRatio = 0.55 + r() * 0.42;
    const col = dim ? (a.tier === 2 ? (k === 1 ? "#fff6d6" : "#ffd25a") : k === 1 ? "#ffffff" : "#c4d7ff") : k === 1 ? ink : accent;
    defs += `<path id="sp${k}" d="${spiro(R, q, dRatio, reach, 0)}" fill="none" stroke="${col}" stroke-width="${(k === 2 ? 1.5 : 1.1) + (dim ? (a.tier === 2 ? 1.5 : 1.9) : 0)}" stroke-linejoin="round"/>`;
    for (let c = 0; c < copies; c++) {
      body += `<use href="#sp${k}" xlink:href="#sp${k}" transform="rotate(${((c / copies) * (360 / (R - q)) + k * 7).toFixed(2)} 400 400)" opacity="${(dim ? (a.tier === 2 ? 1 - k * 0.06 : 0.97 - k * 0.07) : 0.7 - k * 0.12).toFixed(2)}"/>`;
    }
  }
  const c = 13 + a.tier * 5;
  body += `<circle cx="400" cy="400" r="${c + 14}" fill="#050914" stroke="${accent}" stroke-width="1.4" opacity="0.9"/><path d="M400 ${400 - c}L${400 + c * 0.7} 400L400 ${400 + c}L${400 - c * 0.7} 400Z" fill="${accent}"/><circle cx="400" cy="400" r="${c + 24}" fill="none" stroke="${ink}" stroke-width="1" opacity="0.55"/>`;
  if (dim) {   // soft glow so the fine lines read on a dark disc
    defs += `<filter id="lg" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${a.tier === 2 ? 2.8 : 3.2}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    body = `<g filter="url(#lg)">${body}</g>`;
  }
  return { defs, body };
}

/** The common shell of every token: a round token on a transparent square canvas, with its provenance around the picture. */
function shell(a: ArtInput, centre: string, defs: string): string {
  const { y, m, d } = ymd(a.index);
  const pal = PALETTES[a.season] || PALETTES[1];
  const occ = occasionById(a.occasion ?? 0);
  const mythic = a.tier === 2, rare = a.tier === 1;
  const accent = mythic || occ?.gold ? GOLD : pal.accent;
  const W = 800, PR = 240;
  const stroke = mythic ? 9 : rare ? 6 : 4;
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
  const glow = mythic ? `<circle cx="400" cy="400" r="${PR + 10}" fill="url(#halo)"/>` : "";
  const dayText = a.sealed ? "?" : String(d).padStart(2, "0");
  const monText = a.sealed ? "SEALED" : `${MONTHS_EN[m - 1]} ${y}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg1}"/><stop offset="1" stop-color="${pal.bg2}"/></linearGradient>
<radialGradient id="halo"><stop offset="0.7" stop-color="${GOLD}" stop-opacity="0"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.4"/></radialGradient>
<clipPath id="win"><circle cx="400" cy="400" r="${PR - 3}"/></clipPath>
${defs}</defs>
<circle cx="400" cy="400" r="392" fill="url(#bg)"/>
<g class="ar-rings">${rings}</g><g class="ar-rim">${rim}</g><g class="ar-dots">${dots}</g><g class="ar-glow">${glow}</g>
<circle cx="400" cy="400" r="${PR}" fill="${a.tier === 0 ? "#0a1633" : a.tier === 2 ? "#2a1c06" : "#050914"}" stroke="${accent}" stroke-width="${stroke}"/>
${centre}
<g transform="translate(634 604)"><circle r="58" fill="${pal.bg1}" stroke="${accent}" stroke-width="${Math.max(3, stroke - 2)}"/>
<text y="10" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="50" font-weight="700" fill="${pal.ink}">${dayText}</text>
<text y="34" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="1" fill="${accent}">${esc(monText)}</text></g>
${occ ? `<g transform="translate(166 604) scale(0.6)">${emblem(occ.id, accent)}</g>` : ""}
<text x="400" y="86" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="10" fill="${accent}">ATHAR · أثر</text>
<text x="400" y="736" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="6" fill="${accent}" opacity="0.9">${["COMMON", "RARE", "MYTHIC"][a.tier]} · S${a.season}${a.engravings ? ` · ✎${a.engravings}` : ""}</text>
<text x="400" y="764" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="4" fill="${accent}" opacity="0.7">EDITION I · ONE OF ${tierSupply(a.season)[a.tier]}</text>
</svg>`;
}

export function renderArt(a: ArtInput): string {
  const pal = PALETTES[a.season] || PALETTES[1];
  const occ = occasionById(a.occasion ?? 0);
  const accent = a.tier === 2 || occ?.gold ? GOLD : pal.accent;
  const ro = rosette(a, accent, pal.ink);
  const core = `<radialGradient id="core"><stop offset="0" stop-color="${accent}" stop-opacity="${a.tier === 2 ? 0.55 : a.tier === 1 ? 0.26 : 0.55}"/><stop offset="0.75" stop-color="${accent}" stop-opacity="0.05"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`;
  const centre = `<g clip-path="url(#win)" ${a.sealed ? 'opacity="0.35"' : ""}><g class="ar-ro">${ro.body}</g></g>${a.sealed ? `<text x="400" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="200" font-weight="700" fill="${accent}">؟</text>` : ""}`;
  return shell(a, centre, core + ro.defs);
}

/**
 * A token whose picture is a real photo (any shape: face, full figure, group). The token is a circle on a transparent
 * square canvas; the photo sits whole (never cropped) inside a smaller circle at its centre, and everything that gives the
 * token its provenance (date, rarity, season, edition seal, age rings, one dot per hand) stays visible around it.
 * The result is ONE self-contained SVG (the photo is embedded), small enough to be stored permanently for free (< 100 KiB).
 */
export function photoBox(w: number, h: number, r: number): { iw: number; ih: number } {
  // The photo keeps its own aspect ratio and is enlarged to fill the circle: a clearly tall or wide photo gets its long side
  // a little longer than the circle's diameter (the circle is narrowest at those ends, so only far-corner background is lost);
  // a near-square photo is enlarged less so its corners are not lost. What the photo still does not reach is painted by
  // mirrored, softened copies of its own edges, so there are never black bars.
  const asp = w / h, tall = Math.min(1, Math.abs(Math.log(asp)) / Math.log(2));
  const L = 2 * r * (0.86 + 0.26 * tall);
  const k = L / Math.max(w, h);
  return { iw: Math.floor(w * k), ih: Math.floor(h * k) };
}

export function renderPhotoArt(a: ArtInput, photoDataUri: string, dims?: { w: number; h: number }): string {
  const PR = 240;
  const { iw, ih } = photoBox(dims && dims.w > 0 && dims.h > 0 ? dims.w : 1, dims && dims.h > 0 ? dims.h : 1, PR - 3);
  const ix = Math.round(400 - iw / 2), iy = Math.round(400 - ih / 2);
  const defs = `<filter id="soft" filterUnits="userSpaceOnUse" x="0" y="0" width="800" height="800"><feGaussianBlur stdDeviation="7"/></filter>
<image id="ph" href="${photoDataUri}" xlink:href="${photoDataUri}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid meet"/>
`;
  const centre = `<g clip-path="url(#win)">
<g filter="url(#soft)">${ix > 400 - PR ? `<use href="#ph" xlink:href="#ph" transform="translate(${2 * ix} 0) scale(-1 1)"/><use href="#ph" xlink:href="#ph" transform="translate(${2 * (ix + iw)} 0) scale(-1 1)"/>` : ""}${iy > 400 - PR ? `<use href="#ph" xlink:href="#ph" transform="translate(0 ${2 * iy}) scale(1 -1)"/><use href="#ph" xlink:href="#ph" transform="translate(0 ${2 * (iy + ih)}) scale(1 -1)"/>` : ""}</g>
<use href="#ph" xlink:href="#ph"/>
</g>`;
  return shell(a, centre, defs);
}
