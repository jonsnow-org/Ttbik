import { NextRequest, NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/isOwner";
import { supabaseAdmin } from "@/lib/supabase";

// GET: full list (active + inactive) for the admin CRUD UI.
export async function GET(req: NextRequest) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data, error } = await db.from("store_products").select("*").order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data });
}

// POST: create one product. title_ar and affiliate_url are the only real
// requirements -- everything else has a sane default so a quick add
// (paste a link, give it a name) doesn't force filling every field first.
export async function POST(req: NextRequest) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const title_ar = (body?.title_ar || "").trim();
  const affiliate_url = (body?.affiliate_url || "").trim();
  if (!title_ar || !affiliate_url) {
    return NextResponse.json({ error: "title_ar و affiliate_url مطلوبان" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("store_products")
    .insert({
      title_ar,
      affiliate_url,
      description_ar: body?.description_ar || null,
      image_url: body?.image_url || null,
      category: (body?.category || "عام").trim() || "عام",
      price_display: body?.price_display || null,
      sort_order: Number.isFinite(body?.sort_order) ? body.sort_order : 0,
      is_active: body?.is_active ?? true,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}
