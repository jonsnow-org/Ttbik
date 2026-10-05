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
// Rare tokens have a look of their own (emerald-aqua crystal), so that common (silver-blue), rare (aqua crystal) and mythic (gold) are told apart at a glance.
const RARE_PAL = { bg1: "#04201f", bg2: "#0f5a55", ink: "#eafffa", accent: "#5ff0cf" };
const palOf = (a: ArtInput) => (a.tier === 1 && !a.gold ? RARE_PAL : PALETTES[a.season] || PALETTES[1]);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export type ArtInput = { index: number; tier: number; season: number; stage: number; hands: number; engravings: number; sealed?: boolean; occasion?: number; gold?: boolean };   // gold: a special date: gold frame whatever its rarity (the rarity text stays true)

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const PAIRS: [number, number][] = [[7, 2], [8, 3], [9, 4], [10, 3], [11, 4], [12, 5], [13, 4], [11, 3], [9, 2], [13, 5], [7, 3], [10, 7]];

/** One closed spirograph curve (hypotrochoid), scaled so its widest point reaches `reach`. */
function spiro(R: number, r: number, dRatio: number, reach: number, rot: number, density = 160): string {
  const d = r * dRatio, period = (2 * Math.PI * r) / gcd(R, r);
  const steps = Math.min(720, Math.round((period / (2 * Math.PI)) * density));
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
function rosette(a: ArtInput, accent: string, ink: string, mini = false): { defs: string; body: string } {   // mini: the small badge on a photo token (lighter, so the photo keeps the storage budget)
  const r = rng(a.index * 7919 + 13);
  const layers = mini ? 2 : 3, copies = mini ? [1, 2, 2][a.tier] : [2, 3, 4][a.tier];
  const dim = mini || a.tier !== 1; // plain dates read dark on the navy: draw their lines thicker and brighter
  let body = `<circle cx="400" cy="400" r="236" fill="url(#core)"/>`;
  // a ring of beads and, for rarer dates, fine rays: the "banknote" border of the picture
  const beads = mini ? 36 : 90;
  for (let i = 0; i < beads; i++) {
    const an = (i / beads) * Math.PI * 2;
    body += `<circle cx="${(400 + Math.cos(an) * 222).toFixed(1)}" cy="${(400 + Math.sin(an) * 222).toFixed(1)}" r="${i % 5 === 0 ? 2.8 : 1.6}" fill="${accent}" opacity="${i % 5 === 0 ? 1 : dim ? 0.8 : 0.55}"/>`;
  }
  if (a.tier >= 1) {
    const n = mini ? 30 : a.tier === 2 ? 96 : 60;
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
    defs += `<path id="sp${k}" d="${spiro(R, q, dRatio, reach, 0, mini ? 34 : 160)}" fill="none" stroke="${col}" stroke-width="${(k === 2 ? 1.5 : 1.1) + (dim ? (a.tier === 2 ? 1.5 : 1.9) : 0)}" stroke-linejoin="round"/>`;
    for (let c = 0; c < copies; c++) {
      body += `<use xlink:href="#sp${k}" transform="rotate(${((c / copies) * (360 / (R - q)) + k * 7).toFixed(2)} 400 400)" opacity="${(dim ? (a.tier === 2 ? 1 - k * 0.06 : 0.97 - k * 0.07) : 0.7 - k * 0.12).toFixed(2)}"/>`;
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


/** The picture at the heart of a RARE token: a crystal bloom (kite petals, two star polygons, a jewel core). It has its own motion: the
 *  petals turn one way, the inner star the other, the jewel pulses and a glint passes. Same date, same bloom (the number of petals follows it). */
function crystal(a: ArtInput, accent: string, ink: string, mini = false): { defs: string; body: string } {
  const r = rng(a.index * 104729 + 7);
  const petals = mini ? 8 : 12 + 2 * Math.floor(r() * 3);                 // 12, 14 or 16 petals
  const kite = (rot: number, tip: number, base: number, half: number, fill: string, stroke: string, sw: number, extra = "") =>
    `<path d="M0 ${-tip}L${half} ${-(tip + base) / 2}L0 ${-base}L${-half} ${-(tip + base) / 2}Z" transform="rotate(${rot.toFixed(2)} 0 0)" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`;
  const star = (n: number, k: number, R: number) => { let d = ""; for (let i = 0; i < n; i++) { const an = ((i * k) / n) * Math.PI * 2 - Math.PI / 2; d += `${i ? "L" : "M"}${(Math.cos(an) * R).toFixed(1)} ${(Math.sin(an) * R).toFixed(1)}`; } return d + "Z"; };
  const defs = `<linearGradient id="crf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.75"/><stop offset="1" stop-color="${ink}" stop-opacity="0.12"/></linearGradient>`
    + `<radialGradient id="crc"><stop offset="0" stop-color="${ink}"/><stop offset="0.55" stop-color="${accent}"/><stop offset="1" stop-color="${accent}" stop-opacity="0.2"/></radialGradient>`
    + `<filter id="crg" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  let body = `<circle cx="400" cy="400" r="236" fill="url(#core)"/>`;
  // border of beads: the family mark shared with the other tiers
  const beads = mini ? 28 : 72;
  for (let i = 0; i < beads; i++) { const an = (i / beads) * Math.PI * 2; body += `<circle cx="${(400 + Math.cos(an) * 222).toFixed(1)}" cy="${(400 + Math.sin(an) * 222).toFixed(1)}" r="${i % 6 === 0 ? 3 : 1.5}" fill="${accent}" opacity="${i % 6 === 0 ? 1 : 0.7}"/>`; }
  let outer = "", inner = "";
  for (let i = 0; i < petals; i++) {
    const rot = (i * 360) / petals;
    outer += `<g class="ar-cf" style="animation-delay:${((i * 0.37) % 4).toFixed(2)}s" transform="translate(400 400)">${kite(rot, 212, 132, mini ? 40 : 30, "url(#crf)", accent, mini ? 3 : 1.6)}${mini ? "" : kite(rot, 128, 74, 15, ink, "none", 0, 'opacity="0.55"')}</g>`;
  }
  const n2 = mini ? 6 : 8;
  for (let i = 0; i < n2; i++) inner += `<g transform="translate(400 400)">${kite((i * 360) / n2 + 180 / n2, 118, 54, mini ? 30 : 22, ink, "none", 0, 'opacity="0.22"')}</g>`;
  body += `<g class="ar-c1">${outer}</g>`;
  body += `<g class="ar-c2" transform="translate(0 0)"><g transform="translate(400 400)"><path d="${star(petals, 5, 150)}" fill="none" stroke="${accent}" stroke-width="${mini ? 3 : 1.4}" opacity="0.85"/>${mini ? "" : `<path d="${star(petals, 2, 112)}" fill="none" stroke="${ink}" stroke-width="1.1" opacity="0.7"/>`}</g>${inner}</g>`;
  body += `<g class="ar-c3"><polygon points="${Array.from({ length: 8 }, (_, i) => { const an = (i / 8) * Math.PI * 2 + Math.PI / 8; return `${(400 + Math.cos(an) * 36).toFixed(1)},${(400 + Math.sin(an) * 36).toFixed(1)}`; }).join(" ")}" fill="url(#crc)" stroke="${ink}" stroke-width="2"/><path d="M400 372L418 400L400 428L382 400Z" fill="${ink}" opacity="0.9"/></g>`;
  body = `<g filter="url(#crg)">${body}</g>`;
  return { defs, body };
}

/** The common shell of every token: a round token on a transparent square canvas, with its provenance around the picture. */
function shell(a: ArtInput, centre: string, defs: string, emblemAt: [number, number] = [166, 604]): string {
  const { y, m, d } = ymd(a.index);
  const pal = palOf(a);
  const occ = occasionById(a.occasion ?? 0);
  const mythic = a.tier === 2 || !!a.gold, rare = a.tier === 1 && !a.gold;
  const accent = mythic || occ?.gold ? GOLD : pal.accent;
  const W = 800, PR = 240;
  const stroke = mythic ? 9 : rare ? 6 : 4;
  let rings = "";
  for (let i = 0; i <= a.stage; i++) rings += `<circle cx="400" cy="400" r="${PR + 14 + i * 14}" fill="none" stroke="${accent}" stroke-width="${i === a.stage ? 2.5 : 1.1}" opacity="${(0.25 + i * 0.12).toFixed(2)}"/>`;
  // The age of the token is visible: after 30 days a ring, after 6 months a halo, after a year a crown of turning sparks,
  // after 3 years a turning dashed ring and a breathing aura. (Each stage keeps the marks of the stages before it.)
  const sparkP = "M0-9C1-3 3-1 9 0 3 1 1 3 0 9-1 3-3 1-9 0-3-1-1-3 0-9Z";
  if (a.stage >= 2) rings += `<circle class="ar-sta" cx="400" cy="400" r="${PR + 40}" fill="none" stroke="${accent}" stroke-width="14" opacity="0.1"/>`;
  if (a.stage >= 3) { let crown = ""; for (let i = 0; i < 12; i++) { if (i % 6 === 3) continue; const an = (i / 12) * Math.PI * 2; crown += `<path transform="translate(${(400 + Math.cos(an) * 318).toFixed(1)} ${(400 + Math.sin(an) * 318).toFixed(1)}) scale(${i % 2 ? 0.7 : 1})" d="${sparkP}" fill="${accent}" opacity="0.9"/>`; } rings += `<g class="ar-st3">${crown}</g>`; }
  if (a.stage >= 4) rings += `<circle class="ar-st4" cx="400" cy="400" r="334" fill="none" stroke="${accent}" stroke-width="2.4" stroke-dasharray="3 11" opacity="0.8"/><circle class="ar-stb" cx="400" cy="400" r="300" fill="url(#aura)"/>`;
  let dots = "";
  const hd = Math.min(a.hands, 24);
  for (let i = 0; i < hd; i++) {
    const ang = (i / Math.max(hd, 1)) * Math.PI * 2 - Math.PI / 2;
    dots += `<circle cx="${(400 + Math.cos(ang) * 350).toFixed(1)}" cy="${(400 + Math.sin(ang) * 350).toFixed(1)}" r="5" fill="${accent}"/>`;
  }
  // the outer circle is coloured like the inner one: a bright rim, a soft coloured band inside it and a dotted ring
  const band = `<circle cx="400" cy="400" r="368" fill="none" stroke="${accent}" stroke-width="26" opacity="0.14"/>`;
  const rim = mythic
    ? `${band}<circle cx="400" cy="400" r="378" fill="none" stroke="${GOLD}" stroke-width="8"/><circle cx="400" cy="400" r="364" fill="none" stroke="${GOLD}" stroke-width="2" stroke-dasharray="2 10"/>`
    : `${band}<circle cx="400" cy="400" r="378" fill="none" stroke="${accent}" stroke-width="${rare ? 7 : 6}"/><circle cx="400" cy="400" r="364" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="2 9" opacity="0.9"/>`;
  const glow = mythic ? `<circle cx="400" cy="400" r="${PR + 10}" fill="url(#halo)"/>` : "";
  const dayText = a.sealed ? "?" : String(d).padStart(2, "0");
  const monText = a.sealed ? "SEALED" : `${MONTHS_EN[m - 1]} ${y}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.bg1}"/><stop offset="1" stop-color="${pal.bg2}"/></linearGradient>
<radialGradient id="aura"><stop offset="0.6" stop-color="${accent}" stop-opacity="0"/><stop offset="1" stop-color="${accent}" stop-opacity="0.22"/></radialGradient>
<radialGradient id="halo"><stop offset="0.7" stop-color="${GOLD}" stop-opacity="0"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0.4"/></radialGradient>
<clipPath id="win"><circle cx="400" cy="400" r="${PR - 3}"/></clipPath>
${defs}</defs>
<circle cx="400" cy="400" r="392" fill="url(#bg)"/>
<g class="ar-rings">${rings}</g><g class="ar-rim">${rim}</g><g class="ar-dots">${dots}</g><g class="ar-glow">${glow}</g>
<circle cx="400" cy="400" r="${PR}" fill="${a.tier === 0 ? "#0a1633" : a.tier === 2 || a.gold ? "#2a1c06" : "#04201f"}" stroke="${accent}" stroke-width="${stroke}"/>
${centre}
<g transform="translate(634 604)"><circle r="58" fill="${pal.bg1}" stroke="${accent}" stroke-width="${Math.max(3, stroke - 2)}"/>
<text y="10" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="50" font-weight="700" fill="${pal.ink}">${dayText}</text>
<text y="34" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="1" fill="${accent}">${esc(monText)}</text></g>
${occ ? `<g transform="translate(${emblemAt[0]} ${emblemAt[1]}) scale(0.6)">${emblem(occ.id, accent)}</g>` : ""}
<text x="400" y="86" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" letter-spacing="10" fill="${accent}">ATHAR · أثر</text>
<text x="400" y="736" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="6" fill="${accent}" opacity="0.9">${["COMMON", "RARE", "MYTHIC"][a.tier]} · S${a.season}${a.engravings ? ` · ✎${a.engravings}` : ""}</text>
<text x="400" y="764" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="4" fill="${accent}" opacity="0.7">ONE OF ${tierSupply(a.season)[a.tier]}</text>
<text x="400" y="116" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" letter-spacing="5" fill="${accent}" opacity="0.7">EDITION I</text>
</svg>`;
}

export function renderArt(a: ArtInput): string {
  const pal = palOf(a);
  const occ = occasionById(a.occasion ?? 0);
  const accent = a.tier === 2 || a.gold || occ?.gold ? GOLD : pal.accent;
  const rare = a.tier === 1 && !a.gold;
  const ro = rare ? crystal(a, accent, pal.ink) : rosette(a, accent, pal.ink);
  const core = `<radialGradient id="core"><stop offset="0" stop-color="${accent}" stop-opacity="${a.tier === 2 ? 0.55 : a.tier === 1 ? 0.26 : 0.55}"/><stop offset="0.75" stop-color="${accent}" stop-opacity="0.05"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`;
  const centre = `<g clip-path="url(#win)" ${a.sealed ? 'opacity="0.35"' : ""}>${rare ? ro.body + `<rect class="ar-cg" x="180" y="120" width="70" height="560" fill="#fff" opacity="0" transform="skewX(-18)"/>` : `<g class="ar-ro">${ro.body}</g>`}</g>${a.sealed ? `<text x="400" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="200" font-weight="700" fill="${accent}">؟</text>` : ""}`;
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

/** The date's own rosette, shrunk to a small badge (same size as the date seal, bottom left, mirroring it) so a token that carries
 *  a photo keeps the picture it was born with. Returns the badge and the definitions it needs. */
function rosetteBadge(a: ArtInput): { defs: string; badge: string } {
  const pal = palOf(a);
  const accent = a.tier === 2 || a.gold || occasionById(a.occasion ?? 0)?.gold ? GOLD : pal.accent;
  const ro = a.tier === 1 && !a.gold ? crystal(a, accent, pal.ink, true) : rosette(a.gold ? { ...a, tier: 2 } : a, accent, pal.ink, true);   // a gold-wax token keeps a GOLD badge
  const stroke = a.tier === 2 ? 9 : a.tier === 1 ? 6 : 4;
  const core = `<radialGradient id="core"><stop offset="0" stop-color="${accent}" stop-opacity="${a.tier === 2 ? 0.55 : a.tier === 1 ? 0.26 : 0.55}"/><stop offset="0.75" stop-color="${accent}" stop-opacity="0.05"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`;
  const defs = `${core}${ro.defs}<clipPath id="bdg"><circle r="58"/></clipPath>`;
  // The age shows on the badge too (the picture itself is a photo now): ring, halo, a few turning sparks, a dashed ring and an aura.
  const sp = "M0-7C1-2 2-1 7 0 2 1 1 2 0 7-1 2-2 1-7 0-2-1-1-2 0-7Z";
  let age = "";
  if (a.stage >= 1) age += `<circle r="63" fill="none" stroke="${accent}" stroke-width="1.6" opacity="0.55"/>`;
  if (a.stage >= 2) age += `<circle class="ar-bsta" r="67" fill="none" stroke="${accent}" stroke-width="6" opacity="0.12"/>`;
  if (a.stage >= 3) { let c = ""; for (let i = 0; i < 6; i++) { const an = (i / 6) * Math.PI * 2 + 0.5; c += `<path transform="translate(${(Math.cos(an) * 71).toFixed(1)} ${(Math.sin(an) * 71).toFixed(1)}) scale(${i % 2 ? 0.7 : 1})" d="${sp}" fill="${accent}" opacity="0.9"/>`; } age += `<g class="ar-bst3">${c}</g>`; }
  if (a.stage >= 4) age += `<circle class="ar-bst4" r="75" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="2 8" opacity="0.85"/><circle class="ar-bstb" r="75" fill="url(#baura)"/>`;
  const baura = `<radialGradient id="baura"><stop offset="0.6" stop-color="${accent}" stop-opacity="0"/><stop offset="1" stop-color="${accent}" stop-opacity="0.22"/></radialGradient>`;
  const badge = `<g class="ar-bd" transform="translate(166 580)">${age}<circle r="58" fill="#050914"/><g clip-path="url(#bdg)"><g transform="scale(0.26) translate(-400 -400)">${a.tier === 1 && !a.gold ? ro.body : `<g class="ar-ro">${ro.body}</g>`}</g></g><circle r="58" fill="none" stroke="${accent}" stroke-width="${Math.max(3, stroke - 2)}"/></g>`;
  return { defs: defs + baura, badge };
}

export function renderPhotoArt(a: ArtInput, photoDataUri: string, dims?: { w: number; h: number }): string {
  const PR = 240;
  const rb = rosetteBadge(a);
  const { iw, ih } = photoBox(dims && dims.w > 0 && dims.h > 0 ? dims.w : 1, dims && dims.h > 0 ? dims.h : 1, PR - 3);
  const ix = Math.round(400 - iw / 2), iy = Math.round(400 - ih / 2);
  const pvAccent = a.tier === 2 || a.gold ? GOLD : palOf(a).accent;
  const defs = `${rb.defs}<radialGradient id="pvg"><stop offset="0.8" stop-color="${pvAccent}" stop-opacity="0"/><stop offset="1" stop-color="${pvAccent}" stop-opacity="0.34"/></radialGradient><filter id="soft" filterUnits="userSpaceOnUse" x="0" y="0" width="800" height="800"><feGaussianBlur stdDeviation="7"/></filter>
<image id="ph" xlink:href="${photoDataUri}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid meet"/>
`;
  const centre = `<g clip-path="url(#win)">
<g filter="url(#soft)">${ix > 400 - PR ? `<use xlink:href="#ph" transform="translate(${2 * ix} 0) scale(-1 1)"/><use xlink:href="#ph" transform="translate(${2 * (ix + iw)} 0) scale(-1 1)"/>` : ""}${iy > 400 - PR ? `<use xlink:href="#ph" transform="translate(0 ${2 * iy}) scale(1 -1)"/><use xlink:href="#ph" transform="translate(0 ${2 * (iy + ih)}) scale(1 -1)"/>` : ""}</g>
<use xlink:href="#ph"/>
<circle class="ar-pv" cx="400" cy="400" r="${PR - 3}" fill="url(#pvg)" opacity="0.3"/>
<rect class="ar-pg" x="190" y="170" width="46" height="460" fill="#fff" opacity="0" transform="skewX(-18)"/>
</g>${rb.badge}`;
  return shell(a, centre, defs, [166, 196]);   // the occasion emblem moves up to make room for the badge
}

/** A token whose centre is drawn by the caller (a vector scene): same frame, rim, date seal and texts as every other token. */
export function renderCustomArt(a: ArtInput, centre: string, defs = ""): string {
  return shell(a, centre, defs);
}
