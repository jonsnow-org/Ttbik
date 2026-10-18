import { NextResponse } from "next/server";

// TonConnect manifest of the Zenobia pages. Generated from the site's public address (NEXT_PUBLIC_SITE_URL) instead of a fixed file, so that after
// the move behind the gate the manifest's host, the page's host and the ton_proof domain our server checks are always the same host.
export const dynamic = "force-dynamic";

export async function GET() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  return NextResponse.json({ url: site, name: "Zenobia Caravan", iconUrl: `${site}/zenobia/coin-icon.png` }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
