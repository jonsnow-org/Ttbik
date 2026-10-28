// Nova's media Studio (ai-system/modelscope-media): a picture, Arabic speech or a real text-to-video clip (never stitched stills) made on a free CPU Studio.
//   POST {base}/gradio_api/call/v2/<api> {body: "<json>"} -> {event_id};  GET {base}/gradio_api/call/<api>/<event_id> -> `data: ["<json>"]`
// Env: NOVA_MEDIA_STUDIO_URL (off without it), OPEN_CODER_STUDIO_TOKEN or MODELSCOPE_API_TOKEN (private Studio).
import { pressureOn, pressureMedia } from "@/lib/pressureMode";
import { vetMedia } from "@/lib/mediaQuality";
export type MediaReply = { type: string; b64?: string; text?: string; reason?: string };

/** Nova's own media Studio. The env var overrides it ("off" switches media off); without it the known Studio is used, so a runtime that lacks the variable (2026-10-28 15:33: Nova said
 *  "the media Studio is not connected in this session" to the owner) still works. Tests have no default (they never reach the network by accident). */
export const DEFAULT_NOVA_MEDIA_URL = "https://studio-novaai2026-nova-media-server.api-inference.modelscope.net";
export function novaMediaUrl(): string {
  const v = (process.env.NOVA_MEDIA_STUDIO_URL || "").trim().replace(/\/+$/, "");
  if (/^(off|none|0)$/i.test(v)) return "";
  return v || (process.env.NODE_ENV === "test" ? "" : DEFAULT_NOVA_MEDIA_URL);
}
export const novaMediaEnabled = (): boolean => Boolean(novaMediaUrl());

/** The Studio's one SSE answer: `data: ["<json string>"]` → the parsed object (null when unreadable). */
export function parseMediaSse(body: string): MediaReply | null {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const arr = JSON.parse(line.slice(5).trim());
      const inner = Array.isArray(arr) ? arr[0] : arr;
      const obj = typeof inner === "string" ? JSON.parse(inner) : inner;
      if (obj && typeof obj === "object" && typeof obj.type === "string") return obj as MediaReply;
    } catch {
      /* keep looking: an event line that is not the data */
    }
  }
  return null;
}

/** kind image | audio | video. A video is ONE prompt (+ seconds) given to the Studio's text-to-video model; `scenes` / `narration` are accepted for old callers but never become stills.
 *  Every picture / sound / clip that comes back is vetted (src/lib/mediaQuality.ts): a blank or empty result is returned as a typed error, never as media. */
export async function novaMakeMedia(
  kind: "image" | "audio" | "video",
  prompt: string,
  opts: { scenes?: unknown; narration?: unknown; timeoutMs?: number; fetchImpl?: typeof fetch; attempts?: number; onWait?: (attempt: number) => void } = {},
): Promise<MediaReply | null> {
  // a picture the gate refuses (black / constant / noise) is retried with a different seed on the same Studio before an honest error is returned
  const attempts = Math.max(1, Math.min(3, opts.attempts ?? (kind === "image" ? 3 : 1)));
  let last: MediaReply | null = null;
  const deadline = Date.now() + (opts.timeoutMs ?? 240000);
  for (let seed = 0; seed < attempts; seed++) {
    last = await novaMakeMediaOnce(kind, prompt, opts, seed);
    // the Studio does ONE job at a time and answers {"type":"busy"} (or "loading" while it starts): the request waits in line and asks again instead of failing
    for (let q = 1; last && (last.type === "busy" || last.type === "loading") && Date.now() + 20000 < deadline && q <= 40; q++) {
      opts.onWait?.(q);
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 4000 + Math.floor(Math.random() * 3000)));
      last = await novaMakeMediaOnce(kind, prompt, { ...opts, timeoutMs: Math.max(30000, deadline - Date.now()) }, seed);
    }
    if (last && (last.type === "busy" || last.type === "loading")) return { type: "error", reason: "busy", text: kind === "image" ? "استوديو الوسائط مشغول بطلبات أخرى ولم يتفرّغ في الوقت المتاح" : "استوديو الوسائط مشغول بطلبات أخرى ولم يتفرّغ في الوقت المتاح" };
    if (!last || last.type !== "error" || !/^(blank_image|noise_image)$/.test(String(last.reason || ""))) return last;
  }
  return last;
}

async function novaMakeMediaOnce(
  kind: "image" | "audio" | "video",
  prompt: string,
  opts: { scenes?: unknown; narration?: unknown; timeoutMs?: number; fetchImpl?: typeof fetch },
  seed = 0,
): Promise<MediaReply | null> {
  const base = novaMediaUrl();
  if (!base) return null;
  const f = opts.fetchImpl || fetch;
  const api = kind === "image" ? "image" : kind === "audio" ? "speech" : "video";
  const scenes = Array.isArray(opts.scenes) ? opts.scenes.map((x) => String(x).slice(0, 300)).filter(Boolean).slice(0, 6) : [];
  const payload =
    kind === "image" ? { prompt: prompt.slice(0, 400), seed, ...(pressureOn() ? { size: pressureMedia().imageSize } : {}) } : kind === "audio" ? { text: prompt.slice(0, 1500) } : { prompt: (prompt.trim() || scenes[0] || "").slice(0, 800), seconds: pressureMedia().videoSeconds, seed };   // modelscope-media/app.py api_video reads "prompt"
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = (process.env.OPEN_CODER_STUDIO_TOKEN || process.env.MODELSCOPE_API_TOKEN || "").trim();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const timeoutMs = opts.timeoutMs ?? 240000;
  const deadline = Date.now() + timeoutMs;
  try {
    const sub = await f(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify({ body: JSON.stringify(payload) }), signal: AbortSignal.timeout(Math.min(timeoutMs, 30000)) });
    if (!sub.ok) return { type: "error", text: `the media Studio answered HTTP ${sub.status}` };
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return { type: "error", text: "the media Studio gave no event id" };
    const res = await f(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (!res.ok) return { type: "error", text: `the media Studio answered HTTP ${res.status}` };
    const parsed = parseMediaSse(await res.text());
    return ((await vetMedia(parsed)) as MediaReply | null) || { type: "error", text: "the media Studio's answer was unreadable" };
  } catch (e) {
    const n = (e as { name?: string })?.name || "";
    return { type: "error", text: n === "TimeoutError" || n === "AbortError" ? "the media Studio did not finish in time" : "the media Studio could not be reached" };
  }
}
