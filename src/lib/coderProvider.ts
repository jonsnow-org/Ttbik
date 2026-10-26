// Sham (the owner's own model) inside Nova's engine: the Studio's answer is returned in the same shape as a finished job, so the agent loop treats it like any other reply.
import type { CoderMessage, CoderOutcome, CoderReply, CoderTool } from "@/lib/openCoderStudio";
import { shamGenerateAny, shamStudioEnabled, shamVariant } from "@/lib/shamStudio";
import { SHAM_CODE_NOTE, brokenCallAttempt, codeNotTried, parseShamToolCalls, shamCorrectionNote, shamToolConversation, shamToolsEnabled, validateShamCall } from "@/lib/shamTools";

export const PROVIDER_JOB_PREFIX = "p~";

/**
 * Sham, the owner's own model, as a one-shot "worker" for a sub-agent (role "sham", owner only): the task goes to Sham as a plain question and
 * its raw answer comes back for the parent to judge. Sham has no tool calling and no system prompt here: only the task text is sent.
 * An unreachable / loading Studio is reported as a failure, so the run's patience loop waits for it like for any model server.
 */
/** What Sham is given inside Nova's engine. Today's numbers fit a small, still-training model; SHAM_LIMITS=open (or each SHAM_* alone) lifts them
 *  without a code change when the trained Sham can take more. Read per call so a changed environment value applies at once. */
export const SHAM_LIM = {
  get open() { return shamVariant.getStore() === "v2" || (process.env.SHAM_LIMITS || "").trim().toLowerCase() === "open"; },
  get maxNew() { return Number(process.env.SHAM_MAX_NEW_TOKENS) || (this.open ? 768 : 200); },
  get turns() { return Number(process.env.SHAM_HISTORY_TURNS) || (this.open ? 20 : 6); },
  get turnChars() { return Number(process.env.SHAM_TURN_CHARS) || (this.open ? 1200 : 300); },
  get sources() { return Number(process.env.SHAM_SOURCES_CHARS) || (this.open ? 6000 : 1800); },
  get promptChars() { return Number(process.env.SHAM_PROMPT_CHARS) || (this.open ? 12000 : 3200); },
};

export async function shamAsModel(messages: CoderMessage[], opts: { maxTokens?: number; timeoutMs?: number; conversation?: boolean; tools?: CoderTool[] } = {}): Promise<CoderOutcome> {
  if (!shamStudioEnabled()) return { reply: null, failure: "off" };
  const withTools = Boolean(opts.conversation && opts.tools?.length && shamToolsEnabled());       // Nova's loaded tools, as text (shamTools.ts)
  const prompt = withTools ? shamToolConversation(messages, opts.tools!, { turns: SHAM_LIM.turns, turnChars: SHAM_LIM.turnChars, maxChars: SHAM_LIM.promptChars }) : opts.conversation ? shamConversationPrompt(messages) : String([...messages].reverse().find((m) => m.role === "user" && !String(m.content).startsWith("[harness]"))?.content || "").trim().slice(0, 2000);
  if (!prompt) return { reply: null, failure: "unreadable" };
  const r = await shamGenerateAny(prompt, Math.min(SHAM_LIM.maxNew, Math.max(20, opts.maxTokens || 160)), opts.timeoutMs ?? 55000);
  if (!r) return { reply: null, failure: "network" };
  const job = `${PROVIDER_JOB_PREFIX}sham${Date.now().toString(36)}`;
  if (r.type === "text" && (r.text || "").trim()) {
    if (withTools) {
      // The engine checks the call before it runs; a wrong or incomplete one goes back to Sham with the reason (up to two corrections), no training needed.
      let text = String(r.text);
      let p = parseShamToolCalls(text, opts.tools!);
      for (let fix = 0; fix < 2; fix++) {
        const problems = p.calls.map((c) => validateShamCall(c, opts.tools!)).filter((e): e is string => Boolean(e));
        if (!p.calls.length && brokenCallAttempt(p.text)) problems.push("الصيغة غير صحيحة (JSON مكسور أو أداة غير محمّلة).");
        const note = problems.length ? shamCorrectionNote(problems) : !p.calls.length && codeNotTried(p.text, messages, opts.tools!) ? SHAM_CODE_NOTE : "";
        if (!note) break;
        const again = await shamGenerateAny(`${prompt.replace(/\nشام:$/, "")}\nشام: ${text.slice(0, 600)}\n${note}\nشام:`, Math.min(SHAM_LIM.maxNew, Math.max(20, opts.maxTokens || 160)), opts.timeoutMs ?? 55000);
        if (!again || again.type !== "text" || !(again.text || "").trim()) break;
        text = String(again.text); p = parseShamToolCalls(text, opts.tools!);
      }
      const valid = p.calls.filter((c) => !validateShamCall(c, opts.tools!));
      if (!valid.length && !p.text.trim()) return { reply: null, failure: "unreadable" };         // still no usable call after the corrections: the engine's own fallback decides
      return { reply: { type: "done", job, text: p.text, tool_calls: valid } };
    }
    return { reply: { type: "done", job, text: String(r.text).trim(), tool_calls: [] } };
  }
  if (r.type === "image" || r.type === "audio" || r.type === "video") return { reply: { type: "done", job, text: `[Sham answered with ${r.type}, not shown here]${r.text ? ` ${String(r.text).slice(0, 300)}` : ""}`, tool_calls: [] } };
  return { reply: null, failure: r.type === "pending" ? "timeout" : "http" };     // loading / busy / gone / notice: not an answer
}

/**
 * Sham as the chosen model inside Nova's engine. Sham is a small model with a short context and no tool calling, so it gets neither Nova's
 * system prompt nor tool schemas: only the last few turns, and, when the engine ran a research for it, a short excerpt of the SOURCES to
 * write from. The engine (not Sham) does the searching, the retrying, the long-task bookkeeping.
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
