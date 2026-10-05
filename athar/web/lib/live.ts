// Motion for tokens. The picture that is stored permanently and shown by wallets stays an ordinary picture; motion is added
// on top of it by this file. It is pure code (CSS inside the SVG, no scripts, no files), so it costs nothing to keep and works
// for every token for as long as the site exists. Reduced-motion users get the still picture.
//   liveArt     the site's version: a one-time flash on opening, a slow turning rosette, twinkles; the older the token
//               (age stage 0-4) the livelier it is; on the date's own anniversary a golden aura with orbiting sparks.
//   storedMotion a quiet version for the special/mythic pictures we store forever (rim shimmer + halo breathing + one flash),
//               so they move wherever the viewer can play an animated SVG.

const GOLD = "#ffd36a";
const spark = (x: number, y: number, s: number, fill: string, cls: string, delay: number) =>
  `<path class="${cls}" style="animation-delay:${delay.toFixed(2)}s" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s})" fill="${fill}" d="M0-9C1-3 3-1 9 0 3 1 1 3 0 9-1 3-3 1-9 0-3-1-1-3 0-9Z"/>`;

function sparkles(n: number, fill: string, cls: string): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    const an = ((i * 137.508) % 360) * (Math.PI / 180);          // golden-angle spread: even, never in a row
    const rad = 262 + ((i * 37) % 5) * 22;
    out += spark(400 + Math.cos(an) * rad, 400 + Math.sin(an) * rad, 0.7 + ((i * 13) % 4) * 0.25, fill, cls, (i * 0.83) % 5);
  }
  return out;
}

// Motion that belongs to the picture itself, in every version of it (live site, stored file):
//  - the small rosette badge of a photo token turns and breathes
//  - a RARE token's crystal: petals turn one way, the inner star the other, the jewel pulses, the facets twinkle, a glint passes
//  - a photo token's picture is alive too: a soft rim light breathes and a faint glint passes now and then
const BADGE_CSS = `.ar-bd{animation:ar-bdp 3.4s ease-in-out infinite}.ar-ro{animation:ar-spin 60s linear infinite}`
  + `@keyframes ar-bdp{0%,100%{opacity:.72}50%{opacity:1}}`
  + `.ar-c1,.ar-c2{transform-origin:400px 400px}.ar-c1{animation:ar-spin 72s linear infinite}.ar-c2{animation:ar-spin-rev 48s linear infinite}`
  + `.ar-c3{transform-box:fill-box;transform-origin:center;animation:ar-corep 3.2s ease-in-out infinite}`
  + `.ar-cf{animation:ar-facet 5s ease-in-out infinite}`
  + `.ar-cg{animation:ar-glint 8s ease-in-out infinite}`
  + `@keyframes ar-spin-rev{to{transform:rotate(-360deg)}}`
  + `@keyframes ar-corep{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.2);filter:brightness(1.7)}}`
  + `@keyframes ar-facet{0%,100%{opacity:.55}50%{opacity:1}}`
  + `@keyframes ar-glint{0%,80%,100%{opacity:0;transform:translateX(0) skewX(-18deg)}86%{opacity:.34}97%{opacity:0;transform:translateX(560px) skewX(-18deg)}}`
  + `.ar-st3,.ar-st4{transform-origin:400px 400px}.ar-st3{animation:ar-spin 90s linear infinite}.ar-st4{animation:ar-spin-rev 60s linear infinite}.ar-sta{animation:ar-stah 5s ease-in-out infinite}.ar-stb{animation:ar-breathe 5s ease-in-out infinite}`
  + `@keyframes ar-stah{0%,100%{opacity:.05}50%{opacity:.2}}`
  + `.ar-bst3,.ar-bst4,.ar-bsta,.ar-bstb{transform-box:fill-box;transform-origin:center}.ar-bst3{animation:ar-spin 40s linear infinite}.ar-bst4{animation:ar-spin-rev 28s linear infinite}.ar-bsta{animation:ar-stah 5s ease-in-out infinite}.ar-bstb{animation:ar-breathe 5s ease-in-out infinite}`
  + `.ar-pv{animation:ar-pvp 4.6s ease-in-out infinite}.ar-pg{animation:ar-pgs 9s ease-in-out infinite}`
  + `@keyframes ar-pvp{0%,100%{opacity:.3}50%{opacity:.95}}`
  + `@keyframes ar-pgs{0%,76%,100%{opacity:0;transform:translateX(0) skewX(-18deg)}83%{opacity:.26}95%{opacity:0;transform:translateX(520px) skewX(-18deg)}}`;

function inject(svg: string, css: string, extra: string): string {
  return svg.replace("</svg>", `<style>@media (prefers-reduced-motion:no-preference){${css}}</style>${extra}</svg>`);
}

const BASE = `.ar-ro,.ar-orbit,.ar-ring-flash{transform-origin:400px 400px}`
  + `@keyframes ar-spin{to{transform:rotate(360deg)}}`
  + `@keyframes ar-breathe{0%,100%{opacity:.55}50%{opacity:1}}`
  + `@keyframes ar-twinkle{0%,100%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}`
  + `@keyframes ar-flash{0%{opacity:.95;transform:scale(.62)}100%{opacity:0;transform:scale(1.04)}}`
  + `.ar-ring-flash{opacity:0;animation:ar-flash 1.7s ease-out 1 both}`;

export type LiveOpts = { stage?: number; tier?: number; anniversary?: boolean };

export function liveArt(svg: string, o: LiveOpts = {}): string {
  const stage = Math.min(4, Math.max(0, o.stage ?? 0));
  const gold = o.tier === 2;
  const col = gold ? GOLD : "#ffffff";
  const turn = 96 - stage * 15;            // seconds per turn: 96 s when new, 36 s at the oldest stage
  const pulse = 6 - stage * 0.9;           // seconds per breath
  const n = 4 + stage * 3;                 // twinkles
  let css = BASE
    + BADGE_CSS + `.ar-ro{animation:ar-spin ${turn}s linear infinite}`
    + `.ar-rim,.ar-glow{animation:ar-breathe ${pulse}s ease-in-out infinite}`
    + `.ar-rings{animation:ar-breathe ${pulse * 1.6}s ease-in-out infinite}`
    + `.ar-tw{transform-box:fill-box;transform-origin:center;opacity:0;animation:ar-twinkle ${(pulse * 0.9).toFixed(1)}s ease-in-out infinite}`;
  let extra = `<circle class="ar-ring-flash" cx="400" cy="400" r="392" fill="none" stroke="${col}" stroke-width="10"/>` + sparkles(n, col, "ar-tw");
  if (o.anniversary) {
    css += `@keyframes ar-aura{0%,100%{opacity:.2}50%{opacity:.9}}.ar-aura{animation:ar-aura 2.4s ease-in-out infinite}.ar-orbit{animation:ar-spin 14s linear infinite}`;
    let orb = "";
    for (let i = 0; i < 12; i++) { const an = (i / 12) * Math.PI * 2; orb += spark(400 + Math.cos(an) * 392, 400 + Math.sin(an) * 392, 1.1, GOLD, "", 0); }
    extra += `<circle class="ar-aura" cx="400" cy="400" r="396" fill="none" stroke="${GOLD}" stroke-width="12"/><g class="ar-orbit">${orb}</g>`;
  }
  return inject(svg, css, extra);
}

/** Motion for a stored picture that has the badge but needs no shimmer (common and rare photo tokens). */
export function badgeMotion(svg: string): string {
  return inject(svg, BASE + BADGE_CSS, "");
}

export function storedMotion(svg: string): string {
  const css = BASE + BADGE_CSS + `.ar-rim,.ar-glow{animation:ar-breathe 7s ease-in-out infinite}.ar-tw{transform-box:fill-box;transform-origin:center;opacity:0;animation:ar-twinkle 5.5s ease-in-out infinite}`;
  return inject(svg, css, `<circle class="ar-ring-flash" cx="400" cy="400" r="392" fill="none" stroke="${GOLD}" stroke-width="10"/>` + sparkles(6, GOLD, "ar-tw"));
}
