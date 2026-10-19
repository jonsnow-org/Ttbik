/**
 * Viseme detection from the voice, a reduced offline re-implementation of the method of HeadAudio by Mika Suominen
 * (https://github.com/met4citizen/HeadAudio, MIT License) which follows hecomi's uLipSync / wLipSync (MIT):
 *   16 kHz audio -> pre-emphasis -> 512-sample Hamming frames every 256 samples -> FFT -> 40 mel bands -> log -> DCT (12 coefficients)
 *   -> lifter -> tanh compression -> Mahalanobis distance to 39 Gaussian prototypes of the 15 "Oculus" visemes (pre-trained model
 *   public/tools/talking-photo/viseme-model.bin, from HeadAudio, MIT) -> soft weights per viseme.
 * HeadAudio runs this live in an AudioWorklet and votes among the last frames; here the whole recording is available, so every frame is kept
 * as soft weights and turned into our mouth parameters (jaw J, spread S, round R, hiss F), which lets two visemes blend.
 * The model was trained on English speech; the vowels a / i / u / e / o and the closed-lip, hissing and tongue sounds are shared by Arabic.
 */
import type { Track } from "./engine";

const SR = 16000, N = 512, HOP = 256, BANDS = 40, COEFF = 12, LIFTER = 22;
const SIL = 14;
// aa E I O U PP SS TH DD FF kk nn RR CH sil
const VIS_NAMES = ["aa", "E", "I", "O", "U", "PP", "SS", "TH", "DD", "FF", "kk", "nn", "RR", "CH", "sil"] as const;
//                       J     S     R     F   (jaw drop, lip spread, lip round, hiss / teeth)
const MOUTH: Record<(typeof VIS_NAMES)[number], [number, number, number, number]> = {
  aa: [0.85, 0.2, 0, 0], E: [0.5, 0.65, 0, 0], I: [0.28, 1.0, 0, 0.2], O: [0.6, 0, 0.8, 0], U: [0.3, 0, 1.0, 0],
  PP: [0, 0, 0, 0], SS: [0.12, 0.6, 0, 1], TH: [0.2, 0.3, 0, 0.5], DD: [0.22, 0.3, 0, 0.2], FF: [0.12, 0.2, 0, 0.7],
  kk: [0.3, 0.2, 0, 0], nn: [0.18, 0.25, 0, 0], RR: [0.3, 0.1, 0.35, 0], CH: [0.2, 0.1, 0.5, 0.6], sil: [0, 0, 0, 0],
};

export type Prototype = { viseme: number; mu: Float32Array; sigmaInvLower: Float32Array };

export async function loadVisemeModel(url: string): Promise<Prototype[]> {
  const buf = await (await fetch(url)).arrayBuffer();
  const recLen = 2 + COEFF + (COEFF * (COEFF + 1)) / 2, recBytes = recLen * 4, out: Prototype[] = [];
  for (let pos = 0; pos + recBytes <= buf.byteLength; pos += recBytes) {
    const dv = new DataView(buf, pos, 8);
    const viseme = dv.getUint8(7);
    out.push({ viseme, mu: new Float32Array(buf, pos + 8, COEFF), sigmaInvLower: new Float32Array(buf, pos + 8 + COEFF * 4, (COEFF * (COEFF + 1)) / 2) });
  }
  if (!out.length) throw new Error("empty viseme model");
  return out;
}

/** Mono samples at `sr` -> 16 kHz: windowed-sinc low-pass + linear interpolation (the same idea as HeadAudio's polyphase filter). */
function to16k(x: Float32Array, sr: number): Float32Array {
  if (Math.abs(sr - SR) < 1) return x;
  const ratio = sr / SR, n = Math.floor(x.length / ratio), out = new Float32Array(n);
  const taps = 16, cut = Math.min(0.45, 0.45 / Math.max(1, ratio));
  for (let i = 0; i < n; i++) {
    const c = i * ratio; let acc = 0, wsum = 0;
    for (let j = -taps; j <= taps; j++) {
      const k = Math.round(c) + j, u = k - c, v = x[k];
      if (v === undefined) continue;
      const s = u === 0 ? 2 * cut : Math.sin(2 * Math.PI * cut * u) / (Math.PI * u);
      const w = (s * (0.54 + 0.46 * Math.cos((Math.PI * u) / (taps + 1)))) ;
      acc += v * w; wsum += w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}

function fft512(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** MFCC frames (12 coefficients, tanh compressed) and log energy per frame. */
export function mfccFrames(x16: Float32Array): { mfcc: Float32Array[]; le: Float32Array } {
  // pre-emphasis
  const pe = new Float32Array(x16.length);
  for (let i = 0; i < x16.length; i++) pe[i] = x16[i] - 0.97 * (x16[i - 1] ?? 0);
  const hamming = new Float32Array(N); for (let i = 0; i < N; i++) hamming[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1));
  // mel filterbank 30..7800 Hz
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700), melInv = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);
  const lo = mel(30), hi = mel(7800);
  const pts = Array.from({ length: BANDS + 2 }, (_, i) => Math.floor((melInv(lo + ((hi - lo) / (BANDS + 1)) * i) / SR) * N));
  const filters: Float32Array[] = [];
  for (let b = 0; b < BANDS; b++) {
    const f = new Float32Array(N / 2);
    for (let k = pts[b]; k < pts[b + 1]; k++) f[k] = (k - pts[b]) / Math.max(1, pts[b + 1] - pts[b]);
    for (let k = pts[b + 1]; k < pts[b + 2]; k++) f[k] = (pts[b + 2] - k) / Math.max(1, pts[b + 2] - pts[b + 1]);
    filters.push(f);
  }
  const dct: Float32Array[] = [], scale = Math.sqrt(2 / BANDS);
  for (let i = 1; i <= COEFF; i++) { const row = new Float32Array(BANDS); for (let j = 0; j < BANDS; j++) row[j] = scale * Math.cos((Math.PI * i * (j + 0.5)) / BANDS); dct.push(row); }
  const lift = Array.from({ length: COEFF }, (_, i) => 1 + (LIFTER / 2) * Math.sin((Math.PI * (i + 1)) / LIFTER));
  const frames = Math.max(0, Math.floor((pe.length - N) / HOP) + 1);
  const re = new Float32Array(N), im = new Float32Array(N), power = new Float32Array(N / 2), en = new Float32Array(BANDS);
  const mfcc: Float32Array[] = [], le = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = pe[f * HOP + i] * hamming[i]; im[i] = 0; }
    fft512(re, im);
    let tot = 0;
    for (let k = 0; k < N / 2; k++) { power[k] = (re[k] * re[k] + im[k] * im[k]) / N; tot += power[k]; }
    le[f] = Math.log10(tot + 1e-10);
    for (let b = 0; b < BANDS; b++) { let s = 0; const fb = filters[b]; for (let k = 0; k < N / 2; k++) s += power[k] * fb[k]; en[b] = Math.log10(s + 1e-10); }
    const v = new Float32Array(COEFF);
    for (let i = 0; i < COEFF; i++) { let s = 0; const row = dct[i]; for (let j = 0; j < BANDS; j++) s += row[j] * en[j]; v[i] = Math.tanh(s * lift[i]); }
    mfcc.push(v);
  }
  return { mfcc, le };
}

function mahalanobis(v: Float32Array, p: Prototype): number {
  const diff = new Float32Array(COEFF);
  for (let i = 0; i < COEFF; i++) diff[i] = v[i] - p.mu[i];
  let d = 0, idx = 0;
  for (let i = 0; i < COEFF; i++) {   // sigmaInvLower is the lower triangle of the inverse covariance, row by row
    for (let j = 0; j < i; j++, idx++) d += 2 * p.sigmaInvLower[idx] * diff[i] * diff[j];
    d += p.sigmaInvLower[idx++] * diff[i] * diff[i];
  }
  return d;
}

export type VisemeFrame = { w: Float32Array; active: boolean };   // soft weight per viseme (15), and whether anyone is speaking

export function classifyFrames(x: Float32Array, sr: number, model: Prototype[]): VisemeFrame[] {
  const { mfcc, le } = mfccFrames(to16k(x, sr));
  const T = 4;   // temperature of the soft-min over Mahalanobis distances
  return mfcc.map((v, f) => {
    const dmin = new Float32Array(VIS_NAMES.length).fill(Infinity);
    for (const p of model) { let d = mahalanobis(v, p); if (p.viseme === SIL) d /= 1.2; if (d < dmin[p.viseme]) dmin[p.viseme] = d; }
    const base = Math.min(...dmin);
    const w = new Float32Array(VIS_NAMES.length); let sum = 0;
    for (let i = 0; i < w.length; i++) { w[i] = Number.isFinite(dmin[i]) ? Math.exp(-(dmin[i] - base) / T) : 0; sum += w[i]; }
    const active = le[f] > -4.2;   // HeadAudio's voice gate: below about -42 dB there is nobody speaking
    if (!active) { w.fill(0); w[SIL] = 1; return { w, active }; }
    for (let i = 0; i < w.length; i++) w[i] /= sum || 1;
    return { w, active };
  });
}

/** Replaces the mouth curves (J, S, R, F) of a loudness-based track by the viseme-based ones; E and B (loudness, brows) are kept. */
export function refineTrack(track: Track, x: Float32Array, sr: number, model: Prototype[]): Track {
  const frames = classifyFrames(x, sr, model);
  if (!frames.length) return track;
  const fpsIn = SR / HOP, n = track.J.length;
  const J = new Float32Array(n), S = new Float32Array(n), R = new Float32Array(n), F = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const pos = (f / track.fps) * fpsIn, i = Math.min(frames.length - 1, Math.floor(pos)), i2 = Math.min(frames.length - 1, i + 1), k = pos - i;
    let j = 0, s = 0, r = 0, ff = 0;
    for (let v = 0; v < VIS_NAMES.length; v++) {
      const w = frames[i].w[v] * (1 - k) + frames[i2].w[v] * k, m = MOUTH[VIS_NAMES[v]];
      j += w * m[0]; s += w * m[1]; r += w * m[2]; ff += w * m[3];
    }
    const loud = Math.min(1, 0.35 + 0.9 * track.E[f]);   // quiet syllables open less
    J[f] = Math.min(1, j * loud); S[f] = Math.min(1, s * (0.5 + 0.5 * loud)); R[f] = Math.min(1, r); F[f] = Math.min(1, ff);
  }
  // the mouth leads the sound by about two frames, then smooth (fast attack, slower release)
  const shift = (a: Float32Array) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[Math.min(a.length - 1, i + 2)]; return o; };
  const smooth = (a: Float32Array, up: number, down: number) => { const o = new Float32Array(a.length); let v = 0; for (let i = 0; i < a.length; i++) { v += (a[i] - v) * (a[i] > v ? up : down); o[i] = v; } return o; };
  return { ...track, J: smooth(shift(J), 0.75, 0.45), S: smooth(shift(S), 0.55, 0.35), R: smooth(shift(R), 0.55, 0.35), F: smooth(shift(F), 0.65, 0.5) };
}
