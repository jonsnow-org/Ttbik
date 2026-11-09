// Promo images: one polished still per project in three sizes (square post, story, link-preview), from the same projects.json as the videos.
// English first, Arabic under it, no promise of profit. Usage: node scripts/promo/cards.mjs [--only id] [--out dir]
// Env: CHROMIUM (path to a Chromium binary, optional).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { arg, ARABIC_FONTS, LATIN_FONTS, dataUri, esc, fineLine, loadProjects } from "./common.mjs";

const only = arg("only", ""), out = arg("out", "promo-cards"), EN = arg("lang", "both") === "en"; // --lang en: English only (the coins channel allows no Arabic)
const SIZES = { square: [1080, 1080], story: [1080, 1920], link: [1200, 630] };

const card = (p, [W, H], kind) => {
  const tall = kind === "story", wide = kind === "link";
  const u = tall ? 1.15 : wide ? 0.72 : 0.8; // type scale
  return `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;position:relative;overflow:hidden;color:#fff;font-family:${LATIN_FONTS};background:linear-gradient(160deg,${p.bg[1]},${p.bg[0]} 72%)}
.orb{position:absolute;border-radius:50%;filter:blur(110px)}
.o1{width:${W * 0.9}px;height:${W * 0.9}px;background:${p.accent}50;left:-22%;top:-26%}
.o2{width:${W * 0.7}px;height:${W * 0.7}px;background:${p.accent}28;right:-22%;bottom:-24%}
.grid{position:absolute;inset:0;background-image:radial-gradient(${p.accent}22 2px,transparent 2px);background-size:52px 52px;mask-image:radial-gradient(75% 60% at 50% 45%,#000,transparent)}
.frame{position:absolute;inset:${wide ? 24 : 40}px;border-radius:${wide ? 30 : 46}px;border:2px solid ${p.accent}55}
.box{position:relative;height:100%;padding:${wide ? "62px 78px" : tall ? "150px 84px 110px" : "110px 84px 110px"};display:flex;flex-direction:${wide ? "row" : "column"};align-items:${wide ? "center" : "center"};justify-content:center;gap:${wide ? 56 : 38 * u}px;text-align:center}
.logo{width:${(wide ? 250 : tall ? 360 : 220)}px;height:${(wide ? 250 : tall ? 360 : 220)}px;flex:none;border-radius:50%;object-fit:cover;box-shadow:0 0 0 8px ${p.accent}55,0 26px 80px #000b}
.txt{display:flex;flex-direction:column;align-items:center;gap:${22 * u}px;${wide ? "flex:1;align-items:flex-start;text-align:left" : ""}}
.name{font-size:${70 * u}px;font-weight:900;color:${p.accent}}
.en{font-size:${54 * u}px;font-weight:800;line-height:1.22}
.ar{font-size:${50 * u}px;font-weight:600;line-height:1.55;color:${p.accent};direction:rtl;font-family:${ARABIC_FONTS}}
.pills{display:flex;flex-wrap:wrap;justify-content:center;gap:16px;margin-top:${6 * u}px;${wide ? "justify-content:flex-start" : ""}}
.pill{padding:14px 30px;border-radius:999px;background:#ffffff12;border:2px solid ${p.accent}55;font-size:${30 * u}px;font-weight:700}
.handle{margin-top:${10 * u}px;background:${p.accent};color:#111;font-weight:900;font-size:${46 * u}px;padding:20px 56px;border-radius:999px;direction:ltr}
.fine{position:absolute;bottom:${wide ? 30 : 56}px;left:0;right:0;text-align:center;font-size:24px;opacity:.6}
</style><body><div class="orb o1"></div><div class="orb o2"></div><div class="grid"></div><div class="frame"></div>
<div class="box"><img class="logo" src="${dataUri(p.logo)}"><div class="txt">
<div class="name">${esc(EN ? p.name.split(" · ")[0] : p.name)}</div>
<div class="en">${esc(p.tagline[0])}</div>${EN ? "" : `<div class="ar">${esc(p.tagline[1])}</div>`}
${wide ? "" : `<div class="pills">${p.points.map((pt) => `<span class="pill">${esc(pt[0])}</span>`).join("")}</div>`}
<div class="handle">${esc(p.handle)}</div></div></div><div class="fine">${esc(EN ? fineLine(p).split(" · ")[0] : fineLine(p))}</div></body>`;
};

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
for (const p of loadProjects()) {
  if (only && only !== p.id) continue;
  for (const [kind, [W, H]] of Object.entries(SIZES)) {
    const pg = await browser.newPage({ viewport: { width: W, height: H } });
    await pg.setContent(card(p, [W, H], kind), { waitUntil: "load" });
    await pg.evaluate(() => document.fonts.ready);
    const file = path.join(out, `${p.id}-${kind}${EN ? "-en" : ""}.png`);
    await pg.screenshot({ path: file });
    await pg.close();
    console.log("made", file);
  }
}
await browser.close();
