// Runs in the browser. Turns a photo into a "waxed metal" version (silver or gold) using only its own brightness, so the
// face and body are never redrawn: the likeness is exactly the photo's. Light comes from the upper left; a height map made
// from the brightness gives the soft wax relief and the polished glints.
export type WaxMode = "silver" | "gold";

const RAMPS: Record<WaxMode, [number, number[]][]> = {
  gold: [[0, [40, 20, 3]], [.18, [110, 62, 8]], [.4, [176, 112, 18]], [.62, [226, 168, 40]], [.8, [255, 214, 96]], [.93, [255, 240, 168]], [1, [255, 252, 224]]],
  silver: [[0, [24, 28, 38]], [.18, [70, 78, 92]], [.4, [128, 138, 154]], [.62, [184, 192, 206]], [.8, [226, 232, 242]], [.93, [248, 250, 255]], [1, [255, 255, 255]]],
};

function blur(A: Float32Array, W: number, H: number, r: number): Float32Array {
  const o = new Float32Array(W * H), t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += A[y * W + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) { t[y * W + x] = s / (2 * r + 1); s += A[y * W + Math.min(W - 1, x + r + 1)] - A[y * W + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += t[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) { o[y * W + x] = s / (2 * r + 1); s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; }
  }
  return o;
}

function mapRamp(r: [number, number[]][], t: number): number[] {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < r.length; i++) {
    if (t <= r[i][0]) { const a = r[i - 1], b = r[i], f = (t - a[0]) / (b[0] - a[0]); return a[1].map((v, k) => v + (b[1][k] - v) * f); }
  }
  return r[r.length - 1][1];
}

/** Pure pixel step (RGBA in, RGBA out) so it can be tested without a browser. */
export function waxPixels(d: Uint8ClampedArray, W: number, H: number, mode: WaxMode): Uint8ClampedArray {
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  const sorted = Float32Array.from(L).sort();
  const lo = sorted[Math.floor(W * H * 0.02)], hi = sorted[Math.floor(W * H * 0.98)];
  const span = Math.max(0.05, hi - lo);
  for (let i = 0; i < W * H; i++) L[i] = Math.max(0, Math.min(1, (L[i] - lo) / span));      // every photo uses the whole tone range
  const B1 = blur(L, W, H, 2), B2 = blur(L, W, H, 9), H0 = blur(L, W, H, 3);
  const gold = mode === "gold", ramp = RAMPS[mode];
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const iR = Math.min(i + 1, y * W + W - 1), iL = Math.max(i - 1, y * W), iD = Math.min(i + W, (H - 1) * W + x), iU = Math.max(i - W, x);
    const nx = -(H0[iR] - H0[iL]) * 6, ny = -(H0[iD] - H0[iU]) * 6, nl = Math.hypot(nx, ny, 1);
    const diff = Math.max(0, (nx * -0.5 + ny * -0.6 + 0.62) / nl);                           // soft wax light
    const hl = Math.hypot(-0.5, -0.6, 1.62);
    const spec = Math.pow(Math.max(0, (nx * -0.5 + ny * -0.6 + 1.62) / (nl * hl)), gold ? 26 : 34);   // polished glints
    const detail = L[i] + 0.9 * (L[i] - B1[i]);                                             // keeps the face crisp
    const env = 0.5 + 0.5 * Math.sin(B2[i] * 5.2 + nx * 2.4 + ny * 1.6);                    // metal reflects a soft environment
    let t = 0.5 * detail + 0.22 * diff + 0.12 * env + 0.16 * B2[i] + (gold ? 0.5 : 0.42) * spec;
    t = (t - 0.5) * 1.22 + 0.5; t = t * t * (3 - 2 * t) * 0.55 + t * 0.45;
    const c = mapRamp(ramp, t), vg = 1 - 0.07 * Math.pow(Math.hypot(x / W - 0.5, y / H - 0.5) * 1.5, 2);
    out[i * 4] = c[0] * vg; out[i * 4 + 1] = c[1] * vg; out[i * 4 + 2] = c[2] * vg; out[i * 4 + 3] = 255;
  }
  return out;
}

/** Browser wrapper: data URI in, waxed JPEG data URI out (kept under `budget` bytes). */
export async function waxPhoto(uri: string, mode: WaxMode, budget = 58_000): Promise<string | null> {
  const img = new Image();
  img.src = uri;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, W, H);
  const px = waxPixels(src.data, W, H, mode);
  ctx.putImageData(new ImageData(px as unknown as Uint8ClampedArray, W, H), 0, 0);
  for (const q of [0.86, 0.78, 0.7, 0.6, 0.5]) {
    const out = c.toDataURL("image/jpeg", q);
    if (Math.floor((out.length - out.indexOf(",") - 1) * 0.75) <= budget) return out;
  }
  return null;
}
