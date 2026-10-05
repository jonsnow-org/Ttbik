import { NextResponse } from "next/server";
import { tokensOf, isBusy } from "@/lib/chain";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  if (!address) return NextResponse.json({ tokens: [] });
  try { return NextResponse.json({ tokens: await tokensOf(address) }); } catch (e) { if (isBusy(e)) return NextResponse.json({ error: "busy, try again in a moment" }, { status: 503, headers: { "Retry-After": "5" } }); throw e; }
}
