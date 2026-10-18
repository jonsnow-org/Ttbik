import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { ensureIndexTables, isReason } from "@/lib/znbtIndex";
import { validCurve } from "@/lib/znbtHide";
import { isOwnerServer } from "@/lib/isOwner";

// Anyone can report a coin (scam, impersonation, illegal, copyright, spam). The owner reads the reports and decides whether to hide it.
// Reporting never hides anything by itself, so it cannot be used to attack a coin. 5 reports an hour per address, one per coin per address.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (isRateLimited(`znbt-report:${ip}`, 5, 60 * 60_000)) return NextResponse.json({ error: "too many reports, try later" }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const curve = validCurve(String(b.curve || ""));
  if (!curve || !isReason(b.reason)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await ensureIndexTables();
  const ipHash = crypto.createHash("sha256").update("znbt-report:" + ip).digest("hex").slice(0, 24);
  const dup = (await prisma.$queryRawUnsafe(`SELECT 1 FROM znbt_reports WHERE curve=$1 AND ip_hash=$2 LIMIT 1`, curve, ipHash)) as unknown[];
  if (!dup.length) await prisma.$executeRawUnsafe(`INSERT INTO znbt_reports (curve, reason, details, ip_hash) VALUES ($1,$2,$3,$4)`, curve, b.reason, String(b.details || "").slice(0, 500), ipHash);
  return NextResponse.json({ ok: true });
}

/** Owner (signed in on the site): counts per coin, newest first. */
export async function GET() {
  if (!(await isOwnerServer())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureIndexTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT curve, COUNT(*)::int AS n, MAX(created_at) AS last, (array_agg(reason ORDER BY created_at DESC))[1] AS reason, (array_agg(details ORDER BY created_at DESC))[1] AS details FROM znbt_reports GROUP BY curve ORDER BY MAX(created_at) DESC LIMIT 200`)) as unknown[];
  return NextResponse.json({ reports: rows });
}
