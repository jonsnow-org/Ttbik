import { toncenterKey } from "@/lib/settings";
import { NextResponse } from "next/server";
import { Address } from "@ton/core";
import { isActive, makeClient } from "@/lib/chain";
import { AtharCollection } from "../../../../../build/athar_AtharCollection";
import { AtharMinter } from "../../../../../build/athar_AtharMinter";
import { COLLECTION_URI, DELAY_SEC, SITE_URL, getAdmin } from "@/lib/config";
import { SEASON_1 } from "@/lib/seasons";
export const dynamic = "force-dynamic";

// Read-only progress of a launch for a given admin wallet (public data, no secrets).
export async function GET(req: Request) {
  const secret = process.env.ATHAR_ADMIN_PATH || "";
  if (!secret || req.headers.get("x-athar-adm") !== secret) return new Response("Not Found", { status: 404 });
  const adminStr = new URL(req.url).searchParams.get("admin") || "";
  let admin: Address;
  try { admin = Address.parse(adminStr); } catch { return NextResponse.json({ error: "bad admin" }, { status: 400 }); }
  const client = makeClient();
  const gap = () => new Promise((r) => setTimeout(r, toncenterKey() ? 100 : 1100));
  const collection = await AtharCollection.fromInit(admin, COLLECTION_URI, BigInt(DELAY_SEC));
  const minter = await AtharMinter.fromInit(collection.address, admin, BigInt(SEASON_1.id), BigInt(SEASON_1.rangeStart), BigInt(SEASON_1.rangeEnd));
  const out: Record<string, unknown> = {
    siteUrl: SITE_URL, envAdmin: getAdmin(), collection: collection.address.toString({ bounceable: true }), minter: minter.address.toString({ bounceable: true }),
    collectionActive: false, minterActive: false,
  };
  try { out.balance = Number(await client.getBalance(admin)) / 1e9; } catch { out.balance = null; }
  await gap();
  try {
    if (!(await isActive(collection.address))) throw new Error("not deployed");
    const c = client.open(AtharCollection.fromAddress(collection.address));
    const p = await c.getPayoutAddress();
    out.collectionActive = true; out.payout = p ? p.toString() : null; out.minted = Number(await c.getTotalMinted());
  } catch { /* not deployed */ }
  await gap();
  try {
    if (!(await isActive(minter.address))) throw new Error("not deployed");
    const m = client.open(AtharMinter.fromAddress(minter.address));
    out.minterActive = true;
    out.status = Number(await m.getStatus());
    out.soldCount = Number(await m.getSoldCount());
    await gap();
    out.priceNormal = Number(await m.getPrice(0n)) / 1e9;
    out.priceGold = Number(await m.getPrice(2n)) / 1e9;
    await gap();
    out.capLegendary = Number((await m.getKindInfo(7n)).cap);       // set in the second launch group: the signal that every kind is configured
    await gap();
    const my = await m.getMysteryInfo();
    out.poolSize = Number(my.poolSize); out.poolLoaded = Number(my.loaded); out.ticketsSold = Number(my.ticketsSold); out.revealed = my.revealed; out.revealAt = Number(my.revealAt);
    out.commitSet = my.commitHash !== 0n;
  } catch { /* not deployed */ }
  return NextResponse.json(out);
}
