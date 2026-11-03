/**
 * ONE place that decides which Studio makes a model's picture / sound / clip (owner 2026-11-04: every model makes all three kinds,
 * each on ITS OWN Studio and weights; nothing silently falls back to another model's generator).
 *   Nova (coder):  image = its photoreal Studio (photoWeightMedia "coder"); speech + video = Nova's media Studio (NOVA_MEDIA_URL).
 *   Candidates:    image = their own photoreal Studio; speech + video = their own sham-donor-<id>-media Studio.
 *   LFM2.5:        image + speech + video = its own lfm25-media-server (SDXS + Piper + video on its own copy of the weights).
 */
import { candidateMediaStudio, makePhotoMedia, photoWeightProfile } from "@/lib/photoWeightMedia";
import { novaMakeMedia, novaMediaUrl, type MediaReply } from "@/lib/novaMedia";

export type MediaKind = "image" | "audio" | "video";
const LFM_MEDIA_DEFAULT = "https://studio-novaai2026-lfm25-media-server.api-inference.modelscope.net";

/** LFM2.5's own media Studio (LFM_MEDIA_STUDIO_URL; "off" disables). */
export function lfmMediaUrl(): string {
  const raw = (process.env.LFM_MEDIA_STUDIO_URL ?? (process.env.NODE_ENV === "test" ? "" : LFM_MEDIA_DEFAULT)).trim();
  return /^(off|none|0)$/i.test(raw) ? "" : raw.replace(/\/+$/, "");
}

/** The speech / video (and, for LFM2.5, image) Studio of a model, or "" when that model has none. Never another model's address. */
export function ownMediaBase(model: string | undefined): string {
  const id = model || "coder";
  if (id === "coder") return novaMediaUrl();
  if (id === "lfm25") return lfmMediaUrl();
  return candidateMediaStudio(id)?.base || "";
}

const MODEL_NAMES: Record<string, string> = { coder: "Nova", lfm25: "LFM2.5", "qwen35-9b": "Qwen3.5-9B", "gemma4-e4b": "Gemma 4 E4B", minicpmo45: "MiniCPM-o 4.5", sham_v2: "Sham v2" };
export const mediaModelName = (model: string | undefined): string => MODEL_NAMES[model || "coder"] || String(model);

/** Can this model make this kind of media on its own Studio right now (configured, not running)? */
export function modelMediaConfigured(model: string | undefined, kind: MediaKind): boolean {
  const id = model || "coder";
  if (kind === "image" && photoWeightProfile(id)) return true;
  return Boolean(ownMediaBase(id));
}

/** Makes media with the selected model's OWN generator. A model without one gets a typed error, never another model's output. */
export async function makeModelMedia(
  model: string | undefined,
  kind: MediaKind,
  prompt: string,
  opts: { seconds?: number; aspect?: "wide" | "tall" | "square"; timeoutMs?: number; raw?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<MediaReply | null> {
  const id = model || "coder";
  if (kind === "image" && photoWeightProfile(id)) {
    return makePhotoMedia(id, prompt, { timeoutMs: opts.timeoutMs ?? 420000, bypassNegativePrompt: opts.raw, aspect: opts.aspect, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
  }
  const base = ownMediaBase(id);
  if (!base) return { type: "error", reason: "no_own_generator", text: `لا يوجد مولّد ${kind === "image" ? "صور" : kind === "audio" ? "صوت" : "فيديو"} خاص بـ ${mediaModelName(id)} مُعدّ حالياً؛ لم يُستخدم مولّد نموذج آخر.` };
  return novaMakeMedia(kind, prompt, {
    base,
    timeoutMs: opts.timeoutMs ?? (kind === "video" ? 300000 : 240000),
    bypassContentHeuristics: opts.raw,
    ...(kind === "video" ? { seconds: opts.seconds ?? 10 } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}
