/**
 * Shared identity/boundary preamble prepended to every Groq call on the site.
 * Keeps every narrow text task (translation, replies, marketing posts, …)
 * consistent with the brand and, critically, scoped so Groq never overlaps
 * with the separate engineering process that builds/decides the site itself.
 * See docs/groq-assistant-brief.md for the full rationale.
 */
const SITE_IDENTITY_PROMPT = `أنت محرك تنفيذ نصوص مدمج داخل موقع "سوق تولز" (SouqTools) — سوق عربي لأدوات وخدمات رقمية مصغّرة حقيقية (بوتات تليجرام، أدوات تعمل داخل المتصفح، خدمات منفَّذة فعلياً)، وليس متجراً يبيع "وصولاً" عاماً لذكاء اصطناعي كمنتج قائم بذاته.

دورك محدود وتنفيذي بحت: تنفيذ مهمة نصية واحدة محددة تُعطى لك في كل استدعاء (مثل ترجمة، تلخيص، رد على عميل، كتابة منشور، وصف منتج، تحليل مراجعات) بجودة عالية وبالعربية الفصحى الواضحة، ثم التوقف. التعليمات التفصيلية لكل مهمة تصلك في رسالة النظام التالية لهذا النص — نفّذها بدقة.

حدود صارمة يجب الالتزام بها دائماً:
- لا تُقدّم نفسك أبداً كمطوّر الموقع أو كـ"Claude" أو كأي مساعد هندسي؛ أنت أداة تنفيذ نصي واحدة من ضمن ميزات الموقع، ولا علاقة لك ببناء أو تعديل أو نشر أي جزء من الموقع — تلك مهمة فريق تقني منفصل تماماً عنك ولا تحتاج الإشارة إليه.
- لا تَعِد بتنفيذ أي شيء خارج المهمة النصية المطلوبة منك حرفياً (لا إضافة ميزة، لا تعديل كود، لا وصول لأي نظام).
- لا تناقش استراتيجية العمل الداخلية، التسعير، الأفكار غير المنفذة، أو أي تفاصيل تقنية/أمنية للموقع (قواعد بيانات، مفاتيح، لوحة تحكم) — إن سُئلت عن ذلك، اعتذر بإيجاز ووجّه السائل للتواصل عبر قناة الدعم بدل الإجابة بنفسك.
- التزم بالمهمة المحددة فقط ولا تتوسّع في نصائح أو مواضيع جانبية لم تُطلب.`;

// Groq retires models from time to time; a retired model answers 400/404
// and every AI tool on the site silently broke with it. Try the next free
// model instead of failing (first one that answers wins).
const GROQ_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];
// gpt-oss models reason before answering; with the small budgets the site's
// tools use, the reasoning ate every token and the visible answer came back
// empty. Keep their reasoning short and give them room for the answer.
const isReasoningModel = (m: string) => m.startsWith("openai/gpt-oss");

export class GroqError extends Error {
  constructor(public status: number, detail: string) {
    super(`GROQ_ERROR ${status}: ${detail.slice(0, 200)}`);
  }
}

export async function callGroq(systemPrompt: string, userInput: string, maxTokens: number): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("NO_API_KEY");

  let last: GroqError | null = null;
  for (const model of GROQ_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: `${SITE_IDENTITY_PROMPT}\n\n---\n\n${systemPrompt}` },
            { role: "user", content: userInput },
          ],
          max_tokens: isReasoningModel(model) ? maxTokens + 1200 : maxTokens,
          temperature: 0.6,
          ...(isReasoningModel(model) ? { reasoning_effort: "low" } : {}),
        }),
      }).catch(() => null);

      if (res?.ok) {
        const data = await res.json().catch(() => null);
        const text = String(data?.choices?.[0]?.message?.content || "").trim();
        if (text) return text;
        last = new GroqError(200, `empty answer from ${model}`);
        console.error(`[groq] ${model} → empty answer`);
        break; // try the next model
      }
      const status = res?.status ?? 0;
      const detail = res ? await res.text().catch(() => "") : "network error";
      last = new GroqError(status, detail);
      console.error(`[groq] ${model} → ${status} ${detail.slice(0, 200)}`);
      // 401/403: bad key — no other model will help.
      if (status === 401 || status === 403) throw last;
      // 429 / 5xx / network: one short retry on the same model.
      if ((status === 429 || status >= 500 || status === 0) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      break; // 400/404 (e.g. model retired) → next model
    }
  }
  throw last ?? new Error("GROQ_ERROR");
}
