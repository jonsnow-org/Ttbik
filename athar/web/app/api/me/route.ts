import { NextResponse } from "next/server";
import { tokensOf } from "@/lib/chain";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  if (!address) return NextResponse.json({ tokens: [] });
  return NextResponse.json({ tokens: await tokensOf(address) });
}
