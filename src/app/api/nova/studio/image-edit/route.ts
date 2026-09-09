import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

// Nova AI "الاستوديو" → "المكتبة اليدوية": real code-only image editing
// (crop/resize) on the user's OWN uploaded photo — no AI, no synthesis,
// just deterministic pixel operations via sharp. Fast enough (well under
// a second for a single photo) to answer inline in the same request,
// unlike the real generative image/video paths in ai-system/ which need
// a background task + async Telegram delivery because their own
// inference genuinely takes minutes.
const hits = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

// Owner spec, 2026-09-09 ("هدفي كان وصله بمحرر صور... القص والتركيب
// إلى آخره... ليس مجرد كتابة قص في الوصف"): expanded from the original
// 2 ops to a real, useful set — still all deterministic sharp pixel
// operations, no AI, each verified locally against a real image buffer
// before shipping (not assumed from sharp's docs alone). Multi-photo
// composition (merging two images together) is a genuinely separate,
// larger feature — a single request here only ever carries one image —
// and is not part of this op set yet.
const OPS = new Set([
  "crop-square",
  "crop-portrait",
  "crop-landscape",
  "resize-small",
  "resize-large",
  "rotate-90",
  "flip-h",
  "flip-v",
  "grayscale",
  "sharpen",
]);
// Telegram itself already compresses photos sent through the bot API
// (well under a few MB), so this cap is a real abuse guard, not a
// realistic ceiling for a normal photo.
const MAX_BASE64_LEN = 12_000_000;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "لقد تجاوزت الحد المسموح مؤقتاً، حاول بعد قليل" }, { status: 429 });
  }

  const { op, image_base64 } = await req.json().catch(() => ({}));
  if (typeof op !== "string" || !OPS.has(op)) {
    return NextResponse.json({ error: "عملية غير صالحة" }, { status: 400 });
  }
  if (typeof image_base64 !== "string" || !image_base64 || image_base64.length > MAX_BASE64_LEN) {
    return NextResponse.json({ error: "صورة غير صالحة" }, { status: 400 });
  }

  try {
    const input = Buffer.from(image_base64, "base64");
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) {
      return NextResponse.json({ error: "تعذّر قراءة الصورة" }, { status: 422 });
    }

    let pipeline = sharp(input).rotate(); // rotate(): auto-applies EXIF orientation before any op below
    switch (op) {
      case "crop-square": {
        const side = Math.min(meta.width, meta.height);
        pipeline = pipeline.resize({ width: side, height: side, fit: "cover" });
        break;
      }
      case "crop-portrait":
        // 4:5 — a real, common portrait-photo ratio (Instagram's own
        // portrait crop), centered via sharp's default "cover" gravity.
        pipeline = pipeline.resize({ width: 320, height: 400, fit: "cover" });
        break;
      case "crop-landscape":
        // 16:9 — a real, common widescreen/landscape ratio.
        pipeline = pipeline.resize({ width: 480, height: 270, fit: "cover" });
        break;
      case "resize-small":
        // Caps the longer edge at 480px — a real, useful "make this
        // file smaller" op, not a guessed number (480 keeps a typical
        // phone photo well under Telegram's own display width).
        pipeline = pipeline.resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true });
        break;
      case "resize-large":
        // Upscales toward 1600px on the longer edge when the source is
        // smaller — plain pixel interpolation (sharp's default Lanczos
        // kernel), not AI super-resolution; stated plainly so it's
        // never confused with the AI image-generation path.
        pipeline = pipeline.resize({ width: 1600, height: 1600, fit: "inside" });
        break;
      case "rotate-90":
        pipeline = pipeline.rotate(90);
        break;
      case "flip-h":
        // sharp's own naming: flop() mirrors left-right.
        pipeline = pipeline.flop();
        break;
      case "flip-v":
        // sharp's own naming: flip() mirrors top-bottom.
        pipeline = pipeline.flip();
        break;
      case "grayscale":
        pipeline = pipeline.grayscale();
        break;
      case "sharpen":
        pipeline = pipeline.sharpen();
        break;
    }

    const output = await pipeline.jpeg({ quality: 85 }).toBuffer();
    return NextResponse.json({ image_base64: output.toString("base64") });
  } catch {
    return NextResponse.json({ error: "تعذّر تعديل الصورة — تأكد أنها صورة صالحة (JPEG/PNG)" }, { status: 422 });
  }
}
