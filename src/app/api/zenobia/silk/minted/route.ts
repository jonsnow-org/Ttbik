import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { ensureSilkTables } from "@/lib/zenobiaSilk";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

export const dynamic = "force-dynamic";

/** The ledger reports that a passport now exists on-chain (or that a payment was returned). */
export async function POST(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-ops-key") || "", s)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await ensureZenobiaTables(); await ensureSilkTables();
  if (body.refunded === true) {
    await prisma.$executeRawUnsafe(`UPDATE zenobia_silk SET status='refunded' WHERE id=$1 AND status='quoted'`, id);
    return NextResponse.json({ ok: true });
  }
  const idx = Number(body.idx);
  const item = String(body.item || "");
  if (!Number.isInteger(idx) || idx < 0 || !/^[A-Za-z0-9_-]{48}$/.test(item)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await prisma.$executeRawUnsafe(`UPDATE zenobia_silk SET status='minted', idx=$2, item=$3, minted_at=now() WHERE id=$1 AND status='quoted'`, id, idx, item);
  return NextResponse.json({ ok: true });
}
