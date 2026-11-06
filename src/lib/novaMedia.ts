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

/** Media Studio SSE can stay open after the first completed result; return on that data line instead of waiting for EOF. */
export async function readMediaSse(response: Response): Promise<MediaReply | null> {
  const reader = response.body?.getReader();
  if (!reader) return parseMediaSse(await response.text());

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
        const parsed = parseMediaSse(line + "\n");
        if (parsed !== null) {
          await reader.cancel().catch(() => undefined);
          return parsed;
        }
        newline = buffered.indexOf("\n");
      }

      if (done) return buffered ? parseMediaSse(buffered + "\n") : null;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* stream may already be closed */ }
  }
}

/** How long a clip may take on the free CPU Studio: each 4 s pass loads the pipeline (~15 s), samples (~130 s) and decodes/encodes; 2 min start-up slack.
 *  Live 2026-11-04: a 6 s clip (two passes) was given 300 s and timed out while the Studio was still working. */
export const videoDeadlineMs = (seconds: number): number => 120000 + Math.ceil(seconds / 4) * 210000;

/** The bot's own ceiling for polling a clip job: it follows the clip's length (videoDeadlineMs) with 10 min of slack, never below
 *  40 min, never above 2 h. A fixed 40 min aborted a 60 s clip (~55 min of passes) that was still generating. */
export const videoJobCapMs = (seconds: number): number => Math.min(2 * 3600_000, Math.max(40 * 60000, videoDeadlineMs(seconds) + 10 * 60000));

/** kind image | audio | video. A video is ONE prompt (+ seconds) given to the Studio's text-to-video model; `scenes` / `narration` are accepted for old callers but never become stills.
 *  Every picture / sound / clip that comes back is vetted (src/lib/mediaQuality.ts): a blank or empty result is returned as a typed error, never as media. */
export async function novaMakeMedia(
  kind: "image" | "audio" | "video",
  prompt: string,
  opts: { scenes?: unknown; narration?: unknown; seconds?: number; timeoutMs?: number; fetchImpl?: typeof fetch; attempts?: number; onWait?: (attempt: number) => void; base?: string; bypassContentHeuristics?: boolean } = {},
): Promise<MediaReply | null> {
  // a picture the gate refuses (black / constant / noise) is retried with a different seed on the same Studio before an honest error is returned
  const attempts = Math.max(1, Math.min(3, opts.attempts ?? (kind === "image" ? 3 : 1)));
  const requestedSeconds = kind === "video" ? Number(opts.seconds ?? pressureMedia().videoSeconds) : undefined;
  const videoSeconds = requestedSeconds;
  if (kind === "video" && ![6, 10, 15, 30, 60, 120].includes(videoSeconds as number)) {
    return { type: "error", reason: "unsupported_duration", text: "اختر مدة فيديو مدعومة: 6 أو 10 أو 15 أو 30 أو 60 أو 120 ثانية." };
  }
  const effectiveOpts = kind === "video"
    ? { ...opts, seconds: videoSeconds, timeoutMs: Math.min(7200000, Math.max(Number(opts.timeoutMs) || 0, 300000, videoDeadlineMs(videoSeconds as number))) }
    : opts;
  let last: MediaReply | null = null;
  const deadline = Date.now() + (effectiveOpts.timeoutMs ?? 240000);
  // every request starts from its own random seed (a fixed seed 0 made every Nova picture and clip share one noise start and look alike); tests keep 0
  const base0 = process.env.NODE_ENV === "test" ? 0 : Math.floor(Math.random() * 2000000000);
  for (let k = 0; k < attempts; k++) {
    const seed = base0 + k;
    last = await novaMakeMediaOnce(kind, prompt, effectiveOpts, seed);
    // a picture / sound is cheap to ask again: when the Studio dropped the job (crashed or restarted mid-way), wait for it and ask once more inside the deadline
    if (kind !== "video" && last?.type === "error" && /^studio_(unreadable|http_50[234])$/.test(String((last as { reason?: string }).reason || "")) && Date.now() + 45000 < deadline) {
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 15000));
      last = await novaMakeMediaOnce(kind, prompt, { ...effectiveOpts, timeoutMs: Math.max(30000, deadline - Date.now()) }, seed + 7);
    }
    // the Studio does ONE job at a time and answers {"type":"busy"} (or "loading" while it starts): the request waits in line and asks again instead of failing
    for (let q = 1; last && (last.type === "busy" || last.type === "loading") && Date.now() + 20000 < deadline && q <= 40; q++) {
      effectiveOpts.onWait?.(q);
      await new Promise((res) => setTimeout(res, process.env.NODE_ENV === "test" ? 0 : 4000 + Math.floor(Math.random() * 3000)));
      last = await novaMakeMediaOnce(kind, prompt, { ...effectiveOpts, timeoutMs: Math.max(30000, deadline - Date.now()) }, seed);
    }
    if (last && (last.type === "busy" || last.type === "loading")) return { type: "error", reason: "busy", text: kind === "image" ? "استوديو الوسائط مشغول بطلبات أخرى ولم يتفرّغ في الوقت المتاح" : "استوديو الوسائط مشغول بطلبات أخرى ولم يتفرّغ في الوقت المتاح" };
    if (!last || last.type !== "error" || !/^(blank_image|noise_image)$/.test(String(last.reason || ""))) return last;
  }
  return last;
}

/** The user reads these (in the chat): Arabic only (owner 2026-11-04: no English in error messages). The machine-readable cause is in `reason`. */
export const MEDIA_ERR = {
  http: (status: number) => status === 502 || status === 503 ? "استوديو الوسائط يُعاد تشغيله الآن ولم يستجب في الوقت المتاح" : status === 429 ? "استوديو الوسائط مزدحم بطلبات كثيرة الآن" : `استوديو الوسائط رد بخطأ (${status})`,
  noJob: "استوديو الوسائط لم يبدأ المهمة",
  unreadable: "انقطع استوديو الوسائط أثناء الإنشاء ولم يصل ناتج صالح",
  timeout: "لم ينتهِ استوديو الوسائط في الوقت المتاح",
  unreachable: "تعذّر الوصول إلى استوديو الوسائط",
};

type CallOut = { reply: MediaReply | null } | { error: MediaReply; status?: number };

/** The auth headers of the media Studio (shared by the one-shot call and the background clip job). */
function mediaHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = (process.env.OPEN_CODER_STUDIO_TOKEN || process.env.MODELSCOPE_API_TOKEN || "").trim();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return headers;
}

/** Starts one clip as the Studio's OWN background job (video_start) and returns its id, so the caller can poll it across short
 *  serverless legs instead of holding one request open for minutes. This is what lets a clip FINISH in the bot (owner 2026-11-05). */
export async function novaVideoStart(
  prompt: string, seconds: number,
  opts: { base?: string; fetchImpl?: typeof fetch; seed?: number } = {},
): Promise<{ job: string } | MediaReply> {
  const base = (opts.base || "").replace(/\/+$/, "") || novaMediaUrl();
  if (!base) return { type: "error", reason: "studio_off", text: MEDIA_ERR.unreachable };
  const f = opts.fetchImpl || fetch;
  const seed = Number.isInteger(opts.seed) ? Number(opts.seed) : Math.floor(Math.random() * 2000000000);
  const start = await gradioCall(base, "video_start", { prompt: String(prompt || "").slice(0, 800), seconds, seed }, mediaHeaders(), f, Date.now() + 120000, 30000, 30000);
  if ("error" in start) return start.status === 404 ? { type: "error", reason: "no_job_api", text: MEDIA_ERR.unreachable } : start.error;
  const s = start.reply as (MediaReply & { job?: string }) | null;
  if (s && s.type === "job" && s.job) return { job: s.job };
  return s || { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
}

/** One poll of a clip job: running/busy/loading = ask again; anything else is the final (vetted) reply. */
export async function novaVideoJob(
  job: string, opts: { base?: string; fetchImpl?: typeof fetch; waitS?: number; bypassContentHeuristics?: boolean } = {},
): Promise<MediaReply> {
  const base = (opts.base || "").replace(/\/+$/, "") || novaMediaUrl();
  const f = opts.fetchImpl || fetch;
  const wait = Math.max(0, Math.min(5, opts.waitS ?? 5));
  const poll = await gradioCall(base, "job", { job, wait }, mediaHeaders(), f, Date.now() + 40000, 30000, (wait + 20) * 1000);
  if ("error" in poll) return poll.error;
  const r = poll.reply;
  if (!r) return { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
  if (r.type === "running" || r.type === "busy" || r.type === "loading") return r;
  if (r.type === "error" && r.reason === "job_lost") return { type: "error", reason: "studio_job_lost", text: MEDIA_ERR.unreadable };
  return ((await vetMedia(r, { bypassContentHeuristics: opts.bypassContentHeuristics })) as MediaReply | null) || { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
}

/** One call of a hidden Gradio API on the Studio: submit (asked again on 429 / 502-504: no job exists yet), then read the one SSE answer. */
async function gradioCall(base: string, api: string, payload: unknown, headers: Record<string, string>, f: typeof fetch, deadline: number, timeoutMs: number, readMs?: number): Promise<CallOut> {
  // a refused submit (the ModelScope gateway answers 429 to a burst, 502-504 while a Studio restarts) created no job yet, so asking again is safe (live 2026-11-04: Nova audio lost to one 429)
  // a 502 / 503 usually means the Studio is restarting (it was out of memory or redeployed): that takes a minute or two, so keep asking well inside the deadline
  const waits = (process.env.NOVA_MEDIA_SUBMIT_WAITS_MS ?? "2000,5000,10000,20000,30000,45000").split(",").map(Number).filter((x) => x >= 0);
  // null means the connection itself dropped (the gateway closed it) rather than a status answer: also a transient miss to ask again.
  const submit = (): Promise<Response | null> => f(`${base}/gradio_api/call/v2/${api}`, { method: "POST", headers, body: JSON.stringify({ body: JSON.stringify(payload) }), signal: AbortSignal.timeout(Math.min(Math.max(1000, deadline - Date.now()), timeoutMs, 30000)) }).catch(() => null);
  let sub = await submit();
  // A refused submit created no job yet, so asking again is safe. The ModelScope gateway answers 429 to a burst and 500/502-504 while an
  // instance is under memory pressure or restarting (the video failures 2026-11-05 were a bare HTTP 500 on the first submit): retry them all,
  // and retry a dropped connection too, so one cut does not throw away a clip.
  for (let k = 0; (sub === null || !sub.ok) && (sub === null || [429, 500, 502, 503, 504].includes(sub.status)) && k < waits.length && Date.now() + waits[k] < deadline; k++) {
    await new Promise((r) => setTimeout(r, process.env.NODE_ENV === "test" ? 0 : waits[k]));
    sub = await submit();
  }
  if (sub === null) return { error: { type: "error", reason: "studio_unreachable", text: MEDIA_ERR.unreachable } };
  if (!sub.ok) return { error: { type: "error", reason: "studio_http_" + sub.status, text: MEDIA_ERR.http(sub.status) }, status: sub.status };
  const { event_id } = (await sub.json()) as { event_id?: string };
  if (!event_id) return { error: { type: "error", reason: "studio_no_job", text: MEDIA_ERR.noJob } };
  const res = await f(`${base}/gradio_api/call/${api}/${event_id}`, { headers, signal: AbortSignal.timeout(Math.max(1000, Math.min(deadline - Date.now(), readMs ?? Infinity))) });
  if (!res.ok) return { error: { type: "error", reason: "studio_http_" + res.status, text: MEDIA_ERR.http(res.status) }, status: res.status };
  return { reply: await readMediaSse(res) };
}

/** A clip takes minutes. One long SSE read through the ModelScope gateway was cut (unreadable / 502), and with no request in flight the Studio stopped giving
 *  the job CPU (run-log 2026-11-04: sampling stuck at 0/4 for 13+ min, then every request 500/502). The Studio now runs the clip in the background
 *  (`video_start`) and `job` is asked back-to-back, each call at most ~20 s. A cut poll is just asked again: the job keeps running on the Studio.
 *  "no_job_api": the Studio predates the job API (the old single call is used). */
async function videoByJob(base: string, payload: unknown, headers: Record<string, string>, f: typeof fetch, deadline: number, bypass?: boolean): Promise<MediaReply | null | "no_job_api"> {
  const start = await gradioCall(base, "video_start", payload, headers, f, deadline, 30000, 30000);
  // Only a missing endpoint (404) means this Studio runs old code. A 500 is an internal video-start failure, not permission to launch the legacy synchronous call.
  if ("error" in start) return start.status === 404 ? "no_job_api" : start.error;
  const s = start.reply as (MediaReply & { job?: string }) | null;
  if (!s) return { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
  if (s.type === "video") return ((await vetMedia(s, { bypassContentHeuristics: bypass })) as MediaReply | null) || { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
  if (s.type !== "job" || !s.job) return s;                                  // busy / loading / error: the caller's queue loop handles it
  const pause = process.env.NODE_ENV === "test" ? 0 : 5000;
  for (let misses = 0; Date.now() < deadline;) {
    const wait = Math.max(0, Math.min(5, Math.floor((deadline - Date.now()) / 1000) - 3));
    const poll: CallOut = await gradioCall(base, "job", { job: s.job, wait }, headers, f, deadline, 30000, (wait + 15) * 1000)
      .catch(() => ({ error: { type: "error", reason: "studio_unreachable", text: MEDIA_ERR.unreachable } }));
    const r = "error" in poll ? null : poll.reply;
    if (r && r.type === "running") { misses = 0; continue; }
    if (r && r.type === "error" && r.reason === "job_lost") return { type: "error", reason: "studio_job_lost", text: MEDIA_ERR.unreadable };
    if (r) return ((await vetMedia(r, { bypassContentHeuristics: bypass })) as MediaReply | null) || { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
    // a cut or refused poll: the clip is still being made on the Studio; ask again (8 misses in a row mean the Studio is really gone)
    if (++misses >= 8) return "error" in poll ? poll.error : { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
    await new Promise((r2) => setTimeout(r2, pause));
  }
  return { type: "error", reason: "studio_timeout", text: MEDIA_ERR.timeout };
}

async function novaMakeMediaOnce(
  kind: "image" | "audio" | "video",
  prompt: string,
  opts: { scenes?: unknown; narration?: unknown; seconds?: number; timeoutMs?: number; fetchImpl?: typeof fetch; base?: string; bypassContentHeuristics?: boolean },
  seed = 0,
): Promise<MediaReply | null> {
  const base = (opts.base || "").replace(/\/+$/, "") || novaMediaUrl();          // a candidate passes ITS OWN media Studio here (never Nova's)
  if (!base) return null;
  const f = opts.fetchImpl || fetch;
  const api = kind === "image" ? "image" : kind === "audio" ? "speech" : "video";
  const scenes = Array.isArray(opts.scenes) ? opts.scenes.map((x) => String(x).slice(0, 300)).filter(Boolean).slice(0, 6) : [];
  const payload =
    kind === "image" ? { prompt: prompt.slice(0, 400), seed, ...(pressureOn() ? { size: pressureMedia().imageSize } : {}) } : kind === "audio" ? { text: prompt.slice(0, 1500) } : { prompt: (prompt.trim() || scenes[0] || "").slice(0, 800), seconds: Number(opts.seconds ?? pressureMedia().videoSeconds), seed };   // modelscope-media/app.py api_video reads "prompt"
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = (process.env.OPEN_CODER_STUDIO_TOKEN || process.env.MODELSCOPE_API_TOKEN || "").trim();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const timeoutMs = opts.timeoutMs ?? 240000;
  const deadline = Date.now() + timeoutMs;
  try {
    if (kind === "video" && !/^(0|off)$/i.test(process.env.NOVA_MEDIA_VIDEO_JOBS || "")) {
      const viaJob = await videoByJob(base, payload, headers, f, deadline, opts.bypassContentHeuristics);
      if (viaJob !== "no_job_api") return viaJob;
    }
    const call = await gradioCall(base, api, payload, headers, f, deadline, timeoutMs);
    if ("error" in call) return call.error;
    return ((await vetMedia(call.reply, { bypassContentHeuristics: opts.bypassContentHeuristics })) as MediaReply | null) || { type: "error", reason: "studio_unreadable", text: MEDIA_ERR.unreadable };
  } catch (e) {
    const n = (e as { name?: string })?.name || "";
    return n === "TimeoutError" || n === "AbortError" ? { type: "error", reason: "studio_timeout", text: MEDIA_ERR.timeout } : { type: "error", reason: "studio_unreachable", text: MEDIA_ERR.unreachable };
  }
}
