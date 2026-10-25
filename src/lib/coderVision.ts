// Pictures for the model (Studio vision, measured 2026-10-25: ~38 s per 448 px picture on 2 cores). Everything that turns bytes into a picture the model can be shown lives here.
import type { CoderMessage } from "@/lib/openCoderStudio";

/** Longest side, in pixels, of a picture sent to the model: fewer pixels = fewer image tokens = seconds saved on a CPU. */
export const imageMaxPx = (): number => Math.max(256, Math.min(1024, Number(process.env.CODER_IMAGE_MAX_PX) || 512));

/** Bytes of any common picture format -> a small JPEG data URL (rotated by its EXIF, flattened on white). null when it is not a picture. */
export async function toModelImage(bytes: Buffer, maxPx = imageMaxPx()): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes, { failOn: "none" }).rotate().resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The picture is shown to the model once: after it has answered, an older picture is replaced by a short note (it costs hundreds of tokens and a cold read every step otherwise). */
export function dropShownImages(msgs: CoderMessage[]): void {
  let lastAssistant = -1;
  msgs.forEach((m, i) => { if (m.role === "assistant") lastAssistant = i; });
  msgs.forEach((m, i) => {
    const im = (m as { images?: string[] }).images;
    if (m.role === "user" && im?.length && i < lastAssistant) {
      delete (m as { images?: string[] }).images;
      m.content = `${m.content}\n[${im.length} picture${im.length > 1 ? "s were" : " was"} shown to you here and already answered]`;
    }
  });
}
