// Regenerates web/lib/glyphs.data.ts: in an empty folder run `npm i opentype.js`, copy this file there, run it (needs the DejaVu and Liberation fonts under /usr/share/fonts/truetype) and
// turn glyphs.json into the TS module (see its header). The outlines are committed, so nothing needs a font library or a font at runtime.
const opentype = require("opentype.js");
const fs = require("fs");
const F = "/usr/share/fonts/truetype/";
const load = (p) => { const b = fs.readFileSync(F + p); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const faces = {
  sans: [load("liberation/LiberationSans-Regular.ttf"), load("dejavu/DejaVuSans.ttf")],
  serif: [load("liberation/LiberationSerif-Bold.ttf"), load("dejavu/DejaVuSerif-Bold.ttf"), load("dejavu/DejaVuSans-Bold.ttf")],
};
let chars = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789·-&'.,?!:/()€₿✎؟";
const arabic = [0xFEAE, 0xFE97, 0xFE83];        // visual order, left to right, of "أثر": ر (final), ث (initial), أ (isolated)
const out = {};
for (const [name, list] of Object.entries(faces)) {
  out[name] = {};
  const put = (key, cp) => {
    for (const f of list) {
      const g = f.charToGlyph(String.fromCodePoint(cp));
      if (g && g.index !== 0) {
        const k = 1000 / f.unitsPerEm;
        const d = g.getPath(0, 0, 1000).toPathData(0);
        out[name][key] = [Math.round(g.advanceWidth * k), d];
        return true;
      }
    }
    return false;
  };
  for (const ch of chars) if (!put(ch, ch.codePointAt(0))) console.error("missing", name, ch);
  // the Arabic word of the header is drawn from its joined forms; it is stored under one private character
  const parts = arabic.map((cp) => { const f = list[1]; if (name !== 'sans') return {adv:0,d:''}; const g = f.charToGlyph(String.fromCodePoint(cp)); if (g.index === 0) console.error("missing arabic", cp.toString(16)); return { adv: g.advanceWidth * 1000 / f.unitsPerEm, d: g.getPath(0, 0, 1000).toPathData(0) }; });
  let x = 0, ds = [];
  for (const p of parts) { ds.push(["translate", Math.round(x), p.d]); x += p.adv; }
  out[name][""] = [Math.round(x), ds];
}
// path data: tighten it (no spaces before negative numbers)
const tight = (d) => d;
fs.writeFileSync("glyphs.json", JSON.stringify(out));
console.log(Object.keys(out.sans).length, JSON.stringify(out).length);
