import { AsyncLocalStorage } from "node:async_hooks";
import type { ShamTool } from "@/lib/shamTypes";
import { pressureMedia } from "@/lib/pressureMode";
import { shamKnobs, type ShamMode } from "@/lib/shamModes";
import { stripThinkTags } from "@/lib/thinkTags";
import { ARABIC_ONLY_NOTE, isPersianLeak } from "@/lib/scriptGuard";
import { vetMedia } from "@/lib/mediaQuality";
import { orderV2, tracked } from "@/lib/shamPool";
// Calls Sham, the owner's own model hosted on a ModelScope Studio (ai-system/modelscope-sham/app.py), with the Gradio call protocol: (a chat here is answered by the model itself)
// POST {base}/gradio_api/call/v2/<api> -> {event_id}; GET {base}/gradio_api/call/<api>/<event_id> streams `data:` lines holding a list.
// The Studio is private: every call carries the account token (env MODELSCOPE_API_TOKEN, never logged). No token -> null.

export const DEFAULT_URL = "https://studio-novaai2026-sham-v1-server.api-inference.modelscope.net";
export const DEFAULT_V2_URL = "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net";

/** Which Sham a call goes to: "v1" = the current Sham Studio, "v2" = the new body's Studio. Set around a call with shamVariant.run("v2", fn) (the engine does it for the sham_v2 model). */
export const shamVariant = new AsyncLocalStorage<"v1" | "v2">();

/** The chat's thinking / accuracy / speed settings for the calls made inside it (set by the bot route around Sham's own handler). */
export const shamModeCtx = new AsyncLocalStorage<ShamMode>();

/** Applies the settings to one call: the answer budget scales with accuracy, and the sampling / thought header goes at the start of the prompt (src/lib/shamModes.ts). */
function withMode(payload: Record<string, unknown>, variant: "v1" | "v2"): Record<string, unknown> {
  const mode = shamModeCtx.getStore();
  if (!mode) return payload;
  const k = shamKnobs(mode, variant);
  const out = { ...payload };
  if (typeof out.max_new_tokens === "number") out.max_new_tokens = Math.max(20, Math.round(out.max_new_tokens * k.maxNewFactor));
  if (typeof out.prompt === "string" && k.header) out.prompt = k.header + out.prompt;
  return out;
}

let rotate = 0;
/** The Studio addresses for this call, best first. Each variant may name several Studios (comma-separated SHAM_MODELSCOPE_URL / SHAM_V2_URL): calls start at a rotating
 *  one, so users spread over the Studios, and a busy or unreachable one is skipped for the next (see shamBusyHop). */
export function shamBases(): string[] {
  const selectedVariant = shamVariant.getStore();
  // A missing async-local selection is not a request for the legacy model. Returning no route prevents silent v2 -> v1 fallback.
  if (selectedVariant !== "v1" && selectedVariant !== "v2") return [];
  const v2 = selectedVariant === "v2";
  const configured = (v2 ? process.env.SHAM_V2_URL || DEFAULT_V2_URL : process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
  // Primary lists may contain only their assigned model endpoints. The v2 overflow is added separately by orderV2 only after verifying its served checkpoint.
  // Old Nova inference URLs, Nova coder URLs, the other Sham variant and the v2 overflow role are never treated as primary endpoints.
  const raw = configured.filter((x) => !/nova-inference-server|coder-inference|sham-v2-overflow/i.test(x) && !(v2 ? /sham-v1/i : /sham-v2/i).test(x));
  const bases = raw.length ? raw : [v2 ? DEFAULT_V2_URL : DEFAULT_URL];
  const k = rotate++ % Math.max(1, bases.length);
  const rotated = [...bases.slice(k), ...bases.slice(0, k)];
  return v2 ? orderV2(rotated) : rotated;                     // Sham v2 only: the overflow Studio (src/lib/shamPool.ts) takes new calls while the primary is congested
}

export function shamStudioEnabled(): boolean {
  return Boolean((process.env.MODELSCOPE_API_TOKEN || "").trim());
}

export function parseShamSse(body: string): string | null {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim());
      if (Array.isArray(data) && data.length) {
        const first = data[0];
        if (first == null) return null;
        return typeof first === "string" ? first.trim() : JSON.stringify(first);
      }
    } catch {
      /* not a data line we understand: keep reading */
    }
  }
  return null;
}

/**
 * Read a Gradio SSE response as it arrives and return its first complete data value.
 * Do not call Response.text() on the live stream: some Studio streams stay open after
 * the answer is already available, so waiting for EOF can waste the whole request budget.
 */
export async function readShamSse(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return parseShamSse(await response.text());

  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });

      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).replace(/\r$/, "");
        buffered = buffered.slice(newline + 1);
        const parsed = parseShamSse(line + "\n");
        if (parsed !== null) {
          await reader.cancel().catch(() => undefined);
          return parsed;
        }
        newline = buffered.indexOf("\n");
      }

      if (done) {
        return buffered ? parseShamSse(buffered + "\n") : null;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* stream may already be closed */ }
  }
}

export async function shamGenerate(prompt: string, maxNewTokens = 60, timeoutMs = 25000): Promise<string | null> {
  if (!shamStudioEnabled()) return null;
  const base = shamBases()[0];
  if (!base) { setFailure("generate_text: no selected Sham variant; refusing model fallback"); return null; }
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  const deadline = Date.now() + timeoutMs;                      // ONE limit for submit + result together
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/generate_text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, max_new_tokens: maxNewTokens }),
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (!sub.ok) return null;
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id || deadline <= Date.now()) return null;
    const res = await fetch(`${base}/gradio_api/call/generate_text/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!res.ok) return null;
    return await readShamSse(res);
  } catch {
    return null;
  }
}

// ---- pictures and sounds from the model's own tokens (sham_studio_media.py on the Studio). The Studio answers with JSON in the first data entry:
// {"type": "text" | "image" | "audio" | "notice", "text"?, "mime"?, "b64"?}. generate_any: the MODEL decides what its answer is; generate_media: the user chose
// the kind with a command. Nothing here decides for the model or edits what comes back.
export type ShamReply = {
  type: "text" | "tool_calls" | "embedded_step" | "tool_call_error" | "image" | "audio" | "video" | "notice" | "busy" | "loading" | "pending" | "gone" | "error";
  reason?: string; text?: string; mime?: string; b64?: string; route?: string;
  /** Structured assistant function calls returned by Sham v2's own agent_step endpoint. */
  tool_calls?: Array<{ id?: string; type?: "function"; function: { name: string; arguments: string } }>;
  message?: { role?: "assistant"; content?: string; tool_calls?: Array<{ id?: string; type?: "function"; function: { name: string; arguments: string } }> };
  /** An embedded-tool step (the computer or browser of the model itself): the model wrote the call, ran it INSIDE its own loop and returns call + result for the app's loop to record. */
  tool_call?: { id?: string; type?: "function"; function: { name: string; arguments: string } };
  result?: string;
  raw?: string;
  // think (2026-10-14): the model's own decision, a job id while it is still working, and results finished after an earlier request gave up waiting
  decision?: string; job?: string; later?: ShamReply[];
};

export function parseShamReply(body: string): ShamReply | null {
  // Runtime SSE reads return the decoded data payload directly; older callers and tests may
  // still pass a complete SSE body. Accept both formats to keep every route consistent.
  const unwrapped = parseShamSse(body);
  const raw = unwrapped ?? body.trim();
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.type === "string") {
      if (typeof obj.text === "string") obj.text = stripThinkTags(obj.text);     // Sham v2 answers with an empty <think></think>: never shown
      return obj as ShamReply;
    }
  } catch {
    /* not JSON: the Studio is still on the older text-only app */
  }
  return null;
}

/** Every picture / sound / clip a Sham Studio returns passes the quality gate (src/lib/mediaQuality.ts): a blank, noise, silent or empty result becomes a typed
 *  {type:"error", reason, text} instead of media. Replies finished later (`later`) are vetted too. */
export async function vetShamReply(reply: ShamReply | null, opts: { bypassContentHeuristics?: boolean } = {}): Promise<ShamReply | null> {
  if (!reply) return reply;
  const out = (await vetMedia(reply, { bypassContentHeuristics: opts.bypassContentHeuristics })) as ShamReply;
  if (Array.isArray(out.later)) out.later = (await Promise.all(out.later.map((r) => vetShamReply(r, opts)))) as ShamReply[];
  return out;
}

async function shamCallAt(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  const deadline = Date.now() + timeoutMs;                      // submit + result share one limit
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!sub.ok) { note(base, api, `HTTP ${sub.status} on submit`); return null; }
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) { note(base, api, "no event id"); return null; }
    if (deadline <= Date.now()) { note(base, api, "limit used up by the submit"); return null; }
    const res = await fetch(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!res.ok) note(base, api, `HTTP ${res.status} on result`);
    return res.ok ? await readShamSse(res) : null;
  } catch (e) {
    note(base, api, `${(e as { name?: string })?.name || "error"} (limit ${Math.round(timeoutMs / 1000)} s): ${String((e as Error)?.message || "").slice(0, 80)}`);
    return null;
  }
}

/** A Studio that answers "busy" (on another request) or not at all hands the call to the next Studio of the pool at once; with one Studio nothing changes. */
export const shamBusyHop = (reply: ShamReply | null | undefined): boolean => reply?.type === "busy";

async function shamCall(api: string, payload0: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
  if (!shamStudioEnabled()) { setFailure(`${api}: MODELSCOPE_API_TOKEN is empty in this environment`); return null; }
  const variant = shamVariant.getStore();
  if (variant !== "v1" && variant !== "v2") { setFailure(`${api}: no selected Sham variant; refusing model fallback`); return null; }
  // Media prompts are user content, not reasoning prompts: never prepend Sham's text-mode header to them.
  const payload = api === "generate_media_from_panel" ? payload0 : withMode(payload0, variant);
  const bases = shamBases();
  if (!bases.length) { setFailure(`${api}: no dedicated Studio endpoint for the selected variant`); return null; }
  let last: string | null = null;
  const t0 = Date.now();
  for (let i = 0; i < bases.length; i++) {
    const left = timeoutMs - (Date.now() - t0);                 // the pool shares ONE limit: a later Studio only gets what is left (and none if too little)
    if (i > 0 && left < 1500) break;
    const body = await tracked(bases[i], () => shamCallAt(bases[i], api, payload, Math.max(1000, left)), (b) => b === null || shamBusyHop(parseShamReply(b)));
    if (body && !(i < bases.length - 1 && shamBusyHop(parseShamReply(body)))) return body;
    last = body ?? last;
  }
  return last;
}

/** Read a screenshot (or another image) through the selected Sham Studio's own vision stack. */
export async function shamUnderstandImage(b64: string, question = "صف ما يظهر على سطح المكتب، وحدد النافذة النشطة وما يمكن فعله تالياً.", timeoutMs = 90000): Promise<string> {
  const body = await shamCall("understand_media", { kind: "image", b64, question, teach: "", num_frames: 1 }, timeoutMs);
  const reply = body ? await vetShamReply(parseShamReply(body)) : null;
  if (!reply) return "error: selected Sham Studio could not understand the computer screenshot. No other model was used.";
  if (reply.type === "text" && String(reply.text || "").trim()) return String(reply.text).trim();
  if (reply.type === "error" || reply.type === "notice") return `error: ${String(reply.text || reply.reason || "Sham vision did not return an answer").slice(0, 300)}`;
  return "error: selected Sham Studio returned no readable screenshot description.";
}

export async function shamGenerateAny(prompt: string, maxNewTokens = 80, timeoutMs = 50000, opts: { bypassContentHeuristics?: boolean } = {}): Promise<ShamReply | null> {
  const body = await shamCall("generate_any", { prompt, max_new_tokens: maxNewTokens }, timeoutMs);
  let reply = body ? await vetShamReply(parseShamReply(body), opts) : null;
  if (reply?.type === "text" && isPersianLeak(prompt, String(reply.text || ""))) {
    const again = await shamCall("generate_any", { prompt: prompt + ARABIC_ONLY_NOTE, max_new_tokens: maxNewTokens }, timeoutMs);
    const fixed = again ? await vetShamReply(parseShamReply(again), opts) : null;
    if (fixed?.type === "text" && String(fixed.text || "").trim()) reply = fixed;
  }
  if (body && !reply) setFailure(`generate_any: unreadable answer (${body.slice(0, 120).replace(/\s+/g, " ")})`);
  return reply;
}

export type ShamChatMessage = { role: "user" | "assistant"; content: string };

/** Send native conversation turns to Qwen3. This v2-only endpoint adds no system prompt. */
export async function shamGenerateChat(messages: ShamChatMessage[], maxNewTokens = 768, timeoutMs = 90000, opts: { bypassContentHeuristics?: boolean } = {}): Promise<ShamReply | null> {
  if (shamVariant.getStore() !== "v2") {
    setFailure("generate_chat refused outside the Sham v2 variant");
    return null;
  }
  const valid = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  if (!valid.length || valid[valid.length - 1].role !== "user") {
    setFailure("generate_chat requires a final user turn");
    return null;
  }
  const knobs = shamKnobs(shamModeCtx.getStore(), "v2");
  const body = await shamCall("generate_chat", {
    messages_json: JSON.stringify(valid.slice(-12)),
    max_new_tokens: maxNewTokens,
    temperature: knobs.temperature,
    think_tokens: knobs.thinkTokens,
  }, timeoutMs);
  let reply = body ? await vetShamReply(parseShamReply(body), opts) : null;
  const lastUser = valid[valid.length - 1].content;
  if (reply?.type === "text" && isPersianLeak(lastUser, String(reply.text || ""))) {
    const retryTurns = [...valid.slice(-12, -1), { role: "user" as const, content: lastUser + ARABIC_ONLY_NOTE }];
    const again = await shamCall("generate_chat", { messages_json: JSON.stringify(retryTurns), max_new_tokens: maxNewTokens, temperature: knobs.temperature, think_tokens: knobs.thinkTokens }, timeoutMs);
    const fixed = again ? await vetShamReply(parseShamReply(again), opts) : null;
    if (fixed?.type === "text" && String(fixed.text || "").trim()) reply = fixed;
  }
  if (body && !reply) setFailure(`generate_chat: unreadable answer (${body.slice(0, 120).replace(/\s+/g, " ")})`);
  return reply;
}

/**
 * Read a Gradio SSE response and hand each streamed piece to `onDelta` as it arrives: a generator endpoint
 * (generate_chat_stream) yields one data line per piece, so the caller can append deltas and grow the answer in place.
 * A non-generator endpoint sends a single data line, so this also reads an older Studio and never loses the answer.
 */
export async function readShamSseDeltas(response: Response, onDelta: (piece: string) => void): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const whole = parseShamSse(await response.text());
    if (whole) onDelta(whole);
    return whole || "";
  }
  const decoder = new TextDecoder();
  let buffered = "";
  let full = "";
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    let data: unknown;
    try { data = JSON.parse(line.slice(5).trim()); } catch { return; }
    if (!Array.isArray(data) || !data.length) return;
    // The piece is kept verbatim (never trimmed): a leading/trailing space is part of the answer, and trimming
    // each delta would join two words together.
    const piece = typeof data[0] === "string" ? data[0] : JSON.stringify(data[0]);
    full += piece;
    onDelta(piece);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        consume(buffered.slice(0, newline).replace(/\r$/, ""));
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
      if (done) break;
    }
    if (buffered) consume(buffered);
  } finally {
    try { reader.releaseLock(); } catch { /* already closed */ }
  }
  return full;
}

/** A typed Studio reply ({type:"busy"|"error"|...}) is not streamed text: it is one JSON object, never a written answer. */
function looksTypedReply(piece: string): boolean {
  const t = piece.trim();
  if (!t.startsWith("{")) return false;
  try {
    const o = JSON.parse(t) as { type?: unknown };
    return Boolean(o && typeof o === "object" && typeof o.type === "string");
  } catch {
    return false;
  }
}

/**
 * Token-by-token native chat (Sham v2): each decoded piece is handed to `onDelta` as the Studio writes it, and the
 * full answer is returned. A typed reply (busy / error / a Studio without the streaming endpoint) is never streamed as
 * text — it is returned as-is, so the caller's normal handling applies.
 */
export async function shamGenerateChatStream(
  messages: ShamChatMessage[],
  maxNewTokens = 768,
  timeoutMs = 90000,
  onDelta?: (piece: string) => void,
  opts: { bypassContentHeuristics?: boolean } = {},
): Promise<ShamReply | null> {
  if (shamVariant.getStore() !== "v2") {
    setFailure("generate_chat_stream refused outside the Sham v2 variant");
    return null;
  }
  const valid = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  if (!valid.length || valid[valid.length - 1].role !== "user") {
    setFailure("generate_chat_stream requires a final user turn");
    return null;
  }
  if (!shamStudioEnabled()) { setFailure("generate_chat_stream: MODELSCOPE_API_TOKEN is empty in this environment"); return null; }
  const base = shamBases()[0];
  if (!base) { setFailure("generate_chat_stream: no dedicated Studio endpoint for the selected variant"); return null; }
  const knobs = shamKnobs(shamModeCtx.getStore(), "v2");
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  const payload = { messages_json: JSON.stringify(valid.slice(-12)), max_new_tokens: maxNewTokens, temperature: knobs.temperature, think_tokens: knobs.thinkTokens };
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  const emit = (piece: string) => {
    seen++;
    if (seen === 1 && looksTypedReply(piece)) return;      // a busy / error reply, not a written answer
    if (piece) onDelta?.(piece);
  };
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/generate_chat_stream`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (sub.status === 404 || sub.status === 405) {
      // An older Studio has no streaming endpoint: answer with the one-shot chat and hand it over as a single piece.
      const one = await shamGenerateChat(valid, maxNewTokens, timeoutMs, opts);
      if (one?.type === "text" && one.text && onDelta) onDelta(String(one.text));
      return one;
    }
    if (!sub.ok) { setFailure(`generate_chat_stream: HTTP ${sub.status} on submit`); return null; }
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) { setFailure("generate_chat_stream: no event id"); return null; }
    const res = await fetch(`${base}/gradio_api/call/generate_chat_stream/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!res.ok) { setFailure(`generate_chat_stream: HTTP ${res.status} on result`); return null; }
    const full = await readShamSseDeltas(res, emit);
    if (!full.trim()) { setFailure("generate_chat_stream: empty answer"); return null; }
    const reply = await vetShamReply(parseShamReply(full) ?? ({ type: "text", text: full.trim() } as ShamReply), opts);
    if (!reply) setFailure(`generate_chat_stream: unreadable answer (${full.slice(0, 120).replace(/\s+/g, " ")})`);
    return reply;
  } catch (e) {
    setFailure(`generate_chat_stream: ${(e as { name?: string })?.name || "error"}: ${String((e as Error)?.message || "").slice(0, 80)}`);
    return null;
  }
}

/** Ask Sham v2's dedicated Studio for one structured agent step. The Studio turns the model's
 * constrained call into a typed {type:"tool_calls", tool_calls:[...]} response; the app executor
 * still validates every argument and permission. This never routes to Sham v1 or Nova. */
export async function shamGenerateAgentStep(prompt: string, tools: ShamTool[], maxNewTokens = 160, timeoutMs = 90000, session = ""): Promise<ShamReply | null> {
  if (shamVariant.getStore() !== "v2") {
    setFailure("agent_step refused outside the Sham v2 variant");
    return null;
  }
  const body = await shamCall("agent_step", { prompt, tools_json: JSON.stringify(tools), max_new_tokens: maxNewTokens, session }, timeoutMs);
  const reply = body ? parseShamReply(body) : null;
  if (reply?.type === "tool_calls") {
    const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls : reply.message?.tool_calls;
    if (!calls?.length || calls.some((c) => !c || c.type !== "function" || !c.function?.name || typeof c.function.arguments !== "string")) {
      setFailure("agent_step: malformed structured tool_calls envelope");
      return { type: "tool_call_error", text: "استجابة استدعاء الأدوات المنظّمة غير صالحة؛ لم تُنفّذ أي أداة." };
    }
    return { ...reply, tool_calls: calls };
  }
  if (reply?.type === "embedded_step") {
    if (!reply.tool_call?.function?.name || typeof reply.tool_call.function.arguments !== "string") {
      setFailure("agent_step: malformed embedded_step envelope");
      return { type: "tool_call_error", text: "استجابة خطوة الحاسوب المدمج غير صالحة." };
    }
    return reply;
  }
  if (reply?.type === "tool_call_error" || reply?.type === "text" || reply?.type === "busy" || reply?.type === "loading" || reply?.type === "notice" || reply?.type === "error") return reply;
  if (body) setFailure(`agent_step: unreadable answer (${body.slice(0, 120).replace(/\s+/g, " ")})`);
  return null;
}

/** The two media paths a Sham Studio really has, by the exact label its panel API validates (ai-system/modelscope-sham/app.py PANEL_BACKENDS). */
export const SHAM_BACKEND_LABELS = { internal: "شام الداخلي (الأساسي)" } as const;
export type ShamMediaBackend = keyof typeof SHAM_BACKEND_LABELS;

/**
 * Media on ONE explicit path, never a silent switch: "internal" = the model's own tokens + decoder (still training: usually refused by the quality gate), "ready" = the CPU
 * SDXS-512 image / Piper speech / video-model path. Both go through the Studio's `generate_media_from_panel` (the old `generate_media` endpoint is not registered on the Studio,
 * which made every internal call fail with HTTP 500). The Hugging Face route is gone (the owner's rule: no external providers).
 */
export async function shamGenerateMedia(
  kind: "image" | "audio" | "video",
  prompt: string,
  timeoutMs = 180000,
  backend: ShamMediaBackend = "internal",
  opts: { scenes?: unknown; narration?: unknown; bypassQuality?: boolean; seconds?: number } = {},
): Promise<ShamReply | null> {
  const api = "generate_media_from_panel";
  if (!(backend in SHAM_BACKEND_LABELS)) return { type: "error", reason: "unknown_route", text: `مسار الوسائط «${String(backend)}» غير مدعوم.` };
  const scenes = Array.isArray(opts.scenes)
    ? opts.scenes.map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 6)
    : [];
  const payload = { kind, prompt, backend_label: SHAM_BACKEND_LABELS[backend], scenes_json: JSON.stringify(scenes), narration: String(opts.narration || "").slice(0, 1500), raw_test: Boolean(opts.bypassQuality), seconds: kind === "video" ? Math.max(0, Math.min(300, Number(opts.seconds) || 0)) : 0 };
  const body = await shamCall(api, payload, timeoutMs);
  const reply = body ? await vetShamReply(parseShamReply(body), { bypassContentHeuristics: opts.bypassQuality }) : null;
  if (body && !reply) setFailure(api + ": unreadable answer (" + body.slice(0, 120).replace(/\s+/g, " ") + ")");
  return reply;
}

// chat_auto (app.py): one entry for a plain message — the Studio's sham_intent routes the clear cases (media request, live search) and the rest goes to
// generate_any. Same JSON as generate_any plus "route". An older Studio without chat_auto answers null, and the caller falls back to generate_any.
export async function shamChatAuto(prompt: string, maxNewTokens = 80, timeoutMs = 55000, opts: { bypassContentHeuristics?: boolean } = {}): Promise<ShamReply | null> {
  const body = await shamCall("chat_auto", { prompt, max_new_tokens: maxNewTokens }, timeoutMs);
  return body ? vetShamReply(parseShamReply(body), opts) : null;
}

// chat_memory (app.py, 2026-10-14): chat_auto WITH memory — the chat's recent turns, rolling summary and facts from the database
// (src/lib/shamMemory.ts) plus the Studio's own per-user memory (sham_memory.py). An older Studio without chat_memory answers null, and the
// caller falls back to chat_auto. memory_forget deletes the Studio-side memory of one user.
export async function shamChatMemory(
  prompt: string,
  mem: { userId: string; history: { q: string; a: string }[]; summary: string; facts: Record<string, string> },
  maxNewTokens = 80,
  timeoutMs = 48000,
  opts: { bypassContentHeuristics?: boolean } = {},
): Promise<ShamReply | null> {
  const body = await shamCall(
    "chat_memory",
    { prompt, max_new_tokens: maxNewTokens, user_id: mem.userId, history: JSON.stringify(mem.history), summary: mem.summary, facts: JSON.stringify(mem.facts) },
    timeoutMs,
  );
  return body ? vetShamReply(parseShamReply(body), opts) : null;
}

export async function shamMemoryForget(userId: string, timeoutMs = 15000): Promise<boolean> {
  const body = await shamCall("memory_forget", { user_id: userId }, timeoutMs);
  return Boolean(body);
}

// ---- think (2026-10-14): ONE step where the model decides (reply / its own search / picture / sound / clip). No keyword rules on this path.
// Each call has its own short timeout; the outcome says WHY when there is no answer, so the bot can tell the user the truth.
export type ShamOutcome = { reply: ShamReply | null; failure?: "off" | "timeout" | "http" | "network" | "unreadable" };

/** Failure diagnostics are model-local so concurrent Sham v1/v2 calls cannot overwrite each other's error. */
const lastFailureByVariant = new Map<"v1" | "v2", string>();
const failureVariant = (): "v1" | "v2" => shamVariant.getStore() || "v1";
const getFailure = (): string => lastFailureByVariant.get(failureVariant()) || "";
const setFailure = (why: string): void => { lastFailureByVariant.set(failureVariant(), why); };
export const shamLastFailure = (): string => getFailure();
export const shamNoteFailure = (why: string): void => { setFailure(why); };
const note = (base: string, api: string, why: string) => { setFailure(api + " @ " + base.replace(/^https?:\/\/(studio-novaai2026-)?/, "").slice(0, 40) + ": " + why); };

async function shamCallOnceAt(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number, bypassContentHeuristics = false): Promise<ShamOutcome> {
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  const deadline = Date.now() + timeoutMs;
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!sub.ok) { note(base, api, `HTTP ${sub.status} on submit`); return { reply: null, failure: "http" }; }
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) { note(base, api, "no event id"); return { reply: null, failure: "http" }; }
    const res = await fetch(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (!res.ok) { note(base, api, `HTTP ${res.status} on result`); return { reply: null, failure: "http" }; }
    const rawReply = await readShamSse(res);
    const reply = await vetShamReply(rawReply === null ? null : parseShamReply(rawReply), { bypassContentHeuristics });
    if (!reply) note(base, api, "unreadable answer");
    return reply ? { reply } : { reply: null, failure: "unreadable" };
  } catch (e) {
    const name = (e as { name?: string })?.name || "";
    note(base, api, `${name || "error"} after ${Math.round((timeoutMs) / 1000)} s limit: ${String((e as Error)?.message || "").slice(0, 80)}`);
    return { reply: null, failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

async function shamCallOnce(api: string, payload0: Record<string, unknown>, timeoutMs: number, bypassContentHeuristics = false): Promise<ShamOutcome> {
  if (!shamStudioEnabled()) { setFailure(`${api}: MODELSCOPE_API_TOKEN is empty in this environment`); return { reply: null, failure: "off" }; }
  const variant = shamVariant.getStore();
  if (variant !== "v1" && variant !== "v2") {
    setFailure(`${api}: no selected Sham variant; refusing model fallback`);
    return { reply: null, failure: "off" };
  }
  const payload = withMode(payload0, variant);
  const bases = shamBases();
  if (!bases.length) {
    setFailure(`${api}: no dedicated Studio endpoint for the selected variant`);
    return { reply: null, failure: "off" };
  }
  const t0 = Date.now();
  let out: ShamOutcome = { reply: null, failure: "network" };
  for (let i = 0; i < bases.length; i++) {
    out = await tracked(bases[i], () => shamCallOnceAt(bases[i], api, payload, Math.max(3000, timeoutMs - (Date.now() - t0)), bypassContentHeuristics), (o) => o.failure === "network" || o.failure === "http" || shamBusyHop(o.reply));
    const hop = shamBusyHop(out.reply) || out.failure === "network" || out.failure === "http";        // busy, down or refusing: the next Studio (a timeout is not repeated: it may be working on it)
    if (!hop || i === bases.length - 1 || Date.now() - t0 > timeoutMs - 4000) return out;
  }
  return out;
}

export function shamThink(
  prompt: string,
  userId: string,
  mem?: { history: { q: string; a: string }[]; summary: string; facts: Record<string, string> } | null,
  maxNewTokens = 80,
  timeoutMs = 28000,
  bypassContentHeuristics = false,
): Promise<ShamOutcome> {
  return shamCallOutcome(
    "think",
    { prompt, max_new_tokens: maxNewTokens, user_id: userId, history: mem ? JSON.stringify(mem.history) : "", summary: mem?.summary || "", facts: mem ? JSON.stringify(mem.facts) : "" },
    timeoutMs,
    bypassContentHeuristics,
  );
}

// a Studio that has no `think` yet (not restarted): the endpoint answers 500 / not JSON at once -> the bot uses the older path, never a dead reply
export function shamThinkUnavailable(o: ShamOutcome): boolean {
  return !o.reply && (o.failure === "http" || o.failure === "unreadable");
}

export async function shamJobResult(job: string, detach = false, timeoutMs = 8000, bypassContentHeuristics = false): Promise<ShamOutcome> {
  const payload = { job_id: job, detach: detach ? "1" : "" };
  const bases = shamStudioEnabled() ? shamBases() : [];
  if (bases.length <= 1) return shamCallOutcome("job_result", payload, timeoutMs, bypassContentHeuristics);
  let out: ShamOutcome = { reply: null, failure: "http" };            // a job lives on the Studio that started it: ask each one until it is found
  for (const b of bases) {
    out = await shamCallOnceAt(b, "job_result", payload, timeoutMs, bypassContentHeuristics);
    if (out.reply && out.reply.type !== "gone") return out;
  }
  return out;
}

// what the user is told when there is no answer (never "loading" unless the Studio itself says it is loading)
export function shamStatusText(o: ShamOutcome): string {
  const r = o.reply;
  if (r?.type === "loading") return "⏳ شام يحمّل النموذج الآن. أعد إرسال رسالتك بعد دقيقة.";
  if (r?.type === "busy") return "⌛ شام مشغول بطلب آخر الآن. أعد المحاولة بعد قليل.";
  if (r?.type === "gone") return "انتهت صلاحية هذا الطلب على الخادم. أعد إرسال رسالتك.";
  if (o.failure === "timeout") return "⌛ لم يكمل شام الرد في الوقت المتاح. أعد المحاولة بعد قليل.";
  if (o.failure === "http" || o.failure === "network") return "تعذّر الاتصال بخادم شام الآن. أعد المحاولة بعد قليل.";
  if (o.failure === "unreadable") return "خادم شام يعمل بنسخة أقدم لا تعرف هذا الطلب بعد.";
  return "تعذّر الرد الآن.";
}

export function shamPendingText(decision?: string): string {
  if (decision === "image") return "🎨 قرّر شام أن يرسم — سأرسل الصورة حين تجهز.";
  if (decision === "audio") return "🔊 قرّر شام أن يرد بصوت — سأرسله حين يجهز.";
  if (decision === "video") return "🎬 قرّر شام أن يصنع مقطعاً — سأرسله حين يجهز.";
  return "🧠 شام ما زال يفكّر (وقد يبحث) — سأرسل الرد حين يجهز.";
}

// A network blip (the connection never reached the Studio: a restart, a dropped link) is tried once more after a moment, as long as time is left;
// a timeout or an HTTP answer is never repeated (the Studio may already be working on it). Learned on Nova: a short outage is not worth an error message.
export async function shamCallOutcome(api: string, payload: Record<string, unknown>, timeoutMs: number, bypassContentHeuristics = false): Promise<ShamOutcome> {
  const t0 = Date.now();
  const first = await shamCallOnce(api, payload, timeoutMs, bypassContentHeuristics);
  if (first.failure !== "network" || Date.now() - t0 > timeoutMs - 6000) return first;
  await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 1500));
  return shamCallOnce(api, payload, Math.max(3000, timeoutMs - (Date.now() - t0)), bypassContentHeuristics);
}

// What Nova's loop does when a step comes back with nothing usable, for Sham's one-step `think` (the webhook has ~60 s, so every wait is bounded):
// "busy" (the Studio is on another request) is asked again after a moment, twice at most; a text reply with no text at all is asked once more.
// Whatever the model writes is passed on untouched; nothing is invented. `budgetMs` is the time this call may use in total.
export async function shamThinkPatient(
  prompt: string,
  userId: string,
  mem: Parameters<typeof shamThink>[2],
  maxNewTokens: number,
  timeoutMs: number,
  budgetMs = 40000,
  bypassContentHeuristics = false,
): Promise<ShamOutcome> {
  const t0 = Date.now();
  let out = await shamThink(prompt, userId, mem, maxNewTokens, timeoutMs, bypassContentHeuristics);
  let busy = 0, empty = 0;
  for (;;) {
    const r = out.reply;
    const left = budgetMs - (Date.now() - t0);
    if (r?.type === "busy" && busy < 2 && left > timeoutMs / 2) {
      busy++;
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 3000));
    } else if (r?.type === "text" && !(r.text || "").trim() && empty < 1 && left > timeoutMs / 2) {
      empty++;
    } else return out;
    out = await shamThink(prompt, userId, mem, maxNewTokens, Math.max(5000, Math.min(timeoutMs, budgetMs - (Date.now() - t0))), bypassContentHeuristics);
  }
}

/** How many new tokens one Telegram reply may use: 80 today (small model, 60 s webhook), SHAM_LIMITS=open or SHAM_REPLY_TOKENS lifts it (the Studio's own cap, SHAM_MAX_NEW_TOKENS, still applies). */
export const shamReplyTokens = (): number => Number(process.env.SHAM_REPLY_TOKENS) || ((process.env.SHAM_LIMITS || "").trim().toLowerCase() === "open" || shamVariant.getStore() === "v2" ? 768 : 80);   // the new body can write more than a line
