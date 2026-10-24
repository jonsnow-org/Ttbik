// Nova Pro: a second, stronger model reached through an OpenAI-compatible API (ModelScope API-Inference by default, free tier).
// It is chosen by hand (the owner's model picker) — there is no automatic fallback between models. The answer is returned in the same
// shape as the Studio's finished job, so the agent loop treats it like any other reply. Env (names only, never printed):
//   NOVA_PRO_MODEL (required, e.g. "Qwen/Qwen3.5-397B-A17B"), NOVA_PRO_API_KEY (falls back to MODELSCOPE_API_TOKEN),
//   NOVA_PRO_API_URL (default https://api-inference.modelscope.cn/v1).
import type { CoderMessage, CoderOutcome, CoderReply, CoderTool } from "@/lib/openCoderStudio";

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
