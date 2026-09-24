// Shared client helpers for «بَشَر» (page, floating bubble, window).

export type Ans = { id: string; text: string; from: string };
export type Api = Record<string, unknown> & { credits?: number; online?: number; answered?: number; error?: string };

export const ANSWER_SECONDS = 75;
export const MAX_LEN = 280;
// Same public 300x250 unit as AdsterraSlot's in-content position.
export const AD_300x250 = "3ee970813986977775e962f26938d143";

export async function api(action: string, extra: Record<string, unknown> = {}): Promise<Api> {
  try {
    const r = await fetch("/api/bashar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
      cache: "no-store",
    });
    return (await r.json()) as Api;
  } catch {
    return { error: "تعذّر الاتصال" };
  }
}

/** Public link of a question. */
export function questionUrl(id: string) {
  return `${window.location.origin}/bashar/q/${id}`;
}

/**
 * Telegram link: when the owner registers «بَشَر» as a Mini App in BotFather
 * and sets NEXT_PUBLIC_BASHAR_TG_APP (e.g. "ArabicAds_bot/bashar"), shared
 * questions open as Telegram's window on top of the chat. Otherwise the web link.
 */
export function telegramQuestionUrl(id: string) {
  const app = (process.env.NEXT_PUBLIC_BASHAR_TG_APP || "").trim();
  return app ? `https://t.me/${app}?startapp=q_${id}` : questionUrl(id);
}

export function inviteText(question: string) {
  return `🧍 سؤال من إنسان حقيقي — أجبني خلال 75 ثانية:\n«${question}»`;
}
