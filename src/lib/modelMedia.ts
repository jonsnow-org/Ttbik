/**
 * ONE place that decides which Studio makes a model's picture / sound / clip (owner 2026-11-04: every model makes all three kinds,
 * each on ITS OWN Studio and weights; nothing silently falls back to another model's generator).
 *   Nova (coder):  image = its photoreal Studio (photoWeightMedia "coder"); speech + video = Nova's media Studio (NOVA_MEDIA_URL).
 */
import { makePhotoMedia, photoWeightProfile } from "@/lib/photoWeightMedia";
import { novaMakeMedia, novaMediaUrl, type MediaReply } from "@/lib/novaMedia";
import { nova2Urls } from "@/lib/openCoderStudio";

export type MediaKind = "image" | "audio" | "video";
/** Nova 2 has no implicit Nova generator. Its media endpoint must be provisioned separately. */
export function nova2MediaUrl(): string {
  const raw = (process.env.NOVA2_MEDIA_STUDIO_URL || "").trim();
  if (!raw || /^(off|none|0)$/i.test(raw) || !/^https:\/\//i.test(raw)) return "";
  const base = raw.replace(/\/+$/, "");
  const forbidden = [
    novaMediaUrl(),
    (process.env.COMPUTER_STUDIO_URL || "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net").trim(),
    (process.env.NOVA2_COMPUTER_STUDIO_URL || "").trim(),
    (process.env.NOVA_IMAGE_STUDIO_URL || "").trim(),
    (process.env.SHAM_V2_URL || process.env.SHAM_MODELSCOPE_URL || "").trim(),
    (process.env.SHAM_MEDIA_STUDIO_URL || "").trim(),
    (process.env.SHAM_V2_MEDIA_STUDIO_URL || "").trim(),
    ...nova2Urls(),
  ].map((x) => x.replace(/\/+$/, "")).filter(Boolean);
  if (forbidden.includes(base) || /nova-inference-server|coder-inference-server|epicrealism-image-test|sham/i.test(base)) return "";
  return base;
}

/** The selected model's own media Studio. No address from another model is ever borrowed. */
export function ownMediaBase(model: string | undefined): string {
  const id = model || "coder";
  const base = id === "coder" ? novaMediaUrl() : id === "nova2" ? nova2MediaUrl() : "";
  return /nova-inference-server/i.test(base) ? "" : base;
}

const MODEL_NAMES: Record<string, string> = { coder: "Nova", nova2: "Nova 2", sham_v2: "Sham v2" };
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
