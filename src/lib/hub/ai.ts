// One text generator for the creator hub: Sham (owner's model on ModelScope) first, then the site's existing free Groq chain, then null
// (each tool has a rule-based fallback, so a hub tool never shows a raw error). Inputs are clipped; system prompts carry the guardrails.
import { shamGenerate, shamStudioEnabled } from "@/lib/shamStudio";
import { callGroq } from "@/lib/groq";

export type HubAiResult = { text: string; engine: "sham" | "groq" } | null;

export async function hubGenerate(system: string, input: string, maxTokens = 500, prefer: "sham" | "groq" = "sham"): Promise<HubAiResult> {
  const user = (input || "").slice(0, 4000);
  const trySham = async (): Promise<HubAiResult> => {
    if (!shamStudioEnabled()) return null;
    const out = await shamGenerate(`${system}\n\n${user}\n\nالجواب:`, Math.min(maxTokens, 300), 25000);
    return out && out.trim().length >= 12 ? { text: out.trim(), engine: "sham" } : null;
  };
  const tryGroq = async (): Promise<HubAiResult> => {
    if (!process.env.GROQ_API_KEY) return null;
    try {
      const out = await callGroq(system, user, maxTokens);
      return out ? { text: out.trim(), engine: "groq" } : null;
    } catch {
      return null;
    }
  };
  const order = prefer === "sham" ? [trySham, tryGroq] : [tryGroq, trySham];
  for (const f of order) {
    const r = await f();
    if (r) return r;
  }
  return null;
}
