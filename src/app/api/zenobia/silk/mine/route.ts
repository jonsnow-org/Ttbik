import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { ensureSilkTables, silkConfig, silkStage } from "@/lib/zenobiaSilk";
import { holdsCoin } from "@/lib/zenobiaPay";
import { rawAddress } from "@/lib/zenobiaSeason";

export const dynamic = "force-dynamic";

/** Public. The Silk Road Passports a wallet owns right now, with their stage and when each can be traded. */
export async function GET(req: NextRequest) {
  let raw: string;
  try { raw = rawAddress(req.nextUrl.searchParams.get("wallet") || ""); } catch { return NextResponse.json({ error: "bad wallet" }, { status: 400 }); }
  try {
    await ensureZenobiaTables(); await ensureSilkTables();
    const minted = (await prisma.$queryRawUnsafe(`SELECT idx, item, minted_at FROM zenobia_silk WHERE status='minted' AND item IS NOT NULL ORDER BY idx`)) as { idx: number; item: string; minted_at: Date }[];
    const headers = process.env.TONAPI_KEY ? { authorization: `Bearer ${process.env.TONAPI_KEY}` } : undefined;
    const res = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(raw)}/nfts?limit=1000&indirect_ownership=false`, { headers });
    if (!res.ok) return NextResponse.json({ error: "try_again" }, { status: 503 });
    const owned = new Set(((await res.json()) as { nft_items?: { address: string }[] }).nft_items?.map((n) => rawAddress(n.address)) ?? []);
    const jetton = await silkConfig("jetton");
    const holds = jetton ? await holdsCoin(raw, jetton, { apiKey: process.env.TONAPI_KEY }).catch(() => true) : true;
    const now = Date.now();
    const passports = minted.filter((m) => { try { return owned.has(rawAddress(m.item)); } catch { return false; } }).map((m) => {
      const days = Math.max(0, Math.floor((now - new Date(m.minted_at).getTime()) / 86400000));
      return { idx: m.idx, days, stage: silkStage(days, { captive: !holds }), tradableInDays: Math.max(0, 30 - days) };
    });
    return NextResponse.json({ holdsZnb: holds, passports });
  } catch {
    return NextResponse.json({ error: "try_again" }, { status: 503 });
  }
}
