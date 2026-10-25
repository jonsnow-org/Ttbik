// The open coding model (Qwen3.5-4B GGUF on llama.cpp) on its OWN ModelScope Studio (ai-system/modelscope-coder/app.py) — a separate
// service from Sham's Studio (src/lib/shamStudio.ts). Same Gradio call protocol:
//   POST {base}/gradio_api/call/v2/<prefix>chat -> {event_id};  GET {base}/gradio_api/call/<prefix>chat/<event_id> -> `data: ["<json>"]`
// Long answers: `chat` waits up to wait_s on the Studio, then answers {type:"pending", job}; the bot polls `job_result` with an offset
// (only the new text comes back) across short serverless invocations (src/lib/coderSections.ts), so no answer-length cap is needed.
// Env: OPEN_CODER_STUDIO_URL (required — off without it), OPEN_CODER_STUDIO_TOKEN or MODELSCOPE_API_TOKEN (private Studio),
//      OPEN_CODER_API_PREFIX ("coder_" only for the combined single-Studio variant). Tokens are never logged.

import { noteStudioCtx } from "@/lib/coderContext";
import { providerConfig, providerChat, shamAsModel, PROVIDER_JOB_PREFIX } from "@/lib/coderProvider";
export type CoderToolCall = { id?: string; type?: "function"; function: { name: string; arguments: string } };
export type CoderMessage =
  | { role: "system" | "user"; content: string; ctx?: string }
  | { role: "assistant"; content: string; tool_calls?: CoderToolCall[] }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };
export type CoderTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type CoderReply = {
  type: "done" | "pending" | "loading" | "error" | "gone" | "cancelled";
  job?: string;
  text?: string;
  offset?: number;
  total?: number;
  tool_calls?: CoderToolCall[];
  finish_reason?: string;
  queue_pos?: number;
  phase?: string;
  prefill?: { total?: number; cache?: number; processed?: number; time_ms?: number } | null;   // prompt reading progress (llama-server return_progress)
  error?: string;
  timings?: { prompt_n?: number; predicted_n?: number; predicted_per_second?: number };   // llama.cpp's own token counts (done jobs)
};
export type CoderOutcome = { reply: CoderReply | null; failure?: "off" | "timeout" | "http" | "network" | "unreadable" | "auth"; status?: number; detail?: string };   // auth = the server refused our token (401/403): waiting does not fix it

export function coderStudioUrl(): string {
  return (process.env.OPEN_CODER_STUDIO_URL || "").trim().replace(/\/+$/, "");
}
/** Primary Studio + optional replicas (OPEN_CODER_STUDIO_URLS, comma list): a new completion goes to the first healthy one; a job
 *  stays on the Studio that took it (job ids from a replica carry its index: "s<i>~<id>"). */
export function coderStudioUrls(): string[] {
  const extra = (process.env.OPEN_CODER_STUDIO_URLS || "").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean);
  const first = coderStudioUrl();
  return first ? [first, ...extra.filter((x) => x !== first)] : [];
}
const studioCooling = new Map<string, number>();                       // base -> skip until (after a failure), per server instance
const COOL_MS = 60000;
export function splitJob(job: string): { idx: number; id: string } {
  const m = /^s(\d+)~(.+)$/.exec(job || "");
  return m ? { idx: Number(m[1]), id: m[2] } : { idx: 0, id: job };
}
// force redeploy 2
export function coderEnabled(): boolean {
  return Boolean(coderStudioUrl());
}
function coderToken(): string {
  return (process.env.OPEN_CODER_STUDIO_TOKEN || process.env.MODELSCOPE_API_TOKEN || "").trim();
}
function apiName(api: string): string {
  return `${(process.env.OPEN_CODER_API_PREFIX || "").trim()}${api}`;
}

export function parseCoderSse(body: string): CoderReply | null {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim());
      if (!Array.isArray(data) || !data.length || data[0] == null) continue;
      const obj = typeof data[0] === "string" ? JSON.parse(data[0]) : data[0];
      if (obj && typeof obj === "object" && typeof obj.type === "string") return obj as CoderReply;
    } catch {
      /* not a data line we understand: keep reading */
    }
  }
  return null;
}

/** Which Studio last answered a conversation: llama.cpp keeps the conversation's prompt cache per Studio, so the next step goes back to it when it is free (a different Studio would read the whole context again, ~2 minutes on a free CPU). */
const lastStudio = new Map<string, string>();
let pickLock: Promise<void> = Promise.resolve();
let ctxAskedAt = 0;
const recentPick = new Map<string, number>();     // a Studio just handed to one call is not 'idle' for the next call a moment later (two agents starting together go to different Studios)
const heldAt = new Map<string, number>();         // base -> when a conversation last used it (its prompt cache is warm there)
const HELD_MS = 15 * 60000;
export const forgetStudioHeld = (): void => { heldAt.clear(); };
const rememberStudio = (key: string, base: string) => { heldAt.set(base, Date.now()); lastStudio.delete(key); lastStudio.set(key, base); if (lastStudio.size > 500) lastStudio.delete(lastStudio.keys().next().value as string); };

export async function coderCall(api: string, payload: Record<string, unknown>, timeoutMs: number, affinity?: string, fresh = false): Promise<CoderOutcome> {
  const bases = coderStudioUrls();
  if (api === "chat" && Date.now() - ctxAskedAt > 600000 && !process.env.CODER_CTX_TOKENS && process.env.NODE_ENV !== "test") { ctxAskedAt = Date.now(); for (const b of bases) void studioStatus(b, 4000).catch(() => null); }
  if (!bases.length) return { reply: null, failure: "off" };
  if (typeof payload.job_id === "string") {
    // a job lives on one Studio
    const { idx, id } = splitJob(payload.job_id);
    const o = await callOne(bases[idx] || bases[0], api, { ...payload, job_id: id }, timeoutMs);
    return idx ? tagJob(o, idx) : o;
  }
  // a new call: first healthy Studio, failing over to the replicas (connection trouble only; a model error is an answer)
  const now = Date.now();
  let order = bases.map((b, i) => ({ b, i })).sort((x, y) => Number((studioCooling.get(x.b) || 0) > now) - Number((studioCooling.get(y.b) || 0) > now));
  if (fresh && api === "chat") {
    // a side call (the quick acknowledgement) must not push a conversation's prompt out of a Studio that holds it (one slot each): only Studios nobody used lately
    order = order.filter((x) => Date.now() - (heldAt.get(x.b) || 0) > HELD_MS);
    if (!order.length) return { reply: null, failure: "http", detail: "no free Studio" };
  }
  if (api === "chat" && bases.length > 1) {
    // choosing is one at a time: calls that start together (parallel agents / report sections) must not all see the same Studio idle
    const turn = pickLock.then(async () => { const o = await idleFirst(order, affinity ? lastStudio.get(affinity) : undefined); recentPick.set(o[0].b, Date.now()); return o; });
    pickLock = turn.then(() => undefined, () => undefined);
    order = await turn;
  }
  let last: CoderOutcome = { reply: null, failure: "network" };
  const per = bases.length > 1 ? Math.max(8000, Math.floor(timeoutMs / Math.min(2, bases.length))) : timeoutMs;
  for (const { b, i } of order.slice(0, 2)) {
    last = await callOne(b, api, fitWait(payload, per), per);
    if (last.reply) {
      studioCooling.delete(b);
      if (affinity) rememberStudio(affinity, b);
      return i ? tagJob(last, i) : last;
    }
    studioCooling.set(b, Date.now() + COOL_MS);
  }
  return last;
}
/**
 * Both Studios serve: a new completion goes to one that is ready with nothing queued, so a second user (or a background job) does not
 * wait behind the first on one Studio while the other is idle. Each Studio's `status` is asked at once; the first idle one wins without
 * waiting for the rest; otherwise the shortest queue; a Studio that is loading / down goes last. CODER_STUDIO_BALANCE=off = first healthy.
 */
async function idleFirst(order: { b: string; i: number }[], preferred?: string): Promise<{ b: string; i: number }[]> {
  if ((process.env.CODER_STUDIO_BALANCE || "").toLowerCase() === "off") return order;
  const capMs = Math.max(400, Number(process.env.CODER_STUDIO_BALANCE_MS || 900));
  const seen = new Map<string, number>();                                  // base -> queue length (Infinity = not ready / no answer)
  const score = (st: Record<string, unknown> | null) => (st && st.phase === "ready" ? Number(st.queue) || 0 : Infinity);
  const idle = await new Promise<string | null>((resolve) => {
    let left = order.length;
    let firstIdle: string | null = null;
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(preferred && (seen.get(preferred) ?? 9) <= 1 ? preferred : firstIdle); };   // one job ahead on the cache-holding Studio is seconds; a cold read elsewhere is minutes
    const timer = setTimeout(finish, capMs);
    for (const { b } of order) {
      studioStatus(b, capMs).then((st) => {
        const q0 = score(st);
        const q = q0 === 0 && b !== preferred && Date.now() - (recentPick.get(b) || 0) < 4000 ? 0.5 : q0;
        seen.set(b, q);
        left--;
        if (q === 0 && !firstIdle) firstIdle = b;
        // the Studio that holds this conversation's prompt cache wins when it is free; another idle one is taken only once the preferred one has answered (or the time is up)
        if (b === preferred && q0 <= 1) finish();
        else if (q === 0 && (!preferred || b === preferred || seen.has(preferred))) finish();
        else if (left === 0) finish();
      });
    }
  });
  const rank = (b: string) => (b === idle ? -1 : seen.has(b) ? seen.get(b)! : 1e6);
  return [...order].sort((x, y) => rank(x.b) - rank(y.b));               // stable: equal ranks keep the cooling / primary order
}
/**
 * A completion call holds the HTTP request open on the Studio for up to `wait_s` before it answers "pending" + the job id. If the
 * attempt's own timeout is shorter than that, the bot gives up first: the job stays queued on the Studio with an id nobody knows (it
 * can never be polled or cancelled), the call is retried and the retry lands behind it ("1 ahead") while it holds the one-at-a-time
 * runner. So each attempt asks the Studio to answer well inside that attempt's time (CODER_STUDIO_ANSWER_MARGIN_MS, default 8 s, covers
 * the Studio proxy and the event-stream round trip); the job then goes on and is polled with job_result as usual.
 */
export function fitWait(payload: Record<string, unknown>, attemptMs: number): Record<string, unknown> {
  if (typeof payload.wait_s !== "number") return payload;
  const margin = Math.max(3000, Number(process.env.CODER_STUDIO_ANSWER_MARGIN_MS || 8000));
  const room = Math.max(1, Math.floor((attemptMs - margin) / 1000));
  return payload.wait_s > room ? { ...payload, wait_s: room } : payload;
}
function tagJob(o: CoderOutcome, idx: number): CoderOutcome {
  return o.reply?.job ? { ...o, reply: { ...o.reply, job: `s${idx}~${o.reply.job}` } } : o;
}

/** The first words of an error answer (the server says WHY: rate limit, blocked, bad token). Never includes our headers; the body is the server's own text. */
async function errorDetail(r: Response): Promise<string> {
  try {
    return (await r.text()).replace(/\s+/g, " ").slice(0, 160);
  } catch {
    return "";
  }
}

async function callOne(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CoderOutcome> {
  const name = apiName(api);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = coderToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const deadline = Date.now() + timeoutMs;
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${name}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!sub.ok) return { reply: null, failure: sub.status === 401 || sub.status === 403 ? "auth" : "http", status: sub.status, detail: await errorDetail(sub) };
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return { reply: null, failure: "http" };
    const res = await fetch(`${base}/gradio_api/call/${name}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (!res.ok) return { reply: null, failure: res.status === 401 || res.status === 403 ? "auth" : "http", status: res.status, detail: await errorDetail(res) };
    const reply = parseCoderSse(await res.text());
    return reply ? { reply } : { reply: null, failure: "unreadable" };
  } catch (e) {
    const n = (e as { name?: string })?.name || "";
    return { reply: null, failure: n === "TimeoutError" || n === "AbortError" ? "timeout" : "network" };
  }
}

/** Queue one completion. max_tokens 0 = no cap (the model stops by itself or at the Studio's context size). */
export function coderChat(
  messages: CoderMessage[],
  opts: { tools?: CoderTool[]; maxTokens?: number; think?: boolean; temperature?: number; waitS?: number; timeoutMs?: number; model?: string; affinity?: string; fresh?: boolean } = {},
): Promise<CoderOutcome> {
  const waitS = opts.waitS ?? 20;
  if (opts.model === "sham" || opts.model === "sham_loop") return shamAsModel(messages, { maxTokens: opts.maxTokens, timeoutMs: Math.max(60000, opts.timeoutMs ?? 0), conversation: opts.model === "sham_loop" });   // Sham as a sub-agent probe (role sham) or as the chosen model (owner only)
  const prov = providerConfig(opts.model);                       // a hand-picked API model (Nova Pro); everything else is our Studio
  if (opts.model === "nova_pro" && !prov) return Promise.resolve({ reply: null, failure: "off" });   // chosen by hand but not set up: say so, never answer from another model
  if (prov) return providerChat(prov, messages, { tools: opts.tools, maxTokens: opts.maxTokens, temperature: opts.temperature, timeoutMs: Math.max(60000, opts.timeoutMs ?? 0, 240000) });
  return coderCall(
    "chat",
    {
      messages: JSON.stringify(messages),
      tools: opts.tools?.length ? JSON.stringify(opts.tools) : "",
      max_tokens: opts.maxTokens ?? 0,
      think: opts.think ? "1" : "",
      temperature: opts.temperature ?? 0.6,
      wait_s: waitS,
    },
    opts.timeoutMs ?? (waitS + 12) * 1000,
    opts.affinity,
    opts.fresh,
  );
}

export function coderJobResult(job: string, offset = 0, timeoutMs = 10000): Promise<CoderOutcome> {
  if (job.startsWith(PROVIDER_JOB_PREFIX)) return Promise.resolve({ reply: { type: "gone", job } });   // an API answer is never polled; it was consumed inline
  return coderCall("job_result", { job_id: job, offset }, timeoutMs);
}
export function coderCancel(job: string, timeoutMs = 8000): Promise<CoderOutcome> {
  return coderCall("cancel", { job_id: job }, timeoutMs);
}
export async function coderStatus(timeoutMs = 10000): Promise<Record<string, unknown> | null> {
  const bases = coderStudioUrls();
  for (const b of bases.slice(0, 2)) {
    const st = await studioStatus(b, timeoutMs);
    if (st) return st;
  }
  return null;
}
/** The Studio's `status` answer ({phase, queue, model, ...}). It has no `type` field, so parseCoderSse (completion answers) skips it. */
export function parseStatusSse(body: string): Record<string, unknown> | null {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim());
      if (!Array.isArray(data) || data[0] == null) continue;
      const obj = typeof data[0] === "string" ? JSON.parse(data[0]) : data[0];
      if (obj && typeof obj === "object" && typeof obj.phase === "string") return obj as Record<string, unknown>;
    } catch {
      /* keep reading */
    }
  }
  return null;
}
async function studioStatus(base: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const name = apiName("status");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = coderToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const deadline = Date.now() + timeoutMs;
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${name}`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(timeoutMs) });
    if (!sub.ok) return null;
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return null;
    const res = await fetch(`${base}/gradio_api/call/${name}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())) });
    const st = res.ok ? parseStatusSse(await res.text()) : null;
    if (st && st.ctx != null) noteStudioCtx(base, st.ctx);        // the Studio's own context size: every budget in the bot follows it (coderContext.ts)
    return st;
  } catch {
    return null;
  }
}

export function coderFailureText(o: CoderOutcome): string {
  if (o.failure === "off") return "قسم المبرمج غير مفعّل بعد (لم يُضبط عنوان الخادم).";
  if (o.failure === "timeout") return "⌛ خادم المبرمج لم يرد في الوقت المتاح. أعد المحاولة بعد قليل.";
  if (o.failure === "auth") return `⛔ خادم المبرمج رفض رمز الوصول (HTTP ${o.status || 401}). تحقق من MODELSCOPE_API_TOKEN على الخادم الذي يشغّل البوت.${o.detail ? ` رد الخادم: ${o.detail}` : ""}`;
  if (o.failure === "http" || o.failure === "network") return "تعذّر الاتصال بخادم المبرمج الآن (قد يكون قيد التشغيل). أعد المحاولة بعد دقيقة.";
  if (o.failure === "unreadable") return "خادم المبرمج ردّ بصيغة غير متوقعة.";
  if (o.reply?.type === "error") return `خطأ من خادم المبرمج: ${(o.reply.error || "").slice(0, 300)}`;
  if (o.reply?.type === "gone") return "انتهت صلاحية هذا الطلب على الخادم. أعد إرسال رسالتك.";
  return "تعذّر الرد الآن.";
}

export const TELEGRAM_LIMIT = 4096;

/** Split a long answer into Telegram messages (< 4096 chars), preferring paragraph / line breaks, and re-opening a ``` code block that a
 *  cut would leave unbalanced so every part renders on its own. */
export function splitForTelegram(text: string, max = 3900): string[] {
  const out: string[] = [];
  let rest = text || "";
  let carryFence = "";
  while (rest.length) {
    const room = max - carryFence.length - 5;
    let part: string;
    if (rest.length <= room) {
      part = rest;
      rest = "";
    } else {
      let cut = rest.lastIndexOf("\n\n", room);
      if (cut < room * 0.5) cut = rest.lastIndexOf("\n", room);
      if (cut < room * 0.5) cut = rest.lastIndexOf(" ", room);
      if (cut < room * 0.5) cut = room;
      part = rest.slice(0, cut);
      rest = rest.slice(cut).replace(/^\n+/, "");
    }
    let chunk = carryFence + part;
    const fences = chunk.match(/^```[^\n]*$/gm) || [];
    if (fences.length % 2 === 1) {
      const open = fences[fences.length - 1];
      chunk += "\n```";
      carryFence = rest ? `${open}\n` : "";
    } else {
      carryFence = "";
    }
    if (chunk.trim()) out.push(chunk);
  }
  return out;
}

/** The ``` line still open at the end of `text` (odd number of fences), or "". */
export function openFenceAt(text: string): string {
  const fences = (text || "").match(/^```[^\n]*$/gm) || [];
  return fences.length % 2 === 1 ? fences[fences.length - 1] : "";
}

/** Sendable ranges of `text` from `from`: whole chunks only while generating (`final` false), everything when the answer is done. */
export function chunkRanges(text: string, from: number, final: boolean, max = 3800): [number, number][] {
  const out: [number, number][] = [];
  let a = from;
  while (a < text.length) {
    const left = text.length - a;
    if (left <= max) {
      if (final) out.push([a, text.length]);
      break;
    }
    let cut = text.lastIndexOf("\n", a + max);
    if (cut <= a + max * 0.5) cut = text.lastIndexOf(" ", a + max);
    if (cut <= a + max * 0.5) cut = a + max;
    out.push([a, cut]);
    a = cut;
  }
  return out;
}

/** One Telegram message for text[a:b], with a code block re-opened / closed at the edges so it renders on its own. */
export function renderRange(text: string, a: number, b: number): string {
  const before = openFenceAt(text.slice(0, a));
  const body = text.slice(a, b).replace(/^\n+/, "");
  const after = openFenceAt(text.slice(0, b));
  return `${before ? before + "\n" : ""}${body}${after ? "\n```" : ""}`;
}
