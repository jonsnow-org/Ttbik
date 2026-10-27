// Sham's own prompt limits and plain-conversation prompt format (Sham is a small model with a short context). Moved out of Nova's provider file:
// Sham owns these; Nova's lesson export (coderLessons.ts) uses the same format only because Nova may train the old Sham.
import { shamVariant } from "@/lib/shamStudio";
import type { ShamMessage as CoderMessage } from "@/lib/shamTypes";

/** What Sham is given. Today's numbers fit a small, still-training model; SHAM_LIMITS=open (or each SHAM_* alone) lifts them
 *  without a code change when the trained Sham can take more. Read per call so a changed environment value applies at once. */
export const SHAM_LIM = {
  get open() { return shamVariant.getStore() === "v2" || (process.env.SHAM_LIMITS || "").trim().toLowerCase() === "open"; },
  get maxNew() { return Number(process.env.SHAM_MAX_NEW_TOKENS) || (this.open ? 768 : 200); },
  get turns() { return Number(process.env.SHAM_HISTORY_TURNS) || (this.open ? 20 : 6); },
  get turnChars() { return Number(process.env.SHAM_TURN_CHARS) || (this.open ? 1200 : 300); },
  get sources() { return Number(process.env.SHAM_SOURCES_CHARS) || (this.open ? 6000 : 1800); },
  get promptChars() { return Number(process.env.SHAM_PROMPT_CHARS) || (this.open ? 12000 : 3200); },
};

/**
 * Sham's prompt. Sham is a small model with a short context and no tool calling, so it gets neither Nova's
 * system prompt nor tool schemas: only the last few turns, and, when the engine ran a research for it, a short excerpt of the SOURCES to
 * write from.
 */
export function shamConversationPrompt(messages: CoderMessage[]): string {
  const turns = messages.filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content || "").trim() && !String(m.content).startsWith("[harness]"));
  const tool = [...messages].reverse().find((m) => m.role === "tool" && String(m.content || "").trim().length > 40);
  const last = [...turns].reverse().find((m) => m.role === "user");
  const history = turns.slice(-(SHAM_LIM.turns + 1), -1).map((m) => `${m.role === "user" ? "المستخدم" : "شام"}: ${String(m.content).trim().slice(0, SHAM_LIM.turnChars)}`);
  const parts: string[] = [];
  if (tool) parts.push(`المصادر:\n${String(tool.content).trim().slice(0, SHAM_LIM.sources)}`);
  if (history.length) parts.push(history.join("\n"));
  parts.push(`${tool ? "السؤال" : "المستخدم"}: ${String(last?.content || "").trim().slice(0, 700)}\nشام:`);
  return parts.join("\n\n").slice(0, SHAM_LIM.promptChars);
}
