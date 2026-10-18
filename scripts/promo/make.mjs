// Promo videos: each scene is an HTML page rendered by Chromium (so Arabic shapes correctly), then ffmpeg animates and joins the stills.
// Usage: node scripts/promo/make.mjs [--only id] [--out dir] [--format vertical|wide]
// Env: FFMPEG (path, default "ffmpeg"), CHROMIUM (path to a Chromium binary, optional).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const only = arg("only", ""), out = arg("out", "promo-out"), format = arg("format", "vertical");
const [W, H] = format === "wide" ? [1920, 1080] : [1080, 1920];
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const site = JSON.parse(fs.readFileSync("deploy/hosting/site.json", "utf8")).gateUrl;
const cfg = JSON.parse(fs.readFileSync("scripts/promo/projects.json", "utf8"));
const SECS = 3.6, FADE = 0.45, FPS = 25;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const dataUri = (file) => { const b = fs.readFileSync(file); return `data:image/${file.endsWith(".png") ? "png" : "jpeg"};base64,${b.toString("base64")}`; };
const css = (p) => `
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;background:radial-gradient(120% 90% at 50% 0%,${p.bg[1]},${p.bg[0]});color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${H > W ? 44 : 28}px;padding:${H > W ? "90px 80px" : "60px 120px"};text-align:center;font-family:'Noto Sans','Noto Naskh Arabic','Noto Sans Arabic','DejaVu Sans',sans-serif;overflow:hidden}
.en{font-size:${H > W ? 64 : 54}px;font-weight:700;line-height:1.25;letter-spacing:.2px}
.ar{font-size:${H > W ? 58 : 48}px;line-height:1.5;color:${p.accent};font-family:'Noto Naskh Arabic','Noto Sans Arabic','DejaVu Sans',sans-serif;direction:rtl}
.logo{width:${H > W ? 360 : 280}px;height:${H > W ? 360 : 280}px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 8px ${p.accent}55,0 30px 90px #000a}
.name{font-size:${H > W ? 84 : 70}px;font-weight:800;color:${p.accent}}
.phone{height:${H > W ? 1250 : 800}px;aspect-ratio:390/844;border-radius:64px;border:12px solid #111;box-shadow:0 0 0 3px ${p.accent}66,0 40px 100px #000b;overflow:hidden;background:#000}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top}
.cta{background:${p.accent};color:#111;font-weight:800;font-size:${H > W ? 62 : 52}px;padding:26px 60px;border-radius:999px}
.handle{font-size:${H > W ? 54 : 44}px;opacity:.9;direction:ltr}
.fine{position:absolute;bottom:42px;font-size:26px;opacity:.6}`;
const page = (p, body) => `<!doctype html><meta charset="utf-8"><style>${css(p)}</style><body>${body}<div class="fine">Not financial advice · ليست نصيحة مالية</div></body>`;
const two = (pair) => `<div class="en">${esc(pair[0])}</div><div class="ar">${esc(pair[1])}</div>`;

async function build(browser, p) {
  const dir = path.join(out, p.id); fs.mkdirSync(dir, { recursive: true });
  const logo = dataUri(p.logo);
  const scenes = [];
  scenes.push(page(p, `<img class="logo" src="${logo}"><div class="name">${esc(p.name)}</div>${two(p.tagline)}`));
  for (const pt of p.points) scenes.push(page(p, `<img class="logo" style="width:200px;height:200px" src="${logo}">${two(pt)}`));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "en-US", ignoreHTTPSErrors: true });
  for (const s of p.shots || []) {
    try {
      const pg = await ctx.newPage();
      await pg.goto(s.url || site + s.path, { waitUntil: "load", timeout: 45000 });
      await pg.waitForTimeout(4000);
      const png = path.join(dir, `shot-${scenes.length}.png`);
      await pg.screenshot({ path: png }); await pg.close();
      scenes.push(page(p, `<div class="phone"><img src="${dataUri(png)}"></div>${two(s.caption)}`));
    } catch (e) { console.warn(`[${p.id}] screenshot skipped: ${String(e).slice(0, 120)}`); }
  }
  await ctx.close();
  scenes.push(page(p, `<img class="logo" src="${logo}">${two(p.cta)}<div class="cta">${esc(p.handle)}</div>`));

  const clips = [];
  const pgr = await browser.newPage({ viewport: { width: W, height: H } });
  for (let i = 0; i < scenes.length; i++) {
    await pgr.setContent(scenes[i], { waitUntil: "load" });
    await pgr.waitForTimeout(300);
    const png = path.join(dir, `s${i}.png`), mp4 = path.join(dir, `s${i}.mp4`);
    await pgr.screenshot({ path: png });
    const frames = Math.round(SECS * FPS);
    const zoom = `zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`;
    const fade = `fade=t=in:st=0:d=${FADE},fade=t=out:st=${SECS - FADE}:d=${FADE}`;
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", String(SECS), "-vf", `${zoom},${fade},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", mp4]);
    clips.push(mp4);
  }
  await pgr.close();
  const list = path.join(dir, "list.txt");
  fs.writeFileSync(list, clips.map((c) => `file '${path.resolve(c)}'`).join("\n"));
  const final = path.join(out, `${p.id}-${format}.mp4`);
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", final]);
  console.log("made", final, `${(fs.statSync(final).size / 1e6).toFixed(1)} MB`);
}

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
for (const p of cfg.projects) if (!only || only === p.id) await build(browser, p);
await browser.close();
