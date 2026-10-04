import { NextResponse } from "next/server";
import { ticketsOf } from "@/lib/chain";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  if (!address) return NextResponse.json({ tickets: [] });
  try { return NextResponse.json({ tickets: await ticketsOf(address) }); } catch { return NextResponse.json({ tickets: [] }); }
}
