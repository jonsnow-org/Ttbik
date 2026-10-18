import { NextRequest, NextResponse } from "next/server";
import { ageLabel } from "@/lib/znbtAge";

export const dynamic = "force-dynamic";

/**
 * The ZNBt coin icon with an age badge ("new", 1d, 3m, 2y...). The coin's on-chain `image` field points here, so wallets and indexers that
 * fetch it again show the current age. The age counts from `launchedAt` in /zenobia/znbt/config.json (written when the coin is launched);
 * before that, the plain coin is served. Wallets that cache the picture keep showing the age of their last fetch: that is the limit of the idea.
 * The file must stay reachable for as long as the coin lives (the on-chain data also holds a small copy of the coin, with no badge).
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  let label = "";
  try {
    const cfg = (await (await fetch(`${origin}/zenobia/znbt/config.json`, { cache: "no-store" })).json()) as { launchedAt?: string };
    const at = cfg.launchedAt ? Date.parse(cfg.launchedAt) : NaN;
    if (Number.isFinite(at)) label = ageLabel(at, Date.now());
  } catch { /* serve the plain coin */ }
  const res = await fetch(`${origin}${label ? `/zenobia/znbt/age/${label}.webp` : "/zenobia/znbt-coin.webp"}`, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "icon unavailable" }, { status: 502 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: { "content-type": "image/webp", "cache-control": "public, max-age=1800, s-maxage=1800", "x-znbt-age": label || "none" },
  });
}
