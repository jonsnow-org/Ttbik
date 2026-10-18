import { NextRequest, NextResponse } from "next/server";
import { readSnapshot } from "@/lib/znbtIndex";
import { Address } from "@ton/core";

export const dynamic = "force-dynamic";

// Public: the biggest holders of a coin (from tonapi), with their share of the supply. The coin's own bonding curve holds the unsold part and is labelled so.
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const c = req.nextUrl.searchParams.get("c") || "";
  if (!/^[A-Za-z0-9_-]{48}$/.test(c)) return NextResponse.json({ ok: false }, { status: 400 });
  const hit = cache.get(c);
  if (hit && Date.now() - hit.at < 5 * 60_000) return NextResponse.json(hit.body);
  try {
    const snap = await readSnapshot();
    const coin = snap?.coins.find((x) => x.curve === c);
    if (!coin?.minter) return NextResponse.json({ ok: false, reason: "unknown-coin" });
    const res = await fetch(`https://tonapi.io/v2/jettons/${encodeURIComponent(coin.minter)}/holders?limit=15`, { headers: process.env.TONAPI_KEY ? { authorization: `Bearer ${process.env.TONAPI_KEY}` } : {} });
    if (!res.ok) return NextResponse.json({ ok: false, reason: `tonapi-${res.status}` });
    const j = (await res.json()) as { addresses?: { owner?: { address?: string }; balance?: string }[]; total?: number };
    const supply = BigInt(coin.supply);
    const curveRaw = Address.parse(c).toRawString();
    const holders = (j.addresses ?? []).map((h) => {
      const owner = h.owner?.address ?? "";
      const bal = BigInt(h.balance ?? "0");
      return { owner, bps: supply > 0n ? Number((bal * 10000n) / supply) : 0, isCurve: owner.toLowerCase() === curveRaw.toLowerCase(), isCreator: owner.toLowerCase() === Address.parse(coin.creator).toRawString().toLowerCase() };
    });
    const body = { ok: true, total: j.total ?? holders.length, holders };
    cache.set(c, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch { return NextResponse.json({ ok: false, reason: "error" }); }
}
