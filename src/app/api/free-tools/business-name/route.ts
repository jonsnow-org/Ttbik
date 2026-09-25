import { NextRequest, NextResponse } from "next/server";
import { callGroq } from "@/lib/groq";

// This tool is genuinely free and unlimited-use (no order code), so the
// rate limit here protects the shared Groq quota from abuse — generous
// enough for real visitors, tight enough to block naive scripted spam.
const hits = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 10;
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

const SYSTEM_PROMPT =
  "You are a branding expert. Given a short description of a business/store, suggest 8 short, catchy Arabic business names (a mix of Arabic-root words and simple Arabic-English blends). Return ONLY a numbered list, one name per line, no explanations.";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "لقد تجاوزت الحد المسموح مؤقتاً، حاول بعد قليل" }, { status: 429 });
  }

  const { description } = await req.json().catch(() => ({}));
  if (typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  try {
    const output = await callGroq(SYSTEM_PROMPT, description.slice(0, 200), 600);
    return NextResponse.json({ output });
  } catch (e: any) {
    if (e.message === "NO_API_KEY") {
      return NextResponse.json({ error: "الأداة غير مفعّلة بعد على هذا السيرفر" }, { status: 503 });
    }
    return NextResponse.json({ error: "تعذّر توليد الأسماء الآن، حاول لاحقاً", code: typeof e?.status === "number" ? e.status : undefined }, { status: 502 });
  }
}
