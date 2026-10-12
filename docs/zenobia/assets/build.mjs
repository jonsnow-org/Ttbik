// Builds the Zenobia placeholder images (SVG + PNG) used in the previews. Run: NODE_PATH=$(npm root -g) node build.mjs
import fs from "node:fs"; import crypto from "node:crypto"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const f = (n) => Number(n.toFixed(1));
const rng = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const GOLD = ["#fff0b8", "#e7b94f", "#9c6a22"];
const goldDefs = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GOLD[0]}"/><stop offset=".5" stop-color="${GOLD[1]}"/><stop offset="1" stop-color="${GOLD[2]}"/></linearGradient>`;

// coin-style medallion: gold profile bust of a crowned queen facing right (placeholder for the real portrait)
function medallion(size = 512) {
  const r = rng(3);
  let g = `<defs>${goldDefs("gd")}<radialGradient id="bgm" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#3a2a5a"/><stop offset="1" stop-color="#0b0c22"/></radialGradient></defs>
  <rect width="400" height="400" fill="url(#bgm)"/><circle cx="200" cy="200" r="188" fill="none" stroke="url(#gd)" stroke-width="6"/>`;
  for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; g += `<circle cx="${f(200 + Math.cos(a) * 172)}" cy="${f(200 + Math.sin(a) * 172)}" r="${i % 6 === 0 ? 3.2 : 1.8}" fill="url(#gd)"/>`; }
  // shoulders + drape
  g += `<path d="M96 392 C104 330 140 318 168 312 L238 312 C268 322 296 336 306 392 Z" fill="url(#gd)"/>`;
  g += `<path d="M120 392 C130 350 160 338 186 332" fill="none" stroke="#7a4f18" stroke-width="2" opacity=".6"/><path d="M150 392 C158 362 176 350 198 346" fill="none" stroke="#7a4f18" stroke-width="2" opacity=".5"/>`;
  // neck + head profile (facing right)
  g += `<path d="M172 318 C176 296 170 282 160 268 C132 246 126 196 150 162 C176 128 238 120 266 156 C274 168 276 182 274 194 C284 206 296 218 294 230 C290 238 280 240 278 244 C282 252 280 258 274 262 C278 270 274 278 266 284 C262 296 252 304 240 308 L236 322 Z" fill="url(#gd)"/>`;
  // hair bun + braid
  g += `<circle cx="140" cy="214" r="36" fill="url(#gd)"/><path d="M122 196 C140 188 154 196 160 210 M118 214 C138 208 152 216 156 230 M122 232 C138 230 148 238 150 250" fill="none" stroke="#7a4f18" stroke-width="2" opacity=".6"/>`;
  // diadem (as on her coins) with jewels
  g += `<path d="M146 170 C170 134 238 128 270 162" fill="none" stroke="#fff0b8" stroke-width="8" stroke-linecap="round"/><path d="M146 170 C170 134 238 128 270 162" fill="none" stroke="#9c6a22" stroke-width="2"/>`;
  for (const [x, y] of [[170, 150], [196, 140], [222, 138], [246, 146]]) g += `<circle cx="${x}" cy="${y}" r="6" fill="#c0392b" stroke="#fff0b8" stroke-width="2"/>`;
  // crown crest
  g += `<path d="M168 148 l8 -34 l16 24 l12 -34 l12 34 l16 -24 l8 30 z" fill="url(#gd)" stroke="#9c6a22" stroke-width="1.5"/>`;
  // eye + earring
  g += `<path d="M246 196 q10 -6 20 0" fill="none" stroke="#5a3a10" stroke-width="3" stroke-linecap="round"/><circle cx="170" cy="236" r="7" fill="#fff0b8" stroke="#9c6a22" stroke-width="2"/><path d="M170 243 v18" stroke="#fff0b8" stroke-width="3"/>`;
  g += `<text x="200" y="386" text-anchor="middle" font-family="Reem Kufi, serif" font-size="22" fill="#fff0b8" opacity=".9">ZENOBIA · زنوبيا</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 400 400">${g}</svg>`;
}

const STAGES = [
  { id: "1-child", ar: "طفلة", en: "CHILD", col: "#9fd0c4", bg: ["#0e1030", "#1f3a5a"] },
  { id: "2-queen", ar: "ملكة", en: "QUEEN", col: "#f2d27a", bg: ["#0e1030", "#3a2a5a"] },
  { id: "3-warrior", ar: "محاربة", en: "WARRIOR", col: "#e08a4d", bg: ["#1a0e1e", "#5a2a2a"] },
  { id: "4-captive", ar: "أسيرة", en: "CAPTIVE", col: "#8a8aa0", bg: ["#101018", "#2a2a38"] },
  { id: "5-legend", ar: "خلود", en: "LEGEND", col: "#f4ecda", bg: ["#050510", "#14143a"] },
];
function emblem(id, c) {
  if (id.includes("child")) return `<g fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"><path d="M160 300 V230"/><path d="M160 250 q-34 -6 -40 -40 q34 2 40 40"/><path d="M160 238 q34 -6 40 -40 q-34 2 -40 40"/></g><circle cx="160" cy="170" r="6" fill="${c}"/><rect x="120" y="300" width="80" height="6" fill="${c}"/>`;
  if (id.includes("queen")) return `<g fill="${c}"><path d="M95 250 l18 -70 l30 40 l17 -60 l17 60 l30 -40 l18 70 z"/><rect x="95" y="254" width="130" height="14"/></g><circle cx="113" cy="176" r="6" fill="${c}"/><circle cx="160" cy="146" r="7" fill="${c}"/><circle cx="207" cy="176" r="6" fill="${c}"/>`;
  if (id.includes("warrior")) return `<g fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"><path d="M115 130 V260 Q115 300 160 320 Q205 300 205 260 V130 Z"/><path d="M160 150 V300"/><path d="M130 200 H190"/></g><path d="M230 120 L270 320" stroke="${c}" stroke-width="5" stroke-linecap="round"/><path d="M226 134 l18 -22 l12 28 z" fill="${c}"/>`;
  if (id.includes("captive")) return `<g fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"><path d="M120 300 V210 l-10 -26 h24"/><path d="M200 300 V180"/></g><rect x="100" y="300" width="120" height="6" fill="${c}"/><g fill="none" stroke="${c}" stroke-width="4"><ellipse cx="160" cy="236" rx="16" ry="10"/><ellipse cx="184" cy="248" rx="16" ry="10"/><ellipse cx="136" cy="248" rx="16" ry="10"/></g>`;
  return `<g fill="${c}"><path d="M160 120 l9 28 h30 l-24 18 l9 29 l-24 -18 l-24 18 l9 -29 l-24 -18 h30 z"/></g><g fill="none" stroke="${c}" stroke-width="2" opacity=".6"><circle cx="160" cy="165" r="62"/><circle cx="160" cy="165" r="86"/></g><rect x="110" y="300" width="100" height="5" fill="${c}"/>`;
}
function passport(st, i) {
  const r = rng(11 + i); let g = `<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${st.bg[0]}"/><stop offset="1" stop-color="${st.bg[1]}"/></linearGradient></defs><rect width="320" height="440" fill="url(#lg)"/>`;
  for (let k = 0; k < (i === 4 ? 90 : 36); k++) g += `<circle cx="${f(r() * 320)}" cy="${f(r() * 260)}" r="${f(.5 + r() * (i === 4 ? 1.8 : 1))}" fill="#f4ecda" opacity="${f(.2 + r() * .7)}"/>`;
  g += emblem(st.id, st.col);
  g += `<text x="160" y="372" text-anchor="middle" font-family="Reem Kufi, sans-serif" font-size="26" fill="${st.col}">${st.ar}</text><text x="160" y="398" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="#bdb7d6">${st.en}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100" viewBox="0 0 320 440">${g}</svg>`;
}
function skyline() {
  const W = 800, H = 300, n = 36, r = rng(7), base = H - 36;
  let g = `<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e1030"/><stop offset=".7" stop-color="#4a2c5c"/><stop offset="1" stop-color="#c98b4b"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sg)"/><circle cx="640" cy="${base - 10}" r="46" fill="#f3d68a" opacity=".85"/>`;
  for (let i = 0; i < 50; i++) g += `<circle cx="${f(r() * W)}" cy="${f(r() * 120)}" r="${f(.5 + r())}" fill="#f4ecda" opacity="${f(.2 + r() * .6)}"/>`;
  for (let i = 0; i < n; i++) { const h0 = Math.max(10, (0.15 + Math.pow(r(), 1.8) * 0.85) * 190 * 0.6), x = 24 + i * 21.2, mine = i === 7, c = mine ? "#f2c35a" : "#e9d9b4";
    g += `<rect x="${f(x)}" y="${f(base - h0)}" width="14" height="${f(h0)}" fill="${c}"/><rect x="${f(x - 3)}" y="${f(base - h0 - 5)}" width="20" height="5" fill="${c}"/>`; }
  g += `<rect x="0" y="${base}" width="${W}" height="${H - base}" fill="#2a1a3a"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}
function seal() {
  const b = Array.from(crypto.createHash("sha256").update('{"season":3,"scores":[["UQBt..JSz",812],["UQDI..w7",640],["EQC_..Pv",455],["UQAa..9k",301]]}').digest());
  const hue = Math.round(b[0] / 255 * 60 + 20); let g = `<rect width="320" height="320" fill="#0e1030"/>`; const c = 160;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, len = 36 + (b[i] / 255) * 52, th = 3 + (b[16 + i] / 255) * 5;
    const x1 = c + Math.cos(a) * 58, y1 = c + Math.sin(a) * 58, x2 = c + Math.cos(a) * (58 + len), y2 = c + Math.sin(a) * (58 + len);
    g += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="hsl(${hue + i * 3},70%,${55 + (b[i] % 20)}%)" stroke-width="${f(th)}" stroke-linecap="round"/><circle cx="${f(x2)}" cy="${f(y2)}" r="${f(2 + (b[(i + 8) % 32] / 255) * 5)}" fill="#f4ecda"/>`; }
  for (let k = 0; k < 3; k++) g += `<circle cx="${c}" cy="${c}" r="${46 - k * 12}" fill="none" stroke="hsl(${hue},70%,${60 - k * 8}%)" stroke-width="${2 + (b[28 + k] % 3)}" opacity="${.9 - k * .2}"/>`;
  g += `<text x="${c}" y="${c + 7}" text-anchor="middle" font-family="Reem Kufi, sans-serif" font-size="22" fill="#f4ecda">Z</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 320 320">${g}</svg>`;
}
function banner() { // Blum banner 361x119 (drawn at 3x)
  const r = rng(5); let g = `<defs>${goldDefs("gb")}<linearGradient id="bb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0e1030"/><stop offset="1" stop-color="#3a2a5a"/></linearGradient></defs><rect width="361" height="119" fill="url(#bb)"/>`;
  for (let i = 0; i < 40; i++) g += `<circle cx="${f(r() * 361)}" cy="${f(r() * 70)}" r="${f(.4 + r())}" fill="#f4ecda" opacity="${f(.2 + r() * .6)}"/>`;
  for (let i = 0; i < 9; i++) { const x = 190 + i * 18, h = 24 + ((i * 37) % 26); g += `<rect x="${x}" y="${100 - h}" width="9" height="${h}" fill="url(#gb)"/><rect x="${x - 2}" y="${95 - h}" width="13" height="4" fill="url(#gb)"/>`; }
  g += `<rect x="0" y="100" width="361" height="19" fill="#1a1230"/><text x="20" y="58" font-family="Reem Kufi, serif" font-size="34" fill="url(#gb)">ZENOBIA</text><text x="20" y="82" font-family="Reem Kufi, serif" font-size="20" fill="#f4ecda">زنوبيا · ملكة تدمر</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1083" height="357" viewBox="0 0 361 119">${g}</svg>`;
}

const files = [
  ["01-coin-icon-512", medallion(512), 512, 512],
  ["02-channel-avatar-512", medallion(512), 512, 512],
  ["03-blum-banner-361x119", banner(), 1083, 357],
  ...STAGES.map((s, i) => [`04-passport-${s.id}`, passport(s, i), 800, 1100]),
  ["05-skyline-1600x600", skyline(), 1600, 600],
  ["06-season-seal-1000", seal(), 1000, 1000],
];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
const FONTS = '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=Reem+Kufi:wght@500;700&display=swap" rel="stylesheet">';
for (const [name, svg, w, h] of files) {
  fs.writeFileSync(`${name}.svg`, svg);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><meta charset=utf-8>${FONTS}<style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${name}.png`, omitBackground: false });
}
await browser.close();
console.log(files.map((x) => x[0]).join("\n"));
