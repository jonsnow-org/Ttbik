// The one place that turns a pointer position inside the rendered desktop picture into the REAL screen pixel the
// computer Studio expects. The live view streams a SCALED frame (desktopLive asks for scale 0.75), so the <img> is
// smaller than the screen: mapping with the image's own size would land every click short and leave the far edge
// unreachable. The Studio reports the real screen as `width`/`height`; use it, and fall back to the natural size
// only when it is unknown (the scale-1.0 single-frame poll).

export type ScreenSize = { w: number; h: number } | null | undefined;
export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { clientX: number; clientY: number };
export type NaturalSize = { width: number; height: number };

/** Returns the screen pixel, or null when the picture has no usable geometry yet (nothing to click). */
export function desktopPoint(rect: Rect, point: Point, natural: NaturalSize, screen: ScreenSize): { x: number; y: number } | null {
  if (!natural.width || !natural.height || !rect.width || !rect.height) return null;
  const w = screen && screen.w > 0 ? screen.w : natural.width;
  const h = screen && screen.h > 0 ? screen.h : natural.height;
  return {
    x: Math.round(((point.clientX - rect.left) / rect.width) * w),
    y: Math.round(((point.clientY - rect.top) / rect.height) * h),
  };
}

/** The real screen size carried by a Studio reply (frame / live-stream event), or null when it is absent. */
export function screenSizeOf(reply: unknown): { w: number; h: number } | null {
  const r = reply as { width?: unknown; height?: unknown } | null | undefined;
  const w = Number(r?.width);
  const h = Number(r?.height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}
