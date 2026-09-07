import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Owner spec, 2026-09-08 ("اسأل جروك هل يستطيع تغذية ذكاءنا بمعلومات...
 * ان كان يستطيع قم بربطهما معا... احدهما يرسل معلومات وبرامج والآخر
 * يخزن ويتعلم" — ask Groq whether it can feed our AI a continuous
 * stream of information; if so, connect the two: one side sends
 * information, the other stores and learns).
 *
 * The honest, real-constraint answer: Groq's free tier is rate-limited
 * and Vercel's Hobby cron plan only runs daily jobs (confirmed by every
 * other cron in vercel.json already being daily) — a genuinely
 * continuous 24/7 pipe isn't something either free tier supports. This
 * is the closest real, working version of that idea: once a day, Groq
 * is asked to write out clear answers on a rotating batch of general-
 * knowledge topics, and each one is stored directly into
 * NovaKnowledgeEntry — the exact same durable table rag.py's shared
 * knowledge bank already reads for live retrieval AND that
 * merge_and_finetune.ipynb's cell 4ب already pulls as real training
 * data. So one side (Groq) really does keep sending information, and
 * the other (Nova's own knowledge bank + weekly training run) really
 * does store and eventually learn it — the same distillation
 * relationship this project already uses at training time (see
 * ai-system/app/council.py's module docstring: Groq builds Nova, it
 * never answers live users directly), just running proactively instead
 * of only reactively when a real user happens to ask something Nova
 * doesn't know yet.
 *
 * Deliberately NOT the same GROQ_MODEL Nova's own council.py uses
 * ("openai/gpt-oss-120b") — see the real 2026-09-08 identity-leak
 * incident (ai-system/app/council.py's _FORBIDDEN_IDENTITY_TERMS
 * comment): an OpenAI-published model has its own hard-coded
 * self-identification that can leak through even a firm system
 * prompt. This content never gets a system prompt about Nova's
 * identity at all (topics below are neutral general knowledge, never
 * "who are you"), but using the same site-wide llama model
 * src/lib/groq.ts already uses elsewhere avoids that whole class of
 * risk for content headed straight into training data.
 */

const KNOWLEDGE_TOPICS = [
  "اشرح الفرق بين المتغيرات (variables) والثوابت (constants) في البرمجة بمثال بسيط.",
  "ما هي أهم فوائد شرب الماء بانتظام؟",
  "اشرح مفهوم API بلغة بسيطة لغير المبرمجين.",
  "ما الفرق بين الذكاء الاصطناعي والتعلم الآلي؟",
  "كيف أكتب سيرة ذاتية (CV) قوية لأول وظيفة؟",
  "ما هي أهم النصائح لإدارة الوقت بفعالية؟",
  "اشرح الفرق بين HTTP وHTTPS ببساطة.",
  "ما هي فوائد النوم الكافي على الصحة العامة؟",
  "كيف تعمل محركات البحث بشكل عام؟",
  "ما الفرق بين قاعدة البيانات العلائقية وغير العلائقية؟",
  "أعطني نصائح عملية لتوفير المال شهرياً.",
  "اشرح مفهوم التضخم الاقتصادي ببساطة.",
  "ما هي خطوات كتابة خطة عمل بسيطة لمشروع صغير؟",
  "كيف أحسّن مهارات التواصل مع الآخرين؟",
  "ما الفرق بين الفيروس والبكتيريا من ناحية طبية مبسطة؟",
  "اشرح كيف تعمل الخوارزميات بمثال يومي بسيط.",
  "ما هي أهم مبادئ التغذية الصحية المتوازنة؟",
  "كيف أتعلم لغة برمجة جديدة بسرعة وفعالية؟",
  "ما الفرق بين التخزين السحابي (Cloud) والتخزين المحلي؟",
  "أعطني نصائح لتحسين التركيز أثناء الدراسة أو العمل.",
];

// 4 topics/day keeps this comfortably inside Groq's free-tier rate
// limits (a handful of calls once daily, not a burst) while still
// cycling through the whole list roughly every 5 days.
const TOPICS_PER_RUN = 4;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET;
}

async function askGroq(topic: string): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "أجب عن السؤال التالي بفقرة واضحة ومفيدة بالعربية الفصحى، مباشرة بلا مقدمات مثل 'بالتأكيد' أو 'إليك الشرح'.",
          },
          { role: "user", content: topic },
        ],
        max_tokens: 400,
        temperature: 0.5,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Rotate through the topic list by day-of-year instead of randomly,
  // so a redeploy or a re-run on the same day doesn't reshuffle which
  // topics get covered — same list position always maps to the same
  // calendar day.
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  const startIndex = (dayOfYear * TOPICS_PER_RUN) % KNOWLEDGE_TOPICS.length;
  const todaysTopics = Array.from(
    { length: TOPICS_PER_RUN },
    (_, i) => KNOWLEDGE_TOPICS[(startIndex + i) % KNOWLEDGE_TOPICS.length]
  );

  let stored = 0;
  for (const topic of todaysTopics) {
    const content = await askGroq(topic);
    if (!content) continue;
    await prisma.novaKnowledgeEntry.create({
      data: { query: topic, content, source: "general" },
    });
    stored++;
  }

  return NextResponse.json({ ok: true, attempted: todaysTopics.length, stored });
}
