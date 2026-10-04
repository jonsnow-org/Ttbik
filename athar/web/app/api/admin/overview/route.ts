import { NextResponse } from "next/server";
import { Address } from "@ton/core";
import { addresses, allTokens, makeClient, tokensOf } from "@/lib/chain";
import { AtharCollection } from "../../../../../build/athar_AtharCollection";
import { TONCENTER_V3, getAdmin } from "@/lib/config";
import { SEASON_1, seasonTier, seasonSize } from "@/lib/seasons";
export const dynamic = "force-dynamic";

// The owner's overview after launch: how much sold, to whom (counts only), what reached the payout wallet and when. All from public chain data.
export async function GET(req: Request) {
  const secret = process.env.ATHAR_ADMIN_PATH || "";
  if (!secret || req.headers.get("x-athar-adm") !== secret) return new Response("Not Found", { status: 404 });
  const a = await addresses(1);
  if (!a) return NextResponse.json({ deployed: false });
  const tokens = await allTokens();
  const byTier = [0, 0, 0];
  const owners = new Map<string, number>();
  for (const t of tokens) { byTier[seasonTier(SEASON_1, t.index)]++; owners.set(t.owner, (owners.get(t.owner) || 0) + 1); }
  const top = [...owners.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([o, n]) => ({ owner: o, tokens: n }));
  const out: Record<string, unknown> = { deployed: true, minted: tokens.length, size: seasonSize(SEASON_1), byTier, holders: owners.size, top };
  try {
    const payout = await makeClient().open(AtharCollection.fromAddress(a.collection.address)).getPayoutAddress();
    if (payout) {
      out.payout = payout.toString();
      // the public node answers empty for large pages: ask 20 at a time (up to 10 pages), spaced out
      const txs: { now: number; in_msg?: { source?: string; value?: string } }[] = [];
      for (let page = 0; page < 10; page++) {
        const r = await fetch(`${TONCENTER_V3}/transactions?account=${encodeURIComponent(payout.toString())}&limit=20&offset=${page * 20}&sort=desc`, { headers: process.env.TONCENTER_API_KEY ? { "X-API-Key": process.env.TONCENTER_API_KEY } : {}, cache: "no-store" });
        if (!r.ok) break;
        const got = ((await r.json()).transactions || []) as typeof txs;
        txs.push(...got);
        if (got.length < 20) break;
        await new Promise((x) => setTimeout(x, process.env.TONCENTER_API_KEY ? 150 : 1100));
      }
      const sales = txs.filter((t) => { try { return !!t.in_msg?.source && Address.parse(t.in_msg.source).equals(a.collection.address) && Number(t.in_msg.value) > 0; } catch { return false; } })
        .map((t) => ({ at: t.now, ton: Number(t.in_msg!.value) / 1e9 }));
      const day = Math.floor(Date.now() / 86400000);
      out.revenue = sales.reduce((x, y) => x + y.ton, 0);
      out.salesToday = sales.filter((x) => Math.floor(x.at / 86400) === day).length;
      out.recent = sales.slice(0, 15);
      out.revenueNote = txs.length >= 200 ? "آخر 200 عملية فقط" : "كل العمليات";
    }
  } catch { /* the rest still shows */ }
  const admin = getAdmin();
  if (admin) { try { out.mine = await tokensOf(admin); } catch { /* ignore */ } }
  return NextResponse.json(out);
}
