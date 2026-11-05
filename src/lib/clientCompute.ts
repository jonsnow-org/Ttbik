/**
 * How much of a user's device we may use — and only for that user's own task, only while they are
 * using the app, and only after an explicit opt-in. This module decides *how much*; it never starts
 * work by itself and never lets one user's device work for another (no distributed compute).
 * The heavy part (the model, media generation) cannot run here; only light work around the task can
 * (shrinking a picture, chunking text, highlighting code) — see docs/COMPUTE_SHARING.md.
 */

export type DeviceInfo = { cores: number; memoryGb: number };
export type ComputeSlice = { allowed: boolean; workers: number; maxMs: number };

/** A device below this many cores is left alone entirely. */
export const MIN_CORES = 4;
/** Hard ceiling for a single unit of work. */
export const MAX_MS = 1500;
export const MAX_WORKERS = 1;
/** Ceiling for a whole session, so many small jobs cannot add up to a heavy load. */
export const SESSION_CAP_MS = 6000;

export function deviceInfo(): DeviceInfo {
  if (typeof navigator === "undefined") return { cores: 0, memoryGb: 0 };
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { cores: Number(nav.hardwareConcurrency) || 0, memoryGb: Number(nav.deviceMemory) || 0 };
}

/** The slice we may take. No opt-in, or a weak device, means nothing is taken. */
export function computeSlice(optIn: boolean, device: DeviceInfo): ComputeSlice {
  if (!optIn || device.cores < MIN_CORES) return { allowed: false, workers: 0, maxMs: 0 };
  return { allowed: true, workers: MAX_WORKERS, maxMs: MAX_MS };
}

/** The owner's switch, read once per page from the public read-only flag route (never a per-user notice). */
export async function clientComputeOn(): Promise<boolean> {
  if (typeof fetch !== "function") return false;
  try {
    const r = await fetch("/api/client-compute", { cache: "no-store" });
    if (!r.ok) return false;
    const d = await r.json();
    return d?.enabled === true;
  } catch {
    return false;
  }
}

export type Ledger = { allowed: boolean; remaining: () => number; spend: (ms: number) => boolean };

/** A per-session budget. `spend` refuses a job that would pass the cap, and never goes negative. */
export function makeLedger(capMs: number = SESSION_CAP_MS): Ledger {
  let left = Math.max(0, capMs);
  return {
    allowed: left > 0,
    remaining: () => left,
    spend(ms: number) {
      const cost = Math.max(0, ms);
      if (cost > left) return false;
      left -= cost;
      return true;
    },
  };
}
