import { NextRequest, NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/isOwner";
import { supabaseAdmin } from "@/lib/supabase";

// One-click, owner-only fixes for catalog rows that a SQL migration file
// alone never actually reaches production without someone manually running
// it in Supabase's SQL editor -- proven repeatedly unreliable for this
// owner (channel-ad-slot stayed live for weeks after being asked removed
// multiple times, despite migration_remove_channel_ad_slot.sql existing in
// the repo the whole time). This route does the same idempotent statements
// for real, using the app's own already-configured service-role key, one
// tap away on /admin instead of a copy-pasted SQL script.
export async function POST(req: NextRequest) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const results: Record<string, string> = {};

  // Owner directive (2026-09-21, repeated after an earlier partial fix only
  // removed channel-ad-slot): remove all three of these from the live
  // catalog, not just channel-ad-slot. "auto-reply-bot"/"faq-bot" were once
  // accidentally deactivated by an old blanket migration and reactivated by
  // mistake-fix -- this is different: an explicit, repeated owner request to
  // remove them for real this time, not a resurfacing of that old bug.
  const slugsToRemove = ["channel-ad-slot", "auto-reply-bot", "faq-bot"];
  for (const slug of slugsToRemove) {
    await db.from("services").update({ is_active: false }).eq("slug", slug);
    const { error: deleteError } = await db.from("services").delete().eq("slug", slug);
    results[slug] = deleteError
      ? `deactivated but not deleted (${deleteError.message}) -- likely referenced by a real historical order, left inactive`
      : "removed";
  }

  return NextResponse.json({ ok: true, results });
}
