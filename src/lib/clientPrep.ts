/**
 * Light work that belongs in the user's own Mini App browser, done only while the user is using the app and only on what they chose to send: shrinking a picture before upload,
 * cutting a long text into sendable pieces. Saves Studio time and bandwidth; nothing here runs in the background, polls, or computes for anyone else
 * (no distributed compute; any such feature would need an explicit opt-in that does not exist). Pure functions are testable in node; the canvas part runs in the browser only.
 */

/** The size a picture is scaled to so its longest side is at most `max` (never enlarged). */
export function fitSize(w: number, h: number, max = 1280): { w: number; h: number; scaled: boolean } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0, scaled: false };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: k < 1 };
}

/** Cuts text into pieces of at most `max` characters, at paragraph / line / sentence ends where possible; joined back they give the original text. */
export function chunkText(text: string, max = 3500): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(text.length, i + max);
    if (end < text.length) {
      const window = text.slice(i, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("؟ "), window.lastIndexOf("。"));
      if (cut > max * 0.4) end = i + cut + (window[cut] === "\n" ? (window[cut + 1] === "\n" && window.lastIndexOf("\n\n") === cut ? 2 : 1) : 2);
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/** Browser only: a picture file → a JPEG (or the original when it is already small / cannot be decoded), longest side ≤ max. Returns the file to upload. */
export async function shrinkImage(file: File, opts: { max?: number; quality?: number; skipBelowBytes?: number } = {}): Promise<File> {
  const { max = 1280, quality = 0.85, skipBelowBytes = 150_000 } = opts;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function" || !/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const { w, h, scaled } = fitSize(bmp.width, bmp.height, max);
    if (!scaled && file.size <= skipBelowBytes && /jpe?g/.test(file.type)) { bmp.close?.(); return file; }
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;                        // never make it bigger
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
