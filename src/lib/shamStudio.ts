// Calls Sham, the owner's own model hosted on a ModelScope Studio (ai-system/modelscope-sham/app.py), with the Gradio call protocol:
// POST {base}/gradio_api/call/v2/<api> -> {event_id}; GET {base}/gradio_api/call/<api>/<event_id> streams `data:` lines holding a list.
// The Studio is private: every call carries the account token (env MODELSCOPE_API_TOKEN, never logged). No token -> null.

const DEFAULT_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";

export function shamStudioEnabled(): boolean {
  return Boolean((process.env.MODELSCOPE_API_TOKEN || "").trim());
}

export function parseShamSse(body: string): string | null {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim());
      if (Array.isArray(data) && data.length) return data[0] == null ? null : String(data[0]).trim();
    } catch {
      /* not a data line we understand: keep reading */
    }
  }
  return null;
}

export async function shamGenerate(prompt: string, maxNewTokens = 60, timeoutMs = 25000): Promise<string | null> {
  if (!shamStudioEnabled()) return null;
  const base = (process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/generate_text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, max_new_tokens: maxNewTokens }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!sub.ok) return null;
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return null;
    const res = await fetch(`${base}/gradio_api/call/generate_text/${event_id}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return parseShamSse(await res.text());
  } catch {
    return null;
  }
}
