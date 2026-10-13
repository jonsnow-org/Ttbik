import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTonProof } from "@/lib/zenobiaTonProof";
import { isOwnerAddress, readHidePayload, validCurve } from "@/lib/znbtHide";
import { ensureHiddenTable, hideSecret } from "@/lib/znbtHideDb";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

/** Public: the coins hidden from the lists. */
export async function GET() {
  await ensureHiddenTable();
  const rows = (await prisma.$queryRawUnsafe(`SELECT curve, reason FROM znbt_hidden ORDER BY hidden_at DESC LIMIT 1000`)) as { curve: string; reason: string | null }[];
  return NextResponse.json({ hidden: rows });
}

/** Owner only: hide or unhide a coin. Requires a fresh ton_proof signed by the owner wallet. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const secret = await hideSecret();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (!readHidePayload(secret, String(body.proof?.payload || ""))) return NextResponse.json({ error: "challenge expired" }, { status: 401 });
  const result = verifyTonProof({ account: body.account, proof: body.proof }, { domain: new URL(SITE).host });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  if (!isOwnerAddress(result.address)) return NextResponse.json({ error: "owner wallet only" }, { status: 403 });
  const curve = validCurve(String(body.curve || ""));
  if (!curve) return NextResponse.json({ error: "bad coin address" }, { status: 400 });
  await ensureHiddenTable();
  if (body.hidden === false) {
    await prisma.$executeRawUnsafe(`DELETE FROM znbt_hidden WHERE curve=$1`, curve);
  } else {
    await prisma.$executeRawUnsafe(`INSERT INTO znbt_hidden (curve, reason) VALUES ($1,$2) ON CONFLICT (curve) DO UPDATE SET reason=EXCLUDED.reason, hidden_at=now()`, curve, String(body.reason || "").slice(0, 200) || null);
  }
  return NextResponse.json({ ok: true });
}
