// The model's free headless browser (ai-system/modelscope-media/browser_computer.py): real pages with JavaScript, clicking and typing, without Daytona's paid desktop.
// It runs inside the model's OWN media Studio, so nothing is shared with another model: Nova uses Nova's media Studio, each candidate its own sham-donor-<id>-media.
// A session is one user of one model (`session` is derived by the caller from the verified account and the model; the Studio hashes it into a folder name).
import { candidateMediaStudio } from "@/lib/photoWeightMedia";
import { novaMediaUrl } from "@/lib/novaMedia";

export type BrowserArgs = {
  action?: string; url?: string; id?: number | string; x?: number; y?: number; text?: string; enter?: boolean; key?: string; dy?: number; seconds?: number; screenshot?: boolean;
};

const ACTIONS = new Set(["open", "look", "click", "type", "press", "scroll", "back", "wait", "aria"]);

/** The browser lives in the media Studio of the model itself; models without such a Studio have no browser (null). */
export function browserStudioFor(modelId: string | undefined): string | null {
  if (modelId === "coder") return novaMediaUrl() || null;
  return candidateMediaStudio(modelId)?.base || null;
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
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(studioToken() ? { Authorization: "Bearer " + studioToken() } : {}) };
  try {
    const start = await fetchImpl(base + "/gradio_api/call/browser_do", {
      method: "POST", headers, cache: "no-store", signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ data: [JSON.stringify({ ...clean, session })] }),
    });
    if (!start.ok) return "error: browser Studio HTTP " + start.status;
    const { event_id } = (await start.json()) as { event_id?: string };
    if (!event_id) return "error: the browser Studio gave no request id";
    const done = await fetchImpl(base + "/gradio_api/call/browser_do/" + encodeURIComponent(event_id), { headers, cache: "no-store", signal: AbortSignal.timeout(100_000) });
    if (!done.ok) return "error: browser Studio HTTP " + done.status;
    return renderBrowserReply((await readComplete(done)) as Record<string, any>);
  } catch (error) {
    return "error: " + String((error as Error)?.message || error).slice(0, 240);
  }
}

/** One call of a Studio's hidden Gradio API (`/gradio_api/call/<api>`): start, then read the complete event. Shared by the browser and the computer box. */
export async function studioCall(base: string, api: string, payload: Record<string, unknown>, fetchImpl: typeof fetch = globalThis.fetch, readMs = 100_000): Promise<Record<string, any>> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(studioToken() ? { Authorization: "Bearer " + studioToken() } : {}) };
  const submit = () => fetchImpl(`${base}/gradio_api/call/${api}`, { method: "POST", headers, cache: "no-store", signal: AbortSignal.timeout(20_000), body: JSON.stringify({ data: [JSON.stringify(payload)] }) });
  // the Studio gateway answers 403/429/502-504 now and then even when the Studio is healthy: ask again a few times before giving up
  let start = await submit();
  for (let i = 0; !start.ok && [403, 429, 502, 503, 504].includes(start.status) && i < 3; i++) {
    await new Promise((r) => setTimeout(r, process.env.NODE_ENV === "test" ? 0 : 1500 * (i + 1)));
    start = await submit();
  }
  if (!start.ok) throw new Error("Studio HTTP " + start.status);
  const { event_id } = (await start.json()) as { event_id?: string };
  if (!event_id) throw new Error("the Studio gave no request id");
  const done = await fetchImpl(`${base}/gradio_api/call/${api}/${encodeURIComponent(event_id)}`, { headers, cache: "no-store", signal: AbortSignal.timeout(readMs) });
  if (!done.ok) throw new Error("Studio HTTP " + done.status);
  return (await readComplete(done)) as Record<string, any>;
}
