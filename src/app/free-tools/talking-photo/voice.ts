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


// ---------------------------------------------------------------- fundamental frequency and formants
/** Median fundamental frequency (Hz) of the voiced parts, by normalised autocorrelation on up to 160 frames spread over the recording. */
export function estimateF0(x: Float32Array, sr = SR): number {
  const N = Math.round(sr * 0.04), minLag = Math.floor(sr / 420), maxLag = Math.ceil(sr / 70);
  let peak = 0; for (let i = 0; i < x.length; i += 7) peak = Math.max(peak, Math.abs(x[i]));
  const frames = Math.max(1, Math.floor((x.length - N - maxLag) / (sr * 0.01)));
  const step = Math.max(1, Math.floor(frames / 160)), found: number[] = [];
  for (let f = 0; f < frames; f += step) {
    const s0 = Math.floor(f * sr * 0.01);
    let e0 = 0; for (let i = 0; i < N; i += 2) e0 += x[s0 + i] * x[s0 + i];
    if (Math.sqrt(e0 / (N / 2)) < 0.08 * peak) continue;       // silence or breath
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0, e1 = 0;
      for (let i = 0; i < N; i += 2) { c += x[s0 + i] * x[s0 + i + lag]; e1 += x[s0 + i + lag] * x[s0 + i + lag]; }
      const r = c / Math.sqrt(e0 * e1 + 1e-12);
      if (r > best) { best = r; bestLag = lag; }
    }
    if (best > 0.55 && bestLag) found.push(sr / bestLag);
  }
  if (found.length < 3) return 130;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}

function fftIn(re: Float32Array, im: Float32Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
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
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Smooth spectral envelope (log magnitude, N/2+1 bins) of one windowed frame, by cepstral liftering: it follows the formants, not the harmonics. */
export function cepstralEnvelope(logMag: Float32Array, N: number, lifter: number): Float32Array {
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let k = 0; k <= N / 2; k++) { re[k] = logMag[k]; if (k > 0 && k < N / 2) re[N - k] = logMag[k]; }
  fftIn(re, im, true);                                        // the real cepstrum
  for (let q = 0; q < N; q++) { const qq = Math.min(q, N - q); if (qq > lifter) { re[q] = 0; im[q] = 0; } else if (qq === lifter) re[q] *= 0.5; }
  im.fill(0);
  fftIn(re, im, false);
  return re.slice(0, N / 2 + 1);
}

/**
 * Formant shift without changing the pitch: every frame's spectral envelope is moved along the frequency axis by `alpha` (> 1 = shorter vocal tract,
 * a smaller or female voice; < 1 = a bigger, deeper one) while the fine structure (the harmonics, hence the pitch) and the phase are kept.
 */
export function formantShift(x: Float32Array, alpha: number, sr = SR): Float32Array {
  if (Math.abs(alpha - 1) < 0.02) return x;
  const N = 1024, H = 256, win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const lifter = Math.max(14, Math.round(sr / 420));
  const out = new Float32Array(x.length + N), norm = new Float32Array(x.length + N);
  const re = new Float32Array(N), im = new Float32Array(N), logMag = new Float32Array(N / 2 + 1), mag = new Float32Array(N / 2 + 1), ph = new Float32Array(N / 2 + 1);
  for (let s0 = -N + H; s0 < x.length; s0 += H) {
    for (let i = 0; i < N; i++) { re[i] = (x[s0 + i] ?? 0) * win[i]; im[i] = 0; }
    fftIn(re, im, false);
    for (let k = 0; k <= N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); ph[k] = Math.atan2(im[k], re[k]); logMag[k] = Math.log(mag[k] + 1e-6); }
    const env = cepstralEnvelope(logMag, N, lifter);
    for (let k = 0; k <= N / 2; k++) {
      const src = k / alpha, k0 = Math.min(N / 2, Math.floor(src)), k1 = Math.min(N / 2, k0 + 1), f = src - k0;
      const envNew = src >= N / 2 ? env[N / 2] : env[k0] * (1 - f) + env[k1] * f;
      const m = Math.exp(logMag[k] - env[k] + envNew);
      re[k] = m * Math.cos(ph[k]); im[k] = m * Math.sin(ph[k]);
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    im[0] = 0; im[N / 2] = 0;
    fftIn(re, im, true);
    for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < out.length) { out[j] += re[i] * win[i]; norm[j] += win[i] * win[i]; } }
  }
  for (let i = 0; i < x.length; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
  return out.subarray(0, x.length);
}

/** Pitch to `targetHz` (from the speaker's own median f0) and formants by `formantRatio` overall (1 = as recorded). */
export function reshapeVoice(x: Float32Array, targetHz: number, formantRatio: number): Float32Array {
  const f0 = estimateF0(x);
  const ps = Math.min(2.9, Math.max(0.55, targetHz / f0));
  const shifted = Math.abs(ps - 1) < 0.03 ? x : pitchShift(x, 12 * Math.log2(ps));   // resampling moved the formants by ps as well ...
  return formantShift(shifted, formantRatio / (Math.abs(ps - 1) < 0.03 ? 1 : ps));      // ... so only the remainder is applied here
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
/** Loudness of the loud parts of a recording in dBFS: the 95th percentile of the RMS of 30 ms frames (about -20 for ordinary speech, above -10 for shouting). */
export function loudnessDb(x: Float32Array, sr: number): number {
  const n = Math.round(sr * 0.03), hop = Math.round(sr * 0.015), v: number[] = [];
  for (let s = 0; s + n <= x.length; s += hop) { let e = 0; for (let i = 0; i < n; i++) e += x[s + i] * x[s + i]; v.push(10 * Math.log10(e / n + 1e-10)); }
  if (!v.length) return -30;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length * 0.95)];
}

export async function applyEffect(decoded: AudioBuffer, id: EffectId): Promise<{ buffer: AudioBuffer; blob: Blob; loudDb: number }> {
  // work at 22.05 kHz mono (a voice needs no more, and everything below is faster)
  const ratio = decoded.sampleRate / SR;
  let x = resample(toMono(decoded), ratio);
  const loudDb = loudnessDb(x, SR);   // measured before the level is normalised: a shout must stay a shout
  // normalise the level
  let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak > 0) { const g = 0.85 / peak; x = x.map((v) => v * g); }

  // targets: a female voice sits around 210 Hz with vocal-tract resonances about 17 % higher than a male one, a child around 300 Hz and 38 % higher
  if (id === "female") x = reshapeVoice(x, 210, 1.17);
  else if (id === "girl") x = reshapeVoice(x, 300, 1.38);
  else if (id === "deep") x = reshapeVoice(x, 85, 0.86);
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
    x = await render(reshapeVoice(x, estimateF0(x) * 1.5, 1.45), (ctx, src) => {
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const depth = ctx.createGain(); depth.gain.value = 0.4; lfo.connect(depth); depth.connect(trem.gain); lfo.start();
      src.connect(trem); return trem;
    });
  } else if (id === "monster") {
    x = await render(reshapeVoice(x, estimateF0(x) * 0.62, 0.78), (ctx, src) => {
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
  return { buffer, blob: wavBlob(x, SR), loudDb };
}

export function wavBlob(x: Float32Array, sr: number): Blob {
  const n = x.length, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return new Blob([ab], { type: "audio/wav" });
}
