import { NextResponse } from "next/server";
import { fetchMarkets } from "@/lib/markets";

export const revalidate = 300;

export async function GET() {
  const data = await fetchMarkets();
  return NextResponse.json(data, {
    headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
