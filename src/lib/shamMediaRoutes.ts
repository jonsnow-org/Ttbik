import { shamMediaRoute, type ShamMediaRoute } from "@/lib/shamExec";
import { novaMakeMedia, novaMediaEnabled } from "@/lib/novaMedia";
import { shamGenerateMedia, shamVariant, type ShamReply } from "@/lib/shamStudio";

export type ShamMediaKind = "image" | "audio" | "video";

export async function generateShamMediaThroughRoute(
  kind: ShamMediaKind,
  prompt: string,
  opts: { timeoutMs?: number; scenes?: unknown; narration?: unknown } = {},
): Promise<ShamReply | null> {
  const total = Math.min(240000, Math.max(8000, opts.timeoutMs ?? 240000));
  const selected = await shamMediaRoute();
  const order: ShamMediaRoute[] =
    selected === "sham_v1" ? ["sham_v1", "sham_v2", "nova_media"] :
    selected === "nova_media" ? ["nova_media", "sham_v2", "sham_v1"] :
    ["sham_v2", "sham_v1", "nova_media"];
  const good = (reply: ShamReply | null): reply is ShamReply =>
    Boolean(reply && (reply.type === "image" || reply.type === "audio" || reply.type === "video") && reply.b64);
  const started = Date.now();
  let last: ShamReply | null = null;

  for (let i = 0; i < order.length; i++) {
    const remaining = total - (Date.now() - started);
    if (remaining < 8000) break;
    const reserveMs = (order.length - i - 1) * 20000;
    const capMs = i === 0 ? 150000 : i === 1 ? 90000 : 240000;
    const timeoutMs = Math.max(8000, Math.min(capMs, remaining - reserveMs));
    let reply: ShamReply | null = null;

    if (order[i] === "nova_media") {
      if (!novaMediaEnabled()) continue;
      const result = await novaMakeMedia(kind, prompt, {
        scenes: opts.scenes,
        narration: opts.narration,
        timeoutMs,
      });
      reply = result ? (result as ShamReply) : null;
    } else {
      const variant = order[i] === "sham_v1" ? "v1" : "v2";
      reply = await shamVariant.run(variant, () => shamGenerateMedia(kind, prompt, timeoutMs));
    }

    if (good(reply)) return { ...reply, route: order[i] };
    if (reply) last = { ...reply, route: order[i] };
  }

  return last;
}
