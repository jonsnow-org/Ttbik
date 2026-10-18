// Adsterra ad units are tied to the website they were created for. The site is served under two addresses (the Vercel one the search engines know,
// and the gate's workers.dev address that the bots and mini apps use), so the same slot needs a different unit key on each.
// The code keeps using the original (Vercel) keys; on the gate's host this maps them to the gate's own units (created 2026-10-18, placements 31797088-90).
export const GATE_HOST = "ttbik-gate.jonsnowx1r.workers.dev";
const GATE_KEYS: Record<string, string> = {
  "560a1eb1632771185b888243a7d36a07": "8f7c8d3dde15b92944741daff182a498",   // 320x50
  "3ee970813986977775e962f26938d143": "f729961b1e96c693ad1ade9f823959a4",   // 300x250
  // 728x90 has no unit on the gate's site: nothing is shown there
};

/** The unit key to use for `adKey` on `hostname`; null = no unit for this slot on that host. */
export function adsterraKeyFor(hostname: string, adKey: string): string | null {
  if (hostname !== GATE_HOST) return adKey;
  return GATE_KEYS[adKey] ?? null;
}
