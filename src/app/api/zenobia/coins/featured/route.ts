import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTonProof } from "@/lib/zenobiaTonProof";
import { isOwnerAddress, readHidePayload, validCurve } from "@/lib/znbtHide";
import { hideSecret } from "@/lib/znbtHideDb";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
let ready: Promise<void> | null = null;
const ensure = () => (ready ||= prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_featured (curve TEXT PRIMARY KEY, until TIMESTAMPTZ NOT NULL)`).then(() => undefined).catch((e) => { ready = null; throw e; }));

/** Public: the coins the platform owner marked as sponsored (shown first, labelled SPONSORED) and until when. */
export async function GET() {
  try {
    await ensure();
    const rows = (await prisma.$queryRawUnsafe(`SELECT curve, extract(epoch from until)::bigint AS until FROM znbt_featured WHERE until > now() ORDER BY until DESC LIMIT 20`)) as { curve: string; until: bigint | number }[];
    return NextResponse.json({ featured: rows.map((r) => ({ curve: r.curve, until: Number(r.until) })) }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch { return NextResponse.json({ featured: [] }); }
}

/** Owner only (fresh ton_proof): sponsor a coin for 1 to 30 days, or remove it with days = 0. The arrangement and payment are between the owner and the creator. */
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
  const days = Math.floor(Number(body.days));
  if (!Number.isFinite(days) || days < 0 || days > 30) return NextResponse.json({ error: "days must be 0 to 30" }, { status: 400 });
  await ensure();
  if (days === 0) await prisma.$executeRawUnsafe(`DELETE FROM znbt_featured WHERE curve=$1`, curve);
  else await prisma.$executeRawUnsafe(`INSERT INTO znbt_featured (curve, until) VALUES ($1, now() + ($2 || ' days')::interval) ON CONFLICT (curve) DO UPDATE SET until=EXCLUDED.until`, curve, String(days));
  return NextResponse.json({ ok: true });
}
