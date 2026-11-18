/**
 * Guards Sham 2 user-facing replies:
 *  - the live user turn is actually the last message sent to the Studio
 *  - a copied previous assistant answer is retried, not delivered again
 *  - training/checkpoint status reports never go into the model chat
 */
import { nearSameReply } from "@/lib/shamMemory";

export type ShamChatTurn = { role: "user" | "assistant"; content: string };

const REPORT_MARKERS = [
  /تقرير جلسة شام/,
  /جرد أوزان شام/,
  /خطوات تدريب حقيقية هذه الجلسة/,
  /نقاط(?:\s+ال)?حفظ/,
  /نقطة حفظ/,
  /\bsham-(?:merged-)?(?:chat-)?(?:multimodal-)?checkpoint\b/i,
  /\bcheckpoints\/final(?:_merged)?\.pt\b/i,
  /متوسط الخسارة (?:أول|آخر) 10 خطوات/,
];

/** A training-status / checkpoint-inventory dump, not an answer to the user's message. */
export function isTrainingStatusReply(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const hits = REPORT_MARKERS.filter((re) => re.test(t)).length;
  if (hits >= 2) return true;
  if (hits >= 1 && /\|.+\|.+\|/.test(t) && /checkpoint|نقطة|خطوة/i.test(t)) return true;
  if (/جرد أوزان شام/.test(t) || /تقرير جلسة شام/.test(t)) return true;
  return false;
}

/** The new answer is a word-for-word (or near) copy of a previous assistant turn in this history. */
export function isEchoedPriorReply(reply: string, history: Array<{ q?: string; a?: string }> | undefined): boolean {
  const text = String(reply || "").trim();
  if (!text || !history?.length) return false;
  return history.some((turn) => typeof turn.a === "string" && turn.a.trim() && nearSameReply(turn.a, text));
}

/**
 * Native role messages for Sham 2 direct chat. The current user text is always the
 * final turn, even when history already ends with the same question (never omitted,
 * never replaced by an older cached question).
 */
export function shamDirectChatMessages(history: Array<{ q?: string; a?: string }> | undefined, text: string): ShamChatTurn[] {
  const current = String(text || "");
  const out: ShamChatTurn[] = [];
  for (const turn of history || []) {
    const q = typeof turn.q === "string" ? turn.q : "";
    const a = typeof turn.a === "string" ? turn.a : "";
    if (!q.trim()) continue;
    out.push({ role: "user", content: q });
    if (a.trim()) out.push({ role: "assistant", content: a });
  }
  if (out.length && out[out.length - 1].role === "user" && out[out.length - 1].content === current) {
    return out.slice(-12);
  }
  out.push({ role: "user", content: current });
  return out.slice(-12);
}

export function historyFromTurns(turns: ShamChatTurn[]): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = [];
  for (const turn of turns) {
    if (turn.role === "user") out.push({ q: turn.content, a: "" });
    else if (out.length) out[out.length - 1].a = turn.content;
  }
  return out;
}

export function lastUserContent(messages: ShamChatTurn[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

export const STALE_REPLY_USER = "تعذّر تكوين جواب مناسب لهذه الرسالة. أعد المحاولة بصيغة مختلفة.";

/** Remove only an immediately repeated, identical sentence; never synthesize or rewrite the model's wording. */
export function collapseAdjacentDuplicateSentences(text: string): string {
  const chunks = [...String(text || "").matchAll(/[^.!?؟\n]+[.!?؟]?/gu)];
  const remove: Array<[number, number]> = [];
  let previousKey = "";
  for (const chunk of chunks) {
    const value = chunk[0];
    const key = value.normalize("NFKC")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .toLocaleLowerCase("ar")
      .replace(/[\p{P}\p{S}\s]+/gu, " ")
      .trim();
    if (key.length >= 28 && key === previousKey) {
      const start = chunk.index ?? 0;
      remove.push([start, start + value.length]);
      continue;
    }
    if (key.length >= 28) previousKey = key;
  }
  let cleaned = String(text || "");
  for (const [start, end] of remove.reverse()) cleaned = cleaned.slice(0, start) + cleaned.slice(end);
  return cleaned.trim();
}

/** Last-line defense before a reply is shown: repeated sentences, training reports and copied prior answers stay out of the chat. */
export function visibleShamReply(text: string, history?: Array<{ q?: string; a?: string }>): { text: string; blocked: "echo" | "report" | "" } {
  const raw = collapseAdjacentDuplicateSentences(String(text || "").trim());
  if (!raw) return { text: "", blocked: "" };
  if (isTrainingStatusReply(raw)) return { text: STALE_REPLY_USER, blocked: "report" };
  if (isEchoedPriorReply(raw, history)) return { text: STALE_REPLY_USER, blocked: "echo" };
  return { text: raw, blocked: "" };
}
