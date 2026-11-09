// The CENTRAL KNOWLEDGE BANK (ai-system/colab/sham_small/sham_bank.py): everything the crawlers and notebooks collected, compressed and indexed, held by the Sham v1 Studio and asked
// through its read-only `bank_search` call. One bank for Sham, Sham v2 and Nova: it is shared knowledge with sources, not a user's private memory (that is Palmyra Memory
// and the per-user library in shamKnowledge.ts). Best effort: any problem (no token, Studio busy, bank not loaded yet) returns null and the caller carries on without it.
import { DEFAULT_URL } from "@/lib/shamStudio";

export type BankHit = { text: string; source: string; score: number; approx?: boolean };

/** The Studio that holds the bank: the v1 Studio, whichever Sham asks (SHAM_BANK_URL overrides). */
export function bankBase(): string {
  const raw = (process.env.SHAM_BANK_URL || process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
  return raw.find((x) => !/sham-v2|nova-inference|coder-inference/i.test(x)) || DEFAULT_URL;
}

export function bankEnabled(): boolean {
  return Boolean((process.env.MODELSCOPE_API_TOKEN || "").trim()) && process.env.SHAM_BANK_OFF !== "1";
}

export async function bankSearch(query: string, count = 4, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<BankHit[] | null> {
  if (!bankEnabled() || !String(query || "").trim()) return null;
  const f = opts.fetchImpl || fetch;
  const base = bankBase();
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  const deadline = Date.now() + (opts.timeoutMs || 9000);
  try {
    const sub = await f(`${base}/gradio_api/call/v2/bank_search`, { method: "POST", headers, body: JSON.stringify({ data: [String(query).slice(0, 600), Math.max(1, Math.min(8, count))] }), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!sub.ok) return null;
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return null;
    const res = await f(`${base}/gradio_api/call/bank_search/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const arr = JSON.parse(line.slice(5).trim());
      const parsed = typeof arr?.[0] === "string" ? JSON.parse(arr[0]) : arr?.[0];
      if (parsed?.ok && Array.isArray(parsed.results)) return (parsed.results as BankHit[]).filter((h) => h && typeof h.text === "string").slice(0, count);
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The bank's passages as text for the model, each with its source; near-word matches (found by the small encoder, no shared words) are marked so the model weighs them lower. */
export function formatBank(hits: BankHit[] | null): string {
  if (!hits || !hits.length) return "";
  return hits.map((h, i) => `[B${i + 1}] (${h.source || "bank"}${h.approx ? " · approximate match" : ""})\n${h.text}`).join("\n\n");
}

/** The shared bank as one section, or "" when it has nothing / is unreachable. */
export async function bankSection(query: string, count = 4, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<string> {
  return formatBank(await bankSearch(query, count, opts));
}
