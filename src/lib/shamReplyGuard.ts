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

/** Collapse adjacent identical sentence blocks; never synthesize or rewrite the model's wording. */
export function collapseAdjacentDuplicateSentences(text: string): string {
  let cleaned = String(text || "");
  for (let pass = 0; pass < 8; pass++) {
    const chunks = [...cleaned.matchAll(/[^.!?؟\n]+[.!?؟]?/gu)];
    const keys = chunks.map((chunk) => chunk[0].normalize("NFKC")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .toLocaleLowerCase("ar")
      .replace(/[\p{P}\p{S}\s]+/gu, " ")
      .trim());
    let removed = false;
    for (let i = 0; i < chunks.length && !removed; i++) {
      const maxBlock = Math.min(6, Math.floor((chunks.length - i) / 2));
      for (let size = maxBlock; size >= 1; size--) {
        const left = keys.slice(i, i + size);
        const right = keys.slice(i + size, i + size * 2);
        if (left.some((key) => !key) || left.join("\u0000") !== right.join("\u0000")) continue;
        const weight = left.reduce((sum, key) => sum + key.length, 0);
        if (weight < 32 || (size === 1 && left[0].length < 32)) continue;
        const start = chunks[i + size].index ?? 0;
        const last = chunks[i + size * 2 - 1];
        const end = (last.index ?? start) + last[0].length;
        cleaned = cleaned.slice(0, start) + cleaned.slice(end);
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  return cleaned.trim();
}

/**
 * A tool call is markup the engine reads, never words the user reads. Live 2026-11-26: a plain chat message made the old Sham
 * answer `<tool_call>{"name": "computer_search", …}</tool_call>` — its plain (non-durable) path runs no tools, so that markup went
 * into the chat and into memory as if it were the answer. Everything the user can see goes through here first.
 */
export function stripToolCallMarkup(text: string): string {
  let out = String(text || "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, " ")
    .replace(/<tool_call>[\s\S]*$/i, " ")                                  // a call the Studio's own cut left open
    .replace(/<\/?(?:tool_call|function|parameter)\b[^>]*>/gi, " ");
  // The same call, mangled by the Studio: "<tool_ call>", "</ tool_call>", "<tool_callous>" (live 2026-11-26, the second old-Sham
  // answer). From the first such tag on, the rest is the call and its JSON arguments — never words.
  const mangled = out.search(/<\s*\/?\s*tool[\s_]*c/i);
  if (mangled >= 0) out = out.slice(0, mangled);
  // …or the arguments with no tag left at all: a call-shaped JSON object is not an answer either.
  if (/^\s*[{[]/.test(out) && /"(?:name|arguments|parameters|path|content|id)"\s*:/.test(out)) return "";
  // a dangling "<tool_c" / "</tool_call" at the very end (the same cut), never a word: only a fragment that starts with '<'
  const dangling = out.match(/<\/?[a-z_]*\s*[^>\n]*$/i);
  if (dangling?.index !== undefined && out.slice(dangling.index).startsWith("<")) out = out.slice(0, dangling.index);
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Last-line defense before a reply is shown: repeated sentences, training reports and copied prior answers stay out of the chat. */
export function visibleShamReply(text: string, history?: Array<{ q?: string; a?: string }>): { text: string; blocked: "echo" | "report" | "" } {
  const raw = collapseAdjacentDuplicateSentences(stripToolCallMarkup(String(text || "").trim()));
  if (!raw) return { text: "", blocked: "" };
  if (isTrainingStatusReply(raw)) return { text: STALE_REPLY_USER, blocked: "report" };
  if (isEchoedPriorReply(raw, history)) return { text: STALE_REPLY_USER, blocked: "echo" };
  return { text: raw, blocked: "" };
}
