/**
 * Guest mode (Bot API 10.0): someone mentions the bot in a chat it is NOT a member of; Telegram sends `guest_message` with a `guest_query_id`, and the bot answers once
 * with `answerGuestQuery`. Switched in the panel (Telegram tab), off by default; Telegram's own `supports_guest_queries` is set by the same control.
 *
 * What a guest answer is: ONE short plain reply on Nova's lite path (no tools, no memory, no connectors, no computer, no GitHub), so a stranger's chat can never reach the
 * owner's files or accounts. It is also visible to everyone in that chat, so it is short, rate-limited per caller (6 an hour), and "owner" audience answers only the owner.
 */
import { NOVA_CHAT_SYSTEM } from "@/lib/modes";
import { coderChat } from "@/lib/openCoderStudio";
import { tierFor } from "@/lib/coderAuth";
import { guestAudience } from "@/lib/tgFeatures";

const PER_HOUR = 6;
const hits = new Map<number, number[]>();
const allowed = (uid: number): boolean => {
  const now = Date.now();
  const list = (hits.get(uid) || []).filter((t) => now - t < 3600_000);
  if (list.length >= PER_HOUR) { hits.set(uid, list); return false; }
  list.push(now); hits.set(uid, list);
  if (hits.size > 5000) for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k);
  return true;
};
export const _resetGuest = (): void => hits.clear();

/** The question: the message text without the bot's own @mention. */
export function guestQuestion(msg: { text?: string; caption?: string }, botUsername = ""): string {
  let t = String(msg.text || msg.caption || "");
  if (botUsername) t = t.replace(new RegExp(`@${botUsername}\\b`, "ig"), " ");
  return t.replace(/\s+/g, " ").trim().slice(0, 600);
}

const SYSTEM = NOVA_CHAT_SYSTEM + "\nYou were mentioned in someone else's chat: answer in at most three short sentences, in the language of the question, and never reveal anything about the owner, their files or accounts.";

export type GuestResult = "answered" | "ignored" | "refused";

/** Handles one `guest_message` update. Never throws; returns what it did (for the log and the tests). */
export async function handleGuestMessage(api: { raw: Record<string, (p: Record<string, unknown>) => Promise<unknown>> }, msg: any, botUsername = ""): Promise<GuestResult> {
  const mode = await guestAudience();
  const qid = String(msg?.guest_query_id || "");
  const uid = Number(msg?.from?.id);
  if (mode === "off" || !qid || !Number.isFinite(uid)) return "ignored";
  if (mode === "owner" && tierFor(uid) !== "owner") return "ignored";
  const question = guestQuestion(msg, botUsername);
  const say = async (text: string): Promise<GuestResult> => {
    await api.raw.answerGuestQuery({ guest_query_id: qid, result: { type: "article", id: `g${Date.now().toString(36)}`, title: "Nova AI", input_message_content: { message_text: text.slice(0, 3500) } } }).catch(() => null);
    return "answered";
  };
  if (!question) return say("اكتب سؤالك بعد الإشارة إليّ وسأجيبك باختصار.");
  if (tierFor(uid) !== "owner" && !allowed(uid)) return say("وصلتَ إلى حدّ الأسئلة في الساعة. جرّب لاحقًا.");
  const o = await coderChat([{ role: "system", content: SYSTEM }, { role: "user", content: question }], { tools: [], maxTokens: 220, think: false, temperature: 0.6, waitS: 20, timeoutMs: 28000, model: "coder" }).catch(() => null);
  const text = String(o?.reply?.type === "done" ? o.reply.text || "" : "").trim();
  return say(text || "تعذّر الرد الآن، جرّب بعد قليل.");
}
