// Promo videos: each scene is an HTML page rendered by Chromium (so Arabic shapes correctly) and ANIMATED with CSS: text rises in line by line,
// the glow drifts, the phone slides up, the progress bar fills. Every frame is captured by pausing the page's animations at the frame's time,
// then ffmpeg joins the clips. English first, Arabic under it.
// Usage: node scripts/promo/make.mjs [--only id] [--out dir] [--format vertical|wide]
// Env: FFMPEG (path, default "ffmpeg"), CHROMIUM (path to a Chromium binary, optional).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { arg, ARABIC_FONTS, LATIN_FONTS, dataUri, esc, fineLine, loadProjects, logoMarkup, narrationText, projectLanguage, site } from "./common.mjs";

const only = arg("only", ""), out = arg("out", "promo-out"), format = arg("format", "vertical");
const [W, H] = format === "wide" ? [1920, 1080] : [1080, 1920];
const V = H > W; // vertical
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const SITE = site();
let SECS = 3.4;
const FPS = 25, OUT_T = 0.35; // seconds per scene, frames per second, fade-out length
const FFPROBE = process.env.FFPROBE || "ffprobe";

const css = (p, i, n) => `
*{box-sizing:border-box;margin:0}
html,body{width:${W}px;height:${H}px}
body{position:relative;background:linear-gradient(160deg,${p.bg[1]},${p.bg[0]} 70%);color:#fff;overflow:hidden;font-family:${LATIN_FONTS};animation:scene ${SECS}s linear both}
@keyframes scene{0%{opacity:0}9%{opacity:1}${((1 - OUT_T / SECS) * 100).toFixed(1)}%{opacity:1}100%{opacity:0}}
.orb{position:absolute;border-radius:50%;filter:blur(${V ? 120 : 90}px);opacity:.5;animation:drift ${SECS * 2}s ease-in-out infinite alternate}
.o1{width:${V ? 900 : 760}px;height:${V ? 900 : 760}px;background:${p.accent}55;left:-18%;top:-10%}
.o2{width:${V ? 760 : 640}px;height:${V ? 760 : 640}px;background:${p.accent}30;right:-20%;bottom:-8%;animation-direction:alternate-reverse}
@keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(70px,50px) scale(1.12)}}
.grid{position:absolute;inset:0;background-image:radial-gradient(${p.accent}22 2px,transparent 2px);background-size:56px 56px;mask-image:radial-gradient(70% 55% at 50% 45%,#000,transparent);opacity:.55}
.stage{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${V ? 44 : 26}px;padding:${V ? "150px 84px 120px" : "90px 130px 90px"};text-align:center}
.a{animation:rise .8s cubic-bezier(.2,.8,.2,1) var(--d,0s) both}
@keyframes rise{from{opacity:0;transform:translateY(46px)}to{opacity:1;transform:none}}
.en{font-size:${V ? 66 : 56}px;font-weight:800;line-height:1.22}
.ar{font-size:${V ? 60 : 50}px;line-height:1.55;color:${p.accent};font-family:${ARABIC_FONTS};direction:rtl;font-weight:600}
.logo{width:${V ? 340 : 260}px;height:${V ? 340 : 260}px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 8px ${p.accent}55,0 30px 90px #000a;animation:rise .9s cubic-bezier(.2,.8,.2,1) both,pulse ${SECS}s ease-in-out infinite}
.logo.sm{width:${V ? 190 : 150}px;height:${V ? 190 : 150}px}
.logo.monogram{display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 25%,${p.accent},#071321 78%);color:#fff;font-weight:1000;font-size:${V ? 190 : 150}px;letter-spacing:-.06em}
.logo.sm.monogram{font-size:${V ? 104 : 86}px}
@keyframes pulse{0%,100%{box-shadow:0 0 0 8px ${p.accent}55,0 30px 90px #000a}50%{box-shadow:0 0 0 22px ${p.accent}22,0 30px 90px #000a}}
.name{font-size:${V ? 88 : 72}px;font-weight:900;color:${p.accent};letter-spacing:.3px}
.pt{display:flex;flex-direction:column;gap:18px;padding:${V ? "44px 52px" : "30px 50px"};border-radius:36px;background:#ffffff0e;border:2px solid ${p.accent}44;backdrop-filter:blur(6px);max-width:${V ? 900 : 1300}px}
.num{font-size:${V ? 120 : 90}px;font-weight:900;color:${p.accent};opacity:.9;line-height:1}
.phone{height:${V ? 1180 : 760}px;aspect-ratio:390/844;border-radius:64px;border:12px solid #0d0d0d;box-shadow:0 0 0 3px ${p.accent}77,0 50px 110px #000c;overflow:hidden;background:#000;animation:phone 1s cubic-bezier(.2,.8,.2,1) both}
@keyframes phone{from{opacity:0;transform:translateY(120px) rotate(-3deg) scale(.94)}to{opacity:1;transform:none}}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top}
.cta{background:${p.accent};color:#111;font-weight:900;font-size:${V ? 62 : 50}px;padding:26px 64px;border-radius:999px;direction:ltr;animation:rise .8s cubic-bezier(.2,.8,.2,1) var(--d,.5s) both,beat 1.1s ease-in-out .9s infinite}
@keyframes beat{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
.prog{position:absolute;top:${V ? 64 : 36}px;left:${V ? 84 : 130}px;right:${V ? 84 : 130}px;display:flex;gap:10px;z-index:3}
.prog i{flex:1;height:8px;border-radius:8px;background:#ffffff26;overflow:hidden}
.prog i b{display:block;height:100%;width:100%;background:${p.accent};border-radius:8px}
.prog i.done b{width:100%}
.prog i.cur b{animation:fill ${SECS}s linear both}
.prog i.todo b{width:0}
@keyframes fill{from{width:0}to{width:100%}}
.fine{position:absolute;bottom:${V ? 52 : 28}px;left:0;right:0;text-align:center;font-size:26px;opacity:.6}`;

const prog = (i, n) => `<div class="prog">${Array.from({ length: n }, (_, k) => `<i class="${k < i ? "done" : k === i ? "cur" : "todo"}"><b></b></i>`).join("")}</div>`;
const two = (p, pair, d = 0.2) => `<div class="en a" style="--d:${d}s">${esc(pair[0])}</div>${projectLanguage(p) === "en" ? "" : `<div class="ar a" style="--d:${d + 0.18}s">${esc(pair[1])}</div>`}`;
const page = (p, i, n, body) => `<!doctype html><meta charset="utf-8"><style>${css(p, i, n)}</style><body><div class="orb o1"></div><div class="orb o2"></div><div class="grid"></div>${prog(i, n)}<div class="stage">${body}</div><div class="fine">${esc(fineLine(p, projectLanguage(p)))}</div></body>`;

/** Pauses every CSS animation at time t (ms) and photographs the page: a deterministic frame, however slow the machine. */
async function capture(pg, html, dir, name) {
  await pg.setContent(html, { waitUntil: "load" });
  await pg.evaluate(() => document.fonts.ready);
  const frames = Math.round(SECS * FPS);
  for (let f = 0; f < frames; f++) {
    await pg.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }, (f * 1000) / FPS);
    await pg.screenshot({ path: path.join(dir, `${name}-${String(f).padStart(3, "0")}.jpg`), type: "jpeg", quality: 92 });
  }
  const mp4 = path.join(dir, `${name}.mp4`);
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, `${name}-%03d.jpg`), "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", mp4]);
  for (let f = 0; f < frames; f++) fs.rmSync(path.join(dir, `${name}-${String(f).padStart(3, "0")}.jpg`), { force: true });
  return mp4;
}

async function build(browser, p) {
  const dir = path.join(out, p.id); fs.mkdirSync(dir, { recursive: true });
  const logo = logoMarkup(p);
  // 1) real screenshots of the live pages (a failed page is skipped, never fatal)
  const shots = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "en-US", ignoreHTTPSErrors: true });
  for (const [k, s] of (p.shots || []).entries()) {
    try {
      const pg = await ctx.newPage();
      await pg.goto(s.url || SITE + s.path, { waitUntil: "load", timeout: 45000 });
      await pg.waitForTimeout(4000);
      const png = path.join(dir, `shot-${k}.png`);
      await pg.screenshot({ path: png }); await pg.close();
      shots.push({ png, caption: s.caption });
    } catch (e) { console.warn(`[${p.id}] screenshot skipped: ${String(e).slice(0, 120)}`); }
  }
  await ctx.close();

  // 2) the scene list: title, one scene per point, one per live page, call to action
  const total = 2 + p.points.length + shots.length;
  // Athar remains on its existing silent render path; public project campaigns get narration.
  let voiceFile = "";
  if (p.id !== "athar") {
    voiceFile = path.join(dir, "voice.mp3");
    const voice = projectLanguage(p) === "en" ? "en-US-AriaNeural" : "ar-SA-ZariyahNeural";
    execFileSync(process.env.PYTHON || "python3", ["scripts/promo/tts.py", "--text", narrationText(p), "--voice", voice, "--out", voiceFile], { stdio: "inherit" });
    const voiceSeconds = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", voiceFile], { encoding: "utf8" }).trim());
    if (!Number.isFinite(voiceSeconds) || voiceSeconds <= 0) throw new Error(`[${p.id}] narration has no measurable duration`);
    SECS = Math.max(3.4, Math.min(8, voiceSeconds / total + 0.4));
  } else {
    SECS = 3.4;
  }
  const bodies = [];
  bodies.push((i) => page(p, i, total, `${logo}<div class="name a" style="--d:.25s">${esc(projectLanguage(p) === "en" ? projectName(p, "en") : p.name)}</div>${two(p, p.tagline, 0.45)}`));
  p.points.forEach((pt, k) => bodies.push((i) => page(p, i, total, `${logoMarkup(p, "logo sm")}<div class="pt"><div class="num a" style="--d:.15s">${String(k + 1).padStart(2, "0")}</div>${two(p, pt, 0.3)}</div>`)));
  for (const s of shots) bodies.push((i) => page(p, i, total, `<div class="phone"><img src="${dataUri(s.png)}"></div>${two(p, s.caption, 0.7)}`));
  bodies.push((i) => page(p, i, total, `${logo}${two(p, p.cta, 0.3)}<div class="cta" style="--d:.8s">${esc(p.handle)}</div>`));

  // 4) frames -> clips -> one file with narration and a low-volume original music bed.
  const clips = [];
  const pgr = await browser.newPage({ viewport: { width: W, height: H } });
  for (let i = 0; i < bodies.length; i++) clips.push(await capture(pgr, bodies[i](i), dir, `s${i}`));
  await pgr.close();
  const list = path.join(dir, "list.txt");
  fs.writeFileSync(list, clips.map((c) => `file '${path.resolve(c)}'`).join("\n"));
  const final = path.join(out, `${p.id}-${format}.mp4`);
  const encode = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list];
  const music = arg("music", "");
  if (voiceFile && music && fs.existsSync(music)) {
    encode.push("-i", voiceFile, "-stream_loop", "-1", "-i", path.resolve(music), "-filter_complex", "[1:a]volume=1.0[voice];[2:a]volume=0.12[music];[voice][music]amix=inputs=2:duration=longest:dropout_transition=2,alimiter=limit=0.95[a]", "-map", "0:v", "-map", "[a]");
  } else if (voiceFile) {
    encode.push("-i", voiceFile, "-map", "0:v", "-map", "1:a");
  } else {
    encode.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v", "-map", "1:a");
  }
  encode.push("-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final);
  execFileSync(FFMPEG, encode);
  console.log("made", final, `${(fs.statSync(final).size / 1e6).toFixed(1)} MB`, `${(bodies.length * SECS).toFixed(1)} s`, voiceFile ? "with narration" : "legacy silent render");
}

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
for (const p of loadProjects()) if (!only || only === p.id) await build(browser, p);
await browser.close();
