import { allStudioStatus } from "@/lib/openCoderStudio";
import { shamBases, shamVariant } from "@/lib/shamStudio";

// One light, cached status per model for the dot in the model picker: ok (green) = working with room, busy (yellow) = working but under heavy load or still starting,
// down (red) = not answering. It only reads status: no model is ever called to generate anything.
export type Health = "ok" | "busy" | "down";

/** Requests waiting in a Studio's queue from which it counts as heavily loaded (yellow). */
export const HEAVY_QUEUE = 2;

/** Nova has several Studios: green while at least one is ready and free, yellow only under heavy pressure (every ready one has HEAVY_QUEUE+ requests waiting), red when none is ready. */
export function classifyStudios(statuses: (Record<string, unknown> | null)[]): Health {
  const ready = statuses.filter((s): s is Record<string, unknown> => Boolean(s) && (s as Record<string, unknown>).phase === "ready");
  if (!ready.length) return "down";
  const free = ready.filter((s) => Number(s.queue || 0) < HEAVY_QUEUE);   // owner 2026-11-22: running a task (even with one request waiting) is WORKING = green; yellow = heavy pressure only; red = not ready (deploying / error)
  return free.length ? "ok" : "busy";
}

async function reachable(base: string): Promise<boolean> {
  try {
    const token = (process.env.MODELSCOPE_API_TOKEN || process.env.OPEN_CODER_STUDIO_TOKEN || "").trim();
    const res = await fetch(base + "/gradio_api/info", { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch { return false; }
}

async function shamHealth(variant: "v1" | "v2"): Promise<Health> {
  const bases = shamVariant.run(variant, () => shamBases());
  const answers = await Promise.all(bases.map(reachable));
  return answers.some(Boolean) ? "ok" : "down";
}

let cache: { t: number; v: Record<string, Health> } | null = null;
export async function modelHealth(ttlMs = 20000): Promise<Record<string, Health>> {
  if (cache && Date.now() - cache.t < ttlMs) return cache.v;
  const [nova, v1, v2] = await Promise.all([
    allStudioStatus(6000).then(classifyStudios).catch((): Health => "down"),
    shamHealth("v1").catch((): Health => "down"),
    shamHealth("v2").catch((): Health => "down"),
  ]);
  const out: Record<string, Health> = { coder: nova, sham: v1, sham_v2: v2 };
  cache = { t: Date.now(), v: out };
  return out;
}
