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
export type ShamReply = {
  type: "text" | "image" | "audio" | "video" | "notice" | "busy" | "loading" | "pending" | "gone";
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

async function shamCallOnce(api: string, payload: Record<string, unknown>, timeoutMs: number): Promise<ShamOutcome> {
  if (!shamStudioEnabled()) return { reply: null, failure: "off" };
  const base = (process.env.SHAM_MODELSCOPE_URL || DEFAULT_URL).replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${(process.env.MODELSCOPE_API_TOKEN || "").trim()}`, "Content-Type": "application/json" };
  const deadline = Date.now() + timeoutMs;
  try {
    const sub = await fetch(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!sub.ok) return { reply: null, failure: "http" };
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return { reply: null, failure: "http" };
    const res = await fetch(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    if (!res.ok) return { reply: null, failure: "http" };
    const reply = parseShamReply(await res.text());
    return reply ? { reply } : { reply: null, failure: "unreadable" };
  } catch (e) {
    const name = (e as { name?: string })?.name || "";
    return { reply: null, failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
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

export function shamJobResult(job: string, detach = false, timeoutMs = 8000): Promise<ShamOutcome> {
  return shamCallOutcome("job_result", { job_id: job, detach: detach ? "1" : "" }, timeoutMs);
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
export const shamReplyTokens = (): number => Number(process.env.SHAM_REPLY_TOKENS) || ((process.env.SHAM_LIMITS || "").trim().toLowerCase() === "open" ? 400 : 80);
