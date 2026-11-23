/** Which Studios say (in their status: `nova_tldm: "ready"`) that they serve Nova's own T-LDM head. The Studio is the one that knows: no environment flag has to be set on the app server
 *  (owner 2026-11-23: Nova carries T-LDM). A Studio that stops saying it, or stays silent for 10 minutes, no longer counts, so a Nova step never pays for a head that is not there. */
const seen = new Map<string, number>();
const FRESH_MS = 10 * 60 * 1000;
export function noteNovaTldm(base: string, state: unknown, now = Date.now()): void {
  if (state === "ready") seen.set(base, now); else seen.delete(base);
}
export function novaTldmServed(now = Date.now()): boolean {
  for (const t of seen.values()) if (now - t < FRESH_MS) return true;
  return false;
}
export function resetNovaTldmSeen(): void { seen.clear(); }
