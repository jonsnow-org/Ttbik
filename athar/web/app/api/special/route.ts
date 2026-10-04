import { NextResponse } from "next/server";
import { specialOf } from "@/lib/specials";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const i = Number(new URL(req.url).searchParams.get("index"));
  return NextResponse.json({ special: Number.isInteger(i) ? specialOf(i) : null });
}
