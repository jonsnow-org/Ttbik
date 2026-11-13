import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/znbtConfig";
import { ageLabel } from "@/lib/znbtAge";
import { HOSTING } from "@/lib/hostingOps";

export const dynamic = "force-dynamic";

/**
 * The ZNBt coin icon with an age badge ("new", 1d, 3m, 2y...). The coin's on-chain `image` field points here (on the gate's permanent address), so
 * wallets and indexers that fetch it again show the current age. The age counts from `launchedAt` (found on the chain by lib/znbtConfig.ts);
 * before that, the plain coin is served. Wallets that cache the picture keep showing the age of their last fetch: that is the limit.
 * The picture is read from the server's own files; if they are not there (Vercel does not bundle public/), it is fetched from the other addresses.
 */
async function picture(rel: string): Promise<Buffer | null> {
  try { return fs.readFileSync(path.join(process.cwd(), "public", rel)); } catch { /* not on this disk */ }
  for (const base of [HOSTING.vercelUrl, HOSTING.gateUrl, HOSTING.oracleUrl]) {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/${rel}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (r.ok && (r.headers.get("content-type") || "").includes("image")) return Buffer.from(await r.arrayBuffer());
    } catch { /* try the next address */ }
  }
  return null;
}

export async function GET() {
  let label = "";
  try {
    const cfg = await getConfig();
    const at = cfg.launchedAt ? Date.parse(cfg.launchedAt) : NaN;
    if (Number.isFinite(at)) label = ageLabel(at, Date.now());
  } catch { /* serve the plain coin */ }
  const img = (label ? await picture(`zenobia/znbt/age/${label}.webp`) : null) ?? (await picture("zenobia/znbt-coin.webp"));
  if (!img) return NextResponse.json({ error: "icon unavailable" }, { status: 502 });
  return new NextResponse(new Uint8Array(img), {
    headers: { "content-type": "image/webp", "cache-control": "public, max-age=1800, s-maxage=1800", "x-znbt-age": label || "none" },
  });
}
