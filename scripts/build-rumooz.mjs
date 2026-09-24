// Builds the «رموز» symbol library and its letter-code index (run once, output is committed):
//   node scripts/build-rumooz.mjs
//
// Inputs (all free / open licence, fetched at build time):
//   - Unicode emoji-test.txt  → which symbols exist + their subgroup     (Unicode License v3)
//   - CLDR Arabic annotations → Arabic names/keywords for every symbol   (Unicode License v3)
//   - Noto Emoji 2D SVGs      → the drawings                             (Apache License 2.0)
// Outputs:
//   - public/rumooz/s/<codepoints>.svg     minified drawings, fetched lazily by the tool
//   - src/lib/motion/symbols.generated.ts  symbol table + the letter trie (compressed string)
//   - public/rumooz/LICENSES.txt           the notices the licences require
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT_SVG = path.join(ROOT, "public/rumooz/s");
const OUT_TS = path.join(ROOT, "src/lib/motion/symbols.generated.ts");
const OUT_LIC = path.join(ROOT, "public/rumooz/LICENSES.txt");

const SRC = {
  test: "https://unicode.org/Public/emoji/latest/emoji-test.txt",
  ann: "https://cdn.jsdelivr.net/npm/cldr-annotations-full@48.2.0/annotations/ar/annotations.json",
  annDerived: "https://cdn.jsdelivr.net/npm/cldr-annotations-derived-full@48.2.0/annotationsDerived/ar/annotations.json",
  unicodeLicense: "https://cdn.jsdelivr.net/npm/cldr-annotations-full@48.2.0/LICENSE",
  notoLicense: "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/LICENSE",
  noto: (name) => `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@main/2D/svg/${name}`,
};

// subgroup → role: a = moving actor, m = sea creature, v = ground vehicle, w = boat, f = aircraft, b = building/landmark, p = prop, s = sky, g = geography (sets the place)
const ROLES = {
  "animal-mammal": "a", "animal-bird": "a", "animal-amphibian": "a", "animal-reptile": "a", "animal-marine": "m", "animal-bug": "a",
  person: "a", "person-role": "a", "person-fantasy": "a", "person-activity": "a", "person-sport": "a", "person-resting": "a",
  "transport-ground": "v", "transport-water": "w", "transport-air": "f",
  "place-building": "b", "place-religious": "b", "place-other": "b",
  "place-geographic": "g",
  "sky & weather": "s",
  "plant-flower": "p", "plant-other": "p", "food-fruit": "p", "food-vegetable": "p", "food-prepared": "p", "food-asian": "p", "food-sweet": "p",
  drink: "p", dishware: "p", event: "p", "award-medal": "p", sport: "p", game: "p", "arts & crafts": "p", clothing: "p", sound: "p", music: "p",
  "musical-instrument": "p", phone: "p", computer: "p", "light & video": "p", "book-paper": "p", money: "p", mail: "p", writing: "p", office: "p",
  tool: "p", science: "p", medical: "p", household: "p", "other-object": "p", time: "p", hotel: "p",
};
const SKIP_SLUG = /track|fuel|traffic|stop sign|construction|motorway|anchor|ring buoy|seat|police car light|busstop|bus stop|oncoming|playground slide|wheel$/i;
const GEO_PLACE = {
  "snow-capped mountain": "mountain", mountain: "mountain", volcano: "mountain", "mount fuji": "mountain",
  camping: "forest", "national park": "forest", "beach with umbrella": "sea", "desert island": "sea", desert: "desert", "world map": "field",
};

const STOP = new Set(["في", "من", "على", "مع", "الى", "عن", "ذو", "ذات", "او", "و", "وجه", "رمز", "علامه", "شكل", "لون", "نوع"]);

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}
const bare = (w) => (w.startsWith("ال") && w.length > 4 ? w.slice(2) : w);

async function get(url, as = "text") {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(String(r.status));
      return as === "json" ? await r.json() : await r.text();
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
    }
  }
}

function minifySvg(svg) {
  return svg
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>/g, "")
    .replace(/\s(?:version|id|x|y|xml:space|style)="(?:1\.1|Layer_\w+|0px|preserve|enable-background:[^"]*)"/g, "")
    .replace(/xmlns:xlink="[^"]*"\s?/g, (m) => (svg.includes("xlink:") ? m : ""))
    .replace(/(-?\d*\.\d+)/g, (m) => {
      const v = Math.round(Number(m) * 10) / 10;
      // keep a leading "-": it may be the only separator from the previous number
      if (v === 0) return m.startsWith("-") ? "-0" : "0";
      return String(v).replace(/^(-?)0\./, "$1.");
    })
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

// ---------------------------------------------------------------- 1. symbols
const test = await get(SRC.test);
let subgroup = "";
const picked = [];
for (const line of test.split("\n")) {
  if (line.startsWith("# subgroup:")) subgroup = line.slice(11).trim();
  const m = line.match(/^([0-9A-F ]+?)\s*;\s*fully-qualified\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/);
  if (!m || !ROLES[subgroup]) continue;
  const cps = m[1].trim().split(/\s+/);
  if (cps.some((c) => /^1F3F[B-F]$/.test(c))) continue; // skin-tone variants
  if (cps.length > 1 && cps.some((c) => ["1F468", "1F469", "2640", "2642"].includes(c))) continue; // gendered duplicates
  const name = m[3].trim();
  if (SKIP_SLUG.test(name)) continue;
  picked.push({ emoji: m[2], cps, name, subgroup, role: ROLES[subgroup] });
}
console.log("candidates", picked.length);

// ---------------------------------------------------------------- 2. arabic words
const ann = { ...(await get(SRC.ann, "json")).annotations.annotations, ...(await get(SRC.annDerived, "json")).annotationsDerived.annotations };
const annFor = (e) => ann[e] || ann[e.replace(/️/g, "")];

// ---------------------------------------------------------------- 3. drawings
fs.mkdirSync(OUT_SVG, { recursive: true });
const symbols = [];
let bytes = 0;
const queue = picked.filter((p) => annFor(p.emoji));
await Promise.all(
  Array.from({ length: 12 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const file = p.cps.filter((c) => c !== "FE0F").map((c) => c.toLowerCase()).join("_");
      const svg = await get(SRC.noto(`emoji_u${file}.svg`));
      if (!svg) continue;
      const min = minifySvg(svg);
      if (min.length > 100_000) continue; // a handful of very detailed drawings aren't worth the weight
      fs.writeFileSync(path.join(OUT_SVG, `${file}.svg`), min);
      bytes += min.length;
      symbols.push({ ...p, file });
    }
  }),
);
symbols.sort((a, b) => a.file.localeCompare(b.file));
console.log("symbols", symbols.length, "svg KB", Math.round(bytes / 1024));

// ---------------------------------------------------------------- 4. letter trie
const byWord = new Map(); // word → Map(symbolIndex → score)
const add = (w, i, score) => {
  const k = bare(normalize(w));
  if (k.length < 2 || STOP.has(k) || !/^[\p{L}]+$/u.test(k)) return;
  const m = byWord.get(k) || new Map();
  m.set(i, Math.max(m.get(i) || 0, score));
  byWord.set(k, m);
};
symbols.forEach((s, i) => {
  const a = annFor(s.emoji);
  const tts = (a.tts || [])[0] || "";
  const ttsWords = tts.split(/\s+/);
  const face = /وجه/.test(tts) ? 2 : 0; // prefer the full-body drawing when both exist (🐈 over 🐱)
  if (ttsWords.length === 1) add(tts, i, 6 - face);
  ttsWords.forEach((w, j) => add(w, i, (j === 0 ? 4 : 2) - face));
  for (const kw of a.default || []) {
    const ws = kw.split(/\s+/);
    if (ws.length === 1) add(kw, i, 3 - face / 2);
    else ws.forEach((w) => add(w, i, 1));
  }
  s.nameAr = tts;
});

const trie = {};
let words = 0;
for (const [w, m] of byWord) {
  let list = [...m.entries()].sort((a, b) => b[1] - a[1] || symbols[a[0]].cps.length - symbols[b[0]].cps.length);
  // A word shared by many symbols ("حيوان", "طعام") says little: keep it only for strong matches.
  if (list.length > 8) list = list.filter(([, s]) => s >= 4);
  list = list.slice(0, 3);
  if (!list.length) continue;
  let node = trie;
  for (const ch of w) node = node[ch] ||= {};
  node.$ = list.map(([i]) => i.toString(36)).join(",");
  words++;
}

// Serialised depth-first: {ids} marks a word end, letter(…) opens a branch.
// Shared prefixes are stored once, so the index is the letters themselves.
function ser(node) {
  let out = node.$ ? `{${node.$}}` : "";
  for (const ch of Object.keys(node).filter((k) => k !== "$").sort()) out += `${ch}(${ser(node[ch])})`;
  return out;
}
const TRIE = ser(trie);
console.log("words", words, "trie KB", Math.round(TRIE.length / 1024));

const table = symbols.map((s) => [s.file, s.role, GEO_PLACE[s.name] || "", s.nameAr]);
fs.writeFileSync(
  OUT_TS,
  `// GENERATED by scripts/build-rumooz.mjs — do not edit by hand.\n` +
    `// Drawings: Noto Emoji (Apache-2.0). Arabic names: Unicode CLDR (Unicode License v3). See public/rumooz/LICENSES.txt\n` +
    `// [file, role, place, arabicName] — role: a actor, m sea creature, v vehicle, w boat, f aircraft, b building, p prop, s sky, g geography\n` +
    `export const SYMBOLS: [string, string, string, string][] = ${JSON.stringify(table)};\n` +
    `export const TRIE = ${JSON.stringify(TRIE)};\n`,
);

const [uni, noto] = [await get(SRC.unicodeLicense), await get(SRC.notoLicense)];
fs.writeFileSync(
  OUT_LIC,
  `«رموز» symbol library — third-party notices\n\n` +
    `Drawings in /rumooz/s are from Noto Emoji by Google (https://github.com/googlefonts/noto-emoji),\n` +
    `image resources licensed under the Apache License 2.0, minified (whitespace and number precision) by Ttbik.\n\n` +
    `Arabic names and keywords are from the Unicode CLDR annotations and the symbol list from Unicode emoji-test.txt,\n` +
    `used under the Unicode License v3:\n\n${uni}\n\n----\nApache License 2.0 (Noto Emoji):\n\n${noto}\n`,
);
console.log("done");
