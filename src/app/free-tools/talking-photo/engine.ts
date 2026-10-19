/**
 * Talking-photo engine (browser only, no server, no model weights of our own).
 *
 * 1. Audio -> mouth weights. The voice is decoded once and analysed frame by frame (30 fps): loudness gives how much the jaw moves, the first
 *    formant (F1, 250-1000 Hz) gives how wide the mouth opens (an "a" has a high F1, "i" and "u" a low one), the second formant (F2, 1-3 kHz)
 *    separates spread lips ("i", "e") from rounded lips ("u", "o"), and a lot of energy above 4 kHz marks hissing sounds ("s", "sh"), which
 *    keep the teeth almost together. The curves are shifted 2 frames early (the mouth moves before the sound) and smoothed with different
 *    attack and release speeds.
 * 2. Face -> mesh. The face landmarks (MediaPipe, 468 points) or, for drawings, a synthetic ring of points around the mouth that the user placed,
 *    plus static anchor points around them, are triangulated (Delaunay). Each frame the points are displaced (jaw drop, lip width, upper-lip raise,
 *    eyelid blink) and every moved triangle is re-drawn with an affine texture mapping from the original picture, so the real skin and lips move.
 * 3. The inside of the mouth (throat, upper and lower teeth, tongue) is painted into the opening between the displaced inner lips.
 * 4. The whole picture sways slightly like a speaking head (roll, nod with emphasis, drift, breathing) and is scaled up a little so no edge shows.
 */

export type Pt = { x: number; y: number };

// ---------------------------------------------------------------- audio -> weights
export type Track = { fps: number; J: Float32Array; S: Float32Array; R: Float32Array; F: Float32Array; E: Float32Array };
export type Weights = { J: number; S: number; R: number; F: number; E: number };

function fft(re: Float32Array, im: Float32Array) {
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
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function analyzeAudio(buf: AudioBuffer, fps = 30): Track {
  const sr = buf.sampleRate;
  const ch = buf.getChannelData(0);
  const N = sr >= 32000 ? 2048 : 1024;
  const frames = Math.max(1, Math.ceil(buf.duration * fps));
  const hop = sr / fps;
  const re = new Float32Array(N), im = new Float32Array(N);
  const hann = new Float32Array(N); for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const bin = (f: number) => Math.min(N / 2 - 1, Math.max(1, Math.round((f * N) / sr)));
  const db = new Float32Array(frames), c1 = new Float32Array(frames), c2 = new Float32Array(frames), hi = new Float32Array(frames), lowShare = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(f * hop - N / 2);
    let sum = 0;
    for (let i = 0; i < N; i++) { const s = ch[start + i] ?? 0; re[i] = s * hann[i]; im[i] = 0; sum += s * s; }
    db[f] = 10 * Math.log10(sum / N + 1e-10);
    fft(re, im);
    const pw = (k: number) => re[k] * re[k] + im[k] * im[k];
    let tot = 0, low = 0, hiE = 0, w1 = 0, e1 = 0, w2 = 0, e2 = 0;
    for (let k = bin(120); k < bin(Math.min(8000, sr / 2 - 1)); k++) {
      const p = pw(k), fr = (k * sr) / N;
      tot += p;
      if (fr < 1000) low += p;
      if (fr >= 4000) hiE += p;
      if (fr >= 250 && fr < 1000) { w1 += p * fr; e1 += p; }
      if (fr >= 1000 && fr < 3200) { w2 += p * fr; e2 += p; }
    }
    c1[f] = e1 > 0 ? w1 / e1 : 500; c2[f] = e2 > 0 ? w2 / e2 : 1500;
    hi[f] = tot > 0 ? hiE / tot : 0; lowShare[f] = tot > 0 ? low / tot : 0;
  }
  // loudness relative to this recording: the loud part (95th percentile) is "full", 38 dB below it is silence
  const sorted = Array.from(db).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? -30;
  const J = new Float32Array(frames), S = new Float32Array(frames), R = new Float32Array(frames), F = new Float32Array(frames), E = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const e = clamp01((db[f] - (p95 - 38)) / 38);
    E[f] = e;
    if (e < 0.1) continue;                                   // silence or breath: lips together
    const fric = hi[f] > 0.45 && lowShare[f] < 0.4;           // s, sh, f
    const f1 = clamp01((c1[f] - 380) / (860 - 380));          // high F1 = wide open
    const f2 = clamp01((c2[f] - 1100) / (2300 - 1100));       // high F2 = spread lips
    if (fric) { J[f] = 0.14 * e; S[f] = 0.75; F[f] = 1; continue; }
    J[f] = Math.pow(e, 0.7) * (0.28 + 0.72 * f1);
    S[f] = f2 * (0.4 + 0.6 * e);
    R[f] = (1 - f2) * (1 - f1) * smoothstep(0.1, 0.35, e);    // low F1 and low F2 = "u", "o"
  }
  // the mouth leads the sound by about two frames, then smooth with a fast attack and a slower release
  const shift = (a: Float32Array) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[Math.min(a.length - 1, i + 2)]; return o; };
  const smooth = (a: Float32Array, up: number, down: number) => {
    const o = new Float32Array(a.length); let v = 0;
    for (let i = 0; i < a.length; i++) { v += (a[i] - v) * (a[i] > v ? up : down); o[i] = v; }
    return o;
  };
  return { fps, J: smooth(shift(J), 0.7, 0.4), S: smooth(shift(S), 0.5, 0.3), R: smooth(shift(R), 0.5, 0.3), F: smooth(shift(F), 0.6, 0.5), E: smooth(shift(E), 0.7, 0.35) };
}

export function sampleTrack(tr: Track | null, t: number): Weights {
  if (!tr) return { J: 0, S: 0, R: 0, F: 0, E: 0 };
  const x = Math.max(0, t) * tr.fps, i = Math.floor(x), k = x - i, n = tr.J.length - 1;
  const g = (a: Float32Array) => a[Math.min(n, i)] * (1 - k) + a[Math.min(n, i + 1)] * k;
  return { J: g(tr.J), S: g(tr.S), R: g(tr.R), F: g(tr.F), E: g(tr.E) };
}

// ---------------------------------------------------------------- Delaunay (Bowyer-Watson)
export function delaunay(pts: Pt[]): [number, number, number][] {
  const n = pts.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const d = Math.max(maxX - minX, maxY - minY) * 20 + 1, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const P = pts.concat([{ x: mx - d, y: my - d }, { x: mx, y: my + d }, { x: mx + d, y: my - d }]);
  type T = { a: number; b: number; c: number; cx: number; cy: number; r2: number };
  const mk = (a: number, b: number, c: number): T => {
    const A = P[a], B = P[b], C = P[c];
    const dd = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y)) || 1e-9;
    const ux = ((A.x * A.x + A.y * A.y) * (B.y - C.y) + (B.x * B.x + B.y * B.y) * (C.y - A.y) + (C.x * C.x + C.y * C.y) * (A.y - B.y)) / dd;
    const uy = ((A.x * A.x + A.y * A.y) * (C.x - B.x) + (B.x * B.x + B.y * B.y) * (A.x - C.x) + (C.x * C.x + C.y * C.y) * (B.x - A.x)) / dd;
    return { a, b, c, cx: ux, cy: uy, r2: (A.x - ux) ** 2 + (A.y - uy) ** 2 };
  };
  let tris: T[] = [mk(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const bad: T[] = [], keep: T[] = [];
    for (const t of tris) ((p.x - t.cx) ** 2 + (p.y - t.cy) ** 2 < t.r2 - 1e-9 ? bad : keep).push(t);
    const edges = new Map<string, [number, number]>();
    for (const t of bad) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (edges.has(key)) edges.delete(key); else edges.set(key, [u, v]);
    }
    tris = keep;
    for (const [u, v] of edges.values()) tris.push(mk(u, v, i));
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

// ---------------------------------------------------------------- face model
export type Model = {
  pts: Pt[];                 // rest positions (picture pixels)
  tris: [number, number, number][];
  moving: [number, number, number][];     // triangles that can ever move
  inner: number[];           // inner-lip loop (upper from corner to corner, then lower back)
  upperInner: number[]; lowerInner: number[];
  lowerLips: number[]; upperLips: number[];   // lip points that follow the jaw fully (lower) or stay with the face (upper)
  mouth: { x: number; y: number; w: number };
  jawW: Float32Array; lipG: Float32Array; isAnchor: boolean[];
  eyes: { upper: number[]; lower: number[] }[];
  landmark: boolean;
};

const LM = {
  inner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
  upperInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  lowerInner: [324, 318, 402, 317, 14, 87, 178, 88, 95],
  lowerOuter: [375, 321, 405, 314, 17, 84, 181, 91, 146],
  upperOuter: [185, 40, 39, 37, 0, 267, 269, 270, 409],
  eyeR: { upper: [246, 161, 160, 159, 158, 157, 173], lower: [33, 7, 163, 144, 145, 153, 154, 155, 133] },
  eyeL: { upper: [466, 388, 387, 386, 385, 384, 398], lower: [263, 249, 390, 373, 374, 380, 381, 382, 362] },
};

function anchorsAround(W: number, H: number, box: { x0: number; y0: number; x1: number; y1: number }): Pt[] {
  const a: Pt[] = [];
  for (let i = 0; i <= 6; i++) { a.push({ x: (W * i) / 6, y: 0 }, { x: (W * i) / 6, y: H }); }
  for (let i = 1; i < 6; i++) { a.push({ x: 0, y: (H * i) / 6 }, { x: W, y: (H * i) / 6 }); }
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, rx = ((box.x1 - box.x0) / 2) * 1.45, ry = ((box.y1 - box.y0) / 2) * 1.4;
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    a.push({ x: Math.min(W, Math.max(0, cx + Math.cos(t) * rx)), y: Math.min(H, Math.max(0, cy + Math.sin(t) * ry)) });
  }
  return a;
}

function finish(m: { pts: Pt[]; inner: number[]; upperInner: number[]; lowerInner: number[]; lowerLips: number[]; upperLips: number[]; mouth: Model["mouth"]; nFace: number; eyes: Model["eyes"]; landmark: boolean; box: { x0: number; y0: number; x1: number; y1: number } }, W: number, H: number): Model {
  const pts = m.pts.concat(anchorsAround(W, H, m.box));
  const isAnchor = pts.map((_, i) => i >= m.nFace);
  const tris = delaunay(pts);
  const { x: mx, y: my, w: mw } = m.mouth;
  const fw = (m.box.x1 - m.box.x0) / 2;
  const jawW = new Float32Array(pts.length), lipG = new Float32Array(pts.length);
  pts.forEach((p, i) => {
    if (isAnchor[i]) return;
    const dy = p.y - my, dx = Math.abs(p.x - mx);
    jawW[i] = smoothstep(-0.15 * mw, 0.35 * mw, dy) * (1 - smoothstep(0.55 * fw, 1.0 * fw, dx) * 0.85);
    lipG[i] = Math.exp(-((dx / (0.95 * mw)) ** 2 + (dy / (0.75 * mw)) ** 2));
  });
  // the lower lip follows the jaw most in the middle and hardly at the corners, so the opening is rounded, not boxy
  for (const i of m.lowerLips) jawW[i] = Math.max(0.12, 1 - 0.88 * Math.min(1, Math.abs(pts[i].x - mx) / (0.5 * mw)) ** 2);
  for (const i of m.upperLips) jawW[i] = 0;
  const eyeIdx = new Set<number>(); m.eyes.forEach((e) => { e.upper.forEach((i) => eyeIdx.add(i)); e.lower.forEach((i) => eyeIdx.add(i)); });
  const potential = (i: number) => jawW[i] > 0.01 || lipG[i] > 0.01 || eyeIdx.has(i);
  const moving = tris.filter((t) => potential(t[0]) || potential(t[1]) || potential(t[2]));
  return { pts, tris, moving, inner: m.inner, upperInner: m.upperInner, lowerInner: m.lowerInner, lowerLips: m.lowerLips, upperLips: m.upperLips, mouth: m.mouth, jawW, lipG, isAnchor, eyes: m.eyes, landmark: m.landmark };
}

/** From MediaPipe landmarks (normalised x,y). */
export function modelFromLandmarks(lm: Pt[], W: number, H: number): Model {
  const pts = lm.slice(0, 468).map((p) => ({ x: p.x * W, y: p.y * H }));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const a = pts[61], b = pts[291], t = pts[13], u = pts[14];
  const mouth = { x: (t.x + u.x) / 2, y: (t.y + u.y) / 2, w: Math.hypot(b.x - a.x, b.y - a.y) };
  return finish({ pts, inner: LM.inner, upperInner: LM.upperInner.filter((i) => i !== 78 && i !== 308), lowerInner: LM.lowerInner, lowerLips: [...LM.lowerInner, ...LM.lowerOuter], upperLips: [...LM.upperInner.filter((i) => i !== 78 && i !== 308), ...LM.upperOuter], mouth, nFace: pts.length, eyes: [LM.eyeR, LM.eyeL], landmark: true, box: { x0, y0, x1, y1 } }, W, H);
}

/** For drawings, animals, statues: a ring of points built around the mouth the user placed. */
export function modelFromMouth(mouth: { x: number; y: number; w: number }, W: number, H: number): Model {
  const pts: Pt[] = [];
  const { x: mx, y: my, w: mw } = mouth;
  const inner: number[] = [];
  // inner lip loop: a very flat ellipse (closed mouth): the upper half from the left corner to the right corner, then the lower half back
  for (let i = 0; i < 10; i++) { const t = Math.PI + (i / 9) * Math.PI; pts.push({ x: mx + Math.cos(t) * mw * 0.46, y: my + Math.sin(t) * mw * 0.03 }); inner.push(pts.length - 1); }
  for (let i = 1; i < 9; i++) { const t = (i / 9) * Math.PI; pts.push({ x: mx + Math.cos(t) * mw * 0.46, y: my + Math.sin(t) * mw * 0.03 }); inner.push(pts.length - 1); }
  const upperInner = inner.slice(0, 10), lowerInner = inner.slice(10);
  // lips and surroundings: three rings so the skin around the mouth deforms smoothly
  const ring = (rx: number, ry: number, n: number) => { for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push({ x: mx + Math.cos(t) * rx, y: my + Math.sin(t) * ry }); } };
  ring(mw * 0.62, mw * 0.2, 16); ring(mw * 0.95, mw * 0.5, 18); ring(mw * 1.5, mw * 0.95, 20);
  // chin and jaw below the mouth
  for (let i = 0; i < 7; i++) pts.push({ x: mx + (i - 3) * mw * 0.45, y: my + mw * 1.5 });
  for (let i = 0; i < 5; i++) pts.push({ x: mx + (i - 2) * mw * 0.6, y: my + mw * 2.1 });
  const clampPt = (p: Pt) => ({ x: Math.min(W - 1, Math.max(1, p.x)), y: Math.min(H - 1, Math.max(1, p.y)) });
  const cp = pts.map(clampPt);
  const box = { x0: mx - mw * 1.9, y0: my - mw * 2.6, x1: mx + mw * 1.9, y1: my + mw * 2.3 };
  return finish({ pts: cp, inner, upperInner, lowerInner, lowerLips: lowerInner, upperLips: upperInner.slice(1, 9), mouth, nFace: cp.length, eyes: [], landmark: false, box }, W, H);
}

// ---------------------------------------------------------------- rendering
function drawTri(ctx: CanvasRenderingContext2D, img: CanvasImageSource, s: Pt[], d: Pt[]) {
  const [x0, y0, x1, y1, x2, y2] = [s[0].x, s[0].y, s[1].x, s[1].y, s[2].x, s[2].y];
  const a = x1 - x0, b = x2 - x0, c = y1 - y0, dd = y2 - y0, det = a * dd - b * c;
  if (Math.abs(det) < 1e-6) return;
  const ia = dd / det, ib = -b / det, ic = -c / det, id = a / det;
  const du1 = d[1].x - d[0].x, dv1 = d[1].y - d[0].y, du2 = d[2].x - d[0].x, dv2 = d[2].y - d[0].y;
  const A11 = du1 * ia + du2 * ic, A12 = du1 * ib + du2 * id, A21 = dv1 * ia + dv2 * ic, A22 = dv1 * ib + dv2 * id;
  const tx = d[0].x - (A11 * x0 + A12 * y0), ty = d[0].y - (A21 * x0 + A22 * y0);
  const cx = (d[0].x + d[1].x + d[2].x) / 3, cy = (d[0].y + d[1].y + d[2].y) / 3;
  ctx.save();
  ctx.beginPath();
  d.forEach((p, i) => { const vx = p.x - cx, vy = p.y - cy, l = Math.hypot(vx, vy) || 1, px = p.x + (vx / l) * 0.7, py = p.y + (vy / l) * 0.7; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath(); ctx.clip();
  ctx.setTransform(A11, A21, A12, A22, tx, ty);
  const bx0 = Math.floor(Math.min(x0, x1, x2)) - 2, by0 = Math.floor(Math.min(y0, y1, y2)) - 2, bx1 = Math.ceil(Math.max(x0, x1, x2)) + 2, by1 = Math.ceil(Math.max(y0, y1, y2)) + 2;
  ctx.drawImage(img, bx0, by0, bx1 - bx0, by1 - by0, bx0, by0, bx1 - bx0, by1 - by0);
  ctx.restore();
}

function displace(model: Model, w: Weights, blink: number): Pt[] {
  const { pts, jawW, lipG, isAnchor, mouth } = model;
  const { x: mx, y: my, w: mw } = mouth;
  const jaw = w.J * mw * 0.36;
  const widthF = 1 + 0.14 * w.S - 0.3 * w.R;
  const raise = 0.09 * w.J * mw;
  const out = pts.map((p, i) => {
    if (isAnchor[i]) return { x: p.x, y: p.y };
    let x = p.x, y = p.y;
    y += jaw * jawW[i];
    x += (p.x - mx) * (widthF - 1) * lipG[i];
    if (p.y < my) y -= raise * lipG[i];
    return { x, y };
  });
  if (blink > 0.01) {
    for (const e of model.eyes) {
      for (const ui of e.upper) {
        let best = e.lower[0], bd = Infinity;
        for (const li of e.lower) { const d = Math.abs(pts[li].x - pts[ui].x); if (d < bd) { bd = d; best = li; } }
        out[ui].y += blink * 0.92 * (pts[best].y - pts[ui].y);
      }
    }
  }
  return out;
}

function paintMouth(ctx: CanvasRenderingContext2D, model: Model, moved: Pt[], w: Weights) {
  const poly = model.inner.map((i) => moved[i]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const gw = x1 - x0, gh = y1 - y0, mw = model.mouth.w;
  if (gh < 1.5) return;
  ctx.save();
  ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.clip();
  // throat and cheek shadow
  const g = ctx.createRadialGradient((x0 + x1) / 2, y0 + gh * 0.55, 1, (x0 + x1) / 2, y0 + gh * 0.55, Math.max(gw, gh) * 0.62);
  g.addColorStop(0, "#0c0205"); g.addColorStop(0.55, "#220a0f"); g.addColorStop(1, "#4a1620");
  ctx.fillStyle = g; ctx.fillRect(x0 - 2, y0 - 2, gw + 4, gh + 4);
  // tongue: low and soft in the middle, lifts a little for spread vowels
  if (gh > mw * 0.16) {
    const tcx = (x0 + x1) / 2, tcy = y1 - gh * (0.12 + 0.08 * w.S), trx = gw * 0.34, try_ = Math.max(2, gh * 0.3);
    const tg = ctx.createRadialGradient(tcx, tcy - try_ * 0.4, 1, tcx, tcy, Math.max(trx, try_));
    tg.addColorStop(0, "#9c4650"); tg.addColorStop(0.65, "#7e3039"); tg.addColorStop(1, "#4d1a22");
    ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(tcx, tcy, trx, try_, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(40,8,12,0.55)"; ctx.lineWidth = Math.max(1, mw * 0.012);   // the groove down the middle of the tongue
    ctx.beginPath(); ctx.moveTo(tcx, tcy - try_ * 0.7); ctx.lineTo(tcx, tcy + try_ * 0.3); ctx.stroke();
  }
  // upper teeth: a band right under the upper lip, grouped like teeth
  const upperH = Math.min(gh * 0.55, mw * (0.07 + 0.06 * w.F + 0.03 * w.S));
  const tgU = ctx.createLinearGradient(0, y0, 0, y0 + upperH);
  tgU.addColorStop(0, "#c2b9aa"); tgU.addColorStop(0.4, "#e2dccd"); tgU.addColorStop(1, "#b3aa9a");
  ctx.fillStyle = tgU; ctx.fillRect(x0 + gw * 0.07, y0 - 1, gw * 0.86, upperH + 1);
  ctx.strokeStyle = "rgba(90,70,60,0.22)"; ctx.lineWidth = Math.max(0.6, mw * 0.007);
  for (let i = 1; i < 8; i++) { const x = x0 + gw * (0.07 + (0.86 * i) / 8); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + upperH); ctx.stroke(); }
  // lower teeth when the mouth is wide open
  if (gh > mw * 0.3) {
    const lowH = Math.min(gh * 0.22, mw * 0.08);
    ctx.globalAlpha = 0.82; ctx.fillStyle = "#cdc5b5"; ctx.fillRect(x0 + gw * 0.16, y1 - lowH, gw * 0.68, lowH + 1); ctx.globalAlpha = 1;
  }
  // depth: the top of the opening is in shadow
  const sh = ctx.createLinearGradient(0, y0, 0, y0 + gh * 0.5);
  sh.addColorStop(0, "rgba(0,0,0,0.38)"); sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh; ctx.fillRect(x0 - 2, y0 - 2, gw + 4, gh * 0.5 + 2);
  ctx.restore();
}

function paintEyelids(ctx: CanvasRenderingContext2D, base: CanvasImageSource, model: Model, pts: Pt[], blink: number) {
  if (blink < 0.55) return;
  const bc = document.createElement("canvas"); bc.width = 1; bc.height = 1;
  for (const e of model.eyes) {
    const upper = e.upper.map((i) => pts[i]), lower = e.lower.map((i) => model.pts[i]);
    const cy = (upper[3].y + lower[4].y) / 2, h = Math.abs(model.pts[e.lower[4]].y - model.pts[e.upper[3]].y) || 4;
    // skin colour from just above the eyelid
    const bx = bc.getContext("2d")!; bx.clearRect(0, 0, 1, 1);
    bx.drawImage(base, Math.round(upper[3].x), Math.round(upper[3].y - h * 1.4), 1, 1, 0, 0, 1, 1);
    const [r, g, b] = bx.getImageData(0, 0, 1, 1).data;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (blink - 0.55) / 0.3);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath(); upper.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); lower.slice().reverse().forEach((p) => ctx.lineTo(p.x, p.y + 0.5)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(40,25,20,0.55)"; ctx.lineWidth = Math.max(1, h * 0.12);
    ctx.beginPath(); upper.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    ctx.restore();
    void cy;
  }
}

export type Frame = { t: number; w: Weights; blink: number; moving: boolean };

/** Draws one frame of the talking picture on `view` (same size as `base`). `work` is a scratch canvas of the same size. */
export function renderFrame(view: HTMLCanvasElement, work: HTMLCanvasElement, base: HTMLCanvasElement, model: Model | null, f: Frame) {
  const W = view.width, H = view.height;
  const wc = work.getContext("2d")!;
  wc.setTransform(1, 0, 0, 1, 0, 0);
  wc.clearRect(0, 0, W, H);
  wc.drawImage(base, 0, 0);
  if (model && (f.w.J > 0.003 || f.blink > 0.01 || f.w.S > 0.02 || f.w.R > 0.02)) {
    const moved = displace(model, f.w, f.blink);
    for (const t of model.moving) drawTri(wc, base, [model.pts[t[0]], model.pts[t[1]], model.pts[t[2]]], [moved[t[0]], moved[t[1]], moved[t[2]]]);
    if (model.eyes.length) paintEyelids(wc, base, model, moved, f.blink);
    if (f.w.J > 0.02) paintMouth(wc, model, moved, f.w);
  }
  // the speaking head: roll, drift, nod with emphasis, breathing; scaled up so no edge shows
  const vc = view.getContext("2d")!;
  vc.setTransform(1, 0, 0, 1, 0, 0);
  vc.clearRect(0, 0, W, H);
  const k = f.moving ? 1 : 0, t = f.t;
  const roll = (Math.sin(t * 0.8) * 0.014 + Math.sin(t * 1.9 + 1) * 0.006 + (f.w.E - 0.4) * 0.006 * Math.sin(t * 3.1)) * k;
  const dx = (Math.sin(t * 0.55) * 0.006 + Math.sin(t * 1.3 + 2) * 0.003) * W * k;
  const dy = (Math.sin(t * 0.7 + 1) * 0.004 + f.w.E * 0.006 + f.w.J * 0.004) * H * k;
  const sc = 1.07 + (Math.sin(t * 0.5) * 0.004 + f.w.E * 0.004) * k;
  vc.translate(W / 2 + dx, H * 0.92 + dy);
  vc.rotate(roll);
  vc.scale(sc, sc);
  vc.translate(-W / 2, -H * 0.92);
  vc.drawImage(work, 0, 0);
  vc.setTransform(1, 0, 0, 1, 0, 0);
}
