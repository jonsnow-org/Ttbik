// A still PNG of a token picture, for the places that cannot show an SVG: link previews (Telegram, X, WhatsApp...), directories that
// want a direct .png/.jpg link, and any wallet or market that only draws raster pictures. Motion is dropped (the first frame is kept).
import sharp from "sharp";

export async function svgToPng(svg: string, size = 800): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 144 })
    .resize(size, size, { fit: "contain", background: { r: 5, g: 9, b: 20, alpha: 1 } })
    .flatten({ background: "#050914" })
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 8 })
    .toBuffer();
}

export const PNG_HEADERS = { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" };
