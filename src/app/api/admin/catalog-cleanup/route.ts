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
    // Both calls' errors are checked and reported -- the update's error was
    // previously discarded entirely, so a permission failure on it (as
    // opposed to the delete) was silently reported as "deactivated" when it
    // never actually happened (owner-caught, 2026-09-21: the service was
    // still fully live after this route reported success).
    const { error: updateError } = await db.from("services").update({ is_active: false }).eq("slug", slug);
    const { error: deleteError } = await db.from("services").delete().eq("slug", slug);
    if (!deleteError) {
      results[slug] = "removed";
    } else if (!updateError) {
      results[slug] = `deactivated but not deleted (${deleteError.message}) -- likely referenced by a real historical order, left inactive`;
    } else {
      results[slug] = `FAILED -- still fully live (update error: ${updateError.message}; delete error: ${deleteError.message})`;
    }
  }

  // The media bot's /premium flow sends buyers to /service/media-bot-premium
  // and verify-premium only unlocks approved orders for that slug. If
  // migration_media_bot_premium.sql was never run in the SQL editor, the page
  // 404s and the upgrade can't be bought at all — so ensure the row here too.
  results["media-bot-premium"] = await ensureMediaBotPremium(db);

  return NextResponse.json({ ok: true, results });
}

// Same values as supabase/migration_media_bot_premium.sql.
const MEDIA_BOT_PREMIUM = {
  slug: "media-bot-premium",
  name_ar: "ترقية بوت الوسائط المدفوعة",
  subcategory: "بوتات تليجرام",
  short_desc_ar: "ارفع حدك اليومي في بوت تحميل الوسائط وفعّل أولوية أعلى في المعالجة.",
  long_desc_ar:
    "بعد الموافقة على طلبك، عد إلى بوت الوسائط على تليجرام وأرسل الأمر: /premium ثم رمز طلبك (مثال: /premium ABC123) لتفعيل الترقية فوراً على حسابك.",
  price_usd: 5,
  demo_type: "bot_simulator",
  delivery_type: "text",
  delivery_content: "عد إلى بوت الوسائط على تليجرام وأرسل: /premium ثم رمز طلبك لتفعيل الترقية فوراً.",
  tool_route: null,
  sort_order: 7,
};

async function ensureMediaBotPremium(db: ReturnType<typeof supabaseAdmin>): Promise<string> {
  const { data: existing, error: readError } = await db
    .from("services")
    .select("id, is_active")
    .eq("slug", MEDIA_BOT_PREMIUM.slug)
    .maybeSingle();
  if (readError) return `FAILED to read services (${readError.message})`;
  if (existing) {
    if (existing.is_active) return "already live";
    const { error } = await db.from("services").update({ is_active: true }).eq("id", existing.id);
    return error ? `FAILED to reactivate (${error.message})` : "reactivated";
  }
  const { data: category, error: catError } = await db
    .from("categories")
    .select("id")
    .eq("slug", "telegram-bots")
    .maybeSingle();
  if (catError || !category) return `FAILED: category telegram-bots not found${catError ? ` (${catError.message})` : ""}`;
  const { error } = await db.from("services").insert({ ...MEDIA_BOT_PREMIUM, category_id: category.id, is_active: true });
  return error ? `FAILED to insert (${error.message})` : "created";
}

/**
 * Owner-only diagnosis of why the storefront is empty: counts what the anon
 * client and the service-role client each see, with their error messages.
 * Open /api/admin/catalog-cleanup in the browser while logged in as owner.
 */
export async function GET(req: NextRequest) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { supabasePublic } = await import("@/lib/supabase");
  const report: Record<string, unknown> = {};
  for (const [name, make] of [
    ["anon", supabasePublic],
    ["service_role", supabaseAdmin],
  ] as const) {
    try {
      const db = make();
      const [cats, svcs, premium] = await Promise.all([
        db.from("categories").select("slug"),
        db.from("services").select("slug, is_active"),
        db.from("services").select("slug, is_active, price_usd").eq("slug", MEDIA_BOT_PREMIUM.slug).maybeSingle(),
      ]);
      report[name] = {
        categories: cats.error ? `error: ${cats.error.message}` : (cats.data ?? []).map((c) => c.slug),
        services_active: svcs.error ? `error: ${svcs.error.message}` : (svcs.data ?? []).filter((s) => s.is_active).length,
        services_total: svcs.error ? null : (svcs.data ?? []).length,
        media_bot_premium: premium.error ? `error: ${premium.error.message}` : premium.data ?? "missing",
      };
    } catch (e) {
      report[name] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return NextResponse.json(report);
}
