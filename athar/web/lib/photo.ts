// Runs in the browser: shrinks any photo (face, full figure, group) until it fits the free permanent-storage budget.
// Nothing is cropped: the picture keeps its own shape and is shown whole inside the frame.
export const PHOTO_BUDGET = 66_000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable image")); };
    img.src = url;
  });
}

export async function compressPhoto(file: File): Promise<{ uri: string; w: number; h: number } | null> {
  const img = await loadImage(file);
  let side = Math.min(760, Math.max(img.naturalWidth, img.naturalHeight));
  for (let round = 0; round < 8; round++) {
    const k = side / Math.max(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#050914"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const uri = c.toDataURL("image/jpeg", q);
      const bytes = Math.floor((uri.length - uri.indexOf(",") - 1) * 0.75);
      if (bytes <= PHOTO_BUDGET) return { uri, w: c.width, h: c.height };
    }
    side = Math.round(side * 0.82);
  }
  return null;
}
