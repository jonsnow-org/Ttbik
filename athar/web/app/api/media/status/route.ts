import { NextResponse } from "next/server";
import { available, isArchived, isQueued } from "@/lib/mediaQueue";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  return NextResponse.json({ readable: await available(id), queued: isQueued(id), archived: isArchived(id) }, { headers: { "Cache-Control": "no-store" } });
}
