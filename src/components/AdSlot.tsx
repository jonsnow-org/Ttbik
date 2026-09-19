import { isOwnerServer } from "@/lib/isOwner";
import AdsterraSlot from "./AdsterraSlot";

/**
 * Named placement seam for ad networks. Each position currently maps to a
 * live Adsterra unit (see AdsterraSlot.tsx) — set to false here to fall
 * back to the owner-only dashed placeholder for a position with no code
 * yet (e.g. if a new placement is added before its ad code exists).
 */
const HAS_CODE: Record<string, boolean> = {
  "header-banner": true,
  "in-content": true,
  "footer-banner": true,
};

export default function AdSlot({ position, label }: { position: keyof typeof HAS_CODE; label: string }) {
  const isOwner = isOwnerServer();

  if (HAS_CODE[position]) {
    // Owner navigates the site ad-free (real complaint: live ads were
    // showing to the owner too, getting in the way of managing the site).
    // Real visitors are completely unaffected -- this only checks the
    // owner's own cookie, never a visitor's.
    if (isOwner) return null;
    return <AdsterraSlot position={position as "header-banner" | "in-content" | "footer-banner"} />;
  }

  if (!isOwner) return null;

  return (
    <div className="rounded border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
      📢 موضع إعلان محجوز: {label} ({position}) — لا يظهر للزوار حتى يُوضع كود الإعلان
    </div>
  );
}
