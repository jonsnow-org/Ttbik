import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { readSnapshot } from "@/lib/znbtIndex";

export const dynamic = "force-dynamic";

// Public: a share card (PNG) for one coin: name, symbol, how far it is to graduation, market cap. English only, no price promise.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function GET(req: NextRequest) {
  const c = req.nextUrl.searchParams.get("c") || "";
  if (!/^[A-Za-z0-9_-]{48}$/.test(c)) return NextResponse.json({ error: "bad-coin" }, { status: 400 });
  const snap = await readSnapshot().catch(() => null);
  const coin = snap?.coins.find((x) => x.curve === c);
  if (!coin) return NextResponse.json({ error: "unknown-coin" }, { status: 404 });
  const raised = Number(BigInt(coin.raisedNano || "0") / 1_000_000n) / 1000;
  const goal = Number(BigInt(coin.thresholdNano || "0") / 1_000_000n) / 1000;
  const pct = goal > 0 ? Math.min(100, (raised / goal) * 100) : 0;
  const tpt = Number(coin.tokensPerTon || 0);
  const mc = tpt > 0 ? Number(BigInt(coin.supply)) / 1e9 / (tpt / 1e9) : 0;
  const mcText = mc >= 1000 ? (mc / 1000).toFixed(1) + "K GRAM" : mc > 0 ? mc.toFixed(0) + " GRAM" : "–";
  const bar = Math.round((pct / 100) * 880);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1a3d"/><stop offset="1" stop-color="#06060b"/></linearGradient>
<linearGradient id="b" x1="0" x2="1"><stop offset="0" stop-color="#3ddc84"/><stop offset="1" stop-color="#4da3ff"/></linearGradient></defs>
<rect width="1080" height="1080" fill="url(#g)"/><rect x="24" y="24" width="1032" height="1032" rx="40" fill="none" stroke="#4da3ff" stroke-opacity=".45" stroke-width="3"/>
<text x="90" y="130" font-family="sans-serif" font-size="40" font-weight="700" fill="#4da3ff">Palmyra Launch</text>
<text x="90" y="420" font-family="sans-serif" font-size="170" font-weight="800" fill="#ffffff">${esc(clip(coin.symbol || "", 8))}</text>
<text x="90" y="500" font-family="sans-serif" font-size="54" fill="#c9ccd6">${esc(clip(coin.name || "", 28))}</text>
<text x="90" y="680" font-family="sans-serif" font-size="40" fill="#8a8fa0">Progress to graduation</text>
<rect x="90" y="710" width="880" height="34" rx="17" fill="#ffffff18"/><rect x="90" y="710" width="${Math.max(bar, 8)}" height="34" rx="17" fill="url(#b)"/>
<text x="90" y="810" font-family="sans-serif" font-size="56" font-weight="700" fill="#ffffff">${pct.toFixed(1)}%</text>
<text x="970" y="810" text-anchor="end" font-family="sans-serif" font-size="46" fill="#c9ccd6">Market cap ${esc(mcText)}</text>
<text x="90" y="960" font-family="sans-serif" font-size="38" fill="#4da3ff">Launch your own coin in a few taps</text>
<text x="90" y="1010" font-family="sans-serif" font-size="26" fill="#8a8fa0">Experimental, unaudited contracts. Not financial advice.</text>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
