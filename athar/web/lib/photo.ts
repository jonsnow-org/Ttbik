// Runs in the browser: prepares a photo (face, full figure, group) for the token and shrinks it until it fits the free permanent-storage budget.
//  1. empty black/white bars (screenshots, letterboxed frames) are cut away;
//  2. "fill" (default): the square window that fills the circle, chosen automatically (a little above the middle, where faces are) and movable;
//     "whole": the picture as it is, never cropped.
import { coverCrop, trimBorders } from "./photoFit";

export const PHOTO_BUDGET = 58_000;   // base64 makes it 1.33x, the frame and badge add ~14 KB: the whole picture must stay under the free 100 KB

function loadImage(src: string | File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => { if (typeof src !== "string") URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== "string") URL.revokeObjectURL(url); reject(new Error("unreadable image")); };
    img.src = url;
  });
}

/** The picture without its empty bars, as a canvas source rectangle (in the picture's own pixels). */
function contentRect(img: HTMLImageElement): { sx: number; sy: number; sw: number; sh: number } {
  const W = img.naturalWidth, H = img.naturalHeight;
  const k = Math.min(1, 200 / Math.max(W, H));
  const gw = Math.max(1, Math.round(W * k)), gh = Math.max(1, Math.round(H * k));
  const c = document.createElement("canvas"); c.width = gw; c.height = gh;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, gw, gh);
  const d = x.getImageData(0, 0, gw, gh).data, lum = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) lum[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
  const t = trimBorders(lum, gw, gh);
  const sx = Math.round(t.left / k), sy = Math.round(t.top / k);
  return { sx, sy, sw: Math.max(1, W - sx - Math.round(t.right / k)), sh: Math.max(1, H - sy - Math.round(t.bottom / k)) };
}

/** Draws (sx,sy,sw,sh) of the image onto a canvas no larger than `side` px, and encodes it as JPEG within the budget (shrinking if it must). */
function encode(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, side: number): { uri: string; w: number; h: number } | null {
  let s = Math.min(side, Math.max(sw, sh));
  for (let round = 0; round < 8; round++) {
    const k = s / Math.max(sw, sh);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#050914"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const uri = c.toDataURL("image/jpeg", q);
      if (Math.floor((uri.length - uri.indexOf(",") - 1) * 0.75) <= PHOTO_BUDGET) return { uri, w: c.width, h: c.height };
    }
    s = Math.round(s * 0.82);
  }
  return null;
}

/** The chosen file, without its empty bars, as a whole picture (the "whole" version; "fill" is made from it by fillSquare). */
export async function compressPhoto(file: File): Promise<{ uri: string; w: number; h: number } | null> {
  const img = await loadImage(file);
  const r = contentRect(img);
  return encode(img, r.sx, r.sy, r.sw, r.sh, 760);
}

/** The square window of an already prepared picture that fills the circle (fx, fy slide it along the long side). */
export async function fillSquare(uri: string, fx = 0.5, fy = 0.32): Promise<{ uri: string; w: number; h: number } | null> {
  const img = await loadImage(uri);
  const c = coverCrop(img.naturalWidth, img.naturalHeight, fx, fy);
  return encode(img, c.sx, c.sy, c.side, c.side, 700);
}
