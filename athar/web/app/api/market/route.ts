import { NextResponse } from "next/server";
import { marketView } from "@/lib/market";
export const dynamic = "force-dynamic";
// Our tokens listed on Getgems (public indexer data), with the floor price by kind.
export async function GET() {
  try { return NextResponse.json(await marketView(), { headers: { "Cache-Control": "public, max-age=30" } }); }
  catch { return NextResponse.json({ error: "market data is not available right now" }, { status: 503, headers: { "Retry-After": "10" } }); }
}
