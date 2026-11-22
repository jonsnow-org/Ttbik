/**
 * Guards Nova's user-facing replies (Nova's own module — it imports nothing of Sham's, so the two models stay independent).
 *
 * Two problems this closes, both seen live in this project's own chats:
 *  - a CPU model repeats a whole sentence block (a duplicated greeting-plus-identity pair, or the same sentence twice);
 *  - a reply is a word-for-word copy of a previous assistant turn, or a raw status/inventory dump, instead of an answer.
 *
 * The wording is never synthesised: a repeated block is dropped, and a copied / dump reply is replaced with an honest
 * "could not compose a reply" line. CODER_REPLY_GUARD=off disables the whole guard (rollback switch).
 */

const off = () => (process.env.CODER_REPLY_GUARD || "").trim().toLowerCase() === "off";

/** Diacritics, tatweel and punctuation removed; letters/digits only, lower-cased — for comparing two replies. */
export function normReply(s: string): string {
  return String(s || "").replace(/[\u064B-\u0652\u0640]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

/** Two replies say the same thing: identical after normalising, one contains the other, or >= 80% of the words are shared. */
export function nearSameReply(a: string, b: string): boolean {
  const x = normReply(a), y = normReply(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x)))) return true;
  const wa = new Set(x.split(" ")), wb = new Set(y.split(" "));
  let common = 0;
  wa.forEach((w) => { if (wb.has(w)) common++; });
  return common / Math.max(wa.size, wb.size) >= 0.8;
}

/** Collapse adjacent identical sentence blocks (1..6 sentences), longest block first, repeated until stable. Never rewrites the model's wording. */
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

// A raw run/engine report or weight/checkpoint inventory is not an answer to the user's message.
const REPORT_MARKERS = [
  /تقرير الجلسة/,
  /تقرير تشغيل/,
  /جرد الأوزان/,
  /نقاط(?:\s+ال)?حفظ/,
  /نقطة حفظ/,
  /\bcheckpoints?\//i,
  /\bcheckpoint\b/i,
  /متوسط الخسارة/,
  /الخطوة النهائية/,
];

/** A run/status/inventory dump, not an answer. */
export function isStatusDumpReply(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const hits = REPORT_MARKERS.filter((re) => re.test(t)).length;
  if (hits >= 2) return true;
  if (hits >= 1 && /\|.+\|.+\|/.test(t) && /checkpoint|نقطة|خطوة/i.test(t)) return true;
  if (/جرد الأوزان/.test(t) || /تقرير الجلسة/.test(t)) return true;
  return false;
}

/** The assistant replies already in this conversation (the current answer is not pushed yet when this runs). */
export function priorAssistantReplies(messages: Array<{ role?: string; content?: unknown }>): string[] {
  const out: string[] = [];
  for (const m of messages || []) {
    if (m?.role === "assistant" && typeof m.content === "string" && m.content.trim()) out.push(m.content);
  }
  return out;
}

/** The reply is a word-for-word (or near) copy of a previous assistant turn in this chat. */
export function isEchoedPriorReply(reply: string, prior: string[] | undefined): boolean {
  const text = String(reply || "").trim();
  if (!text || !prior?.length) return false;
  return prior.some((a) => typeof a === "string" && a.trim() && nearSameReply(a, text));
}

const hasArabic = (t: string): boolean => /[\u0600-\u06FF]/.test(String(t || ""));
export const NOVA_STALE_AR = "تعذّر تكوين جواب مناسب لهذه الرسالة. أعد المحاولة بصيغة مختلفة.";
export const NOVA_STALE_EN = "I could not produce a suitable reply to this message. Please try rephrasing it.";

export type NovaVisible = { text: string; blocked: "echo" | "report" | "" };

/**
 * Last-line defense before Nova's final answer is shown: adjacent repeated blocks are collapsed, and a copied prior
 * reply or a raw status dump is replaced with an honest line (in the language of the text). Wording is never invented.
 */
export function visibleNovaReply(text: string, prior?: string[]): NovaVisible {
  const collapsed = collapseAdjacentDuplicateSentences(String(text || "").trim());
  if (!collapsed) return { text: "", blocked: "" };
  if (off()) return { text: collapsed, blocked: "" };
  const stale = hasArabic(collapsed) ? NOVA_STALE_AR : NOVA_STALE_EN;
  if (isStatusDumpReply(collapsed)) return { text: stale, blocked: "report" };
  if (isEchoedPriorReply(collapsed, prior)) return { text: stale, blocked: "echo" };
  return { text: collapsed, blocked: "" };
}
