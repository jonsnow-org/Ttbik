import type { Db } from "@/lib/coderAuth";
import { createDonorToolBridge } from "@/lib/donorToolBridge";

export type DonorTestId = "qwen35-9b" | "gemma4-e4b" | "minicpmo45";
export type DonorHistoryMessage = { role: "user" | "assistant"; content: string };
export type DonorTestMedia = {
  kind: "image" | "audio" | "video";
  dataUrl: string;
  format: string;
};
export type DonorTestStatus = {
  id: DonorTestId;
  phase: "ready" | "loading" | "error" | "deploying" | "not_created" | "unavailable" | "unconfigured";
  studio: "running" | "deploying" | "not_created" | "unknown";
  detail?: string;
  media_capabilities?: { vision: boolean; audio: boolean; video: boolean };
};

export const DONOR_TESTS = [
  {
    id: "qwen35-9b",
    studio: "sham-donor-qwen35-9b-test",
    name: { ar: "Qwen3.5-9B", en: "Qwen3.5-9B" },
    desc: { ar: "اختبار مباشر داخل محادثة البوت · مسار معزول", en: "Isolated Qwen candidate · Telegram bot route" },
  },
  {
    id: "gemma4-e4b",
    studio: "sham-donor-gemma4-e4b-test",
    name: { ar: "Gemma 4 E4B", en: "Gemma 4 E4B" },
    desc: { ar: "اختبار مباشر داخل محادثة البوت · مسار معزول", en: "Isolated Gemma candidate · Telegram bot route" },
  },
  {
    id: "minicpmo45",
    studio: "sham-donor-minicpmo45-test",
    name: { ar: "MiniCPM-o 4.5", en: "MiniCPM-o 4.5" },
    desc: { ar: "مرشح متعدد الوسائط · مرفقات تيليغرام حسب قدرات المشغّل", en: "Multimodal candidate · Telegram media according to runtime capabilities" },
  },
] as const;

export const isDonorTestId = (id: string): id is DonorTestId =>
  DONOR_TESTS.some((x) => x.id === id);

export const donorTestOptions = (selected?: string) => DONOR_TESTS.map((x) => ({
  id: x.id,
  name: x.name,
  desc: x.desc,
  selected: x.id === selected,
}));

const OWNER = "novaai2026";
const EXPECTED_DONOR_APP_REVISION = "donor-bakeoff-2026-10-30-r7";
const MS = "https://www.modelscope.cn";
const tokenOf = () => (process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_TOKEN || "").trim();
const configOf = (id: string) => {
  const value = DONOR_TESTS.find((x) => x.id === id);
  if (!value) throw new Error("مرشح الاختبار غير معروف.");
  return value;
};
const apiOf = (config: (typeof DONOR_TESTS)[number]) =>
  "https://studio-" + OWNER + "-" + config.studio + ".api-inference.modelscope.net";
const authHeaders = (token: string) => ({ Authorization: "Bearer " + token, "Content-Type": "application/json" });

async function readSseResult(response: Response): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let consumed = 0;
  try {
    while (consumed < 2_000_000) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      consumed += part.value.length;
      while (true) {
        const match = /\r?\n\r?\n/.exec(buffer);
        if (!match || match.index === undefined) break;
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (/(^|\r?\n)event:\s*complete(\r?\n|$)/.test(frame)) return frame;
        if (/(^|\r?\n)event:\s*error(\r?\n|$)/.test(frame)) {
          throw new Error("أعاد استديو المرشح خطأ أثناء تنفيذ الطلب.");
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new Error("انتهت مهلة انتظار الرد المكتمل من استديو المرشح.");
}

function parseSseData(raw: string): unknown {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const parsed = JSON.parse(line.slice(5).trim());
      const value = Array.isArray(parsed) ? parsed[0] : parsed;
      if (typeof value === "string") {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;
    } catch { /* ignore non-JSON heartbeat lines */ }
  }
  throw new Error("لم يصل محتوى صالح من استديو المرشح.");
}

async function callGradio(
  config: (typeof DONOR_TESTS)[number],
  apiName: string,
  data: unknown[],
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const token = tokenOf();
  if (!token) throw new Error("رمز ModelScope غير مضبوط على الخادم.");
  const base = apiOf(config);
  const start = await fetchImpl(base + "/gradio_api/call/" + apiName, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ data }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!start.ok) {
    const detail = (await start.text().catch(() => "")).slice(0, 300);
    throw new Error("استديو " + config.name.ar + ": HTTP " + start.status + (detail ? " · " + detail : ""));
  }
  const started = await start.json().catch(() => ({})) as { event_id?: string };
  if (!started.event_id) throw new Error("استديو المرشح لم يُرجع معرّف الطلب.");
  const result = await fetchImpl(base + "/gradio_api/call/" + apiName + "/" + encodeURIComponent(started.event_id), {
    headers: authHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!result.ok) {
    const detail = (await result.text().catch(() => "")).slice(0, 300);
    throw new Error("تعذّر استلام رد المرشح · HTTP " + result.status + (detail ? " · " + detail : ""));
  }
  return parseSseData(await readSseResult(result));
}

function asObject(value: unknown): Record<string, any> {
  if (Array.isArray(value)) value = value[0];
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return { text: value }; }
  }
  if (!value || typeof value !== "object") throw new Error("رد النموذج غير صالح.");
  return value as Record<string, any>;
}

export async function donorTestChat(
  id: string,
  prompt: string,
  history: DonorHistoryMessage[],
  media?: DonorTestMedia,
  fetchImpl: typeof fetch = globalThis.fetch,
  context?: { chatId: number; db: Db },
): Promise<{
  text: string;
  tool_calls: { name?: string; arguments?: unknown }[];
  executed_tools: { name?: string; arguments?: unknown; result?: unknown }[];
  seconds?: number;
  tokens_per_second?: number;
}> {
  const config = configOf(id);
  const toolBridge = context ? await createDonorToolBridge(context.chatId, id, context.db) : undefined;
  const prior = (Array.isArray(history) ? history : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  // Candidate-native prompt/history only. No Nova/Sham agent, system prompt, memory, connector credentials or fallback.
  // All traffic, including plain text, uses the candidate's own Studio payload endpoint.
  // The short-lived bridge ticket exposes only connected-service tool schemas; provider tokens never leave this app server.
  const raw = await callGradio(config, "chat_payload", [JSON.stringify({
    prompt: prompt.slice(0, 12000),
    history: prior,
    use_tools: true,
    media: media || null,
    tool_bridge: toolBridge || null,
  })], 240_000, fetchImpl);
  const result = asObject(raw);
  if (result.error) throw new Error(String(result.error).slice(0, 700));
  return {
    text: String(result.text || ""),
    tool_calls: Array.isArray(result.tool_calls) ? result.tool_calls : [],
    executed_tools: Array.isArray(result.executed_tools) ? result.executed_tools : [],
    seconds: Number.isFinite(Number(result.seconds)) ? Number(result.seconds) : undefined,
    tokens_per_second: Number.isFinite(Number(result.tokens_per_second)) ? Number(result.tokens_per_second) : undefined,
  };
}
async function callGradioDirect(
  config: (typeof DONOR_TESTS)[number],
  apiName: string,
  data: unknown[],
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const token = tokenOf();
  if (!token) throw new Error("رمز ModelScope غير مضبوط على الخادم.");
  const response = await fetchImpl(apiOf(config) + "/gradio_api/run/" + apiName, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ data }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error("استديو " + config.name.ar + ": HTTP " + response.status + (detail ? " · " + detail : ""));
  }
  return response.json();
}

function parseStatus(value: unknown): Record<string, any> | null {
  if (Array.isArray(value)) value = value[0];
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

async function probeOne(config: (typeof DONOR_TESTS)[number], fetchImpl: typeof fetch): Promise<DonorTestStatus> {
  const token = tokenOf();
  if (!token) return { id: config.id, phase: "unconfigured", studio: "unknown" };
  try {
    const lookup = await fetchImpl(MS + "/openapi/v1/studios/" + OWNER + "/" + config.studio, {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (lookup.status === 404) return { id: config.id, phase: "not_created", studio: "not_created" };
    if (!lookup.ok) return { id: config.id, phase: "unavailable", studio: "unknown", detail: "ModelScope HTTP " + lookup.status };
    const body = await lookup.json().catch(() => ({})) as Record<string, any>;
    const data = body.data || body.Data || body;
    const runtime = data.runtime || {};
    const runtimeState = String(runtime.status || data.status || "").toLowerCase();
    if (!["running", "ready"].includes(runtimeState)) {
      return {
        id: config.id,
        phase: runtimeState.includes("fail") || runtimeState.includes("error") ? "error" : "deploying",
        studio: "deploying",
        detail: runtimeState || "استديو غير جاهز بعد",
      };
    }
    const direct = asObject(await callGradioDirect(config, "status", [], 20_000, fetchImpl));
    const statusValue = parseStatus(Array.isArray(direct.data) ? direct.data[0] : direct.data ?? direct);
    const phase = String(statusValue?.phase || "unavailable").toLowerCase();
    const appRevision = String(statusValue?.app_revision || "");
    if (phase === "ready" && appRevision !== EXPECTED_DONOR_APP_REVISION) {
      return {
        id: config.id,
        phase: "deploying",
        studio: "deploying",
        detail: "يجري تحديث مشغّل المرشح قبل إتاحته للاختبار المباشر.",
      };
    }
    const caps = statusValue?.media_capabilities;
    return {
      id: config.id,
      phase: phase === "ready" ? "ready" : phase === "loading" ? "loading" : phase === "error" ? "error" : "unavailable",
      studio: "running",
      ...(caps && typeof caps === "object" ? {
        media_capabilities: {
          vision: caps.vision === true,
          audio: caps.audio === true,
          video: caps.video === true,
        },
      } : {}),
      ...(statusValue?.error ? { detail: String(statusValue.error).slice(0, 220) } : {}),
    };
  } catch (error) {
    return { id: config.id, phase: "unavailable", studio: "unknown", detail: String((error as Error)?.message || error).slice(0, 220) };
  }
}

export async function probeDonorTestStudio(id: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<DonorTestStatus> {
  return probeOne(configOf(id), fetchImpl);
}

export async function probeDonorTestStudios(fetchImpl: typeof fetch = globalThis.fetch): Promise<DonorTestStatus[]> {
  return Promise.all(DONOR_TESTS.map((config) => probeOne(config, fetchImpl)));
}
