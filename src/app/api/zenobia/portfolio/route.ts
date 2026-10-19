import { NextRequest, NextResponse } from "next/server";
import { readSnapshot } from "@/lib/znbtIndex";

export const dynamic = "force-dynamic";

/** Public (a wallet's holdings are public on chain): the platform coins this wallet holds, with a value in TON at the current curve price. ?w=<wallet address> */
export async function GET(req: NextRequest) {
  const w = req.nextUrl.searchParams.get("w") || "";
  if (!/^[A-Za-z0-9_:-]{48,70}$/.test(w)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const snap = await readSnapshot();
    const byMinter = new Map((snap?.coins ?? []).filter((c) => c.minter).map((c) => [c.minter!, c]));
    const res = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(w)}/jettons?currencies=ton`, { headers: process.env.TONAPI_KEY ? { authorization: `Bearer ${process.env.TONAPI_KEY}` } : {} });
    if (!res.ok) return NextResponse.json({ ok: false, reason: `tonapi-${res.status}` });
    const j = (await res.json()) as { balances?: { balance?: string; jetton?: { address?: string } }[] };
    const { Address } = await import("@ton/core");
    const norm = (a: string) => { try { return Address.parse(a).toRawString(); } catch { return a; } };
    const minters = new Map([...byMinter].map(([m, c]) => [norm(m), c]));
    const holdings = [];
    for (const b of j.balances ?? []) {
      const coin = minters.get(norm(b.jetton?.address ?? ""));
      if (!coin) continue;
      const bal = BigInt(b.balance ?? "0");
      if (bal <= 0n) continue;
      const tpt = Number(coin.tokensPerTon || 0);
      holdings.push({ curve: coin.curve, name: coin.name, symbol: coin.symbol, image: coin.image, balance: bal.toString(), valueTon: tpt > 0 ? Math.round((Number(bal) / tpt) * 1000) / 1000 : null });
    }
    holdings.sort((a, b) => (b.valueTon ?? 0) - (a.valueTon ?? 0));
    return NextResponse.json({ ok: true, holdings, athar: await atharTokens(w) });
  } catch { return NextResponse.json({ ok: false, reason: "error" }); }
}

// The Athar day-tokens (one NFT per calendar date) this wallet holds: shown as a small "passport" on the portfolio. Public chain data, best effort.
const ATHAR_COLLECTION = "EQAuIOwjzSmGQfL925LjD5eG0Qk1zJNRk4Ap8jzSOwnCRIYf";
async function atharTokens(w: string): Promise<{ count: number; items: { name: string; image: string }[] }> {
  try {
    const r = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(w)}/nfts?collection=${ATHAR_COLLECTION}&limit=60&indirect_ownership=false`, { headers: process.env.TONAPI_KEY ? { authorization: `Bearer ${process.env.TONAPI_KEY}` } : {}, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!r.ok) return { count: 0, items: [] };
    const j = (await r.json()) as { nft_items?: { metadata?: { name?: string; image?: string } }[] };
    const items = (j.nft_items ?? []).map((n) => ({ name: String(n.metadata?.name || "").slice(0, 60), image: String(n.metadata?.image || "") })).filter((n) => n.name);
    return { count: items.length, items: items.slice(0, 12) };
  } catch { return { count: 0, items: [] }; }
}
