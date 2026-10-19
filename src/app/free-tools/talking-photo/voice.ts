/**
 * Voice effects for the talking photo, all in the browser (no library, no download):
 * pitch shifting = resampling (which moves pitch and formants together, like a younger or older speaker) followed by WSOLA time-stretching to
 * restore the original duration; robot / alien / monster / radio are small Web Audio graphs rendered offline.
 * The result is an ordinary mono AudioBuffer at 22.05 kHz, which is then analysed for the mouth and played / recorded like any voice.
 */

export type EffectId = "original" | "female" | "girl" | "deep" | "robot" | "alien" | "monster" | "radio";
export const EFFECTS: { id: EffectId; ar: string; en: string }[] = [
  { id: "original", ar: "الصوت الأصلي", en: "Original" },
  { id: "female", ar: "أنثى", en: "Female" },
  { id: "girl", ar: "طفلة / صوت رفيع", en: "Girl / high" },
  { id: "deep", ar: "رجل عميق", en: "Deep male" },
  { id: "robot", ar: "روبوت", en: "Robot" },
  { id: "alien", ar: "فضائي", en: "Alien" },
  { id: "monster", ar: "وحش", en: "Monster" },
  { id: "radio", ar: "راديو قديم", en: "Old radio" },
];

const SR = 22050;

function toMono(buf: AudioBuffer): Float32Array {
  const n = buf.length, ch = buf.numberOfChannels, out = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ch; }
  return out;
}

/** Linear-interpolation resampling: `ratio` > 1 makes it shorter (and higher). A light moving average first when going down in rate (anti-alias). */
function resample(x: Float32Array, ratio: number): Float32Array {
  let src = x;
  if (ratio > 1.2) {
    const k = Math.round(ratio), sm = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) { let a = 0, c = 0; for (let j = -k; j <= k; j++) { const v = x[i + j]; if (v !== undefined) { a += v; c++; } } sm[i] = a / c; }
    src = sm;
  }
  const n = Math.floor(src.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * ratio, k = Math.floor(p), f = p - k; out[i] = (src[k] ?? 0) * (1 - f) + (src[k + 1] ?? 0) * f; }
  return out;
}

/** WSOLA time stretch: output length = input length * factor, pitch unchanged. */
function wsola(x: Float32Array, factor: number): Float32Array {
  const N = 1024, Ha = N / 2, Hs = Ha / factor, S = 128;
  const outLen = Math.floor(x.length * factor) + N;
  const out = new Float32Array(outLen), norm = new Float32Array(outLen);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let prevStart = 0;
  for (let k = 0; ; k++) {
    const outPos = k * Ha;
    if (outPos + N > outLen) break;
    const target = Math.round(k * Hs);
    if (target > x.length - N) break;
    let best = target;
    if (k > 0) {
      // the natural continuation of the previous segment is what the new one should line up with
      const ref = prevStart + Ha;
      let bestScore = -Infinity;
      for (let d = -S; d <= S; d += 2) {
        const c = target + d;
        if (c < 0 || c + N > x.length) continue;
        let sc = 0;
        for (let i = 0; i < Ha; i += 2) sc += (x[ref + i] ?? 0) * x[c + i];
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
    }
    for (let i = 0; i < N; i++) { out[outPos + i] += x[best + i] * win[i]; norm[outPos + i] += win[i]; }
    prevStart = best;
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
  return out.subarray(0, Math.floor(x.length * factor));
}

export function pitchShift(x: Float32Array, semitones: number): Float32Array {
  const r = Math.pow(2, semitones / 12);
  return wsola(resample(x, r), r);
}

async function render(x: Float32Array, build: (ctx: OfflineAudioContext, src: AudioBufferSourceNode) => AudioNode, tail = 0.2): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, x.length + Math.round(tail * SR), SR);
  const b = ctx.createBuffer(1, x.length, SR); b.getChannelData(0).set(x);
  const src = ctx.createBufferSource(); src.buffer = b;
  build(ctx, src).connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0).slice();
}

const curve = (k: number) => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); } return c; };

/** Applies an effect to a decoded voice and returns the processed mono buffer and a WAV blob of it. */
export async function applyEffect(decoded: AudioBuffer, id: EffectId): Promise<{ buffer: AudioBuffer; blob: Blob }> {
  // work at 22.05 kHz mono (a voice needs no more, and everything below is faster)
  const ratio = decoded.sampleRate / SR;
  let x = resample(toMono(decoded), ratio);
  // normalise the level
  let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak > 0) { const g = 0.85 / peak; x = x.map((v) => v * g); }

  if (id === "female") x = pitchShift(x, 4);
  else if (id === "girl") x = pitchShift(x, 8);
  else if (id === "deep") x = pitchShift(x, -4);
  else if (id === "robot") {
    x = await render(pitchShift(x, -1), (ctx, src) => {
      const ring = ctx.createGain(); ring.gain.value = 0;
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = 55; osc.connect(ring.gain); osc.start();
      src.connect(ring);
      const mix = ctx.createGain();
      const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.006;
      const fb = ctx.createGain(); fb.gain.value = 0.55;
      ring.connect(mix); ring.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(mix);
      const dry = ctx.createGain(); dry.gain.value = 0.25; src.connect(dry); dry.connect(mix);
      return mix;
    });
  } else if (id === "alien") {
    x = await render(pitchShift(x, 6), (ctx, src) => {
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const depth = ctx.createGain(); depth.gain.value = 0.4; lfo.connect(depth); depth.connect(trem.gain); lfo.start();
      src.connect(trem); return trem;
    });
  } else if (id === "monster") {
    x = await render(pitchShift(x, -7), (ctx, src) => {
      const sh = ctx.createWaveShaper(); sh.curve = curve(30);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
      src.connect(sh); sh.connect(lp); return lp;
    });
  } else if (id === "radio") {
    x = await render(x, (ctx, src) => {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 450;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2800;
      const sh = ctx.createWaveShaper(); sh.curve = curve(6);
      src.connect(hp); hp.connect(lp); lp.connect(sh); return sh;
    });
  }
  // back to a 0.9 peak
  peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak > 0) { const g = 0.9 / peak; x = x.map((v) => v * g); }

  const ac = new OfflineAudioContext(1, Math.max(1, x.length), SR);
  const buffer = ac.createBuffer(1, Math.max(1, x.length), SR); buffer.getChannelData(0).set(x);
  return { buffer, blob: wavBlob(x, SR) };
}

export function wavBlob(x: Float32Array, sr: number): Blob {
  const n = x.length, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return new Blob([ab], { type: "audio/wav" });
}
