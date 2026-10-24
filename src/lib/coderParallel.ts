// Parallel report writing. A long answer is generation-bound (~6 tokens/s per Studio), and one Studio writes one answer at a time. When a research
// request has its sources and there are several Studios, the report is split into sections: each section is written by a different Studio from the
// same sources at the same time, and the harness joins them. Steps of one task that depend on each other stay sequential (they cannot be split);
// this is the part that can: independent sections. CODER_PARALLEL_REPORT=off switches it off. Needs >= 2 Studios and >= 2 usable sections,
// otherwise the caller writes the report the ordinary way.
import type { CoderMessage } from "@/lib/openCoderStudio";

export type Writer = (messages: CoderMessage[], index: number) => Promise<string>;
export const SECTIONS_MAX = 4;
export const SOURCES_CHARS = 4500;        // each Studio reads the sources again (~40 prompt tokens/s): kept short so the parallel part stays fast

export const parallelEnabled = (studios: number): boolean => (process.env.CODER_PARALLEL_REPORT || "").toLowerCase() !== "off" && studios >= 2;

/** The section topics: the focused queries drafted for the research (distinct, at most SECTIONS_MAX). */
export function reportTopics(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const t = q.replace(/\s+/g, " ").trim();
    const k = t.toLowerCase();
    if (t.length < 4 || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= SECTIONS_MAX) break;
  }
  return out;
}

export function sectionPrompt(request: string, topic: string, sources: string, lang: "ar" | "en"): CoderMessage[] {
  const L = lang === "ar" ? "Arabic" : "English";
  return [
    { role: "system", content: `You write ONE section of a research report, in ${L} (code, names and terms stay in English). Use ONLY the SOURCES below. 120 to 170 words. Start with a title line "## <short title in ${L}>". Cite source numbers like [3] when the sources show them. Name only projects, files or facts that appear in the SOURCES; if the sources say nothing about this section's focus, write one honest sentence saying so. No preamble, no conclusion.` },
    { role: "user", content: `Request: ${request.slice(0, 500)}\n\nSection focus: ${topic}\n\nSOURCES:\n${sources.slice(0, SOURCES_CHARS)}` },
  ];
}

export function composeReport(parts: { topic: string; text: string }[]): string {
  // exactly what the user reads: the sections, nothing about how they were written
  return parts.map((p) => (/^\s*#{1,3}\s/.test(p.text) ? p.text.trim() : `## ${p.topic}\n${p.text.trim()}`)).join("\n\n");
}

/** The sections, written in parallel. null when fewer than two came back usable (the caller then writes it the ordinary way). */
export async function parallelReport(o: { request: string; queries: string[]; sources: string; lang: "ar" | "en"; write: Writer }): Promise<{ text: string; sections: number } | null> {
  const topics = reportTopics(o.queries);
  if (topics.length < 2) return null;
  const done = await Promise.all(topics.map((t, i) => o.write(sectionPrompt(o.request, t, o.sources, o.lang), i).then((text) => ({ topic: t, text: (text || "").trim() })).catch(() => ({ topic: t, text: "" }))));
  const ok = done.filter((d) => d.text.length >= 80);
  if (ok.length < 2) return null;
  return { text: composeReport(ok), sections: ok.length };
}

/** A Writer on our Studios: one bounded completion per section, polled until done or the deadline; each section its own affinity so they spread over the Studios. */
export function studioWriter(affinityBase: string, deadlineMs = 170000): Writer {
  return async (messages, index) => {
    const { coderChat, coderJobResult } = await import("@/lib/openCoderStudio");
    const t0 = Date.now();
    const o = await coderChat(messages, { think: false, temperature: 0.3, maxTokens: 480, waitS: 15, timeoutMs: 25000, affinity: `${affinityBase}:${index}` });
    let r = o.reply;
    while (r && r.type === "pending" && r.job && Date.now() - t0 < deadlineMs) r = (await coderJobResult(r.job, 0, 10000)).reply || r;
    return r && r.type === "done" ? r.text || "" : "";
  };
}
