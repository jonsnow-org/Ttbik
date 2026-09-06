// Shared cross-bot bridge to the Nova AI FastAPI brain (ai-system/), so
// AD_BOT/JOBS_BOT/MARRIAGE_BOT can offer a real "improve this text with
// AI" step instead of duplicating any LLM logic in this repo. Reuses
// the exact TELEGRAM channel resolveOrCreateUser path Nova's own bot
// uses (see ai-system/app/quota.py) — a user's Telegram id is globally
// unique across every bot they talk to, so this intentionally shares
// the SAME NovaUser account, daily free quota and PRO subscription as
// if they messaged NOVA_BOT directly. That's a deliberate design
// choice, not a shortcut: it's the one honest way to let every bot
// benefit from Nova without creating a second, ownerless quota system
// bots could be used to bypass.
const FASTAPI_URL = process.env.NOVA_FASTAPI_URL || "";
const INTERNAL_SECRET = process.env.NOVA_INTERNAL_SECRET || "";

export function novaAssistConfigured(): boolean {
  return Boolean(FASTAPI_URL && INTERNAL_SECRET);
}

export async function askNovaAssist(telegramId: string, message: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!novaAssistConfigured()) {
    return { ok: false, error: "مساعد الذكاء الاصطناعي غير مُفعّل حالياً." };
  }
  try {
    const res = await fetch(`${FASTAPI_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
      body: JSON.stringify({ channel: "TELEGRAM", telegram_id: telegramId, message }),
      signal: AbortSignal.timeout(55000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 429 here means the user hit Nova's own free daily quota (shared
      // across every bot) — a normal, expected outcome, not an error to
      // hide: the caller should let the user keep their original text.
      return { ok: false, error: data?.detail || "تعذّر الحصول على اقتراح الذكاء الاصطناعي الآن." };
    }
    return { ok: true, text: String(data.answer || "").trim() };
  } catch {
    return { ok: false, error: "تعذّر الاتصال بمساعد الذكاء الاصطناعي حالياً." };
  }
}

export async function improveListingText(telegramId: string, kind: string, draft: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const instruction =
    `حسّن نص ${kind} التالي ليكون أكثر احترافية ووضوحاً وجاذبية، بنفس اللغة التي كُتب بها، ` +
    `دون اختراع تفاصيل أو أرقام غير موجودة في النص الأصلي، وبدون أي مقدمة أو تعليق منك — ` +
    `أعد النص المحسّن فقط:\n\n"""${draft}"""`;
  return askNovaAssist(telegramId, instruction);
}
