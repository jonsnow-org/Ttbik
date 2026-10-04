// Original artwork for the special dates, drawn in code (no photographs, no logos, nobody's rights). Every scene is light
// shapes on a dark ground: the brightness is what the waxed-gold treatment turns into metal. The two Syrian dates add an
// overlay (the revolution flag in its real colours) that is drawn AFTER the gold step so its colours stay readable.
import { ymd } from "./dates";

const W = "#f4f1ea", L = "#cfc9bc", M = "#948e82", D = "#5a564e", K = "#1b1a18";
const P = (n: number) => n.toFixed(1);
const star = (cx: number, cy: number, R: number, rot = -90, points = 5, inner = 0.382) => {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const a = ((rot + (i * 180) / points) * Math.PI) / 180, r = i % 2 ? R * inner : R;
    d += `${i ? "L" : "M"}${P(cx + Math.cos(a) * r)} ${P(cy + Math.sin(a) * r)}`;
  }
  return `<path d="${d}Z" fill="${W}"/>`;
};
const circ = (cx: number, cy: number, r: number, fill = W, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const ln = (x1: number, y1: number, x2: number, y2: number, w = 6, c = W) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
const path = (d: string, fill = W, extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;
const ring = (cx: number, cy: number, r: number, w = 6, c = W) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
const rect = (x: number, y: number, w: number, h: number, fill = W, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const earth = (cx: number, cy: number, r: number) =>
  `${circ(cx, cy, r, L)}${path(`M${cx - r * 0.6} ${cy - r * 0.2}c${r * 0.2} ${-r * 0.5} ${r * 0.7} ${-r * 0.5} ${r * 0.8} ${-r * 0.1}c${-r * 0.1} ${r * 0.4} ${-r * 0.5} ${r * 0.5} ${-r * 0.8} ${r * 0.1}Z`, M)}${path(`M${cx + r * 0.1} ${cy + r * 0.3}c${r * 0.3} ${-r * 0.1} ${r * 0.5} ${r * 0.1} ${r * 0.3} ${r * 0.4}c${-r * 0.2} ${r * 0.1} ${-r * 0.4} ${-r * 0.1} ${-r * 0.3} ${-r * 0.4}Z`, M)}${ring(cx, cy, r, 4, W)}`;
const moon = (cx: number, cy: number, r: number) =>
  `${circ(cx, cy, r, L)}${circ(cx - r * 0.3, cy - r * 0.25, r * 0.22, M)}${circ(cx + r * 0.35, cy + r * 0.1, r * 0.3, M)}${circ(cx - r * 0.1, cy + r * 0.45, r * 0.16, M)}${ring(cx, cy, r, 4, W)}`;
const stars = (n: number, seed: number) => {
  let s = "", x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; const a = x % 800; x = (x * 1103515245 + 12345) & 0x7fffffff; const b = x % 800; s += circ(a, b, 1 + (x % 3) * 0.6, W, `opacity="0.${5 + (x % 5)}"`); }
  return s;
};
const rocket = (cx: number, cy: number, s = 1, flame = true) => `<g transform="translate(${cx} ${cy}) scale(${s})">${path("M0 -190C50 -130 60 -40 52 70L-52 70C-60 -40 -50 -130 0 -190Z", W)}${circ(0, -70, 26, K)}${ring(0, -70, 26, 5, M)}${path("M-52 20L-110 110L-52 80Z", L)}${path("M52 20L110 110L52 80Z", L)}${flame ? path("M-30 76Q0 190 30 76Z", M) : ""}</g>`;
const hex = (cx: number, cy: number, r: number, fill = W) => { let d = ""; for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; d += `${i ? "L" : "M"}${P(cx + Math.cos(a) * r)} ${P(cy + Math.sin(a) * r)}`; } return `<path d="${d}Z" fill="${fill}" stroke="${K}" stroke-width="4"/>`; };
const bricks = (x: number, y: number, w: number, h: number, bw = 54, bh = 26, skip?: (cx: number, cy: number) => boolean) => {
  let s = "";
  for (let r = 0; r * bh < h; r++) for (let c = -1; c * bw < w; c++) {
    const bx = x + c * bw + (r % 2 ? bw / 2 : 0), by = y + r * bh;
    const x0 = Math.max(x, bx), x1 = Math.min(x + w, bx + bw - 4), y1 = Math.min(y + h, by + bh - 4);
    if (x1 <= x0 || y1 <= by) continue;
    if (skip && skip((x0 + x1) / 2, (by + y1) / 2)) continue;
    s += rect(x0, by, x1 - x0, y1 - by, (r + c) % 3 ? L : M, 2);
  }
  return s;
};
const sine = (x0: number, x1: number, y: number, amp: number, wl: number, ph = 0) => { let d = ""; for (let x = x0; x <= x1; x += 6) d += `${x === x0 ? "M" : "L"}${x} ${P(y + Math.sin(((x + ph) / wl) * Math.PI * 2) * amp)}`; return d; };

type Motif = () => string;
const MOTIFS: Record<string, Motif> = {
  football: () => {
    let s = circ(400, 400, 150, W) + ring(400, 400, 150, 6, M);
    s += star(400, 400, 52, -90, 5, 0.809).replace(W, K);
    for (let i = 0; i < 5; i++) { const a = (-90 + i * 72) * Math.PI / 180; s += star(400 + Math.cos(a) * 118, 400 + Math.sin(a) * 118, 30, -90 + i * 72, 5, 0.809).replace(W, K); s += ln(400 + Math.cos(a) * 52, 400 + Math.sin(a) * 52, 400 + Math.cos(a) * 100, 400 + Math.sin(a) * 100, 4, M); }
    return s;
  },
  trophy: () => path("M300 230H500V300C500 380 450 420 400 420C350 420 300 380 300 300Z", W) + path("M300 250C230 250 230 340 310 350M500 250C570 250 570 340 490 350", "none", `stroke="${W}" stroke-width="14"`) + rect(385, 420, 30, 70, L) + path("M320 560V520Q320 490 360 490H440Q480 490 480 520V560Z", W) + rect(300, 560, 200, 26, L, 6) + star(400, 320, 38),
  torch: () => path("M350 330L450 330L420 560L380 560Z", L) + rect(330, 300, 140, 36, W, 8) + path("M400 130C470 210 480 260 430 300C440 250 400 240 400 200C380 240 340 260 360 300C320 260 330 190 400 130Z", W) + path("M400 200C430 240 430 270 405 290C380 270 380 240 400 200Z", M),
  satellite: () => circ(400, 400, 60, W) + ring(400, 400, 60, 5, M) + [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ln(400 + a * 40, 400 + b * 40, 400 + a * 230, 400 + b * 120, 5)).join("") + circ(400, 400, 20, M),
  panelsat: () => rect(350, 340, 100, 120, W, 10) + [[200, 350], [450, 350]].map(([x, y]) => rect(x, y, 150, 100, L, 4) + [1, 2, 3].map((i) => ln(x + i * 37, y, x + i * 37, y + 100, 3, K)).join("") + ln(x, y + 50, x + 150, y + 50, 3, K)).join("") + ln(400, 340, 400, 270, 6) + circ(400, 262, 14, W),
  capsule: () => stars(80, 3) + path("M340 330H460L520 520H280Z", W) + path("M340 330C340 270 460 270 460 330Z", L) + circ(400, 420, 26, K) + ring(400, 420, 26, 5, M) + path("M280 520Q400 570 520 520Z", M) + path("M300 540Q400 700 500 540Q400 600 300 540Z", L),
  orbit: () => stars(60, 11) + earth(400, 420, 130) + `<ellipse cx="400" cy="420" rx="230" ry="80" fill="none" stroke="${W}" stroke-width="5" stroke-dasharray="3 12" transform="rotate(-24 400 420)"/>` + path("M590 330l30 -18 18 30 -30 18Z", W),
  shuttle: () => stars(50, 5) + path("M400 140C450 200 455 330 450 500H350C345 330 350 200 400 140Z", W) + path("M350 380L250 540L350 500Z", L) + path("M450 380L550 540L450 500Z", L) + rect(370, 220, 60, 30, K, 10) + path("M360 500H440L460 560H340Z", M) + path("M370 560Q400 690 430 560Z", L),
  moonlander: () => stars(60, 9) + moon(400, 560, 340).replace(/stroke-width="4"/g, 'stroke-width="3"') + path("M350 400H450L470 450H330Z", K, `stroke="${W}" stroke-width="6"`) + rect(360, 356, 80, 48, K, 14).replace("/>", ` stroke="${W}" stroke-width="6"/>`) + ln(340, 450, 295, 530, 8, W) + ln(460, 450, 505, 530, 8, W) + rect(268, 528, 54, 10, W) + rect(478, 528, 54, 10, W) + ln(400, 356, 400, 320, 5, W) + circ(400, 314, 8, W),
  earthrise: () => stars(70, 21) + earth(520, 250, 90) + path("M0 560Q400 470 800 560V800H0Z", L) + circ(220, 640, 40, M) + circ(430, 700, 26, M) + circ(610, 620, 34, M),
  hexscope: () => { let s = ""; const pts = [[0, 0], [1, 0], [-1, 0], [0.5, 0.87], [-0.5, 0.87], [0.5, -0.87], [-0.5, -0.87]]; for (const [a, b] of pts) s += hex(400 + a * 104, 400 + b * 104, 54, b === 0 && a === 0 ? W : L); return stars(40, 17) + s; },
  rover: () => stars(30, 4) + rect(300, 400, 220, 70, W, 12) + ln(480, 400, 480, 320, 8) + rect(455, 290, 56, 34, L, 6) + circ(300, 520, 34, W) + circ(400, 530, 34, W) + circ(510, 520, 34, W) + circ(300, 520, 14, M) + circ(400, 530, 14, M) + circ(510, 520, 14, M) + ln(300, 470, 300, 500, 6, M) + path("M200 560Q400 520 620 560V620H200Z", M),
  probe: () => path("M400 250C310 250 260 320 260 380L540 380C540 320 490 250 400 250Z", W) + `<ellipse cx="400" cy="380" rx="140" ry="30" fill="${L}"/>` + rect(380, 380, 40, 110, L) + ln(400, 250, 400, 150, 6) + circ(400, 144, 10) + ln(420, 450, 620, 520, 8) + circ(630, 524, 12, M),
  station: () => stars(40, 8) + rect(250, 392, 300, 16, W) + rect(370, 360, 60, 80, L, 8) + [[170, 330], [170, 430], [560, 330], [560, 430]].map(([x, y]) => rect(x, y, 70, 40, L, 3) + ln(x + 35, y, x + 35, y + 40, 2, K)).join("") + ln(250, 400, 240, 400, 8) + ln(550, 400, 560, 400, 8),
  jet: () => stars(10, 2).replace(/<circle/g, "<circle") + path("M130 400L650 395Q690 400 650 405L340 440L250 470L330 410Z", W) + path("M340 395L260 330L420 380Z", L) + path("M610 398L650 330L640 400Z", L) + path("M640 395L720 400L640 405Z", M),
  atom: () => circ(400, 400, 36, W) + [0, 60, 120].map((r) => `<ellipse cx="400" cy="400" rx="190" ry="62" fill="none" stroke="${W}" stroke-width="6" transform="rotate(${r} 400 400)"/>`).join("") + [0, 60, 120].map((r) => circ(400 + Math.cos((r * Math.PI) / 180) * 190, 400 + Math.sin((r * Math.PI) / 180) * 190 * 0.0 + (r === 60 ? 0 : 0), 14, L)).join(""),
  dna: () => { let a = "", b = "", rungs = ""; for (let y = 150; y <= 650; y += 6) { const t = (y / 100) * Math.PI; const x1 = 400 + Math.sin(t) * 90, x2 = 400 - Math.sin(t) * 90; a += `${y === 150 ? "M" : "L"}${P(x1)} ${y}`; b += `${y === 150 ? "M" : "L"}${P(x2)} ${y}`; if (((y - 150) / 6) % 8 === 0) rungs += ln(P(x1) as unknown as number, y, P(x2) as unknown as number, y, 4, M); } return path(a, "none", `stroke="${W}" stroke-width="10" stroke-linecap="round"`) + path(b, "none", `stroke="${L}" stroke-width="10" stroke-linecap="round"`) + rungs; },
  cells: () => [[330, 340, 80], [470, 360, 70], [400, 480, 90], [300, 500, 50]].map(([x, y, r]) => circ(x, y, r, L) + ring(x, y, r, 5, W) + circ(x + r * 0.15, y - r * 0.1, r * 0.3, M)).join(""),
  network: () => { const pts: [number, number][] = [[400, 400], [250, 280], [560, 270], [610, 450], [450, 590], [260, 520], [180, 400]]; let s = ""; pts.slice(1).forEach(([x, y], i) => { s += ln(400, 400, x, y, 4, M) + ln(x, y, pts[((i + 1) % 6) + 1][0], pts[((i + 1) % 6) + 1][1], 3, M); }); return s + pts.map(([x, y], i) => circ(x, y, i ? 26 : 40, i ? L : W)).join(""); },
  globeweb: () => ring(400, 400, 190, 8) + `<ellipse cx="400" cy="400" rx="90" ry="190" fill="none" stroke="${W}" stroke-width="5"/>` + ln(210, 400, 590, 400, 5) + `<ellipse cx="400" cy="400" rx="190" ry="90" fill="none" stroke="${L}" stroke-width="4"/>` + ln(400, 210, 400, 590, 5) + ring(400, 400, 190, 3, M),
  chip: () => rect(300, 300, 200, 200, W, 16) + rect(340, 340, 120, 120, K, 8) + [0, 1, 2, 3, 4].map((i) => rect(318 + i * 40, 260, 16, 38, L) + rect(318 + i * 40, 502, 16, 38, L) + rect(260, 318 + i * 40, 38, 16, L) + rect(502, 318 + i * 40, 38, 16, L)).join("") + circ(400, 400, 28, W),
  coin: () => circ(400, 400, 190, W) + ring(400, 400, 170, 8, M) + ring(400, 400, 150, 3, D) + `<text x="400" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="210" font-weight="700" fill="${K}">₿</text>`,
  euro: () => circ(400, 400, 190, W) + ring(400, 400, 170, 8, M) + `<text x="400" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="230" font-weight="700" fill="${K}">€</text>`,
  blocks: () => [[250, 450], [400, 450], [550, 450], [325, 320], [475, 320], [400, 190]].map(([x, y], i) => rect(x - 60, y - 60, 120, 120, i % 2 ? L : W, 10) + ring(x, y, 22, 4, M)).join("") + ln(250, 450, 325, 320, 4, M) + ln(325, 320, 400, 190, 4, M) + ln(400, 190, 475, 320, 4, M) + ln(475, 320, 550, 450, 4, M),
  diamond: () => path("M400 130L560 400L400 480L240 400Z", W) + path("M400 130L240 400L400 480Z", L) + path("M400 510L560 430L400 670L240 430Z", M) + path("M400 510L240 430L400 670Z", D),
  chat: () => path("M240 260Q240 220 280 220H520Q560 220 560 260V430Q560 470 520 470H400L300 560V470H280Q240 470 240 430Z", W) + [0, 1, 2].map((i) => circ(330 + i * 70, 345, 20, K)).join(""),
  paperplane: () => path("M170 420L620 220L520 600L400 480Z", W) + path("M400 480L620 220L360 520Z", L) + path("M360 520L400 480L390 600Z", M),
  book: () => path("M400 250Q300 200 180 230V560Q300 530 400 580Z", W) + path("M400 250Q500 200 620 230V560Q500 530 400 580Z", L) + [0, 1, 2, 3].map((i) => ln(230, 300 + i * 50, 370, 320 + i * 45, 4, M) + ln(430, 320 + i * 45, 570, 300 + i * 50, 4, M)).join("") + star(400, 160, 28),
  mic: () => rect(350, 180, 100, 190, W, 50) + path("M310 300Q310 430 400 430Q490 430 490 300", "none", `stroke="${W}" stroke-width="14"`) + ln(400, 430, 400, 540, 14) + rect(330, 540, 140, 24, L, 10) + [0, 1, 2, 3].map((i) => ln(360, 215 + i * 36, 440, 215 + i * 36, 3, K)).join(""),
  gate: () => rect(190, 250, 420, 320, L) + path("M270 570V380Q270 280 400 280Q530 280 530 380V570Z", K) + path("M270 570V380Q270 300 320 285L320 560Z", W) + path("M530 570V380Q530 300 480 285L480 560Z", W) + ln(400, 280, 400, 570, 4, M),
  arch: () => rect(180, 230, 440, 50, W) + rect(190, 190, 420, 40, L) + path("M360 190l40 -60 40 60Z", W) + [0, 1, 2, 3, 4, 5].map((i) => rect(200 + i * 72, 280, 40, 290, i % 2 ? L : W)).join("") + rect(170, 570, 460, 30, M),
  wall: () => stars(20, 7) + bricks(150, 260, 500, 300),
  wallbreak: () => { const sk = (x: number, y: number) => (x - 400) ** 2 / 140 ** 2 + (y - 410) ** 2 / 120 ** 2 < 1; let rays = ""; for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; rays += ln(400, 410, 400 + Math.cos(a) * 260, 410 + Math.sin(a) * 210, 3, M); } return rays + bricks(150, 260, 500, 300, 54, 26, sk) + circ(400, 410, 54, W, 'opacity="0.9"'); },
  tunnel: () => [0, 1, 2, 3, 4].map((i) => path(`M${200 + i * 30} 600V${380 - i * 14}Q${200 + i * 30} ${210 + i * 24} 400 ${210 + i * 24}Q${600 - i * 30} ${210 + i * 24} ${600 - i * 30} ${380 - i * 14}V600Z`, i % 2 ? L : D, `stroke="${W}" stroke-width="4"`)).join("") + rect(380, 400, 40, 200, W),
  mountain: () => stars(30, 6) + path("M100 620L330 220L470 440L560 330L720 620Z", M) + path("M330 220L430 390L370 380L330 440L280 380L240 390Z", W) + path("M560 330L620 430L560 410L520 440Z", L) + ln(330, 220, 330, 160, 5) + path("M332 160L380 176L332 192Z", W),
  leafearth: () => earth(400, 400, 150) + path("M180 560C140 440 250 380 330 440C300 500 260 560 180 560Z", W) + path("M620 560C660 440 550 380 470 440C500 500 540 560 620 560Z", L) + ln(190, 555, 290, 470, 4, K) + ln(610, 555, 510, 470, 4, K),
  wave: () => stars(15, 12) + path(sine(100, 700, 420, 40, 300) + "V640H100Z", M) + path("M120 600C130 340 330 190 560 270C500 280 470 330 500 380C520 420 600 440 680 560V600Z", W) + path("M180 600C190 400 330 300 520 330C470 350 450 390 480 430C510 470 580 500 640 600Z", L) + circ(240, 190, 44, L),
  flame: () => path("M400 130C490 250 540 330 500 460C480 520 430 560 400 560C300 560 250 470 290 390C310 440 340 440 350 400C330 300 360 230 400 130Z", W) + path("M400 330C450 400 470 460 430 510C410 535 390 535 380 520C340 480 360 400 400 330Z", L) + path("M400 440C425 470 430 500 410 520C395 530 380 520 380 500C380 480 390 460 400 440Z", M),
  heart: () => path("M400 560C260 450 190 380 190 300C190 230 240 190 295 190C340 190 380 215 400 255C420 215 460 190 505 190C560 190 610 230 610 300C610 380 540 450 400 560Z", W) + `<polyline points="230,340 330,340 370,260 430,430 470,340 570,340" fill="none" stroke="${K}" stroke-width="10" stroke-linejoin="round"/>`,
  shield: () => path("M400 160L580 220V380C580 500 490 560 400 610C310 560 220 500 220 380V220Z", W) + path("M400 160L580 220V380C580 500 490 560 400 610Z", L) + rect(380, 270, 40, 190, K, 6) + rect(305, 345, 190, 40, K, 6),
  virus: () => { let s = circ(400, 400, 110, W) + circ(370, 370, 18, M) + circ(430, 420, 24, M) + circ(405, 345, 12, M); for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; s += ln(400 + Math.cos(a) * 110, 400 + Math.sin(a) * 110, 400 + Math.cos(a) * 170, 400 + Math.sin(a) * 170, 8, L) + circ(400 + Math.cos(a) * 180, 400 + Math.sin(a) * 180, 14, W); } return s; },
  blackhole: () => stars(60, 31) + `<ellipse cx="400" cy="400" rx="260" ry="70" fill="none" stroke="${W}" stroke-width="30" opacity="0.55" transform="rotate(-18 400 400)"/>` + `<ellipse cx="400" cy="400" rx="220" ry="52" fill="none" stroke="${L}" stroke-width="16" transform="rotate(-18 400 400)"/>` + circ(400, 400, 100, K) + ring(400, 400, 100, 8, W),
  galaxy: () => { let s = ""; for (let i = 0; i < 320; i++) { const t = i / 320, a = t * 14, r = 12 + t * 210; for (const o of [0, Math.PI]) s += circ(P(400 + Math.cos(a + o) * r) as unknown as number, P(400 + Math.sin(a + o) * r * 0.78) as unknown as number, 1.5 + (1 - t) * 3, t < 0.5 ? W : L, `opacity="${(1 - t * 0.6).toFixed(2)}"`); } return s + circ(400, 400, 28, W); },
  ringstars: () => { let s = ""; for (let i = 0; i < 12; i++) { const a = (-90 + i * 30) * Math.PI / 180; s += star(400 + Math.cos(a) * 170, 400 + Math.sin(a) * 170, 34, -90, 5, 0.4); } return s + ring(400, 400, 80, 6, M) + circ(400, 400, 26, L); },
  ballot: () => rect(230, 380, 340, 200, W, 14) + rect(350, 360, 100, 14, K) + path("M330 190H470V380H330Z", L) + path("M360 290l30 30 60 -70", "none", `stroke="${K}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"`) + rect(400 - 8, 430, 16, 100, K),
  bird: () => path("M120 330C260 360 330 330 400 420C470 330 540 360 680 330C600 450 500 470 440 520L400 640L360 520C300 470 200 450 120 330Z", W) + path("M400 420C440 380 500 360 560 360C500 400 460 420 440 470Z", L) + circ(400, 470, 12, K),
  sheep: () => [[300, 400, 80], [390, 360, 90], [490, 400, 80], [400, 450, 90], [330, 460, 60], [470, 460, 60]].map(([x, y, r]) => circ(x, y, r, W) + ring(x, y, r, 3, M)).join("") + path("M560 380C620 380 650 430 620 480C590 500 560 470 550 430Z", K) + circ(590, 430, 8, W) + ln(330, 520, 330, 600, 12, K) + ln(470, 520, 470, 600, 12, K),
  magnifier: () => ring(360, 360, 130, 24) + circ(360, 360, 110, L, 'opacity="0.35"') + ln(455, 455, 620, 620, 38) + path("M300 320Q340 270 400 290", "none", `stroke="${W}" stroke-width="10" stroke-linecap="round"`),
  bus: () => rect(170, 290, 460, 230, W, 36) + [0, 1, 2, 3].map((i) => rect(210 + i * 100, 330, 74, 80, K, 8)).join("") + rect(210, 440, 380, 18, M) + circ(280, 540, 46, K) + circ(520, 540, 46, K) + ring(280, 540, 46, 8, W) + ring(520, 540, 46, 8, W) + rect(170, 290, 460, 24, L, 12),
  guitar: () => `<g transform="rotate(35 400 400)">${path("M400 330C340 330 310 380 340 430C290 460 290 540 360 560C420 580 500 560 500 500C500 460 470 440 470 430C500 400 470 330 400 330Z", W)}${circ(400, 470, 30, K)}${rect(386, 120, 28, 230, L)}${rect(370, 90, 60, 50, M, 8)}${[0, 1, 2, 3, 4].map((i) => ln(388 + i * 6, 130, 388 + i * 6, 520, 2, K)).join("")}</g>`,
  music: () => circ(300, 540, 56, W) + circ(520, 500, 56, W) + rect(340, 210, 16, 330, W) + rect(560, 170, 16, 330, W) + path("M340 210L576 170V240L340 280Z", L),
  phone: () => rect(280, 150, 240, 440, W, 40) + rect(305, 205, 190, 320, K, 12) + circ(400, 560, 18, K) + ln(320, 260, 480, 260, 6, M) + ln(320, 310, 440, 310, 6, M) + [0, 1, 2].map((i) => `<path d="M${560 + i * 22} ${250 - i * 22}Q${590 + i * 30} ${300} ${560 + i * 22} ${350 + i * 22}" fill="none" stroke="${W}" stroke-width="8" stroke-linecap="round"/>`).join(""),
  chartdown: () => ln(190, 190, 190, 600, 10) + ln(190, 600, 640, 600, 10) + `<polyline points="230,280 330,360 410,330 530,470 600,520" fill="none" stroke="${W}" stroke-width="16" stroke-linejoin="round"/>` + path("M640 560L560 540L600 480Z", L) + [0, 1, 2, 3].map((i) => rect(240 + i * 110, 560 - 30 * (4 - i), 50, 30 * (4 - i), M)).join(""),
  stopwatch: () => ring(400, 430, 170, 22) + rect(380, 190, 40, 50, W, 6) + rect(350, 160, 100, 24, L, 8) + ln(400, 430, 400, 330, 10) + ln(400, 430, 480, 470, 8, L) + [0, 1, 2, 3].map((i) => ln(400 + Math.cos(i * 1.5708) * 135, 430 + Math.sin(i * 1.5708) * 135, 400 + Math.cos(i * 1.5708) * 155, 430 + Math.sin(i * 1.5708) * 155, 8)).join("") + circ(400, 430, 16, W),
  pizza: () => circ(400, 400, 190, W) + circ(400, 400, 172, L) + [[330, 330], [470, 340], [400, 440], [320, 470], [490, 480], [400, 280]].map(([x, y]) => circ(x, y, 26, M)).join("") + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ln(400, 400, 400 + Math.cos(i * 0.7854) * 172, 400 + Math.sin(i * 0.7854) * 172, 4, D)).join(""),
  comet: () => stars(40, 14) + circ(560, 260, 54, W) + circ(545, 245, 14, M) + path("M530 285C420 360 300 480 140 620C300 560 430 470 560 320Z", L) + path("M510 280C380 330 260 380 120 430C250 450 400 400 540 310Z", M),
  brokenstar: () => path("M400 160L450 340L640 340L490 450L545 630L400 520L255 630L310 450L160 340L350 340Z", W) + path("M400 160L350 340L310 450L255 630L400 520L420 420L380 360L420 300Z", L) + path("M400 130L370 300L410 360L380 440L420 560", "none", `stroke="${K}" stroke-width="12"`),
  crowd: () => [0, 1, 2, 3, 4, 5, 6].map((i) => circ(180 + i * 73, 440 + (i % 2) * 30, 34, i % 2 ? L : W) + path(`M${130 + i * 73} 620Q${180 + i * 73} 480 ${230 + i * 73} 620Z`, i % 2 ? L : W)).join("") + ln(500, 330, 500, 150, 8) + path("M504 150C560 130 590 190 650 170V270C590 290 560 230 504 250Z", W),
  falcon: () => path("M150 380C250 300 340 330 400 400C460 330 550 300 650 380C600 410 520 400 470 450L400 600L330 450C280 400 200 410 150 380Z", W) + path("M400 400L440 330L500 340L450 410Z", L) + circ(420, 400, 10, K) + path("M400 600L370 690L400 650L430 690Z", M),
  heartpulse: () => MOTIFS.heart(),
  // The two Syrian dates (scene only; the flag overlay is added in colour after the gold step)
  syria1: () => stars(40, 41) + lowered(path("M-200 640Q400 600 1000 640V900H-200Z", M) + omari(660, 640) + olive(200, 640)),
  syria2: () => stars(40, 43) + lowered(path("M-200 640Q400 610 1000 640V900H-200Z", M) + clocktower(660, 640) + oliveBranch(200, 560)),
};
// the Syrian scenes fill the picture; the revolution flag is only a small mark above them
const lowered = (inner: string) => `<g transform="translate(400 705) scale(0.95) translate(-400 -640)">${inner}</g>`;
function olive(cx: number, base: number): string {
  let s = path(`M${cx - 18} ${base}C${cx - 28} ${base - 90} ${cx - 50} ${base - 130} ${cx - 70} ${base - 190}L${cx - 40} ${base - 200}C${cx - 25} ${base - 160} ${cx - 8} ${base - 130} ${cx} ${base - 110}C${cx + 8} ${base - 150} ${cx + 30} ${base - 190} ${cx + 60} ${base - 210}L${cx + 76} ${base - 190}C${cx + 40} ${base - 150} ${cx + 28} ${base - 70} ${cx + 22} ${base}Z`, L);
  const blobs: [number, number, number][] = [[-70, -230, 62], [0, -270, 78], [74, -240, 66], [-120, -190, 48], [128, -190, 50], [10, -200, 58]];
  for (const [dx, dy, r] of blobs) s += `<ellipse cx="${cx + dx}" cy="${base + dy}" rx="${r * 1.25}" ry="${r * 0.8}" fill="${W}"/>`;
  for (let i = 0; i < 28; i++) { const a = i * 2.4; s += circ(P(cx + Math.cos(a) * (40 + (i % 5) * 22)) as unknown as number, P(base - 215 + Math.sin(a) * (30 + (i % 4) * 18)) as unknown as number, 5, M); }
  return s;
}
function oliveBranch(cx: number, cy: number): string {
  let s = path(`M${cx - 120} ${cy + 80}Q${cx + 20} ${cy - 20} ${cx + 160} ${cy - 90}`, "none", `stroke="${L}" stroke-width="10" stroke-linecap="round"`);
  for (let i = 0; i < 9; i++) {
    const t = i / 8, x = cx - 120 + t * 280, y = cy + 80 - t * 170 - Math.sin(t * Math.PI) * 30;
    s += `<ellipse cx="${P(x)}" cy="${P(y - 26)}" rx="12" ry="36" fill="${W}" transform="rotate(-25 ${P(x)} ${P(y - 26)})"/><ellipse cx="${P(x + 6)}" cy="${P(y + 28)}" rx="12" ry="36" fill="${L}" transform="rotate(35 ${P(x + 6)} ${P(y + 28)})"/>`;
    if (i % 3 === 1) s += circ(P(x - 14) as unknown as number, P(y + 6) as unknown as number, 10, M);
  }
  return s;
}
// Al-Omari Mosque, Daraa: a square minaret with a gallery and a small dome, beside the courtyard arches
function omari(cx: number, base: number): string {
  let s = rect(cx - 150, base - 150, 300, 150, L) + [0, 1, 2, 3, 4].map((i) => path(`M${cx - 135 + i * 56} ${base}V${base - 70}Q${cx - 107 + i * 56} ${base - 110} ${cx - 79 + i * 56} ${base - 70}V${base}Z`, K)).join("");
  s += rect(cx - 150, base - 162, 300, 14, W);
  s += rect(cx - 36, base - 400, 72, 250, W) + rect(cx - 46, base - 300, 92, 12, L) + [0, 1].map((i) => path(`M${cx - 18} ${base - 250 + i * -80}v-34q18 -26 36 0v34z`, K)).join("");
  s += rect(cx - 52, base - 420, 104, 22, L) + rect(cx - 28, base - 470, 56, 52, W) + path(`M${cx - 30} ${base - 470}Q${cx} ${base - 520} ${cx + 30} ${base - 470}Z`, L) + ln(cx, base - 520, cx, base - 560, 5) + circ(cx, base - 566, 8, W);
  return s;
}
// the clock tower of Homs: a stout tower with a clock face and a small cap
function clocktower(cx: number, base: number): string {
  let s = rect(cx - 62, base - 330, 124, 330, L) + rect(cx - 74, base - 30, 148, 30, W) + rect(cx - 70, base - 340, 140, 18, W);
  s += circ(cx, base - 240, 48, W) + ring(cx, base - 240, 48, 6, M) + ln(cx, base - 240, cx, base - 276, 5, K) + ln(cx, base - 240, cx + 24, base - 224, 5, K);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; s += circ(P(cx + Math.cos(a) * 40) as unknown as number, P(base - 240 + Math.sin(a) * 40) as unknown as number, 2, K); }
  s += rect(cx - 40, base - 150, 80, 60, K, 4) + path(`M${cx - 70} ${base - 340}L${cx} ${base - 440}L${cx + 70} ${base - 340}Z`, W) + ln(cx, base - 440, cx, base - 480, 5) + circ(cx, base - 486, 8, W);
  return s;
}

// The revolution flag (green, white, black; three red stars) drawn in its true colours, waving a little.
export function revolutionFlag(x: number, y: number, w = 300): string {
  const h = w * 0.62, id = `f${x}${y}`;
  const wavePath = (y0: number, y1: number) => `M${x} ${y + y0}` + Array.from({ length: 31 }, (_, i) => { const t = i / 30; return `L${P(x + t * w)} ${P(y + y0 + Math.sin(t * Math.PI * 2) * 9 * t)}`; }).join("") + Array.from({ length: 31 }, (_, i) => { const t = 1 - i / 30; return `L${P(x + t * w)} ${P(y + y1 + Math.sin(t * Math.PI * 2) * 9 * t)}`; }).join("") + "Z";
  const st = (cx: number, cy: number, R: number) => { let d = ""; for (let i = 0; i < 10; i++) { const a = ((-90 + i * 36) * Math.PI) / 180, r = i % 2 ? R * 0.382 : R; d += `${i ? "L" : "M"}${P(cx + Math.cos(a) * r)} ${P(cy + Math.sin(a) * r)}`; } return `<path d="${d}Z" fill="#ce1126"/>`; };
  const midY = (cx: number) => y + h / 2 + Math.sin(((cx - x) / w) * Math.PI * 2) * 9 * ((cx - x) / w);
  return `<g>${rect(x - 8, y - 14, 6, h + 130, "#d8d2c4", 3)}${circ(x - 5, y - 18, 6, "#d8d2c4")}` +
    `<path d="${wavePath(0, h / 3)}" fill="#007a3d"/><path d="${wavePath(h / 3, (2 * h) / 3)}" fill="#ffffff"/><path d="${wavePath((2 * h) / 3, h)}" fill="#000000"/>` +
    [0.3, 0.5, 0.7].map((t) => st(x + t * w, midY(x + t * w), h * 0.11)).join("") + `</g>`;
}

export const SCENE_BG = (uid = "s") => `<defs><radialGradient id="${uid}bg" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="#34302a"/><stop offset="1" stop-color="#0c0b0a"/></radialGradient></defs><rect width="800" height="800" fill="url(#${uid}bg)"/>`;

// date (YYYY-MM-DD) -> motif
const BY_DATE: Record<string, string> = {
  "1953-04-25": "dna", "1957-10-04": "satellite", "1961-04-12": "capsule", "1962-02-20": "orbit", "1963-08-28": "mic", "1969-07-20": "moonlander",
  "1969-10-29": "network", "1971-12-02": "falcon", "1976-04-01": "chip", "1977-05-25": "galaxy", "1981-04-12": "shuttle", "1985-07-13": "music",
  "1986-06-22": "football", "1989-03-12": "network", "1989-11-09": "wallbreak", "1990-02-11": "gate", "1990-04-24": "hexscope", "1990-10-03": "arch",
  "1991-08-06": "globeweb", "1993-04-30": "globeweb", "1997-06-26": "book", "1998-07-12": "football", "1998-09-04": "magnifier", "2008-10-31": "coin",
  "2009-01-03": "blocks", "2010-05-22": "pizza", "2012-07-04": "atom", "2013-08-14": "paperplane", "2015-07-30": "diamond", "2019-04-10": "blackhole",
  "2022-11-20": "football", "2022-12-18": "trophy",
  "1953-05-29": "mountain", "1954-05-06": "stopwatch", "1955-12-01": "bus", "1957-03-25": "ringstars", "1958-01-31": "panelsat", "1959-01-02": "orbit",
  "1961-08-13": "wall", "1962-07-10": "panelsat", "1964-10-10": "torch", "1965-03-18": "capsule", "1967-12-03": "heart", "1968-12-24": "earthrise",
  "1969-08-15": "guitar", "1970-04-22": "leafearth", "1970-06-21": "football", "1973-04-03": "phone", "1976-01-21": "jet", "1977-09-05": "probe",
  "1978-07-25": "cells", "1980-05-08": "shield", "1983-01-01": "network", "1986-01-28": "shuttle", "1986-04-26": "atom", "1991-12-26": "brokenstar",
  "1992-07-25": "torch", "1993-11-01": "ringstars", "1994-04-27": "ballot", "1994-05-06": "tunnel", "1996-07-05": "sheep", "1998-11-20": "station",
  "1999-01-01": "euro", "2008-08-08": "torch", "2008-09-15": "chartdown", "2010-12-17": "flame", "2011-03-11": "wave", "2011-03-15": "syria1",
  "2012-08-06": "rover", "2014-11-12": "comet", "2015-12-12": "leafearth", "2018-07-15": "trophy", "2020-03-11": "virus", "2021-02-18": "rover",
  "2021-12-25": "hexscope", "2022-11-30": "chat", "2023-08-23": "moonlander", "2024-12-08": "syria2",
};
const BIG = new Set(["earthrise", "moonlander", "mountain", "wave", "wall", "wallbreak", "tunnel", "syria1", "syria2", "galaxy", "blackhole", "orbit", "crowd"]);
const SYRIA = new Set(["2011-03-15", "2024-12-08"]);

export const specialKey = (index: number) => { const { y, m, d } = ymd(index); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
export const specialMotifs = () => Object.keys(BY_DATE);

/** The artwork of a special date: `scene` is to be turned into waxed gold; `overlay` (Syrian dates) is drawn afterwards in colour. */
export function specialScene(index: number): { scene: string; overlay?: string } | null {
  const k = specialKey(index), motif = BY_DATE[k];
  if (!motif || !MOTIFS[motif]) return null;
  const big = BIG.has(motif);
  const inner = big ? MOTIFS[motif]() : `<g transform="translate(400 400) scale(1.28) translate(-400 -400)">${MOTIFS[motif]()}</g>`;
  const scene = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">${SCENE_BG()}${inner}</svg>`;
  if (!SYRIA.has(k)) return { scene };
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">${revolutionFlag(150, 150, 120)}</svg>`;
  return { scene, overlay };
}
