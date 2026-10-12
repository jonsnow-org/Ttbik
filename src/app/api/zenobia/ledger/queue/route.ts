import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

export const dynamic = "force-dynamic";

/**
 * For the ledger wallet on Oracle (same key as the Oracle health report: x-ops-key).
 * Returns the passports waiting to be minted, oldest first, and only while the owner has them open (/passports on).
 */
export async function GET(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-ops-key") || "", s)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureZenobiaTables();
  const open = (await prisma.$queryRawUnsafe(`SELECT 1 FROM zenobia_config WHERE k='passports' AND v='on' LIMIT 1`)) as unknown[];
  if (!open.length) return NextResponse.json({ open: false, items: [] });
  const items = (await prisma.$queryRawUnsafe(
    `SELECT idx, wallet FROM zenobia_passport WHERE status='requested' AND wallet IS NOT NULL ORDER BY idx ASC LIMIT 5`,
  )) as { idx: number; wallet: string }[];
  return NextResponse.json({ open: true, items });
}
