// Monetag In-Page Push (a small banner-like card inside the page; no new windows, no notification permission) for the gate's own site.
// Zone 12062586 belongs to ttbik-gate.jonsnowx1r.workers.dev, so it is loaded only there. Never on pages where money, wallets or private
// matters are handled, or in the owner's tools (owner directive 2026-09-24: nothing intrusive).
import { GATE_HOST } from "@/lib/adsterraKeys";

export const INPAGE_PUSH_ZONE = "12062586";
const NEVER_ON = ["/admin", "/match-app", "/pay", "/order", "/service", "/fadaa", "/verify", "/api", "/zenobia", "/s/", "/t/", "/c/"];

/** The zone to load for this address and path, or null. */
export function inPagePushZone(hostname: string, pathname: string): string | null {
  if (hostname !== GATE_HOST) return null;
  if (NEVER_ON.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"))) return null;
  return INPAGE_PUSH_ZONE;
}
