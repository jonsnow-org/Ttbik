// The free headless browser and all computer tools run only on the reserved private 16 GB computer Studio.
// The execution host is shared, but each user+model gets a distinct BrowserContext, cookies and persistent directory.
export const DEFAULT_COMPUTER_STUDIO_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net";
import { COMPUTER_MODEL_IDS } from "@/lib/computerModels";

const COMPUTER_MODELS = new Set<string>(COMPUTER_MODEL_IDS);

export type BrowserArgs = {
  action?: string; url?: string; id?: number | string; x?: number; y?: number; text?: string; enter?: boolean; key?: string; dy?: number; seconds?: number; screenshot?: boolean; tab?: number; path?: string;
};

const ACTIONS = new Set(["open", "look", "click", "type", "press", "scroll", "back", "wait", "aria", "tabs", "new_tab", "switch_tab", "close_tab", "upload", "download", "console", "network"]);

/** All supported models use the dedicated computer-only hub Studio.
 * The user+model session key still isolates each model's files, browser cookies and desktop. */
export function browserStudioFor(modelId: string | undefined): string | null {
  if (!modelId || !COMPUTER_MODELS.has(modelId)) return null;
  const configured = (process.env.COMPUTER_STUDIO_URL || "").trim();
  if (/^(off|none|0)$/i.test(configured)) return null;
  return (configured || DEFAULT_COMPUTER_STUDIO_URL).replace(/\/+$/, "");
}

export function studioToken(): string {
  return (process.env.OPEN_CODER_STUDIO_TOKEN || process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_TOKEN || "").trim();
}

/** Exactly the fields the Studio understands, bounded; anything else is dropped. */
export function cleanBrowserArgs(a: BrowserArgs): Record<string, unknown> | null {
  const action = String(a.action || "").toLowerCase();
  if (!ACTIONS.has(action)) return null;
  const out: Record<string, unknown> = { action };
  if (a.url !== undefined) out.url = String(a.url).slice(0, 2000);
  if (a.id !== undefined && Number.isFinite(Number(a.id))) out.id = Math.trunc(Number(a.id));
  if (Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.y)) && a.x !== undefined && a.y !== undefined) { out.x = Math.trunc(Number(a.x)); out.y = Math.trunc(Number(a.y)); }
  if (a.text !== undefined) out.text = String(a.text).slice(0, 2000);
  if (a.enter) out.enter = true;
  if (a.key !== undefined) out.key = String(a.key).slice(0, 30);
  if (a.dy !== undefined && Number.isFinite(Number(a.dy))) out.dy = Math.max(-4000, Math.min(4000, Math.trunc(Number(a.dy))));
  if (a.seconds !== undefined && Number.isFinite(Number(a.seconds))) out.seconds = Math.max(1, Math.min(20, Math.trunc(Number(a.seconds))));
  if (a.tab !== undefined && Number.isFinite(Number(a.tab))) out.tab = Math.max(0, Math.min(20, Math.trunc(Number(a.tab))));
  if (a.path !== undefined) {
    const path = String(a.path).replace(/\\/g, "/");
    if (path.split("/").some((part) => part === "..") || path.includes("\0")) return null;
    out.path = path.slice(0, 500);
  }
  return out;
}

/** What the model reads: address, title, the page text, then the numbered things it can click or type into. */
export function renderBrowserReply(r: Record<string, any>): string {
  if (!r || r.ok === false) return "error: " + String(r?.error || "the browser did not answer").slice(0, 300);
  const parts = [
    "URL: " + String(r.url || "") + (r.resumed ? "   (your earlier session was restored: same cookies, same page)" : ""),
    "TITLE: " + String(r.title || ""),
    "",
    "PAGE TEXT:",
    String(r.text || "(empty)"),
    "",
    "CLICKABLE ELEMENTS (use their number with action=click or action=type):",
    String(r.elements || "(none)"),
  ];
  // drawn areas (canvas / video / svg / iframes) have no text: tell the model where they are so it can click by x,y or ask for the outline
  if (r.visual) parts.push("", "DRAWN AREAS WITHOUT READABLE TEXT (click them with x,y, or call action=aria for the page outline):", String(r.visual));
  if (r.outline) parts.push("", "PAGE OUTLINE (roles and names):", String(r.outline));
  if (Array.isArray(r.tabs)) parts.push("", "OPEN TABS:", r.tabs.map((t: any) => `[${t.index}]${t.active ? " *" : ""} ${t.title} — ${t.url}`).join("\n"));
  if (r.download) parts.push("", `DOWNLOADED: ${r.download.path} (${r.download.bytes} bytes)`);
  if (Array.isArray(r.console) && r.console.length) parts.push("", "JAVASCRIPT CONSOLE:", r.console.join("\n"));
  if (Array.isArray(r.network_errors) && r.network_errors.length) parts.push("", "NETWORK FAILURES:", r.network_errors.join("\n"));
  return parts.join("\n");
}

export async function readComplete(res: Response): Promise<unknown> {
  const body = await res.text();
  for (const block of body.split(/\r?\n\r?\n/)) {
    if (/event:\s*error/.test(block)) throw new Error("the browser Studio returned an error");
    if (!/event:\s*complete/.test(block)) continue;
    const line = block.split(/\r?\n/).find((l) => l.startsWith("data:"));
    if (!line) continue;
    const first = JSON.parse(line.slice(5).trim());
    const value = Array.isArray(first) ? first[0] : first;
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  throw new Error("the browser Studio sent no answer");
}

export async function browserDo(modelId: string | undefined, session: string, args: BrowserArgs, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const base = browserStudioFor(modelId);
  if (!base) return "error: this model has no browser Studio";
  const clean = cleanBrowserArgs(args);
  if (!clean) return "error: action must be one of open, look, click, type, press, scroll, back, wait, aria";
  try {
    // Use the same authenticated b64 envelope and bounded gateway retry path as
    // desktop_do and box_do. This keeps every computer action on one transport.
    const reply = await studioCall(base, "browser_do", { ...clean, session }, fetchImpl, 100_000);
    return renderBrowserReply(reply);
  } catch (error) {
    return "error: " + String((error as Error)?.message || error).slice(0, 360);
  }
}

function safeStudioBody(raw: string): string {
  if (!raw) return "";
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const parts = ["code", "error", "detail", "message", "request_id", "requestId"]
      .map((key) => value[key])
      .filter((item) => typeof item === "string" || typeof item === "number")
      .map((item) => String(item));
    if (parts.length) raw = parts.join(" | ");
  } catch {
    // A gateway may return an HTML error page; strip markup before displaying a short hint.
  }
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bms-[A-Za-z0-9_-]{12,}\b/g, "ms-[redacted]")
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

async function studioHttpError(response: Response, api: string, stage: string): Promise<string> {
  const requestId = response.headers.get("x-request-id") || response.headers.get("x-requestid")
    || response.headers.get("cf-ray") || response.headers.get("x-trace-id") || "";
  const detail = safeStudioBody(await response.text().catch(() => ""));
  const statusLabel = response.status === 412 ? " (precondition failed)" : "";
  return "Studio HTTP " + response.status + statusLabel + " at " + api + " " + stage
    + (detail ? ": " + detail : "")
    + (requestId ? " [request " + requestId.slice(0, 80) + "]" : "");
}

function isTransientStudio412(detail: string, retryAfter: string | null): boolean {
  return Boolean(retryAfter) || /deploy(?:ing|ment)|starting|warming(?: up)?|temporarily unavailable|runtime not ready|studio not ready/i.test(detail);
}

/** One call of a Studio's hidden Gradio API (`/gradio_api/call/<api>`): start, then read the complete event. Shared by the browser and the computer box. */
async function studioCallPlain(base: string, api: string, wire: string, headers: Record<string, string>, fetchImpl: typeof fetch, readMs: number): Promise<Record<string, any>> {
  const start = await fetchImpl(`${base}/gradio_api/call/${api}`, { method: "POST", headers, cache: "no-store", signal: AbortSignal.timeout(20_000), body: JSON.stringify({ data: [wire] }) });
  if (!start.ok) throw new Error(await studioHttpError(start, api, "submit"));
  const { event_id } = (await start.json()) as { event_id?: string };
  if (!event_id) throw new Error("the Studio gave no request id");
  const done = await fetchImpl(`${base}/gradio_api/call/${api}/${encodeURIComponent(event_id)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(readMs) });
  if (!done.ok) throw new Error(await studioHttpError(done, api, "result"));
  return (await readComplete(done)) as Record<string, any>;
}
export async function studioCall(base: string, api: string, payload: Record<string, unknown>, fetchImpl: typeof fetch = globalThis.fetch, readMs = 100_000): Promise<Record<string, any>> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(studioToken() ? { Authorization: "Bearer " + studioToken() } : {}) };
  // The Studio gateway's request filter answers 403 to some command text (`echo a; echo b`): the computer / browser jobs travel as base64 (the Studio decodes "b64:"). An older Studio answers "bad request": send it plain then.
  const encode = api === "box_do" || api === "browser_do" || api === "desktop_do";
  let wire = encode ? "b64:" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64") : JSON.stringify(payload);
  const submit = () => fetchImpl(`${base}/gradio_api/call/${api}`, { method: "POST", headers, cache: "no-store", signal: AbortSignal.timeout(20_000), body: JSON.stringify({ data: [wire] }) });
  // Retry transient gateway responses. HTTP 412 is not retried blindly:
  // it is retried only when the response identifies an in-progress deploy/start,
  // or explicitly supplies Retry-After. Other precondition failures surface.
  let start = await submit();
  for (let i = 0; !start.ok && i < 3; i++) {
    const transientGateway = [403, 429, 502, 503, 504].includes(start.status);
    const detail412 = start.status === 412 ? safeStudioBody(await start.clone().text().catch(() => "")) : "";
    const transient412 = start.status === 412 && isTransientStudio412(detail412, start.headers.get("retry-after"));
    if (!transientGateway && !transient412) break;
    await new Promise((r) => setTimeout(r, process.env.NODE_ENV === "test" ? 0 : 1500 * (i + 1)));
    start = await submit();
  }
  if (!start.ok) throw new Error(await studioHttpError(start, api, "submit"));
  const { event_id } = (await start.json()) as { event_id?: string };
  if (!event_id) throw new Error("the Studio gave no request id");
  const done = await fetchImpl(`${base}/gradio_api/call/${api}/${encodeURIComponent(event_id)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(readMs) });
  if (!done.ok) throw new Error("Studio HTTP " + done.status);
  const reply = (await readComplete(done)) as Record<string, any>;
  if (encode && wire.startsWith("b64:") && reply && reply.ok === false && reply.error === "bad request") {
    wire = JSON.stringify(payload);                      // an older Studio that does not decode b64 yet
    return studioCallPlain(base, api, wire, headers, fetchImpl, readMs);
  }
  return reply;
}

const TRANSIENT_LIVE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

async function liveStreamFetch(
  url: string,
  makeInit: () => RequestInit,
  api: string,
  stage: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, makeInit());
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === "test" ? 0 : 300 * (attempt + 1)));
      continue;
    }
    if (response.ok) return response;
    const detail = await studioHttpError(response, api, stage);
    if (!TRANSIENT_LIVE_HTTP_STATUSES.has(response.status) || attempt === 2) throw new Error(detail);
    lastError = new Error(detail);
    await new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === "test" ? 0 : 300 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("the live computer stream could not connect");
}

/** Open a bounded Gradio event stream (used by the graphical computer's live screen). */
export async function studioStream(
  base: string,
  api: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = globalThis.fetch,
  readMs = 40_000,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(studioToken() ? { Authorization: "Bearer " + studioToken() } : {}) };
  const wire = "b64:" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  // The live endpoint only streams frames/activity; retrying its submit after a
  // transient gateway error cannot repeat a desktop input or mutate the session.
  const start = await liveStreamFetch(
    base + "/gradio_api/call/" + api,
    () => ({
      method: "POST", headers, cache: "no-store", signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ data: [wire] }),
    }),
    api, "submit", fetchImpl,
  );
  const { event_id } = (await start.json()) as { event_id?: string };
  if (!event_id) throw new Error("the Studio gave no live-stream request id");
  const stream = await liveStreamFetch(
    base + "/gradio_api/call/" + api + "/" + encodeURIComponent(event_id),
    () => ({
      headers, cache: "no-store", signal: AbortSignal.timeout(Math.max(5_000, Math.min(45_000, readMs))),
    }),
    api, "stream", fetchImpl,
  );
  if (!stream.body) throw new Error("the Studio returned an empty live stream");
  return stream;
}
