import { NextRequest, NextResponse } from "next/server";
import { Address } from "@ton/core";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { ensureSilkTables, silkConfig, silkPriceGram, SILK_CAP } from "@/lib/zenobiaSilk";
import { holdsCoin, LEDGER_RAW } from "@/lib/zenobiaPay";

export const dynamic = "force-dynamic";

/**
 * A holder asks to buy a passport. Nothing is charged here: this only checks the rules (open, not sold out, the wallet holds enough ZNB)
 * and returns what to send. The ledger mints only after it sees the payment on the chain.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let wallet: Address;
  try { wallet = Address.parse(String(body.wallet || "")); } catch { return NextResponse.json({ error: "bad wallet" }, { status: 400 }); }
  await ensureZenobiaTables(); await ensureSilkTables();
  const jetton = await silkConfig("jetton");
  if (!jetton || (await silkConfig("silk")) !== "on") return NextResponse.json({ error: "not_open" }, { status: 409 });
  const minted = Number(((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM zenobia_silk WHERE status='minted'`)) as { n: number }[])[0]?.n ?? 0);
  if (minted >= SILK_CAP) return NextResponse.json({ error: "sold_out" }, { status: 409 });
  const min = BigInt((await silkConfig("silk_min")) || "0");
  try {
    if (!(await holdsCoin(wallet.toString(), jetton, { apiKey: process.env.TONAPI_KEY, minBalance: min > 0n ? min : 1n }))) return NextResponse.json({ error: "need_znb", min: String(min) }, { status: 403 });
  } catch { return NextResponse.json({ error: "try_again" }, { status: 503 }); }
  const raw = wallet.toRawString();
  const open = (await prisma.$queryRawUnsafe(`SELECT id FROM zenobia_silk WHERE wallet=$1 AND status='quoted' ORDER BY id DESC LIMIT 1`, raw)) as { id: number }[];
  const id = open[0]?.id ?? Number(((await prisma.$queryRawUnsafe(`INSERT INTO zenobia_silk (wallet) VALUES ($1) RETURNING id`, raw)) as { id: number }[])[0].id);
  return NextResponse.json({
    claimId: id,
    comment: `SILK-${id}`,
    to: Address.parseRaw(LEDGER_RAW).toString({ bounceable: false }),
    priceGram: silkPriceGram(minted),
    note: "Send at least the price from this same wallet with this exact comment. Payments that break the rules are returned minus a small fee.",
  });
}
