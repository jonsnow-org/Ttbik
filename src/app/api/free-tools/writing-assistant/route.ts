import { NextRequest, NextResponse } from "next/server";
import { callGroq } from "@/lib/groq";

// Consolidates 4 of the old paid catalog's dead-on-arrival AI services
// (smart-translator, social-caption-generator, blog-writer,
// product-description-writer — see docs/AGENT_BUS.md for why they were
// retired: none of them ever had a working /tools/[tool] page behind
// them, tool_route pointed nowhere) into one free, genuinely working tool.
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
  caption: {
    system:
      "أنت خبير تسويق سوشيال ميديا. بناءً على وصف المنتج/الموضوع المُعطى، اكتب 3 منشورات جاهزة لإنستغرام وتيك توك بأساليب مختلفة (مرح، احترافي، تسويقي مباشر)، كل واحد بحد أقصى 4 أسطر مع إيموجي مناسبة. افصل بين المنشورات بخط فارغ ورقم.",
    maxTokens: 400,
  },
  blog: {
    system:
      "أنت كاتب محتوى محترف. بناءً على الكلمة المفتاحية أو الموضوع المُعطى، اكتب مسودة مقال متكاملة بالعربية: عنوان جذاب، مقدمة قصيرة، ثم 3-4 فقرات رئيسية بعناوين فرعية. هذه نقطة انطلاق للكتابة، وليست مقالاً نهائياً جاهزاً للنشر دون مراجعة.",
    maxTokens: 700,
  },
  "product-desc": {
    system:
      "أنت كاتب أوصاف منتجات لمتجر إلكتروني. بناءً على اسم المنتج وتفاصيله المُعطاة، اكتب وصف منتج مقنعاً وقصيراً بالعربية (فقرة واحدة 3-5 أسطر) يبرز أهم فائدة للعميل، مناسب للنشر مباشرة على Shopify/Salla.",
    maxTokens: 300,
  },
  translate: {
    system:
      "أنت مترجم محترف للمستندات التجارية. تُعطى نصاً بالعربية أو الإنجليزية — ترجمه بدقة إلى اللغة الأخرى (إن كان عربياً ترجمه للإنجليزية، وإن كان إنجليزياً ترجمه للعربية)، محافظاً على بنية النص (فقرات، أرقام، بنود) والمصطلحات الرسمية. أعد الترجمة فقط دون أي شرح إضافي.",
    maxTokens: 600,
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
    const output = await callGroq(config.system, input.slice(0, 1500), config.maxTokens);
    return NextResponse.json({ output });
  } catch (e: any) {
    if (e.message === "NO_API_KEY") {
      return NextResponse.json({ error: "الأداة غير مفعّلة بعد على هذا السيرفر" }, { status: 503 });
    }
    return NextResponse.json({ error: "تعذّر توليد النص الآن، حاول لاحقاً", code: typeof e?.status === "number" ? e.status : undefined }, { status: 502 });
  }
}
