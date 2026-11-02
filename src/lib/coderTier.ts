import { classifyRequest, isPlainQuestion } from "@/lib/modes";
import type { CoderMessage, CoderTool } from "@/lib/openCoderStudio";

// Smart routing by difficulty: when some of Nova's Studios run a FAST model (OPEN_CODER_FAST_STUDIOS, comma list of their addresses), greetings and short plain
// questions go to those; code, agent, planning and every tool step go to the others (the strong model). No fast Studio configured = no change at all.
export type Tier = "fast" | "strong";

export function fastStudioBases(raw: string = process.env.OPEN_CODER_FAST_STUDIOS || ""): Set<string> {
  return new Set(raw.split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean));
}

const FAST_MAX_CHARS = 240;

export function tierFor(messages: CoderMessage[], tools?: CoderTool[], fast: Set<string> = fastStudioBases()): Tier | undefined {
  if (!fast.size) return undefined;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return "strong";                    // a tool step or a continuation of a task stays on the strong model
  const text = String(last.content || "").replace(/^\[[^\]]*\]\s*/, "").trim();
  if (!text || (last.images && last.images.length)) return "strong";
  if ((tools?.length || 0) > 3) return "strong";
  const klass = classifyRequest(text);
  if (klass === "trivial") return "fast";
  if (klass === "chat" && text.length <= FAST_MAX_CHARS && isPlainQuestion(text)) return "fast";
  return "strong";
}

/** Keeps the Studios of the wanted tier; if none of them is available, every Studio stays (a request is never refused because of its tier). */
export function filterByTier<T extends { b: string }>(order: T[], tier: Tier | undefined, fast: Set<string> = fastStudioBases()): T[] {
  if (!tier || !fast.size) return order;
  const wanted = order.filter((x) => fast.has(x.b) === (tier === "fast"));
  return wanted.length ? wanted : order;
}
