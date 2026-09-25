import { NextRequest, NextResponse } from "next/server";
import { mediaDb } from "@/lib/mediaSocial";
import { hookSecret, safeEqual, setRenderUrl } from "@/lib/mediaFrontDoor";

// Called only by the Python media bot (see media-bot/main.py):
//   POST {render_url}  register where to forward updates → then it points the webhook at /api/media-bot/webhook
//   GET                claim queued download requests saved while it was down (removed as they're handed out)
// Auth: x-media-bot-key = the same token-derived secret as the webhook.
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const s = hookSecret();
  return !!s && safeEqual(req.headers.get("x-media-bot-key") || "", s);
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const url = String(body.render_url || "").trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)) return NextResponse.json({ error: "bad render_url" }, { status: 400 });
  const ok = await setRenderUrl(url);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "store failed" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ updates: [] });
  const { data, error } = await db.from("media_bot_queue").select("update_id,payload").order("created_at", { ascending: true }).limit(20);
  if (error || !data?.length) return NextResponse.json({ updates: [] });
  const ids = data.map((r: any) => r.update_id);
  await db.from("media_bot_queue").delete().in("update_id", ids);
  return NextResponse.json({ updates: data.map((r: any) => r.payload) });
}
