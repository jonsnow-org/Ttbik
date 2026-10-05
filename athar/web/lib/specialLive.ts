// The coloured, animated picture of a special date. The scene is drawn in code (specialArt.ts), tinted with a colour theme that
// fits its subject, and moves the way its subject moves (a paper plane darts away, a heart beats, a flame flickers...).
// It is pure vector with CSS motion inside the SVG, so it stays tiny, sharp at any zoom and needs nothing but the token itself.
// A one-word caption is printed on it so small that it can only be read when the viewer zooms in a lot.
import { specialParts } from "./specialArt";
import { renderCustomArt } from "./art";
import { SEASON_1 } from "./seasons";

type Theme = { w: string; l: string; m: string; d: string; k: string; bg1: string; bg2: string };
const THEMES: Record<string, Theme> = {
  gold:   { w: "#ffe9a8", l: "#ffc94d", m: "#c98a22", d: "#6b4510", k: "#1d1306", bg1: "#42300c", bg2: "#0e0902" },
  space:  { w: "#eef8ff", l: "#9bd7ff", m: "#4f98e0", d: "#244f8c", k: "#07142e", bg1: "#14306a", bg2: "#030816" },
  ocean:  { w: "#e6fffb", l: "#72efe0", m: "#2fb3c4", d: "#14627a", k: "#04202c", bg1: "#0e4254", bg2: "#02121a" },
  red:    { w: "#ffe1e1", l: "#ff8383", m: "#e0405a", d: "#82162c", k: "#2a0610", bg1: "#481020", bg2: "#0e0206" },
  green:  { w: "#f0ffe0", l: "#9ae890", m: "#44ab60", d: "#1f6038", k: "#06200f", bg1: "#10442a", bg2: "#02120a" },
  purple: { w: "#f4e9ff", l: "#c9a2ff", m: "#8d5fe0", d: "#472a86", k: "#140826", bg1: "#2c1458", bg2: "#07030f" },
  fire:   { w: "#fff3d1", l: "#ffb84d", m: "#ff6b2d", d: "#9c2c0e", k: "#2a0c03", bg1: "#4a1806", bg2: "#0e0401" },
  btc:    { w: "#fff1d6", l: "#ffb347", m: "#f7931a", d: "#8a4a06", k: "#2a1602", bg1: "#442808", bg2: "#0d0601" },
  tg:     { w: "#f2fbff", l: "#8ad8ff", m: "#2aabee", d: "#14608f", k: "#04182a", bg1: "#0e3b60", bg2: "#02101a" },
  mars:   { w: "#ffeadf", l: "#ffb391", m: "#d96a3e", d: "#7a2c14", k: "#2a0e05", bg1: "#5e2813", bg2: "#150703" },
  moon:   { w: "#f6f3ec", l: "#d9d5ca", m: "#928d83", d: "#4f4c46", k: "#14130f", bg1: "#1d2c4d", bg2: "#04070f" },
  stone:  { w: "#f7ead4", l: "#e0bd8c", m: "#ae7e4c", d: "#5f3e24", k: "#22140a", bg1: "#42301c", bg2: "#0f0a05" },
};
const THEME_OF: Record<string, string> = {
  football: "green", trophy: "gold", torch: "fire", flame: "fire", pizza: "fire",
  satellite: "space", panelsat: "space", capsule: "space", orbit: "space", shuttle: "space", moonlander: "space", earthrise: "space",
  rover: "space", probe: "space", station: "space", comet: "space", hexscope: "space", jet: "space", ringstars: "space", euro: "space", mountain: "space",
  atom: "purple", galaxy: "purple", blackhole: "purple", virus: "purple", diamond: "purple",
  dna: "ocean", network: "ocean", globeweb: "ocean", chip: "ocean", chat: "ocean", phone: "ocean", paperplane: "ocean", magnifier: "ocean",
  wave: "ocean", stopwatch: "ocean", ballot: "ocean",
  heart: "red", heartpulse: "red", cells: "red", brokenstar: "red", chartdown: "red",
  leafearth: "green", shield: "green", sheep: "stone",
  wall: "stone", wallbreak: "stone", tunnel: "stone", gate: "stone", arch: "stone", guitar: "stone",
};

// a few dates need their own colours (Bitcoin is orange, Telegram is blue, Mars is red, the Webb mirrors are gold, the Moon is silver...)
const THEME_OF_DATE: Record<string, string> = {
  "2008-10-31": "btc", "2009-01-03": "btc", "2013-08-14": "tg", "2012-08-06": "mars", "2021-02-18": "mars", "2021-12-25": "gold",
  "2019-04-10": "fire", "1969-07-20": "moon", "2023-08-23": "moon", "1986-04-26": "gold",
};

// how each subject moves
const ANIM_OF: Record<string, string> = {
  heart: "beat", heartpulse: "beat", cells: "beat", virus: "beat", shield: "pop",
  paperplane: "dart", jet: "dart", bird: "dart", falcon: "dart", comet: "dart",
  shuttle: "launch",
  satellite: "float", panelsat: "float", probe: "float", station: "float", rover: "float", moonlander: "float", capsule: "float",
  globeweb: "spin", atom: "spin", hexscope: "spin", galaxy: "spin", blackhole: "spin", ringstars: "spin", pizza: "spin",
  torch: "flicker", flame: "flicker",
  football: "bounce", trophy: "shine", diamond: "shine", crowd: "bounce",
  coin: "flip", euro: "flip", blocks: "stack",
  dna: "twist", sheep: "bob", earthrise: "rise",
  mic: "bob", music: "bob", guitar: "sway", bus: "roll", phone: "buzz", chat: "pop", book: "page",
  wave: "swell", wallbreak: "shake", wall: "shake", brokenstar: "shake", tunnel: "zoom", gate: "zoom", arch: "zoom", mountain: "rise",
  stopwatch: "tick", magnifier: "sweep", chartdown: "drop", network: "glow", chip: "glow", ballot: "pop",
  syria1: "flutter", syria2: "flutter",
};

const LABEL: Record<string, string> = {
  "1953-04-25": "DNA", "1957-10-04": "Sputnik", "1961-04-12": "Gagarin", "1962-02-20": "Glenn", "1963-08-28": "I have a dream", "1969-07-20": "Moon landing",
  "1969-10-29": "First message", "1971-12-02": "UAE", "1976-04-01": "Apple", "1977-05-25": "Star Wars", "1981-04-12": "Space Shuttle", "1985-07-13": "Live Aid",
  "1986-06-22": "Maradona", "1989-03-12": "The Web", "1989-11-09": "Berlin Wall falls", "1990-02-11": "Mandela free", "1990-04-24": "Hubble", "1990-10-03": "Reunification",
  "1991-08-06": "First website", "1993-04-30": "Web for all", "1997-06-26": "Harry Potter", "1998-07-12": "World Cup 98", "1998-09-04": "Google", "2008-10-31": "Bitcoin paper",
  "2009-01-03": "Genesis block", "2010-05-22": "Pizza day", "2012-07-04": "Higgs", "2013-08-14": "Telegram", "2015-07-30": "Ethereum", "2019-04-10": "Black hole",
  "2022-11-20": "Qatar 2022", "2022-12-18": "Final 2022", "1953-05-29": "Everest", "1954-05-06": "4-minute mile", "1955-12-01": "Rosa Parks", "1957-03-25": "Treaty of Rome",
  "1958-01-31": "Explorer 1", "1959-01-02": "Luna 1", "1961-08-13": "Berlin Wall built", "1962-07-10": "Telstar", "1964-10-10": "Tokyo 1964", "1965-03-18": "First spacewalk",
  "1967-12-03": "First heart transplant", "1968-12-24": "Earthrise", "1969-08-15": "Woodstock", "1970-04-22": "Earth Day", "1970-06-21": "Brazil 1970", "1973-04-03": "First mobile call",
  "1976-01-21": "Concorde", "1977-09-05": "Voyager 1", "1978-07-25": "First IVF baby", "1980-05-08": "Smallpox gone", "1983-01-01": "Internet born", "1986-01-28": "Challenger",
  "1986-04-26": "Chernobyl", "1991-12-26": "USSR ends", "1992-07-25": "Barcelona 92", "1993-11-01": "European Union", "1994-04-27": "First free vote", "1994-05-06": "Channel Tunnel",
  "1996-07-05": "Dolly", "1998-11-20": "ISS", "1999-01-01": "Euro", "2008-08-08": "Beijing 2008", "2008-09-15": "Lehman", "2010-12-17": "Arab Spring", "2011-03-11": "Tohoku",
  "2011-03-15": "Syrian revolution", "2012-08-06": "Curiosity", "2014-11-12": "Rosetta", "2015-12-12": "Paris accord", "2018-07-15": "World Cup 2018", "2020-03-11": "Covid-19",
  "2021-02-18": "Perseverance", "2021-12-25": "Webb", "2022-11-30": "ChatGPT", "2023-08-23": "Chandrayaan-3", "2024-12-08": "Syria is free",
};

const PAL: [keyof Theme, string][] = [["w", "#f4f1ea"], ["l", "#cfc9bc"], ["m", "#948e82"], ["d", "#5a564e"], ["k", "#1b1a18"]];
const tint = (svg: string, t: Theme) => PAL.reduce((s, [k, from]) => s.split(from).join(t[k]), svg);

// every move is a gentle loop with a lively moment, so the picture is calm most of the time and "does its thing" now and then
const MOVES = `.mo{transform-box:fill-box;transform-origin:center}`
  + `@keyframes m-beat{0%,60%,100%{transform:scale(1)}8%{transform:scale(1.13)}16%{transform:scale(.97)}26%{transform:scale(1.09)}38%{transform:scale(1)}}`
  + `@keyframes m-dart{0%,70%,100%{transform:translate(0,0);opacity:1}72%{transform:translate(-190px,150px) rotate(-8deg);opacity:0}73%{opacity:0}74%{transform:translate(-190px,150px);opacity:0}82%{transform:translate(0,0) rotate(0);opacity:1}86%{transform:translate(14px,-10px)}92%{transform:translate(0,0)}}`
  + `@keyframes m-launch{0%,66%,100%{transform:translateY(0);opacity:1}72%{transform:translateY(-260px);opacity:0}74%{transform:translateY(260px);opacity:0}84%{transform:translateY(0);opacity:1}88%{transform:translateY(-8px)}}`
  + `@keyframes m-float{0%,100%{transform:translateY(-8px) rotate(-3deg)}50%{transform:translateY(8px) rotate(3deg)}}`
  + `@keyframes m-spin{to{transform:rotate(360deg)}}`
  + `@keyframes m-flicker{0%,100%{transform:scale(1,1) skewX(0)}12%{transform:scale(.97,1.05) skewX(-2deg)}27%{transform:scale(1.03,.97) skewX(2deg)}41%{transform:scale(.98,1.06) skewX(-1deg)}58%{transform:scale(1.02,1) skewX(2deg)}76%{transform:scale(.99,1.04) skewX(-2deg)}}`
  + `@keyframes m-bounce{0%,100%{transform:translateY(0) scale(1.06,.94)}18%{transform:translateY(-70px) scale(.97,1.04)}36%{transform:translateY(0) scale(1.06,.94)}50%{transform:translateY(-26px) scale(1)}62%{transform:translateY(0) scale(1.03,.97)}}`
  + `@keyframes m-shine{0%,100%{transform:scale(1);filter:brightness(1)}8%{transform:scale(1.07);filter:brightness(1.5)}20%{transform:scale(1);filter:brightness(1)}}`
  + `@keyframes m-flip{0%,55%,100%{transform:scaleX(1)}70%{transform:scaleX(.04)}85%{transform:scaleX(-1)}92%{transform:scaleX(-1)}}`
  + `@keyframes m-stack{0%,100%{transform:translateY(0)}10%{transform:translateY(-14px)}20%{transform:translateY(0)}}`
  + `@keyframes m-twist{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.42)}}`
  + `@keyframes m-bob{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-16px) rotate(2deg)}}`
  + `@keyframes m-sway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}`
  + `@keyframes m-roll{0%,100%{transform:translateX(-22px)}50%{transform:translateX(22px)}}`
  + `@keyframes m-buzz{0%,70%,100%{transform:translate(0,0)}72%{transform:translate(-5px,2px) rotate(-2deg)}75%{transform:translate(5px,-2px) rotate(2deg)}78%{transform:translate(-5px,2px) rotate(-2deg)}81%{transform:translate(5px,0) rotate(2deg)}84%{transform:translate(0,0)}}`
  + `@keyframes m-pop{0%,100%{transform:scale(1)}8%{transform:scale(1.12)}16%{transform:scale(1)}60%{transform:scale(1.05)}70%{transform:scale(1)}}`
  + `@keyframes m-page{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.9)}}`
  + `@keyframes m-swell{0%,100%{transform:translate(-12px,6px) scale(1)}50%{transform:translate(12px,-10px) scale(1.07)}}`
  + `@keyframes m-shake{0%,78%,100%{transform:translate(0,0)}80%{transform:translate(-7px,3px)}83%{transform:translate(7px,-3px)}86%{transform:translate(-6px,2px)}89%{transform:translate(5px,-2px)}92%{transform:translate(0,0)}}`
  + `@keyframes m-zoom{0%,100%{transform:scale(.94)}50%{transform:scale(1.1)}}`
  + `@keyframes m-rise{0%,100%{transform:translateY(14px)}50%{transform:translateY(-10px)}}`
  + `@keyframes m-tick{0%,100%{transform:rotate(-4deg)}25%{transform:rotate(3deg)}50%{transform:rotate(-2deg)}75%{transform:rotate(4deg)}}`
  + `@keyframes m-sweep{0%,100%{transform:translate(-26px,10px) rotate(-8deg)}50%{transform:translate(26px,-10px) rotate(8deg)}}`
  + `@keyframes m-drop{0%,60%,100%{transform:translateY(0)}72%{transform:translateY(34px)}86%{transform:translateY(0)}}`
  + `@keyframes m-glow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.55) drop-shadow(0 0 14px currentColor)}}`
  + `@keyframes m-flutter{0%,100%{transform:skewX(0) scale(1)}25%{transform:skewX(-3deg) scale(1.02)}75%{transform:skewX(3deg) scale(.99)}}`
  + `@keyframes m-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}`
  + `@keyframes m-ring{0%{transform:scale(.3);opacity:.8}100%{transform:scale(7);opacity:0}}`
  + `@keyframes m-halo{0%,100%{opacity:.25}50%{opacity:.75}}`
  + `@keyframes m-glint{0%,82%,100%{opacity:0;transform:translateX(-340px) skewX(-18deg)}90%{opacity:.55}98%{opacity:0;transform:translateX(340px) skewX(-18deg)}}`;
const DUR: Record<string, string> = {
  beat: "1.3s ease-in-out", dart: "7s ease-in-out", launch: "8s ease-in-out", float: "6s ease-in-out", spin: "46s linear", flicker: "1.6s ease-in-out",
  bounce: "2.6s ease-in-out", shine: "5s ease-in-out", flip: "6s ease-in-out", stack: "4s ease-out", twist: "4.4s ease-in-out", bob: "3.2s ease-in-out",
  sway: "4s ease-in-out", roll: "5s ease-in-out", buzz: "5s linear", pop: "4s ease-out", page: "4s ease-in-out", swell: "5s ease-in-out", shake: "6s linear",
  zoom: "6s ease-in-out", rise: "7s ease-in-out", tick: "2.4s steps(4,end)", sweep: "6s ease-in-out", drop: "7s ease-in-out", glow: "3.4s ease-in-out",
  flutter: "3.2s ease-in-out", breathe: "6s ease-in-out",
};
// the flash of each subject: a glint for what is shiny, an expanding ring for what sends signals, a breathing glow for the rest
const GLINT = new Set(["trophy", "diamond", "coin", "euro", "blocks", "mic", "music", "book", "bus"]);
const RING = new Set(["satellite", "panelsat", "phone", "network", "chat", "paperplane", "probe", "station", "chip"]);
const HALO: Record<string, string> = { beat: "1.3s", flicker: "1.6s", shine: "5s", glow: "3.4s", spin: "9s" };
const esc = (s: string) => s.replace(/[<>&"]/g, "");

export function hasLiveScene(index: number): boolean { return !!specialParts(index); }

/** The finished token picture of a special date (coloured, animated, captioned). Null when the date has no scene of ours. */
export function renderSpecialLive(index: number): string | null {
  const p = specialParts(index);
  if (!p) return null;
  const t = THEMES[THEME_OF_DATE[p.key] || THEME_OF[p.motif] || "gold"];
  const anim = ANIM_OF[p.motif] && DUR[ANIM_OF[p.motif]] ? ANIM_OF[p.motif] : "breathe";
  const css = `@media (prefers-reduced-motion:no-preference){${MOVES}.mo{animation:m-${anim} ${DUR[anim]} infinite}.glint{animation:m-glint 9s ease-in-out infinite}.fxring{transform-box:fill-box;transform-origin:center;animation:m-ring 3.4s ease-out infinite}.fxhalo{animation:m-halo ${HALO[anim] || "5s"} ease-in-out infinite}}`;
  const bg = `<defs><radialGradient id="sbg" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="${t.bg1}"/><stop offset="1" stop-color="${t.bg2}"/></radialGradient></defs><rect width="800" height="800" fill="url(#sbg)"/><radialGradient id="shl"><stop offset="0" stop-color="${t.l}" stop-opacity="0.55"/><stop offset="0.6" stop-color="${t.m}" stop-opacity="0.18"/><stop offset="1" stop-color="${t.m}" stop-opacity="0"/></radialGradient>`;
  const body = tint(p.inner, t);
  const label = LABEL[p.key];
  // larger than the plain pictures: the scene fills the window (its corners only are lost to the circle)
  const centre = `<g clip-path="url(#win)"><g transform="translate(400 400) scale(0.6) translate(-400 -400)">${bg}${GLINT.has(p.motif) || RING.has(p.motif) ? "" : `<circle class="fxhalo" cx="400" cy="400" r="330" fill="url(#shl)" opacity="0"/>`}<g class="mo">${body}</g>${p.overlay ? `<g class="mo">${p.overlay}</g>` : ""}`
    + (GLINT.has(p.motif) ? `<rect class="glint" x="400" y="0" width="70" height="800" fill="#fff" opacity="0"/>` : "")
    + (RING.has(p.motif) ? `<circle class="fxring" cx="400" cy="400" r="40" fill="none" stroke="${t.l}" stroke-width="7" opacity="0"/>` : "")
    + `</g>`
    + (label ? `<text x="400" y="624" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="5.2" letter-spacing="1.2" fill="${t.l}" opacity="0.85">${esc(label.toUpperCase())}</text>` : "")
    + `</g>`;
  const svg = renderCustomArt({ index, tier: 2, season: SEASON_1.id, stage: 0, hands: 1, engravings: 0 }, centre);
  return svg.replace("</svg>", `<style>${css}</style></svg>`);
}
