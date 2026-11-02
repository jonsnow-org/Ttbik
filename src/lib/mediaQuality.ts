// Media quality gate (TypeScript side of ai-system/colab/sham_small/media_quality.py — same thresholds and reason codes).
// A black / constant / noise picture, silent or empty audio, or an empty / truncated video is NEVER handed to a user: the reply becomes
// {type:"error", reason, text} with a clear message. Used by every client that receives generated media (Nova's media Studio, Sham / Sham v2 Studios).
import sharp from "sharp";

export type MediaReasonCode = "blank_image" | "noise_image" | "invalid_image" | "silent_audio" | "invalid_audio" | "empty_video";
export type MediaLike = { type: string; b64?: string; text?: string; reason?: string; mime?: string; [k: string]: unknown };

export const MIN_STD = 8;
export const MIN_RANGE = 24;
export const MIN_NEIGHBOUR_CORR = 0.15;
export const MIN_AUDIO_SECONDS = 0.2;
export const MIN_AUDIO_PEAK = 0.01;
export const MIN_VIDEO_BYTES = 1024;

export const MEDIA_MESSAGES: Record<MediaReasonCode, string> = {
  blank_image: "لم يُنشئ النموذج صورة صالحة (النتيجة فارغة/سوداء). لم تُرسَل أي صورة.",
  noise_image: "النتيجة ضجيج عشوائي وليست صورة؛ النموذج غير جاهز لهذا الطلب.",
  invalid_image: "الصورة الناتجة غير صالحة.",
  silent_audio: "لم يُنشئ النموذج صوتاً مسموعاً (فارغ/صامت).",
  invalid_audio: "الصوت الناتج غير صالح.",
  empty_video: "لم يُنشئ النموذج فيديو صالحاً (فارغ/غير مكتمل).",
};

export class MediaQualityError extends Error {
  constructor(public reason: MediaReasonCode, public detail = "") {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

function corr(a: Float64Array, b: Float64Array): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  const d = Math.sqrt(saa * sbb);
  return d ? sab / d : 0;
}

/** Throws MediaQualityError unless the picture has real content. */
export async function checkImage(buf: Buffer, opts: { rejectNoise?: boolean } = {}): Promise<{ mean: number; std: number; min: number; max: number; neighbourCorr?: number }> {
  let data: Buffer, w: number, h: number;
  try {
    const out = await sharp(buf).removeAlpha().greyscale().resize(256, 256, { fit: "inside", kernel: "nearest", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    data = out.data; w = out.info.width; h = out.info.height;
  } catch (e) {
    throw new MediaQualityError("invalid_image", String((e as Error)?.message || "undecodable").slice(0, 80));
  }
  if (!w || !h || !data.length) throw new MediaQualityError("invalid_image", "empty image");
  let sum = 0, lo = 255, hi = 0;
  for (let i = 0; i < data.length; i++) { const v = data[i]; sum += v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const mean = sum / data.length;
  let ss = 0;
  for (let i = 0; i < data.length; i++) ss += (data[i] - mean) ** 2;
  const std = Math.sqrt(ss / data.length);
  const stats = { mean: Math.round(mean * 10) / 10, std: Math.round(std * 10) / 10, min: lo, max: hi } as { mean: number; std: number; min: number; max: number; neighbourCorr?: number };
  if (std < MIN_STD || hi - lo < MIN_RANGE) throw new MediaQualityError("blank_image", `std=${std.toFixed(1)} range=${hi - lo} mean=${mean.toFixed(0)}`);
  if (opts.rejectNoise !== false && w >= 8 && h >= 8) {
    const hA = new Float64Array(h * (w - 1)), hB = new Float64Array(h * (w - 1)), vA = new Float64Array((h - 1) * w), vB = new Float64Array((h - 1) * w);
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) { hA[k] = data[y * w + x]; hB[k++] = data[y * w + x + 1]; }
    k = 0;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) { vA[k] = data[y * w + x]; vB[k++] = data[(y + 1) * w + x]; }
    const c = Math.min(corr(hA, hB), corr(vA, vB));
    stats.neighbourCorr = Math.round(c * 1000) / 1000;
    if (c < MIN_NEIGHBOUR_CORR) throw new MediaQualityError("noise_image", `neighbour_corr=${c.toFixed(2)}`);
  }
  return stats;
}

/** PCM WAV: audible and not constant. */
export function checkWav(buf: Buffer): { seconds: number; peak: number } {
  if (!buf || buf.length < 64) throw new MediaQualityError("silent_audio", "empty audio");
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") throw new MediaQualityError("invalid_audio", "not a RIFF/WAVE file");
  let fmt: { ch: number; rate: number; bits: number; tag: number } | null = null;
  let dataAt = -1, dataLen = 0;
  for (let i = 12; i + 8 <= buf.length;) {
    const id = buf.toString("latin1", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === "fmt " && i + 24 <= buf.length) fmt = { tag: buf.readUInt16LE(i + 8), ch: buf.readUInt16LE(i + 10), rate: buf.readUInt32LE(i + 12), bits: buf.readUInt16LE(i + 22) };
    if (id === "data") { dataAt = i + 8; dataLen = Math.min(size === 0xffffffff || i + 8 + size > buf.length ? buf.length - i - 8 : size, buf.length - i - 8); break; }
    i += 8 + size + (size % 2);
  }
  if (!fmt || dataAt < 0 || !fmt.rate || !fmt.ch) throw new MediaQualityError("invalid_audio", "missing fmt/data chunk");
  const bytes = fmt.bits / 8;
  if (![1, 2, 4].includes(bytes) || (fmt.tag !== 1 && fmt.tag !== 3 && fmt.tag !== 0xfffe)) throw new MediaQualityError("invalid_audio", `format ${fmt.tag}/${fmt.bits}`);
  const frames = Math.floor(dataLen / (bytes * fmt.ch));
  const seconds = frames / fmt.rate;
  if (frames <= 0 || seconds < MIN_AUDIO_SECONDS) throw new MediaQualityError("silent_audio", `${frames} frames at ${fmt.rate} Hz`);
  let peak = 0, sum = 0, sumSq = 0;
  const n = frames * fmt.ch;
  for (let j = 0; j < n; j++) {
    const o = dataAt + j * bytes;
    const v = bytes === 2 ? buf.readInt16LE(o) / 32768 : bytes === 1 ? (buf[o] - 128) / 128 : fmt.tag === 3 ? buf.readFloatLE(o) : buf.readInt32LE(o) / 2147483648;
    if (!Number.isFinite(v)) throw new MediaQualityError("invalid_audio", "NaN/Inf samples");
    peak = Math.max(peak, Math.abs(v)); sum += v; sumSq += v * v;
  }
  const std = Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
  if (peak < MIN_AUDIO_PEAK || std < MIN_AUDIO_PEAK / 4) throw new MediaQualityError("silent_audio", `peak=${peak.toFixed(4)} std=${std.toFixed(5)}`);
  return { seconds: Math.round(seconds * 100) / 100, peak: Math.round(peak * 1000) / 1000 };
}

/** MP4 structure: ftyp + moov + mdat and not tiny (frames are decoded on the Studio, which has ffmpeg; the clients check the container). */
export function checkMp4(buf: Buffer): { bytes: number } {
  if (!buf || buf.length < MIN_VIDEO_BYTES) throw new MediaQualityError("empty_video", `${buf?.length || 0} bytes`);
  const names = new Set<string>();
  for (let i = 0; i + 8 <= buf.length && names.size < 32;) {
    let size = buf.readUInt32BE(i);
    names.add(buf.toString("latin1", i + 4, i + 8));
    if (size === 1 && i + 16 <= buf.length) size = Number(buf.readBigUInt64BE(i + 8));
    if (size < 8) break;
    i += size;
  }
  if (!names.has("ftyp") || !names.has("moov") || !names.has("mdat")) throw new MediaQualityError("empty_video", "not a complete MP4 (ftyp/moov/mdat)");
  return { bytes: buf.length };
}

export function mediaError(reason: MediaReasonCode, detail = "", keep: Record<string, unknown> = {}): MediaLike {
  return { type: "error", reason, text: MEDIA_MESSAGES[reason], ...(detail ? { detail: detail.slice(0, 160) } : {}), ...keep };
}

/** The one chokepoint for a media reply: unchanged when it passes (or is not media), else a typed error without the bytes. */
export async function vetMedia<T extends MediaLike>(reply: T | null | undefined): Promise<T | MediaLike | null | undefined> {
  if (!reply || (reply.type !== "image" && reply.type !== "audio" && reply.type !== "video")) return reply;
  const keep: Record<string, unknown> = {};
  for (const k of ["backend", "route"]) if (reply[k] !== undefined) keep[k] = reply[k];
  try {
    const raw = Buffer.from(String(reply.b64 || "").split(",").pop() || "", "base64");
    if (reply.type === "image") await checkImage(raw);
    else if (reply.type === "audio") checkWav(raw);
    else checkMp4(raw);
    return reply;
  } catch (e) {
    if (e instanceof MediaQualityError) return mediaError(e.reason, e.detail, keep);
    return mediaError(reply.type === "image" ? "invalid_image" : reply.type === "audio" ? "invalid_audio" : "empty_video", String((e as Error)?.message || ""), keep);
  }
}
