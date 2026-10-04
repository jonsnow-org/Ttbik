// Reads the pixel size of a JPEG / PNG / WebP from its header (no image library needed). Returns null if unreadable.
export function imageSize(b: Buffer): { w: number; h: number } | null {
  try {
    if (b.length > 24 && b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (b.length > 30 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") {
      const t = b.subarray(12, 16).toString();
      if (t === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (t === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
      if (t === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
  } catch { /* fall through */ }
  return null;
}

/** The frame hugs the photo: a face (square) gets a big square window, a standing figure a tall narrow one. Nothing is cropped. */
export function fitWindow(w: number, h: number, maxW = 656, maxH = 548) {
  const r = w / h;
  let ww = maxW, wh = maxW / r;
  if (wh > maxH) { wh = maxH; ww = maxH * r; }
  return { ww: Math.round(ww), wh: Math.round(wh) };
}
