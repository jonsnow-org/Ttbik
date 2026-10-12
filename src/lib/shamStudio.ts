// Calls Sham, the owner's own model hosted on a ModelScope Studio (ai-system/modelscope-sham/app.py), with the Gradio call protocol: (a chat here is answered by the model itself)
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

// ---- pictures and sounds from the model's own tokens (sham_studio_media.py on the Studio). The Studio answers with JSON in the first data entry:
// {"type": "text" | "image" | "audio" | "notice", "text"?, "mime"?, "b64"?}. generate_any: the MODEL decides what its answer is; generate_media: the user chose
// the kind with a command. Nothing here decides for the model or edits what comes back.
export type ShamReply = { type: "text" | "image" | "audio" | "notice"; text?: string; mime?: string; b64?: string };

export function parseShamReply(body: string): ShamReply | null {
  const raw = parseShamSse(body);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.type === "string") return obj as ShamReply;
  } catch {
    /* not JSON: the Studio is still on the older text-only app */
  }
  return null;
}

async function shamCall(api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
  if (!shamStudioEnabled()) return null;
  const base = (process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!sub.ok) return null;
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return null;
    const res = await fetch(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function shamGenerateAny(prompt: string, maxNewTokens = 80, timeoutMs = 50000): Promise<ShamReply | null> {
  const body = await shamCall("generate_any", { prompt, max_new_tokens: maxNewTokens }, timeoutMs);
  return body ? parseShamReply(body) : null;
}

export async function shamGenerateMedia(kind: "image" | "audio" | "video", prompt: string, timeoutMs = 55000): Promise<ShamReply | null> {
  const body = await shamCall("generate_media", { kind, prompt }, timeoutMs);
  return body ? parseShamReply(body) : null;
}
