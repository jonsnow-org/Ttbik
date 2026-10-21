// The open coding model (Qwen3.5-4B GGUF on llama.cpp) on its OWN ModelScope Studio (ai-system/modelscope-coder/app.py) — a separate
// service from Sham's Studio (src/lib/shamStudio.ts). Same Gradio call protocol:
//   POST {base}/gradio_api/call/v2/<prefix>chat -> {event_id};  GET {base}/gradio_api/call/<prefix>chat/<event_id> -> `data: ["<json>"]`
// Long answers: `chat` waits up to wait_s on the Studio, then answers {type:"pending", job}; the bot polls `job_result` with an offset
// (only the new text comes back) across short serverless invocations (src/lib/coderSections.ts), so no answer-length cap is needed.
// Env: OPEN_CODER_STUDIO_URL (required — off without it), OPEN_CODER_STUDIO_TOKEN or MODELSCOPE_API_TOKEN (private Studio),
//      OPEN_CODER_API_PREFIX ("coder_" only for the combined single-Studio variant). Tokens are never logged.

export type CoderToolCall = { id?: string; type?: "function"; function: { name: string; arguments: string } };
export type CoderMessage =
  | { role: "system" | "user"; content: string }
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
  error?: string;
};
export type CoderOutcome = { reply: CoderReply | null; failure?: "off" | "timeout" | "http" | "network" | "unreadable" };

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

export async function coderCall(api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CoderOutcome> {
  const bases = coderStudioUrls();
  if (!bases.length) return { reply: null, failure: "off" };
  if (typeof payload.job_id === "string") {
    // a job lives on one Studio
    const { idx, id } = splitJob(payload.job_id);
    const o = await callOne(bases[idx] || bases[0], api, { ...payload, job_id: id }, timeoutMs);
    return idx ? tagJob(o, idx) : o;
  }
  // a new call: first healthy Studio, failing over to the replicas (connection trouble only; a model error is an answer)
  const now = Date.now();
  const order = bases.map((b, i) => ({ b, i })).sort((x, y) => Number((studioCooling.get(x.b) || 0) > now) - Number((studioCooling.get(y.b) || 0) > now));
  let last: CoderOutcome = { reply: null, failure: "network" };
  const per = bases.length > 1 ? Math.max(8000, Math.floor(timeoutMs / Math.min(2, bases.length))) : timeoutMs;
  for (const { b, i } of order.slice(0, 2)) {
    last = await callOne(b, api, payload, per);
    if (last.reply) {
      studioCooling.delete(b);
      return i ? tagJob(last, i) : last;
    }
    studioCooling.set(b, Date.now() + COOL_MS);
  }
  return last;
}
function tagJob(o: CoderOutcome, idx: number): CoderOutcome {
  return o.reply?.job ? { ...o, reply: { ...o.reply, job: `s${idx}~${o.reply.job}` } } : o;
}

async function callOne(base: string, api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<CoderOutcome> {
  const name = apiName(api);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = coderToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const deadline = Date.now() + timeoutMs;
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${name}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!sub.ok) return { reply: null, failure: "http" };
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return { reply: null, failure: "http" };
    const res = await fetch(`${base}/gradio_api/call/${name}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (!res.ok) return { reply: null, failure: "http" };
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
  opts: { tools?: CoderTool[]; maxTokens?: number; think?: boolean; temperature?: number; waitS?: number; timeoutMs?: number } = {},
): Promise<CoderOutcome> {
  const waitS = opts.waitS ?? 20;
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
  );
}

export function coderJobResult(job: string, offset = 0, timeoutMs = 10000): Promise<CoderOutcome> {
  return coderCall("job_result", { job_id: job, offset }, timeoutMs);
}
export function coderCancel(job: string, timeoutMs = 8000): Promise<CoderOutcome> {
  return coderCall("cancel", { job_id: job }, timeoutMs);
}
export async function coderStatus(timeoutMs = 10000): Promise<Record<string, unknown> | null> {
  const o = await coderCall("status", {}, timeoutMs);
  return (o.reply as unknown as Record<string, unknown>) || null;
}

export function coderFailureText(o: CoderOutcome): string {
  if (o.failure === "off") return "قسم المبرمج غير مفعّل بعد (لم يُضبط عنوان الخادم).";
  if (o.failure === "timeout") return "⌛ خادم المبرمج لم يرد في الوقت المتاح. أعد المحاولة بعد قليل.";
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
