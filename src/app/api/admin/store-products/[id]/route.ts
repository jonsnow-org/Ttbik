import { NextRequest, NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/isOwner";
import { supabaseAdmin } from "@/lib/supabase";

const EDITABLE_FIELDS = [
  "title_ar",
  "description_ar",
  "image_url",
  "affiliate_url",
  "category",
  "price_display",
  "sort_order",
  "is_active",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) patch[field] = body[field];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data, error } = await db.from("store_products").update(patch).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { error } = await db.from("store_products").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
