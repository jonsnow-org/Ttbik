import { AsyncLocalStorage } from "node:async_hooks";
// The open coding model (Qwen3.5-4B GGUF on llama.cpp) on its OWN ModelScope Studio (ai-system/modelscope-coder/app.py) — a separate
// service from Sham's Studio (src/lib/shamStudio.ts). Same Gradio call protocol:
//   POST {base}/gradio_api/call/v2/<prefix>chat -> {event_id};  GET {base}/gradio_api/call/<prefix>chat/<event_id> -> `data: ["<json>"]`
// Long answers: `chat` waits up to wait_s on the Studio, then answers {type:"pending", job}; the bot polls `job_result` with an offset
// (only the new text comes back) across short serverless invocations (src/lib/coderSections.ts), so no answer-length cap is needed.
// Env: OPEN_CODER_STUDIO_URL (required — off without it), OPEN_CODER_STUDIO_TOKEN or MODELSCOPE_API_TOKEN (private Studio),
//      OPEN_CODER_API_PREFIX ("coder_" only for the combined single-Studio variant). Tokens are never logged.

import { filterByTier, tierFor, type Tier } from "@/lib/coderTier";
import { pressureOn } from "@/lib/pressureMode";
import { noteStudioCtx } from "@/lib/coderContext";
const PROVIDER_JOB_PREFIX = "p~";   // jobs of the removed "Sham inside Nova" provider: a run saved before that was removed gets "gone" instead of being polled
export type CoderToolCall = { id?: string; type?: "function"; function: { name: string; arguments: string } };
export type CoderMessage =
  | { role: "system" | "user"; content: string; ctx?: string; images?: string[] }          // images: data URLs of pictures the model should SEE (only a vision Studio can)
  | { role: "assistant"; content: string; tool_calls?: CoderToolCall[] }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };
export type CoderTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type CoderReply = {
  type: "done" | "pending" | "loading" | "error" | "gone" | "cancelled";
  job?: string;
  text?: string;
  offset?: number;
  total?: number;
  reasoning_len?: number;                                 // characters of thinking so far (deeper thinking on)
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
// ── Engine pools (owner 2026-11-04: every model is independent) ─────────────────────────────────────────────────────────────────────────
// Nova and LFM2.5 run the same engine (this module + coderSections) but each on ITS OWN Studios. The model of the current request is carried
// by an AsyncLocalStorage set at every engine entry (the webhook handler, every worker leg); a new completion may only go to that model's pool.
// A job id carries a GLOBAL index into allEngineBases(), so polling a job always reaches the Studio that took it, whatever the context.
const engineModel = new AsyncLocalStorage<string>();
export const ENGINE_MODELS = ["coder", "lfm25"] as const;
export type EngineModel = (typeof ENGINE_MODELS)[number];
export const isEngineModel = (id: string | undefined): id is EngineModel => id === "coder" || id === "lfm25";
/** Runs fn with `model`'s Studio pool for every new completion made inside it (any non-engine id = Nova's pool). */
export function withEngineModel<T>(model: string | undefined, fn: () => T): T {
  return engineModel.run(isEngineModel(model) ? model : "coder", fn);
}
export const currentEngineModel = (): EngineModel => (engineModel.getStore() as EngineModel | undefined) || "coder";
const LFM_DEFAULT = "https://studio-novaai2026-lfm25-inference-server.api-inference.modelscope.net";
/** LFM2.5's own Studios (LFM_STUDIO_URLS, comma list). Outside tests the dedicated Studio is the default; LFM_STUDIO_URLS=off disables it. */
export function lfmStudioUrls(): string[] {
  const raw = (process.env.LFM_STUDIO_URLS ?? process.env.LFM_STUDIO_URL ?? (process.env.NODE_ENV === "test" ? "" : LFM_DEFAULT)).trim();
  if (/^(off|none|0)$/i.test(raw)) return [];
  return raw.split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean).filter((x) => !/nova-inference-server|sham/i.test(x));
}
function novaStudioUrls(): string[] {
  // Nova and Sham inference remain independent. nova-inference-server is a computer-only execution host and is never used for model inference.
  const lfm = new Set(lfmStudioUrls());
  const mine = (x: string) => !/nova-inference-server|sham-v\d-|sham-v\d+-server|\/\/[^/]*sham/i.test(x) && !/lfm/i.test(x) && !lfm.has(x);
  const extra = (process.env.OPEN_CODER_STUDIO_URLS || "").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter(Boolean).filter(mine);
  const first = coderStudioUrl();
  return first && mine(first) ? [first, ...extra.filter((x) => x !== first)] : extra.length ? extra : [];
}
/** Every engine Studio, Nova's first then LFM's: the index space of job ids ("s<i>~<id>"). */
export function allEngineBases(): string[] {
  const nova = novaStudioUrls();
  return [...nova, ...lfmStudioUrls().filter((x) => !nova.includes(x))];
}
/** The Studios a new completion of the CURRENT model may use (Nova: primary + replicas; LFM2.5: its own). Never the other model's. */
export function coderStudioUrls(model: EngineModel = currentEngineModel()): string[] {
  return model === "lfm25" ? lfmStudioUrls() : novaStudioUrls();
}
const studioCooling = new Map<string, number>();                       // base -> skip until (after a failure), per server instance
const COOL_MS = 60000;
export function splitJob(job: string): { idx: number; id: string } {
  const m = /^s(\d+)~(.+)$/.exec(job || "");
  return m ? { idx: Number(m[1]), id: m[2] } : { idx: 0, id: job };
}
// force redeploy 2
export function coderEnabled(): boolean {
  return coderStudioUrls().length > 0;
}
function coderToken(): string {
  return (process.env.OPEN_CODER_STUDIO_TOKEN || process.env.MODELSCOPE_API_TOKEN || "").trim();
}
function apiName(api: string): string {
  return `${(process.env.OPEN_CODER_API_PREFIX || "").trim()}${api}`;
}

/** A model sometimes writes its tool call as DeepSeek-style markup (<｜DSML｜function_calls><｜DSML｜invoke name="web_search"><｜DSML｜parameter name="query">…) that the Studio's parser does not
 *  turn into tool_calls (live 2026-11-11, LFM2.5 task: the markup was shown as the answer and the task ended with no answer). Turn it into real tool calls and strip it from the text. */
/** A small model sometimes answers with a whole JSON message object instead of prose (live 2026-11-12, LFM2.5: {"role":"system","content":"..."}). When the entire
 *  answer is such an object (only message / answer keys, one string body), show the body. Anything else is left untouched. */
export function unwrapJsonAnswer(text: string): string {
  const t = text.trim();
  if (t.length < 2 || t[0] !== "{" || t[t.length - 1] !== "}") return text;
  let obj: unknown;
  try { obj = JSON.parse(t); } catch { return text; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return text;
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o);
  const allowed = new Set(["role", "content", "reflection", "answer", "response", "text", "message"]);
  if (!keys.length || keys.some((k) => !allowed.has(k))) return text;
  // LFM2.5 (live 2026-11-12) also writes {"reflection": ["step one", "step two"]}: an array of strings is the body too (joined line by line)
  const asText = (v: unknown): string => (typeof v === "string" ? v.trim() : Array.isArray(v) && v.length && v.every((x) => typeof x === "string") ? (v as string[]).map((x) => x.trim()).filter(Boolean).join("\n") : "");
  const body = ["content", "answer", "response", "text", "message", "reflection"].map((k) => asText(o[k])).find((v) => v);
  return typeof body === "string" && body ? body : text;
}

export function recoverTextToolCalls(reply: CoderReply): CoderReply {
  if (reply.type === "done" && !(reply.tool_calls && reply.tool_calls.length) && typeof reply.text === "string") {
    const unwrapped = unwrapJsonAnswer(reply.text);
    if (unwrapped !== reply.text) reply = { ...reply, text: unwrapped };
  }
  const text = typeof reply.text === "string" ? reply.text : "";
  if (reply.type !== "done" || (reply.tool_calls && reply.tool_calls.length) || !/function_calls>/.test(text) || !/invoke\s+name=/.test(text)) return reply;
  const calls: CoderToolCall[] = [];
  const P = "(?:[｜|]DSML[｜|])?";
  const invoke = new RegExp(`<${P}invoke\\s+name="([A-Za-z0-9_.:-]+)"\\s*>([\\s\\S]*?)</${P}invoke>`, "g");
  const param = new RegExp(`<${P}parameter\\s+name="([A-Za-z0-9_.:-]+)"[^>]*>([\\s\\S]*?)</${P}parameter>`, "g");
  let m: RegExpExecArray | null;
  while ((m = invoke.exec(text))) {
    const args: Record<string, unknown> = {};
    let q: RegExpExecArray | null;
    param.lastIndex = 0;
    while ((q = param.exec(m[2]))) {
      const raw = q[2].trim();
      let v: unknown = raw;
      if (/^-?\d+(\.\d+)?$/.test(raw) || /^(true|false|null)$/.test(raw) || /^[\[{][\s\S]*[\]}]$/.test(raw)) {
        try { v = JSON.parse(raw); } catch { v = raw; }
      }
      args[q[1]] = v;
    }
    calls.push({ id: `recovered_${calls.length + 1}`, type: "function", function: { name: m[1], arguments: JSON.stringify(args) } });
  }
  if (!calls.length) return reply;
  const clean = text.replace(new RegExp(`<${P}function_calls>[\\s\\S]*?</${P}function_calls>`, "g"), "").replace(new RegExp(`<${P}function_calls>[\\s\\S]*$`), "").trim();
  return { ...reply, text: clean, tool_calls: calls, finish_reason: reply.finish_reason && reply.finish_reason !== "stop" ? reply.finish_reason : "tool_calls" };
}

export function parseCoderSse(body: string): CoderReply | null {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim());
      if (!Array.isArray(data) || !data.length || data[0] == null) continue;
      const obj = typeof data[0] === "string" ? JSON.parse(data[0]) : data[0];
      if (obj && typeof obj === "object" && typeof obj.type === "string") return recoverTextToolCalls(obj as CoderReply);
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
/** The Studio that holds a conversation's prompt cache: the one that answered it last, and — after a restart of this server, when that memory is gone — the same
 *  one again by a fixed hash of the conversation key, so a deploy of the bot does not send every conversation to a cold Studio. */
export function homeStudio(key: string, bases: string[]): string {
  const known = lastStudio.get(key);
  if (known && bases.includes(known)) return known;
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return bases[h % bases.length];
}
const heldAt = new Map<string, number>();         // base -> when a conversation last used it (its prompt cache is warm there)
const HELD_MS = 15 * 60000;
export const forgetStudioHeld = (): void => { heldAt.clear(); };
const rememberStudio = (key: string, base: string) => { heldAt.set(base, Date.now()); lastStudio.delete(key); lastStudio.set(key, base); if (lastStudio.size > 500) lastStudio.delete(lastStudio.keys().next().value as string); };

/** What this process sent to the Studios (purpose, which Studio, when): when a step finds a job ahead of it, this says whether the bot itself put it there. */
const studioLog: { t: number; studio: number; tag: string }[] = [];
export function recentStudioCalls(ms = 600000): { ageS: number; studio: number; tag: string }[] {
  const now = Date.now();
  return studioLog.filter((e) => now - e.t < ms).map((e) => ({ ageS: Math.round((now - e.t) / 1000), studio: e.studio, tag: e.tag }));
}
export async function coderCall(api: string, payload: Record<string, unknown>, timeoutMs: number, affinity?: string, fresh = false, avoidHome = false, tag = "", needVision = false, tier?: Tier, prefer = ""): Promise<CoderOutcome> {
  const all = allEngineBases();
  const pool = coderStudioUrls();
  if (pressureOn()) avoidHome = true;                                       // pressure mode (owner switch): the least-queued Studio, not the conversation's cache-holding one
  if (api === "chat" && Date.now() - ctxAskedAt > 600000 && !process.env.CODER_CTX_TOKENS && process.env.NODE_ENV !== "test") { ctxAskedAt = Date.now(); for (const b of pool) void studioStatus(b, 4000).catch(() => null); }
  if (typeof payload.job_id === "string") {
    // a job lives on one Studio (global index: valid in any request context)
    if (!all.length) return { reply: null, failure: "off" };
    const { idx, id } = splitJob(payload.job_id);
    const o = await callOne(all[idx] || all[0], api, { ...payload, job_id: id }, timeoutMs);
    return idx ? tagJob(o, idx) : o;
  }
  const bases = pool;
  if (!bases.length) return { reply: null, failure: "off", detail: currentEngineModel() === "lfm25" ? "LFM2.5's own Studio is not configured (no other model is used instead)" : undefined };
  // a new call: first healthy Studio, failing over to the replicas (connection trouble only; a model error is an answer)
  const now = Date.now();
  let order = bases.map((b) => ({ b, i: all.indexOf(b) })).sort((x, y) => Number((studioCooling.get(x.b) || 0) > now) - Number((studioCooling.get(y.b) || 0) > now));
  if (api === "chat") {
    // choosing is one at a time (calls that start together must not all see the same Studio idle), and a Studio is marked as holding a conversation
    // the moment a normal call is sent to it: the side calls (quick acknowledgement, quiet work) are `fresh` and may only use a Studio no conversation
    // used in the last 15 minutes, so they can never take the slot of the user's own request ("1 ahead") or push its prompt cache out
    const turn = pickLock.then(async () => {
      let ord = order;
      if (needVision) {
        await Promise.all(bases.map((b) => studioStatus(b, 1500).catch(() => null)));          // learn which Studios read pictures
        ord = ord.filter((x) => visionBases.has(x.b));
        if (!ord.length) return null;
      }
      if (prefer) { const now2 = Date.now(); const pick = ord.filter((x) => x.b.includes(prefer) && (studioCooling.get(x.b) || 0) <= now2); if (pick.length) ord = pick; }   // a short side job (picture-prompt translation) goes to the named fast Studio when it is up
      ord = filterByTier(ord, tier);                                                          // fast model for greetings and short questions, strong model for the rest (only when fast Studios are configured)
      if (fresh) {
        ord = ord.filter((x) => Date.now() - (heldAt.get(x.b) || 0) > HELD_MS);
        if (!ord.length) return null;
      }
      const o = bases.length > 1 ? await idleFirst(ord, !fresh && !avoidHome && affinity ? homeStudio(affinity, bases) : undefined) : ord;
      recentPick.set(o[0].b, Date.now());
      if (!fresh) heldAt.set(o[0].b, Date.now());
      return o;
    });
    pickLock = turn.then(() => undefined, () => undefined);
    const picked = await turn;
    if (!picked) return { reply: null, failure: "http", detail: needVision ? "no Studio reads pictures (vision is off)" : "no free Studio" };
    order = picked;
  }
  let last: CoderOutcome = { reply: null, failure: "network" };
  const per = bases.length > 1 ? Math.max(8000, Math.floor(timeoutMs / Math.min(2, bases.length))) : timeoutMs;
  for (const { b, i } of order.slice(0, 2)) {
    last = await callOne(b, api, fitWait(payload, per), per);
    if (last.reply) {
      studioCooling.delete(b);
      if (affinity) rememberStudio(affinity, b);
      if (api === "chat") { studioLog.push({ t: Date.now(), studio: i + 1, tag: tag || "?" }); if (studioLog.length > 60) studioLog.shift(); }
      return i ? tagJob(last, i) : last;
    }
    // the hub's rate limit is not a sick Studio: no cooling, no failover (the other Studio holds no cache for this conversation: a cold read of the whole prompt is minutes); the caller waits and asks again, the same Studio first
    if (last.status === 429) return last;
    studioCooling.set(b, Date.now() + COOL_MS);
  }
  return last;
}
/**
 * Both Studios serve: a new completion goes to one that is ready with nothing queued, so a second user (or a background job) does not
 * wait behind the first on one Studio while the other is idle. Each Studio's `status` is asked at once; the first idle one wins without
 * waiting for the rest; otherwise the shortest queue; a Studio that is loading / down goes last. CODER_STUDIO_BALANCE=off = first healthy.
 */
/** How many jobs may be queued ahead on the Studio that holds a conversation's prompt cache before the conversation moves to another one. Measured 2026-11-14 (live Nova task): three Studios took turns, so every step re-read 6-15 thousand tokens from scratch at 20-29 tokens/s (minutes per step); two jobs ahead on the cache-holding Studio are seconds. CODER_STUDIO_STICKY_QUEUE=0 restores the strict rule. */
const stickyQueue = (): number => { const n = Number(process.env.CODER_STUDIO_STICKY_QUEUE); return Number.isFinite(n) && n >= 0 ? Math.min(8, Math.floor(n)) : 2; };
async function idleFirst(order: { b: string; i: number }[], preferred?: string): Promise<{ b: string; i: number }[]> {
  if ((process.env.CODER_STUDIO_BALANCE || "").toLowerCase() === "off") return order;
  if (preferred && order.some((x) => x.b === preferred)) {
    // the conversation's own Studio first: when it is ready with nothing queued, the other four are not asked at all (five asks at once is the burst the hub refuses)
    const st0 = await studioStatus(preferred, Math.max(400, Number(process.env.CODER_STUDIO_BALANCE_MS || 900))).catch(() => null);
    if (st0 && st0.phase === "ready" && !(Number(st0.queue) > stickyQueue())) return [...order].sort((x, y) => Number(y.b === preferred) - Number(x.b === preferred));
  }
  const capMs = Math.max(400, Number(process.env.CODER_STUDIO_BALANCE_MS || 900));
  const seen = new Map<string, number>();                                  // base -> queue length (Infinity = not ready / no answer)
  const score = (st: Record<string, unknown> | null) => (st && st.phase === "ready" ? Number(st.queue) || 0 : Infinity);
  const idle = await new Promise<string | null>((resolve) => {
    let left = order.length;
    let firstIdle: string | null = null;
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(preferred && (seen.get(preferred) ?? 9) <= stickyQueue() ? preferred : firstIdle); };   // one job ahead on the cache-holding Studio is seconds; a cold read elsewhere is minutes
    const timer = setTimeout(finish, capMs);
    for (const { b } of order) {
      studioStatus(b, capMs).then((st) => {
        const q0 = score(st);
        const q = q0 === 0 && b !== preferred && Date.now() - (recentPick.get(b) || 0) < 4000 ? 0.5 : q0;
        seen.set(b, q);
        left--;
        if (q === 0 && !firstIdle) firstIdle = b;
        // the Studio that holds this conversation's prompt cache wins when it is free; another idle one is taken only once the preferred one has answered (or the time is up)
        if (b === preferred && q0 === 0) finish();
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

// The hub refuses BURSTS, not a steady stream. Measured 2026-10-26 (nova-ratelimit-probe.yml, one call at a time even 4 per second = never refused): 6 calls at once → 1 refused (429),
// 10 at once → 5 refused, 10-20 at once over the five Studios → all refused. A call here is two requests (submit, then the result stream), and the bot used to ask all five Studios
// for their status in parallel at every step plus the poll: a burst. So every request to a Studio goes through ONE gate (CODER_HUB_CONCURRENCY, default 3 at a time), and a 429 is
// asked again after a short pause (the burst is over in seconds) instead of ending the step.
let hubActive = 0;
const hubWaiters: (() => void)[] = [];
async function hubSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = Math.max(1, Number(process.env.CODER_HUB_CONCURRENCY || 3));
  while (hubActive >= max) await new Promise<void>((res) => hubWaiters.push(res));
  hubActive++;
  try {
    return await fn();
  } finally {
    hubActive--;
    hubWaiters.shift()?.();
  }
}
const HUB_RETRY_MS = (): number[] => (process.env.NODE_ENV === "test" ? [0, 0] : [1500, 3500, 7000]);

async function callOne(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CoderOutcome> {
  const started = Date.now();
  const waits = HUB_RETRY_MS();
  for (let k = 0; ; k++) {
    const o = await hubSlot(() => callOnce(base, api, payload, timeoutMs));
    if (o.status !== 429 || k >= waits.length) return o;
    const pause = waits[k] + (waits[k] ? Math.random() * 600 : 0);
    if (Date.now() + pause + 1500 > started + timeoutMs) return o;           // no room left in this call's own time budget: the caller's own pause takes over
    await new Promise((res) => setTimeout(res, pause));
  }
}

async function callOnce(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CoderOutcome> {
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
    const reply = await readCoderSse(res, parseCoderSse);
    return reply ? { reply } : { reply: null, failure: "unreadable" };
  } catch (e) {
    const n = (e as { name?: string })?.name || "";
    return { reply: null, failure: n === "TimeoutError" || n === "AbortError" ? "timeout" : "network" };
  }
}

/** The messages as the model server reads them: a user message with pictures becomes content parts (text + image_url). Nothing else changes. */
export function wireMessages(messages: CoderMessage[]): unknown[] {
  return messages.map((m) => {
    const imgs = (m as { images?: string[] }).images;
    if (m.role !== "user" || !imgs?.length) return m;
    const { images: _i, ...rest } = m as { images?: string[] } & Record<string, unknown>;
    return { ...rest, content: [{ type: "text", text: String(m.content) + (m.ctx ? `\n\n${m.ctx}` : "") }, ...imgs.map((u) => ({ type: "image_url", image_url: { url: u } }))], ctx: undefined };
  });
}
/** Studios that told us (in their status) they read pictures; refreshed by every status ask. */
const visionBases = new Set<string>();
export const hasImages = (messages: CoderMessage[]): boolean => messages.some((m) => (m as { images?: string[] }).images?.length);
/** Is any Studio able to read pictures right now? (asks the Studios' status, shared for 1.5 s) */
export async function anyVisionStudio(capMs = 1500): Promise<boolean> {
  await Promise.all(coderStudioUrls().map((b) => studioStatus(b, capMs).catch(() => null)));
  return coderStudioUrls().some((b) => visionBases.has(b));
}

/** Queue one completion. max_tokens 0 = no cap (the model stops by itself or at the Studio's context size). */
export async function coderChat(
  messages: CoderMessage[],
  opts: { tools?: CoderTool[]; maxTokens?: number; think?: boolean; temperature?: number; waitS?: number; timeoutMs?: number; model?: string; affinity?: string; fresh?: boolean; avoidHome?: boolean; tag?: string; thinkCap?: number; priority?: number; prefer?: string; accuracy?: "fast" | "balanced" | "precise" } = {},
): Promise<CoderOutcome> {
  const waitS = opts.waitS ?? 20;
  const base = {
      messages: JSON.stringify(wireMessages(messages)),
      tools: opts.tools?.length ? JSON.stringify(opts.tools) : "",
      max_tokens: opts.maxTokens ?? 0,
      think: opts.think ? (opts.thinkCap && opts.thinkCap !== 1200 ? `1:${Math.round(opts.thinkCap)}` : "1") : "",
      temperature: opts.temperature ?? 0.6,
      wait_s: waitS,
  };
  const call = (payload: Record<string, unknown>) => coderCall("chat", payload, opts.timeoutMs ?? (waitS + 12) * 1000, opts.affinity, opts.fresh, opts.avoidHome, opts.tag, hasImages(messages), tierFor(messages, opts.tools), opts.prefer || "");
  if (!(opts.priority && opts.priority > 0)) return call(base);                       // no field at all: the payload is what every Studio already understands
  const o = await call({ ...base, priority: 1 });                                     // Pro / owner: ahead in the Studio's queue
  return o.status === 400 || o.status === 422 ? call(base) : o;                       // a Studio from before the field existed rejects it: same call without it
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
/** Every Studio's own status, in STUDIOS order (null = no answer): the owner panel shows each one instead of one ✅ for all. */
export async function allStudioStatus(timeoutMs = 7000): Promise<(Record<string, unknown> | null)[]> {
  return Promise.all(coderStudioUrls().map((b) => studioStatus(b, timeoutMs).catch(() => null)));
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

/**
 * Gradio SSE may keep its result connection open after the first complete answer arrives.
 * Parse each complete line as it streams instead of waiting for Response.text() to reach EOF.
 */
export async function readCoderSse<T>(response: Response, parse: (body: string) => T | null): Promise<T | null> {
  const reader = response.body?.getReader();
  if (!reader) return parse(await response.text());

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
        const parsed = parse(line + "\n");
        if (parsed !== null) {
          await reader.cancel().catch(() => undefined);
          return parsed;
        }
        newline = buffered.indexOf("\n");
      }

      if (done) return buffered ? parse(buffered + "\n") : null;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* stream may already be closed */ }
  }
}
// The hub rate-limits the account ("429 Request limit exceeded" seen on a live task): status asks are shared for 1.5 s (idle-picking, the panel, the queue check all ask the same Studios).
const statusShared = new Map<string, { t: number; p: Promise<Record<string, unknown> | null> }>();
function studioStatus(base: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  if (process.env.NODE_ENV === "test") return studioStatusRaw(base, timeoutMs);
  const hit = statusShared.get(base);
  if (hit && Date.now() - hit.t < 1500) return hit.p;
  const p = studioStatusRaw(base, timeoutMs);
  statusShared.set(base, { t: Date.now(), p });
  return p;
}
async function studioStatusRaw(base: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  return hubSlot(() => studioStatusOnce(base, timeoutMs));
}
async function studioStatusOnce(base: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
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
    const st = res.ok ? await readCoderSse(res, parseStatusSse) : null;
    if (st && st.ctx != null) noteStudioCtx(base, st.ctx);
    if (st) { if (st.vision === true) visionBases.add(base); else visionBases.delete(base); }        // the Studio's own context size: every budget in the bot follows it (coderContext.ts)
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

/** Is any Studio ready with nothing queued (answered within `capMs`)? A step waiting in a queue moves there at once. */
export async function anyIdleStudio(capMs = 900): Promise<boolean> {
  const all = await allStudioStatus(capMs);
  // a Studio that did not answer (the hub rate-limits status asks too) may well be idle: it counts, otherwise a 429 on the asks would keep a step waiting behind a long job
  return all.some((st) => (st && st.phase === "ready" && !(Number(st.queue) > 0)) || st === null);
}
