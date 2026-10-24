// Nova Pro: a second, stronger model reached through an OpenAI-compatible API (ModelScope API-Inference by default, free tier).
// It is chosen by hand (the owner's model picker) — there is no automatic fallback between models. The answer is returned in the same
// shape as the Studio's finished job, so the agent loop treats it like any other reply. Env (names only, never printed):
//   NOVA_PRO_MODEL (required, e.g. "Qwen/Qwen3.5-397B-A17B"), NOVA_PRO_API_KEY (falls back to MODELSCOPE_API_TOKEN),
//   NOVA_PRO_API_URL (default https://api-inference.modelscope.cn/v1).
import type { CoderMessage, CoderOutcome, CoderReply, CoderTool } from "@/lib/openCoderStudio";
import { shamGenerateAny, shamStudioEnabled } from "@/lib/shamStudio";

export const PROVIDER_JOB_PREFIX = "p~";

export type ProviderCfg = { base: string; key: string; model: string };

export function providerConfig(modelId: string | undefined): ProviderCfg | null {
  if (modelId !== "nova_pro") return null;
  const model = (process.env.NOVA_PRO_MODEL || "").trim();
  const key = (process.env.NOVA_PRO_API_KEY || process.env.MODELSCOPE_API_TOKEN || "").trim();
  if (!model || !key) return null;
  return { base: (process.env.NOVA_PRO_API_URL || "https://api-inference.modelscope.cn/v1").trim().replace(/\/+$/, ""), key, model };
}
export const providerReady = (modelId: string): boolean => providerConfig(modelId) !== null;

export async function providerChat(
  cfg: ProviderCfg,
  messages: CoderMessage[],
  opts: { tools?: CoderTool[]; maxTokens?: number; temperature?: number; timeoutMs?: number },
): Promise<CoderOutcome> {
  const body: Record<string, unknown> = { model: cfg.model, messages, temperature: opts.temperature ?? 0.6, stream: false };
  if (opts.tools?.length) body.tools = opts.tools;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  try {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
    });
    if (!res.ok) return { reply: null, failure: "http" };
    const j: any = await res.json().catch(() => null);
    const choice = j?.choices?.[0];
    const msg = choice?.message;
    if (!msg) return { reply: null, failure: "unreadable" };
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c: any) => c?.function?.name) : [];
    const reply: CoderReply = {
      type: "done",
      job: `${PROVIDER_JOB_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: typeof msg.content === "string" ? msg.content : "",
      tool_calls: calls.map((c: any, i: number) => ({ id: c.id || `call_${i}`, type: "function" as const, function: { name: String(c.function.name), arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) } })),
      finish_reason: choice.finish_reason || undefined,
    };
    return { reply };
  } catch (e) {
    const n = (e as { name?: string })?.name || "";
    return { reply: null, failure: n === "TimeoutError" || n === "AbortError" ? "timeout" : "network" };
  }
}

/**
 * Sham, the owner's own model, as a one-shot "worker" for a sub-agent (role "sham", owner only): the task goes to Sham as a plain question and
 * its raw answer comes back for the parent to judge. Sham has no tool calling and no system prompt here: only the task text is sent.
 * An unreachable / loading Studio is reported as a failure, so the run's patience loop waits for it like for any model server.
 */
export async function shamAsModel(messages: CoderMessage[], opts: { maxTokens?: number; timeoutMs?: number; conversation?: boolean } = {}): Promise<CoderOutcome> {
  if (!shamStudioEnabled()) return { reply: null, failure: "off" };
  const prompt = opts.conversation ? shamConversationPrompt(messages) : String([...messages].reverse().find((m) => m.role === "user" && !String(m.content).startsWith("[harness]"))?.content || "").trim().slice(0, 2000);
  if (!prompt) return { reply: null, failure: "unreadable" };
  const r = await shamGenerateAny(prompt, Math.min(200, Math.max(20, opts.maxTokens || 160)), opts.timeoutMs ?? 55000);
  if (!r) return { reply: null, failure: "network" };
  const job = `${PROVIDER_JOB_PREFIX}sham${Date.now().toString(36)}`;
  if (r.type === "text" && (r.text || "").trim()) return { reply: { type: "done", job, text: String(r.text).trim(), tool_calls: [] } };
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
  const history = turns.slice(-7, -1).map((m) => `${m.role === "user" ? "المستخدم" : "شام"}: ${String(m.content).trim().slice(0, 300)}`);
  const parts: string[] = [];
  if (tool) parts.push(`المصادر:\n${String(tool.content).trim().slice(0, 1800)}`);
  if (history.length) parts.push(history.join("\n"));
  parts.push(`${tool ? "السؤال" : "المستخدم"}: ${String(last?.content || "").trim().slice(0, 700)}\nشام:`);
  return parts.join("\n\n").slice(0, 3200);
}
