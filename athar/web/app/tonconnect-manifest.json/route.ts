import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
// TON Connect reads this file to show the app's name and icon inside the wallet.
export async function GET() {
  return NextResponse.json({ url: SITE_URL, name: "Athar", iconUrl: `${SITE_URL}/api/img/collection.png?px=180` }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
