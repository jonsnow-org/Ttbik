// Regenerates fixtures/expected.json from the TypeScript implementations (src/app/free-tools/talking-photo/{viseme,voice}.ts) on fixtures/input.json.
//   node fixtures/gen_fixtures.mjs            (needs `esbuild` resolvable: `npm i --no-save esbuild` somewhere, or NODE_PATH)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "../../..");
const require = createRequire(import.meta.url);
let esbuild; for (const p of ["esbuild", ...(process.env.ESBUILD_PATH ? [process.env.ESBUILD_PATH] : [])]) { try { esbuild = require(p); break; } catch { /* next */ } }
if (!esbuild) throw new Error("esbuild not found: npm i --no-save esbuild, or set ESBUILD_PATH to its folder");
const build = async (file) => {
  const r = await esbuild.build({ entryPoints: [path.join(root, "src/app/free-tools/talking-photo", file)], bundle: true, format: "esm", write: false, platform: "node", logLevel: "silent" });
  const out = path.join(here, `.tmp-${file}.mjs`); fs.writeFileSync(out, r.outputFiles[0].text); return import(out);
};
const V = await build("viseme.ts"), W = await build("voice.ts");

const input = JSON.parse(fs.readFileSync(path.join(here, "input.json"), "utf8"));
const f32 = (b64) => { const b = Buffer.from(b64, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const b64 = (a) => Buffer.from(new Float32Array(a).buffer).toString("base64");
const x16 = f32(input["16000"].b64), x22 = f32(input["22050"].b64);

// the viseme model, parsed exactly as loadVisemeModel does (it fetches a URL; here the file is read)
const COEFF = 12, recLen = 2 + COEFF + (COEFF * (COEFF + 1)) / 2, recBytes = recLen * 4;
const buf = fs.readFileSync(path.join(here, "viseme-model.bin")), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), model = [];
for (let pos = 0; pos + recBytes <= ab.byteLength; pos += recBytes) {
  const dv = new DataView(ab, pos, 8);
  model.push({ viseme: dv.getUint8(7), mu: new Float32Array(ab, pos + 8, COEFF), sigmaInvLower: new Float32Array(ab, pos + 8 + COEFF * 4, (COEFF * (COEFF + 1)) / 2) });
}
const { mfcc, le } = V.mfccFrames(x16);
const frames = V.classifyFrames(x16, 16000, model);
const argmax = frames.map((fr) => { let b = 0; for (let i = 1; i < fr.w.length; i++) if (fr.w[i] > fr.w[b]) b = i; return b; });
const out = {
  generated_by: "fixtures/gen_fixtures.mjs from src/app/free-tools/talking-photo/{viseme,voice}.ts",
  viseme: { frames: mfcc.length, mfcc: mfcc.slice(0, 40).map((v) => Array.from(v)), le: Array.from(le.slice(0, 40)), argmax, active: frames.map((f) => f.active), weights_first: frames.slice(0, 30).map((f) => Array.from(f.w)) },
  voice: {
    f0: W.estimateF0(x22, 22050),
    pitch_shift_5: b64(W.pitchShift(x22, 5)),
    formant_117: b64(W.formantShift(x22, 1.17, 22050)),
    reshape_female: b64(W.reshapeVoice(x22, 210, 1.17)),
    loudness_db: W.loudnessDb(x22, 22050),
  },
};
fs.writeFileSync(path.join(here, "expected.json"), JSON.stringify(out));
for (const f of fs.readdirSync(here)) if (f.startsWith(".tmp-")) fs.unlinkSync(path.join(here, f));
console.log("expected.json written", { frames: mfcc.length, f0: out.voice.f0, loudness: out.voice.loudness_db });
