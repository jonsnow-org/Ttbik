// How a photo is made to fit the circle (pure geometry, so it can be tested without a browser).
//  - trimBorders: the empty black (or white) bars some photos carry (a screenshot, a letterboxed video frame) are cut away first
//  - coverCrop: the square window that fills the circle: it takes the person and leaves the empty sides out; the owner can move it

export type Trim = { left: number; top: number; right: number; bottom: number };

/** `lum` is a w*h grid of brightness (0-255). Returns how many rows/columns to cut from each side (never more than `maxFrac` of a side). */
export function trimBorders(lum: ArrayLike<number>, w: number, h: number, maxFrac = 0.4): Trim {
  const rowStat = (y: number) => { let s = 0, mn = 255, mx = 0; for (let x = 0; x < w; x++) { const v = lum[y * w + x]; s += v; if (v < mn) mn = v; if (v > mx) mx = v; } return { mean: s / w, mn, mx }; };
  const colStat = (x: number) => { let s = 0, mn = 255, mx = 0; for (let y = 0; y < h; y++) { const v = lum[y * w + x]; s += v; if (v < mn) mn = v; if (v > mx) mx = v; } return { mean: s / h, mn, mx }; };
  const empty = (st: { mean: number; mn: number; mx: number }) => (st.mean < 18 && st.mx < 70) || (st.mean > 238 && st.mn > 190);   // a black or a white bar, with no picture in it
  const walk = (n: number, size: number, stat: (i: number) => { mean: number; mn: number; mx: number }, fromEnd: boolean) => {
    let k = 0; const cap = Math.floor(size * maxFrac);
    while (k < cap && empty(stat(fromEnd ? n - 1 - k : k))) k++;
    return k;
  };
  const t = { top: walk(h, h, rowStat, false), bottom: walk(h, h, rowStat, true), left: walk(w, w, colStat, false), right: walk(w, w, colStat, true) };
  // a trim of only a pixel or two is noise (a dark corner of a real photo), not a bar
  const min = (size: number) => Math.max(2, Math.round(size * 0.015));
  return { top: t.top >= min(h) ? t.top : 0, bottom: t.bottom >= min(h) ? t.bottom : 0, left: t.left >= min(w) ? t.left : 0, right: t.right >= min(w) ? t.right : 0 };
}

/** The square window of a w*h picture that fills the circle. fx/fy (0-1) slide it along the long side; fy defaults a little above the middle (faces). */
export function coverCrop(w: number, h: number, fx = 0.5, fy = 0.32): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  const cl = (v: number) => Math.min(1, Math.max(0, v));
  return { sx: Math.round((w - side) * cl(fx)), sy: Math.round((h - side) * cl(fy)), side };
}
