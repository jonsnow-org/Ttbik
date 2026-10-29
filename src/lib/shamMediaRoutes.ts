import { shamEngine, targetOf } from "@/lib/shamMediaEngine";
import { shamGenerateMedia, shamLastFailure, shamNoteFailure, shamVariant, type ShamReply } from "@/lib/shamStudio";

export type ShamMediaKind = "image" | "audio" | "video";

/** Make media on the engine selected FOR THIS MODEL (Sham v2 and old Sham each have their own).
 * Calls without an explicit model context are refused; media must never fall back to a shared global route. */
export async function generateShamMediaThroughRoute(
  kind: ShamMediaKind,
  prompt: string,
  opts: { timeoutMs?: number; scenes?: unknown; narration?: unknown } = {},
): Promise<ShamReply> {
  const model = shamVariant.getStore();
  if (model !== "v1" && model !== "v2") {
    return { type: "error", route: "unselected", reason: "model_not_selected", text: "No Sham model was selected for this media request; no Studio was called." };
  }
  const modelId = model === "v2" ? "sham_v2" : "sham";
  const route = targetOf(modelId, await shamEngine(modelId)).route;
  const timeoutMs = Math.min(240000, Math.max(8000, opts.timeoutMs ?? 240000));
  try {
    let reply: ShamReply | null;
    const variant = route === "sham_v1" ? "v1" : "v2";
    const backend = route === "sham_v2_ready" ? "ready" : "internal";
    shamNoteFailure("");
    reply = await shamVariant.run(variant, () => shamGenerateMedia(
      kind,
      prompt,
      timeoutMs,
      backend,
      { scenes: opts.scenes, narration: opts.narration },
    ));
    if (reply && (reply.type === "image" || reply.type === "audio" || reply.type === "video") && reply.b64) {
      return { ...reply, route };
    }
    const detail = reply?.text || (reply ? 'Studio returned type "' + reply.type + '" without a usable media file.' : shamLastFailure() || "The selected route returned no response.");
    // keep the Studio's typed reason (blank_image, noise_image, disk, unavailable, ...) so the caller can say WHY, and say plainly what the internal path is
    const reason = reply?.type === "error" ? reply.reason : undefined;
    const note = route === "sham_v2_internal" || route === "sham_v1"
      ? (reason === "blank_image" || reason === "noise_image" ? "\n(مسار شام الداخلي لا يزال قيد التدريب ولا ينتج وسائط صالحة بعد؛ غيّر «محرك الوسائط» لهذا النموذج إلى «الأوزان الجاهزة» من لوحة المالك. لم يحدث تحويل تلقائي.)" : "")
      : "";
    return { type: "error", route, ...(reason ? { reason } : {}), text: detail + note };
  } catch (error) {
    return { type: "error", route, text: String((error as Error)?.message || error).slice(0, 300) };
  }
}
