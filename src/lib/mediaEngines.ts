// The owner's read-only picture of "which engine makes which media for which model" and whether each Studio behind it is alive.
// Nova → nova-media-server only. Sham v2 → sham-v2-server (image, speech) + sham-v2-video-server (video) (+ the overflow Studio for chat). Old Sham → its own Studio.
// Owner-only (the caller checks). The probes are the Studios' own `status` call, a few seconds each, all in parallel.
import type { Db } from "@/lib/coderAuth";
import { novaMediaUrl } from "@/lib/novaMedia";
import { DEFAULT_URL, DEFAULT_V2_URL, DEFAULT_V2_VIDEO_URL } from "@/lib/shamStudio";
import { overflowConfigured, overflowVerdict } from "@/lib/shamPool";
import { SHAM_ENGINE_OPTIONS, shamEngine, type ShamEngine, type ShamModelId } from "@/lib/shamMediaEngine";

export type StudioProbe = { id: string; role: { ar: string; en: string }; ok: boolean; phase: string; detail: string };
export type MediaLine = { kind: "image" | "audio" | "video"; ar: string; en: string; studio: string };
export type EngineOption = { id: ShamEngine; ar: string; en: string; hint: { ar: string; en: string } };
export type ModelMedia = {
  id: "coder" | ShamModelId;
  engine: ShamEngine | "nova";
  options: EngineOption[];               // empty = nothing to choose (Nova)
  lines: MediaLine[];
  studios: StudioProbe[];
};

const OPTION_TEXT: Record<ShamEngine, EngineOption> = {
  ready: { id: "ready", ar: "أوزان جاهزة (موصى به)", en: "Ready weights (recommended)", hint: { ar: "نماذج صور وصوت وفيديو جاهزة تعمل محليًا على المعالج داخل استوديوهات شام v2. تخرج وسائط حقيقية.", en: "Ready image, speech and video models running on the CPU inside Sham v2's Studios. Real output." } },
  internal: { id: "internal", ar: "مولّد شام الداخلي (تجريبي)", en: "Sham's own generator (experimental)", hint: { ar: "مولّد شام نفسه. ما زال قيد التدريب فيرفض فاحص الجودة أغلب ما ينتجه. استخدمه للتجربة فقط.", en: "Sham's own generator. Still training: the quality gate refuses most of its output. For testing only." } },
};
const opts = (m: ShamModelId): EngineOption[] => SHAM_ENGINE_OPTIONS[m].map((e) => (e === "internal" && m === "sham" ? { ...OPTION_TEXT.internal, ar: "استوديو شام القديم الأصلي (تجريبي)", en: "Old Sham's own Studio (experimental)" } : OPTION_TEXT[e]));

const hostOf = (u: string) => u.replace(/^https?:\/\/(studio-novaai2026-)?/, "").replace(/\.api-inference\.modelscope\.net.*$/, "");

/** One Studio's own `status` answer (POST call/v2/status, then the event). Never throws. */
export async function probeStudio(base: string, token: string, f: typeof fetch = fetch, ms = 7000): Promise<{ ok: boolean; phase: string; detail: string }> {
  if (!base) return { ok: false, phase: "off", detail: "no address" };
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  try {
    const sub = await f(`${base}/gradio_api/call/v2/status`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(ms) });
    if (!sub.ok) return { ok: false, phase: "down", detail: `HTTP ${sub.status}` };
    const { event_id } = (await sub.json()) as { event_id?: string };
    if (!event_id) return { ok: false, phase: "down", detail: "no event id" };
    const res = await f(`${base}/gradio_api/call/status/${event_id}`, { headers, signal: AbortSignal.timeout(ms) });
    const line = (await res.text()).split("\n").find((l) => l.startsWith("data:")) || "";
    const arr = JSON.parse(line.slice(5).trim()) as unknown[];
    const st = (typeof arr[0] === "string" ? JSON.parse(arr[0]) : arr[0]) as { phase?: string; error?: string; model?: string };
    const phase = String(st?.phase || "unknown");
    return { ok: phase === "ready", phase, detail: String(st?.error || (st?.model ? `model ${st.model}` : "")).slice(0, 120) };
  } catch (e) {
    return { ok: false, phase: "down", detail: String((e as Error)?.message || e).slice(0, 80) };
  }
}

const clean = (u: string | undefined, d: string) => (u || d).split(",")[0].trim().replace(/\/+$/, "");
const ROLE = {
  nova: { ar: "استوديو وسائط نوفا (صورة وصوت وفيديو)", en: "Nova media Studio (image, speech, video)" },
  v2chat: { ar: "استوديو شام v2 (محادثة + صورة + صوت)", en: "Sham v2 Studio (chat + image + speech)" },
  v2video: { ar: "استوديو فيديو شام v2", en: "Sham v2 video Studio" },
  v2over: { ar: "استوديو شام v2 الاحتياطي (للمحادثة وقت الازدحام)", en: "Sham v2 overflow Studio (chat when busy)" },
  v1: { ar: "استوديو شام القديم", en: "Old Sham Studio" },
};

export async function mediaEngineStatus(db?: Db, f: typeof fetch = fetch): Promise<{ models: ModelMedia[]; checkedAt: string }> {
  const msToken = (process.env.MODELSCOPE_API_TOKEN || "").trim();
  const novaToken = (process.env.OPEN_CODER_STUDIO_TOKEN || msToken).trim();
  const novaUrl = novaMediaUrl();
  const v2 = clean(process.env.SHAM_V2_URL, DEFAULT_V2_URL), v2v = clean(process.env.SHAM_V2_VIDEO_URL, DEFAULT_V2_VIDEO_URL), v1 = clean(process.env.SHAM_MODELSCOPE_URL, DEFAULT_URL);
  const over = overflowConfigured();
  const [pNova, pV2, pV2v, pV1] = await Promise.all([probeStudio(novaUrl, novaToken, f), probeStudio(v2, msToken, f), probeStudio(v2v, msToken, f), probeStudio(v1, msToken, f)]);
  const S = (id: string, role: { ar: string; en: string }, p: { ok: boolean; phase: string; detail: string }): StudioProbe => ({ id, role, ...p });
  const ov = overflowVerdict();
  const overflow: StudioProbe[] = over ? [S(hostOf(over), ROLE.v2over, { ok: ov.ok, phase: ov.ok ? "ready" : "unverified", detail: ov.ok ? "" : ov.why })] : [];
  const e2 = await shamEngine("sham_v2", db), e1 = await shamEngine("sham", db);
  const v2lines = (e: ShamEngine): MediaLine[] => e === "ready"
    ? [{ kind: "image", ar: "صورة: أوزان جاهزة (SDXS) على المعالج", en: "Image: ready weights (SDXS) on CPU", studio: hostOf(v2) }, { kind: "audio", ar: "صوت: أوزان جاهزة (Piper) على المعالج", en: "Speech: ready weights (Piper) on CPU", studio: hostOf(v2) }, { kind: "video", ar: "فيديو: نموذج فيديو حقيقي على المعالج", en: "Video: a real text-to-video model on CPU", studio: hostOf(v2v) }]
    : [{ kind: "image", ar: "صورة: مولّد شام الداخلي", en: "Image: Sham's own generator", studio: hostOf(v2) }, { kind: "audio", ar: "صوت: مولّد شام الداخلي", en: "Speech: Sham's own generator", studio: hostOf(v2) }, { kind: "video", ar: "فيديو: مولّد شام الداخلي", en: "Video: Sham's own generator", studio: hostOf(v2) }];
  return {
    checkedAt: new Date().toISOString(),
    models: [
      { id: "coder", engine: "nova", options: [], studios: [S(novaUrl ? hostOf(novaUrl) : "nova-media-server", ROLE.nova, novaUrl ? pNova : { ok: false, phase: "off", detail: "NOVA_MEDIA_STUDIO_URL=off" })],
        lines: [{ kind: "image", ar: "صورة: SDXS على المعالج", en: "Image: SDXS on CPU", studio: "nova-media-server" }, { kind: "audio", ar: "صوت عربي: Piper على المعالج", en: "Arabic speech: Piper on CPU", studio: "nova-media-server" }, { kind: "video", ar: "فيديو: نموذج فيديو حقيقي على المعالج", en: "Video: a real text-to-video model on CPU", studio: "nova-media-server" }] },
      { id: "sham_v2", engine: e2, options: opts("sham_v2"), lines: v2lines(e2), studios: [S(hostOf(v2), ROLE.v2chat, pV2), S(hostOf(v2v), ROLE.v2video, pV2v), ...overflow] },
      { id: "sham", engine: e1, options: opts("sham"), lines: [{ kind: "image", ar: "صورة: مولّد شام القديم الداخلي", en: "Image: old Sham's own generator", studio: hostOf(v1) }, { kind: "audio", ar: "صوت: مولّد شام القديم الداخلي", en: "Speech: old Sham's own generator", studio: hostOf(v1) }, { kind: "video", ar: "فيديو: مولّد شام القديم الداخلي", en: "Video: old Sham's own generator", studio: hostOf(v1) }],
        studios: [S(hostOf(v1), ROLE.v1, pV1)] },
    ],
  };
}
