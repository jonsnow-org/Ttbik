import { NextRequest, NextResponse } from "next/server";
import { callGroq } from "@/lib/groq";

// Consolidates the other 2 of the old paid catalog's dead-on-arrival AI
// services (text-summarizer, review-analyzer) into one free, genuinely
// working tool — see writing-assistant/route.ts for the same rationale.
// ai-chat-assistant (the 7th) was deliberately NOT folded in anywhere:
// an open-ended AI chat is exactly what src/lib/groq.ts's own site-identity
// prompt says this project is not ("ليس متجراً يبيع وصولاً عاماً لذكاء
// اصطناعي") — merging it in would just resurrect the thing that made it
// worth retiring in the first place.
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

const MODES: Record<string, { system: string; maxTokens: number }> = {
  summarize: {
    system:
      "أنت مساعد لمديري الأعمال. تُعطى تقريراً أو مستنداً طويلاً — لخّصه إلى أهم 3-5 نقاط رئيسية بصيغة قائمة نقطية، ثم أضف سطراً أخيراً بعنوان 'التوصية:' يحتوي توصية عملية واحدة محددة يمكن اتخاذ قرار بناءً عليها فوراً. لا تُخرج ملخصاً عاماً.",
    maxTokens: 500,
  },
  reviews: {
    system:
      "أنت محلل آراء عملاء. تُعطى عدة تقييمات عملاء (كل تقييم في سطر منفصل) — حلّل كل تقييم على حدة: صنّفه (إيجابي/سلبي/محايد) واقترح رداً مناسباً وقصيراً بالعربية لكل واحد. رتّب الإخراج تقييماً تلو الآخر بصيغة: '- التقييم: ... | التصنيف: ... | الرد المقترح: ...'.",
    maxTokens: 700,
  },
};

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "لقد تجاوزت الحد المسموح مؤقتاً، حاول بعد قليل" }, { status: 429 });
  }

  const { mode, input } = await req.json().catch(() => ({}));
  const config = typeof mode === "string" ? MODES[mode] : undefined;
  if (!config) {
    return NextResponse.json({ error: "نوع غير صالح" }, { status: 400 });
  }
  if (typeof input !== "string" || !input.trim()) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  try {
    const output = await callGroq(config.system, input.slice(0, 2500), config.maxTokens);
    return NextResponse.json({ output });
  } catch (e: any) {
    if (e.message === "NO_API_KEY") {
      return NextResponse.json({ error: "الأداة غير مفعّلة بعد على هذا السيرفر" }, { status: 503 });
    }
    return NextResponse.json({ error: "تعذّر تحليل النص الآن، حاول لاحقاً", code: typeof e?.status === "number" ? e.status : undefined }, { status: 502 });
  }
}
