import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { ensureSilkTables, silkConfig } from "@/lib/zenobiaSilk";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

export const dynamic = "force-dynamic";

/** For the ledger wallet on Oracle (x-ops-key): the approved requests it should look for a payment for. It checks the payment on the chain itself. */
export async function GET(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-ops-key") || "", s)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureZenobiaTables(); await ensureSilkTables();
  if ((await silkConfig("silk")) !== "on") return NextResponse.json({ claims: [] });
  const claims = (await prisma.$queryRawUnsafe(
    `SELECT id, wallet FROM zenobia_silk WHERE status='quoted' AND created_at > now() - interval '3 days' ORDER BY id ASC LIMIT 20`,
  )) as { id: number; wallet: string }[];
  return NextResponse.json({ claims });
}
