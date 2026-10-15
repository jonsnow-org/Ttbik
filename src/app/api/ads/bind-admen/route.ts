import { NextResponse } from "next/server";
import { bindAdmenBot } from "@/lib/siteAds";

export async function POST() {
  const result = await bindAdmenBot();
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
