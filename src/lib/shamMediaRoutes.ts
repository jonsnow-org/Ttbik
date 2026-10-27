import { shamMediaRoute } from "@/lib/shamExec";
import { novaMakeMedia, novaMediaEnabled } from "@/lib/novaMedia";
import { shamGenerateMedia, shamLastFailure, shamNoteFailure, shamVariant, type ShamReply } from "@/lib/shamStudio";

export type ShamMediaKind = "image" | "audio" | "video";

/** Run exactly the route selected in the owner's panel. Never auto-switch to another route. */
export async function generateShamMediaThroughRoute(
  kind: ShamMediaKind,
  prompt: string,
  opts: { timeoutMs?: number; scenes?: unknown; narration?: unknown } = {},
): Promise<ShamReply> {
  const route = await shamMediaRoute();
  const timeoutMs = Math.min(240000, Math.max(8000, opts.timeoutMs ?? 240000));
  try {
    let reply: ShamReply | null;
    if (route === "nova_media") {
      if (!novaMediaEnabled()) {
        return { type: "error", route, text: "The selected Nova Media Studio route is disabled or not configured." };
      }
      const result = await novaMakeMedia(kind, prompt, {
        scenes: opts.scenes,
        narration: opts.narration,
        timeoutMs,
      });
      reply = result ? (result as ShamReply) : null;
    } else {
      const variant = route === "sham_v1" ? "v1" : "v2";
      shamNoteFailure("");
      reply = await shamVariant.run(variant, () =>
        shamGenerateMedia(kind, prompt, timeoutMs, route === "sham_v2" ? "ready" : "internal"),
      );
    }
    if (reply && (reply.type === "image" || reply.type === "audio" || reply.type === "video") && reply.b64) {
      return { ...reply, route };
    }
    const detail = reply?.text || (reply ? 'Studio returned type "' + reply.type + '" without a usable media file.' : shamLastFailure() || "The selected route returned no response.");
    return { type: "error", route, text: detail };
  } catch (error) {
    return { type: "error", route, text: String((error as Error)?.message || error).slice(0, 300) };
  }
}
