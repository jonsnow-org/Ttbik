import { NextResponse } from "next/server";
import { allTokens } from "@/lib/chain";
export const dynamic = "force-dynamic";
// Which dates have a token (public chain data). Owners are not exposed here, only the taken dates.
export async function GET() {
  try { return NextResponse.json({ taken: (await allTokens()).map((t) => t.index) }, { headers: { "Cache-Control": "public, max-age=30" } }); }
  catch { return NextResponse.json({ taken: [] }); }
}
