// «رموز» film: plays the real clips picked for each scene into one vertical
// frame (cover-fit, slow camera move, crossfades, captions) so the canvas can
// be recorded as the final video. Clips are loaded as blobs (same-origin) so
// the canvas stays recordable.
import type { Clip } from "./match";

export const W = 540;
export const H = 960;

export type Media = { clip: Clip; el: HTMLVideoElement | HTMLImageElement; src: string };

export async function loadMedia(clip: Clip): Promise<Media | null> {
  try {
    const res = await fetch(clip.url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const src = URL.createObjectURL(await res.blob());
    if (clip.kind === "photo") {
      const img = new Image();
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad(new Error("image"));
        img.src = src;
      });
      return { clip, el: img, src };
    }
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    await new Promise<void>((ok, bad) => {
      const timer = setTimeout(() => bad(new Error("timeout")), 30_000);
      v.onloadeddata = () => {
        clearTimeout(timer);
        ok();
      };
      v.onerror = () => {
        clearTimeout(timer);
        bad(new Error("video"));
      };
      v.src = src;
    });
    return { clip, el: v, src };
  } catch {
    return null;
  }
}

export function freeMedia(m: Media | null | undefined) {
  if (!m) return;
  if (m.el instanceof HTMLVideoElement) m.el.pause();
  URL.revokeObjectURL(m.src);
}

const ease = (p: number) => p * p * (3 - 2 * p);

function size(el: Media["el"]) {
  return el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function caption(ctx: CanvasRenderingContext2D, text: string, p: number) {
  if (!text) return;
  const g = ctx.createLinearGradient(0, H * 0.7, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  const appear = Math.min(1, Math.max(0, (p - 0.06) / 0.18));
  ctx.globalAlpha *= appear;
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 10;
  const lines = wrapLines(ctx, text, W - 80);
  const y0 = H - 110 - (lines.length - 1) * 46 + (1 - appear) * 24;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * 46));
  ctx.shadowBlur = 0;
}

/** One shot of the film at progress t/dur. Photos get a stronger camera move than footage. */
export function drawShot(ctx: CanvasRenderingContext2D, m: Media | null | undefined, text: string, t: number, dur: number, index: number, alpha = 1, withCaption = true) {
  const p = Math.min(1, Math.max(0, t / dur));
  ctx.save();
  ctx.globalAlpha = alpha;
  if (m) {
    const [iw, ih] = size(m.el);
    const photo = m.clip.kind === "photo";
    const zoom = photo ? 1.06 + 0.14 * ease(p) : 1 + 0.05 * ease(p);
    const s = Math.max(W / (iw || W), H / (ih || H)) * zoom;
    const w = (iw || W) * s;
    const h = (ih || H) * s;
    const spare = w - W;
    const dir = index % 2 ? -1 : 1;
    const x = -spare / 2 + dir * Math.min(spare / 2, photo ? 40 : 16) * (ease(p) - 0.5) * 2;
    ctx.drawImage(m.el, x, (H - h) / 2, w, h);
  } else {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, W, H);
  }
  if (withCaption) caption(ctx, text, p);
  ctx.restore();
}

/** Keeps exactly the clips on screen playing (from their start when they appear). */
export function syncPlayback(media: (Media | null)[], active: number[]) {
  media.forEach((m, i) => {
    if (!m || !(m.el instanceof HTMLVideoElement)) return;
    const v = m.el;
    if (active.includes(i)) {
      if (v.paused) {
        v.currentTime = 0;
        void v.play().catch(() => {});
      }
    } else if (!v.paused) v.pause();
  });
}
