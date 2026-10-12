import { NextResponse } from "next/server";
import { fetchEnMarkets } from "@/lib/autoFeeds";

export const revalidate = 300;

export async function GET() {
  const data = await fetchEnMarkets();
  return NextResponse.json(data, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
