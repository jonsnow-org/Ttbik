import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Real, server-side, cross-device notification delivery. The mini-app's
// follow button used to write "X started following you" only into the
// CURRENT browser's own localStorage -- which could never reach the
// person who was actually followed, on any device, ever. This is the
// actual delivery path that was missing.

async function client() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: NextRequest) {
  const userId = (req.nextUrl.searchParams.get("user_id") || "").trim();
  if (!userId) return NextResponse.json({ notifications: [] });

  const db = await client();
  if (!db) return NextResponse.json({ notifications: [] });

  const { data } = await db
    .from("media_notifications")
    .select("id,from_id,from_name,type,read,created_at,post_id")
    .eq("to_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    notifications: (data || []).map((n: any) => ({
      id: String(n.id),
      fromId: String(n.from_id || ""),
      fromName: String(n.from_name || "مستخدم"),
      type: String(n.type || "follow"),
      read: !!n.read,
      at: n.created_at ? Math.floor(new Date(n.created_at).getTime() / 1000) : 0,
      postId: n.post_id ? String(n.post_id) : undefined,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const toId = String(body.to_id || "").trim();
  const fromId = String(body.from_id || "").trim();
  if (!toId || !fromId || toId === fromId) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const db = await client();
  if (db) {
    await db.from("media_notifications").insert({
      to_id: toId,
      from_id: fromId,
      from_name: String(body.from_name || "مستخدم").slice(0, 40),
      type: String(body.type || "follow"),
      post_id: body.post_id ? String(body.post_id) : null,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.user_id || "").trim();
  if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const db = await client();
  if (db) {
    await db.from("media_notifications").update({ read: true }).eq("to_id", userId);
  }
  return NextResponse.json({ ok: true });
}
