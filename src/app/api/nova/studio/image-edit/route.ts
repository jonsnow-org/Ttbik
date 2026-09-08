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

const OPS = new Set(["crop-square", "resize-small"]);
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
    if (op === "crop-square") {
      const side = Math.min(meta.width, meta.height);
      pipeline = pipeline.resize({ width: side, height: side, fit: "cover" });
    } else {
      // resize-small: caps the longer edge at 480px — a real, useful
      // "make this file smaller" op, not a guessed number (480 keeps a
      // typical phone photo well under Telegram's own display width).
      pipeline = pipeline.resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true });
    }

    const output = await pipeline.jpeg({ quality: 85 }).toBuffer();
    return NextResponse.json({ image_base64: output.toString("base64") });
  } catch {
    return NextResponse.json({ error: "تعذّر تعديل الصورة — تأكد أنها صورة صالحة (JPEG/PNG)" }, { status: 422 });
  }
}
