import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
// TON Connect reads this file to show the app's name and icon inside the wallet. The icon is a plain file (public/icon-180.png): the wallet
// shows grey placeholders until it has it, so it must never be drawn on demand (a cold render took seconds).
export async function GET() {
  return NextResponse.json({ url: SITE_URL, name: "Athar", iconUrl: `${SITE_URL}/icon-180.png` }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } });
}
