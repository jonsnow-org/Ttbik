/**
 * Per-model photorealistic image Studio router.
 * Every identity has one private ModelScope Studio and one private model repo.
 * This module never tries another Studio and refuses mismatched model/hash output.
 */
export type PhotoModelId = "coder" | "qwen35-9b" | "gemma4-e4b" | "minicpmo45" | "sham_v2";
export type PhotoWeightProfile = {
  modelId: PhotoModelId; displayName: string; sourceModel: string; modelRepo: string;
  endpointEnv: string; defaultEndpoint: string; resolution: string; steps: number; cfg: number; negative: string; validationStatus: "previously_passed" | "needs_retest"; expectedCheckpointSha256?: string;
};
export type PhotoMediaMetadata = Record<string, unknown> & {
  result: "image_generated"; model_repo: string; checkpoint_sha256: string; image_sha256?: string; seconds?: number;
};
export type PhotoMediaReply =
  | { type: "image"; b64: string; mime: "image/png"; text: string; metadata: PhotoMediaMetadata }
  | { type: "error"; reason: string; text: string };

const COMMON_NEGATIVE =
  "cartoon, anime, illustration, drawing, painting, cgi, 3d render, doll, plastic skin, waxy skin, airbrushed, deformed eyes, asymmetrical eyes, bad anatomy, bad proportions, malformed hands, extra fingers, fused fingers, missing fingers, extra limbs, blurry, low quality, jpeg artifacts, watermark, logo, text";

export const PHOTO_WEIGHT_PROFILES: Record<PhotoModelId, PhotoWeightProfile> = {
  // Existing Nova route is preserved during the donor bake-off; no candidate points to this repo.
  coder: { modelId: "coder", displayName: "Nova AI", sourceModel: "emilianJR/epiCRealism",
    modelRepo: "novaai2026/epicrealism-image-test-models", endpointEnv: "NOVA_IMAGE_STUDIO_URL",
    defaultEndpoint: "https://studio-novaai2026-epicrealism-image-test.api-inference.modelscope.net",
    resolution: "512 × 768", steps: 30, cfg: 7, negative: COMMON_NEGATIVE,
    validationStatus: "needs_retest" },
  // Previously successful weight; a separate Gemma-owned copy lives in its own repo/Studio.
  "qwen35-9b": { modelId: "qwen35-9b", displayName: "Qwen3.5-9B", sourceModel: "cyberdelia/CyberRealistic",
    modelRepo: "novaai2026/cyberrealistic-final-test-models", endpointEnv: "QWEN35_IMAGE_STUDIO_URL",
    defaultEndpoint: "https://studio-novaai2026-cyberrealistic-final-test.api-inference.modelscope.net",
    expectedCheckpointSha256: "2209c07b331a06cb28cf7c830ec758ae5b49eb97fab21f5de6b18c7be8b41554",
    resolution: "512 × 768 (author recommended)", steps: 30, cfg: 5, negative: COMMON_NEGATIVE,
    validationStatus: "previously_passed" },
  // Gemma has its own duplicate checkpoint package and its own private image Studio; it does not share Sham v2's route.
  "gemma4-e4b": { modelId: "gemma4-e4b", displayName: "Gemma 4 E4B", sourceModel: "SG161222/Realistic_Vision_V6.0_B1_noVAE",
    modelRepo: "novaai2026/gemma4-realistic-vision-v6-test-models", endpointEnv: "GEMMA4_IMAGE_STUDIO_URL",
    defaultEndpoint: "https://studio-novaai2026-gemma4-realistic-vision-v6-test.api-inference.modelscope.net",
    expectedCheckpointSha256: "c48bfd159cd7a6507b128685e963c398fa72399cefafaf603781df50ce836cc7",
    resolution: "512 × 512", steps: 25, cfg: 5.5, negative: COMMON_NEGATIVE,
    validationStatus: "previously_passed" },
  // Third candidate; Umranz must become ready and generate a verified sample before it is counted as successful.
  minicpmo45: { modelId: "minicpmo45", displayName: "MiniCPM-o 4.5", sourceModel: "Umranz/SD1.5-Uncensored-Photoreal",
    modelRepo: "novaai2026/umranz-sd15-test-models", endpointEnv: "MINICPMO45_IMAGE_STUDIO_URL",
    defaultEndpoint: "https://studio-novaai2026-umranz-sd15-image-test.api-inference.modelscope.net",
    resolution: "512 × 768", steps: 30, cfg: 6.5, negative: COMMON_NEGATIVE,
    validationStatus: "needs_retest" },
  // Existing Sham v2 route is preserved on its original successful Studio; Gemma uses a private clone.
  sham_v2: { modelId: "sham_v2", displayName: "Sham v2", sourceModel: "SG161222/Realistic_Vision_V6.0_B1_noVAE",
    modelRepo: "novaai2026/realistic-vision-v6-test-models", endpointEnv: "SHAM_V2_IMAGE_STUDIO_URL",
    defaultEndpoint: "https://studio-novaai2026-realistic-vision-v6-test.api-inference.modelscope.net",
    expectedCheckpointSha256: "c48bfd159cd7a6507b128685e963c398fa72399cefafaf603781df50ce836cc7",
    resolution: "512 × 512", steps: 25, cfg: 5.5, negative: COMMON_NEGATIVE,
    validationStatus: "previously_passed" },
};;;

const cleanBase = (value: string): string => value.trim().replace(/\/+$/, "");
export function photoWeightProfile(model: string | undefined): PhotoWeightProfile | null {
  const id = (model || "coder") as PhotoModelId;
  return Object.prototype.hasOwnProperty.call(PHOTO_WEIGHT_PROFILES, id) ? PHOTO_WEIGHT_PROFILES[id] : null;
}
export function photoWeightEndpoint(profile: PhotoWeightProfile): string {
  const value = (process.env[profile.endpointEnv] || "").trim();
  if (/^(off|none|0)$/i.test(value)) return "";
  return cleanBase(value || profile.defaultEndpoint);
}
function photoToken(): string {
  return (process.env.OPEN_CODER_STUDIO_TOKEN || process.env.MODELSCOPE_API_TOKEN || process.env.MODELSCOPE_TOKEN || "").trim();
}
function dataValues(sse: string): unknown[] {
  const out: unknown[] = [];
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch { /* ignore Gradio event metadata */ }
  }
  return out;
}
function walk(value: unknown, visit: (value: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  visit(obj);
  for (const child of Object.values(obj)) if (child && (Array.isArray(child) || typeof child === "object")) walk(child, visit);
}
function decodeInner(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}
async function sseUntilComplete(response: Response): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  try {
    while (true) {
      const result = await reader.read();
      raw += decoder.decode(result.value, { stream: !result.done });
      if (/\bevent: complete\b/.test(raw) || /\bevent: error\b/.test(raw) || result.done) break;
    }
    return raw;
  } finally {
    try { await reader.cancel(); } catch { /* stream already closed */ }
    try { reader.releaseLock(); } catch { /* closed */ }
  }
}
function findStatus(values: unknown[]): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  for (const value of values) walk(decodeInner(value), (obj) => { if (!found && typeof obj.phase === "string") found = obj; });
  return found;
}
function findImageAndMetadata(values: unknown[]): { file: Record<string, unknown> | null; metadata: Record<string, unknown> | null } {
  let file: Record<string, unknown> | null = null;
  let metadata: Record<string, unknown> | null = null;
  for (const value of values) walk(decodeInner(value), (obj) => {
    if (!file && (typeof obj.path === "string" || typeof obj.url === "string")) file = obj;
    if (!metadata && obj.result === "image_generated") metadata = obj;
  });
  return { file, metadata };
}
function safeRelativeFilePath(file: Record<string, unknown>): string | null {
  let path = typeof file.path === "string" ? file.path : "";
  if (!path && typeof file.url === "string") {
    try { path = new URL(file.url).pathname; } catch { return null; }
  }
  const marker = "/gradio_api/file=";
  if (path.includes(marker)) path = path.slice(path.indexOf(marker) + marker.length);
  path = path.replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\0")) return null;
  return path;
}
function encodedGradioPath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
async function submitAndRead(
  base: string, api: string, payload: Record<string, unknown>, headers: Record<string, string>,
  timeoutMs: number, fetchImpl: typeof fetch,
): Promise<string> {
  const submit = await fetchImpl(base + "/gradio_api/call/" + api, {
    method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.min(timeoutMs, 30000)),
  });
  if (!submit.ok) throw new Error("HTTP " + submit.status + " while submitting " + api);
  const eventId = String((await submit.json() as { event_id?: string }).event_id || "");
  if (!eventId) throw new Error("The image Studio did not return an event id for " + api + ".");
  const stream = await fetchImpl(base + "/gradio_api/call/" + api + "/" + encodeURIComponent(eventId), {
    headers, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!stream.ok) throw new Error("HTTP " + stream.status + " while waiting for " + api);
  const body = await sseUntilComplete(stream);
  if (/\bevent: error\b/.test(body)) throw new Error("The Studio returned an error event for " + api + ".");
  if (!/\bevent: complete\b/.test(body)) throw new Error("The Studio did not complete " + api + " within " + timeoutMs + "ms.");
  return body;
}

/** Generate with exactly the image Studio assigned to the selected chat model. */
export async function makePhotoMedia(
  model: string | undefined, prompt: string,
  opts: { negativePrompt?: string; seed?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<PhotoMediaReply> {
  const profile = photoWeightProfile(model);
  if (!profile) return { type: "error", reason: "model_not_mapped", text: "No independent image weight is assigned to model " + (model || "unknown") + ". Nothing was sent to another Studio." };
  const base = photoWeightEndpoint(profile);
  if (!base) return { type: "error", reason: "studio_disabled", text: profile.displayName + "'s dedicated image Studio is disabled. No fallback was attempted." };
  const token = photoToken();
  if (!token) return { type: "error", reason: "missing_token", text: "The private ModelScope Studio token is not configured on the bot server. No fallback was attempted." };
  const description = String(prompt || "").trim();
  if (description.length < 8 || description.length > 1800) return { type: "error", reason: "bad_prompt", text: "The image description must be between 8 and 1800 characters." };
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = Math.max(30000, Math.min(900000, Number(opts.timeoutMs) || 360000));
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: "Bearer " + token };

  try {
    const statusSse = await submitAndRead(base, "status", { data: [] }, headers, Math.min(timeoutMs, 45000), fetchImpl);
    const status = findStatus(dataValues(statusSse));
    if (!status || status.phase !== "ready") {
      const phase = String(status?.phase || "unreadable");
      return { type: "error", reason: "studio_not_ready", text: profile.displayName + "'s own image Studio is " + phase + ". No other model or Studio was used." };
    }
    const statusRepo = String(status.model_repo || status.modelscope_model_repo || "");
    const statusHash = String(status.checkpoint_sha256 || "");
    if (statusRepo !== profile.modelRepo || !/^[a-f0-9]{64}$/i.test(statusHash) || (profile.expectedCheckpointSha256 && statusHash !== profile.expectedCheckpointSha256)) {
      return { type: "error", reason: "model_identity_mismatch", text: profile.displayName + "'s image Studio did not prove the expected private model repository and SHA-256 checkpoint. Generation was refused." };
    }

    const seed = Number.isInteger(opts.seed) ? Number(opts.seed) : Math.floor(Date.now() / 1000) % 2147483647;
    const payload = { data: [
      description, String(opts.negativePrompt ?? profile.negative).slice(0, 1800),
      profile.resolution, profile.steps, profile.cfg, seed,
    ] };
    const outputSse = await submitAndRead(base, "image", payload, headers, timeoutMs, fetchImpl);
    const found = findImageAndMetadata(dataValues(outputSse));
    if (!found.file || !found.metadata) return { type: "error", reason: "missing_image_metadata", text: profile.displayName + "'s Studio completed without a verifiable image file and model metadata." };
    if (found.metadata.model_repo !== profile.modelRepo || String(found.metadata.checkpoint_sha256 || "") !== statusHash) {
      return { type: "error", reason: "generated_checkpoint_mismatch", text: "The generated image metadata did not match " + profile.displayName + "'s ready checkpoint. The image was discarded; no fallback was attempted." };
    }
    if (found.metadata.result !== "image_generated") return { type: "error", reason: "generation_not_confirmed", text: "The Studio did not confirm a successful image generation." };
    const path = safeRelativeFilePath(found.file);
    if (!path) return { type: "error", reason: "bad_file_path", text: "The Studio returned an invalid image file path." };
    const fileResponse = await fetchImpl(base + "/gradio_api/file=" + encodedGradioPath(path), {
      headers, signal: AbortSignal.timeout(Math.min(timeoutMs, 120000)),
    });
    if (!fileResponse.ok) throw new Error("HTTP " + fileResponse.status + " while downloading the generated image");
    const mime = (fileResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (mime && !mime.startsWith("image/") && mime !== "application/octet-stream") throw new Error("The Studio returned a non-image file (" + mime + ").");
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (bytes.length < 1000) throw new Error("The generated image file is empty or truncated.");
    return {
      type: "image", b64: bytes.toString("base64"), mime: "image/png",
      text: "Generated by " + profile.displayName + "'s dedicated image-weight Studio.",
      metadata: found.metadata as PhotoMediaMetadata,
    };
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 240);
    return { type: "error", reason: "studio_error", text: profile.displayName + "'s own image Studio failed: " + message + ". No other Studio or model was used." };
  }
}


export type PhotoWeightStatus = {
  modelId: PhotoModelId;
  displayName: string;
  sourceModel: string;
  modelRepo: string;
  endpoint: string;
  ready: boolean;
  validationStatus: "previously_passed" | "needs_retest";
  phase: string;
  checkpointSha256: string | null;
  sourceRevision: string | null;
  memoryGb: number | null;
  detail: string;
};

/** Owner-panel probe for every image weight; status only, no generation. */
export async function photoWeightStatus(fetchImpl: typeof fetch = fetch): Promise<PhotoWeightStatus[]> {
  const token = photoToken();
  return Promise.all(Object.values(PHOTO_WEIGHT_PROFILES).map(async (profile) => {
    const endpoint = photoWeightEndpoint(profile);
    const base: PhotoWeightStatus = {
      modelId: profile.modelId, displayName: profile.displayName, sourceModel: profile.sourceModel,
      modelRepo: profile.modelRepo, endpoint, ready: false, validationStatus: profile.validationStatus, phase: endpoint ? "unknown" : "off",
      checkpointSha256: null, sourceRevision: null, memoryGb: null, detail: "",
    };
    if (!endpoint) return { ...base, detail: "Studio endpoint disabled" };
    if (!token) return { ...base, phase: "no_token", detail: "No ModelScope API token configured" };
    try {
      const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
      const sse = await submitAndRead(endpoint, "status", { data: [] }, headers, 12000, fetchImpl);
      const state = findStatus(dataValues(sse));
      if (!state) return { ...base, phase: "unreadable", detail: "Studio status payload was not readable" };
      const phase = String(state.phase || "unknown");
      const repo = String(state.model_repo || state.modelscope_model_repo || "");
      const hash = String(state.checkpoint_sha256 || "");
      const validHash = /^[a-f0-9]{64}$/i.test(hash);
      const expectedMatches = !profile.expectedCheckpointSha256 || profile.expectedCheckpointSha256 === hash;
      const ready = phase === "ready" && repo === profile.modelRepo && validHash && expectedMatches;
      const reason = phase !== "ready" ? String(state.error || ("phase=" + phase))
        : repo !== profile.modelRepo ? "Model repository mismatch"
        : !validHash ? "Checkpoint SHA-256 missing"
        : !expectedMatches ? "Checkpoint SHA-256 differs from the previously verified source" : "";
      return {
        ...base, ready, phase: ready ? "ready" : phase,
        checkpointSha256: validHash ? hash : null,
        sourceRevision: typeof state.source_revision === "string" ? state.source_revision : null,
        memoryGb: Number.isFinite(Number(state.memory_gb)) ? Number(state.memory_gb) : null,
        detail: reason.slice(0, 240),
      };
    } catch (error) {
      return { ...base, phase: "down", detail: String((error as Error)?.message || error).slice(0, 180) };
    }
  }));
}
