import { AsyncLocalStorage } from "node:async_hooks";
import { shamKnobs, type ShamMode } from "@/lib/shamModes";
// Calls Sham, the owner's own model hosted on a ModelScope Studio (ai-system/modelscope-sham/app.py), with the Gradio call protocol: (a chat here is answered by the model itself)
// POST {base}/gradio_api/call/v2/<api> -> {event_id}; GET {base}/gradio_api/call/<api>/<event_id> streams `data:` lines holding a list.
// The Studio is private: every call carries the account token (env MODELSCOPE_API_TOKEN, never logged). No token -> null.

const DEFAULT_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
const DEFAULT_V2_URL = "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net";

/** Which Sham a call goes to: "v1" = the current Sham Studio, "v2" = the new body's Studio. Set around a call with shamVariant.run("v2", fn) (the engine does it for the sham_v2 model). */
export const shamVariant = new AsyncLocalStorage<"v1" | "v2">();

/** The chat's thinking / accuracy / speed settings for the calls made inside it (set by the bot route around Sham's own handler). */
export const shamModeCtx = new AsyncLocalStorage<ShamMode>();

/** Applies the settings to one call: the answer budget scales with accuracy, and the sampling / thought header goes at the start of the prompt (src/lib/shamModes.ts). */
function withMode(payload: Record<string, unknown>): Record<string, unknown> {
  const mode = shamModeCtx.getStore();
  if (!mode) return payload;
  const k = shamKnobs(mode, shamVariant.getStore());
  const out = { ...payload };
  if (typeof out.max_new_tokens === "number") out.max_new_tokens = Math.max(20, Math.round(out.max_new_tokens * k.maxNewFactor));
  if (typeof out.prompt === "string" && k.header) out.prompt = k.header + out.prompt;
  return out;
}

let rotate = 0;
/** The Studio addresses for this call, best first. Each variant may name several Studios (comma-separated SHAM_MODELSCOPE_URL / SHAM_V2_URL): calls start at a rotating
 *  one, so users spread over the Studios, and a busy or unreachable one is skipped for the next (see shamBusyHop). */
export function shamBases(): string[] {
  const v2 = shamVariant.getStore() === "v2";
  const raw = (v2 ? process.env.SHAM_V2_URL || DEFAULT_V2_URL : process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
  const k = rotate++ % Math.max(1, raw.length);
  return [...raw.slice(k), ...raw.slice(0, k)];
}

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
  const base = shamBases()[0];
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
export type ShamReply = {
  type: "text" | "image" | "audio" | "video" | "notice" | "busy" | "loading" | "pending" | "gone" | "error";
  text?: string; mime?: string; b64?: string; route?: string;
  // think (2026-10-14): the model's own decision, a job id while it is still working, and results finished after an earlier request gave up waiting
  decision?: string; job?: string; later?: ShamReply[];
};

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

async function shamCallAt(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!sub.ok) { note(base, api, `HTTP ${sub.status} on submit`); return null; }
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) { note(base, api, "no event id"); return null; }
    const res = await fetch(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) note(base, api, `HTTP ${res.status} on result`);
    return res.ok ? await res.text() : null;
  } catch (e) {
    note(base, api, `${(e as { name?: string })?.name || "error"} (limit ${Math.round(timeoutMs / 1000)} s): ${String((e as Error)?.message || "").slice(0, 80)}`);
    return null;
  }
}

/** A Studio that answers "busy" (on another request) or not at all hands the call to the next Studio of the pool at once; with one Studio nothing changes. */
export const shamBusyHop = (reply: ShamReply | null | undefined): boolean => reply?.type === "busy";

async function shamCall(api: string, payload0: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
  if (!shamStudioEnabled()) { lastFailure = `${api}: MODELSCOPE_API_TOKEN is empty in this environment`; return null; }
  const payload = withMode(payload0);
  const bases = shamBases();
  let last: string | null = null;
  for (let i = 0; i < bases.length; i++) {
    const body = await shamCallAt(bases[i], api, payload, timeoutMs);
    if (body && !(i < bases.length - 1 && shamBusyHop(parseShamReply(body)))) return body;
    last = body ?? last;
  }
  return last;
}

export async function shamGenerateAny(prompt: string, maxNewTokens = 80, timeoutMs = 50000): Promise<ShamReply | null> {
  const body = await shamCall("generate_any", { prompt, max_new_tokens: maxNewTokens }, timeoutMs);
  const reply = body ? parseShamReply(body) : null;
  if (body && !reply) lastFailure = `generate_any: unreadable answer (${body.slice(0, 120).replace(/\s+/g, " ")})`;
  return reply;
}

export async function shamGenerateMedia(
  kind: "image" | "audio" | "video",
  prompt: string,
  timeoutMs = 55000,
  backend: "internal" | "ready" = "internal",
): Promise<ShamReply | null> {
  // Sham v2's transplanted text body does not have a reliable trained image decoder.
  // Its ready path uses the packaged SDXS/Piper weights in its own ModelScope repo.
  // Keep v1 on its own decoder; never silently fall back between backends.
  const api = backend === "ready" ? "generate_media_from_panel" : "generate_media";
  const payload = backend === "ready"
    ? { kind, prompt, backend_label: "المسار البديل (أوزان محلية جاهزة)" }
    : { kind, prompt };
  const body = await shamCall(api, payload, timeoutMs);
  const reply = body ? parseShamReply(body) : null;
  if (body && !reply) lastFailure = `${api}: unreadable answer (${body.slice(0, 120).replace(/\\s+/g, " ")})`;
  return reply;
}

// chat_auto (app.py): one entry for a plain message — the Studio's sham_intent routes the clear cases (media request, live search) and the rest goes to
// generate_any. Same JSON as generate_any plus "route". An older Studio without chat_auto answers null, and the caller falls back to generate_any.
export async function shamChatAuto(prompt: string, maxNewTokens = 80, timeoutMs = 55000): Promise<ShamReply | null> {
  const body = await shamCall("chat_auto", { prompt, max_new_tokens: maxNewTokens }, timeoutMs);
  return body ? parseShamReply(body) : null;
}

// chat_memory (app.py, 2026-10-14): chat_auto WITH memory — the chat's recent turns, rolling summary and facts from the database
// (src/lib/shamMemory.ts) plus the Studio's own per-user memory (sham_memory.py). An older Studio without chat_memory answers null, and the
// caller falls back to chat_auto. memory_forget deletes the Studio-side memory of one user.
export async function shamChatMemory(
  prompt: string,
  mem: { userId: string; history: { q: string; a: string }[]; summary: string; facts: Record<string, string> },
  maxNewTokens = 80,
  timeoutMs = 48000,
): Promise<ShamReply | null> {
  const body = await shamCall(
    "chat_memory",
    { prompt, max_new_tokens: maxNewTokens, user_id: mem.userId, history: JSON.stringify(mem.history), summary: mem.summary, facts: JSON.stringify(mem.facts) },
    timeoutMs,
  );
  return body ? parseShamReply(body) : null;
}

export async function shamMemoryForget(userId: string, timeoutMs = 15000): Promise<boolean> {
  const body = await shamCall("memory_forget", { user_id: userId }, timeoutMs);
  return Boolean(body && parseShamSse(body));
}

// ---- think (2026-10-14): ONE step where the model decides (reply / its own search / picture / sound / clip). No keyword rules on this path.
// Each call has its own short timeout; the outcome says WHY when there is no answer, so the bot can tell the user the truth.
export type ShamOutcome = { reply: ShamReply | null; failure?: "off" | "timeout" | "http" | "network" | "unreadable" };

/** The last failed Studio call (api, which Studio, why): shown to the owner under a failure message, so a failure is read, not guessed. */
let lastFailure = "";
export const shamLastFailure = (): string => lastFailure;
export const shamNoteFailure = (why: string): void => { lastFailure = why; };
const note = (base: string, api: string, why: string) => { lastFailure = `${api} @ ${base.replace(/^https?:\/\/(studio-novaai2026-)?/, "").slice(0, 40)}: ${why}`; };

async function shamCallOnceAt(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<ShamOutcome> {
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  const deadline = Date.now() + timeoutMs;
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!sub.ok) { note(base, api, `HTTP ${sub.status} on submit`); return { reply: null, failure: "http" }; }
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) { note(base, api, "no event id"); return { reply: null, failure: "http" }; }
    const res = await fetch(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (!res.ok) { note(base, api, `HTTP ${res.status} on result`); return { reply: null, failure: "http" }; }
    const reply = parseShamReply(await res.text());
    if (!reply) note(base, api, "unreadable answer");
    return reply ? { reply } : { reply: null, failure: "unreadable" };
  } catch (e) {
    const name = (e as { name?: string })?.name || "";
    note(base, api, `${name || "error"} after ${Math.round((timeoutMs) / 1000)} s limit: ${String((e as Error)?.message || "").slice(0, 80)}`);
    return { reply: null, failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

async function shamCallOnce(api: string, payload0: Record<string, unknown>, timeoutMs: number): Promise<ShamOutcome> {
  if (!shamStudioEnabled()) { lastFailure = `${api}: MODELSCOPE_API_TOKEN is empty in this environment`; return { reply: null, failure: "off" }; }
  const payload = withMode(payload0);
  const bases = shamBases();
  const t0 = Date.now();
  let out: ShamOutcome = { reply: null, failure: "network" };
  for (let i = 0; i < bases.length; i++) {
    out = await shamCallOnceAt(bases[i], api, payload, Math.max(3000, timeoutMs - (Date.now() - t0)));
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
): Promise<ShamOutcome> {
  return shamCallOutcome(
    "think",
    { prompt, max_new_tokens: maxNewTokens, user_id: userId, history: mem ? JSON.stringify(mem.history) : "", summary: mem?.summary || "", facts: mem ? JSON.stringify(mem.facts) : "" },
    timeoutMs,
  );
}

// a Studio that has no `think` yet (not restarted): the endpoint answers 500 / not JSON at once -> the bot uses the older path, never a dead reply
export function shamThinkUnavailable(o: ShamOutcome): boolean {
  return !o.reply && (o.failure === "http" || o.failure === "unreadable");
}

export async function shamJobResult(job: string, detach = false, timeoutMs = 8000): Promise<ShamOutcome> {
  const payload = { job_id: job, detach: detach ? "1" : "" };
  const bases = shamStudioEnabled() ? shamBases() : [];
  if (bases.length <= 1) return shamCallOutcome("job_result", payload, timeoutMs);
  let out: ShamOutcome = { reply: null, failure: "http" };            // a job lives on the Studio that started it: ask each one until it is found
  for (const b of bases) {
    out = await shamCallOnceAt(b, "job_result", payload, timeoutMs);
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
export async function shamCallOutcome(api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<ShamOutcome> {
  const t0 = Date.now();
  const first = await shamCallOnce(api, payload, timeoutMs);
  if (first.failure !== "network" || Date.now() - t0 > timeoutMs - 6000) return first;
  await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 1500));
  return shamCallOnce(api, payload, Math.max(3000, timeoutMs - (Date.now() - t0)));
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
): Promise<ShamOutcome> {
  const t0 = Date.now();
  let out = await shamThink(prompt, userId, mem, maxNewTokens, timeoutMs);
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
    out = await shamThink(prompt, userId, mem, maxNewTokens, Math.max(5000, Math.min(timeoutMs, budgetMs - (Date.now() - t0))));
  }
}

/** How many new tokens one Telegram reply may use: 80 today (small model, 60 s webhook), SHAM_LIMITS=open or SHAM_REPLY_TOKENS lifts it (the Studio's own cap, SHAM_MAX_NEW_TOKENS, still applies). */
export const shamReplyTokens = (): number => Number(process.env.SHAM_REPLY_TOKENS) || ((process.env.SHAM_LIMITS || "").trim().toLowerCase() === "open" || shamVariant.getStore() === "v2" ? 400 : 80);   // the new body can write more than a line
