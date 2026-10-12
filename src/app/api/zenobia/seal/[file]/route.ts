import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { sealSvg } from "@/lib/zenobiaScore";

export const dynamic = "force-dynamic";

/** The living seal of a closed season: GET /api/zenobia/seal/2026-W42.svg (derived only from the season's result hash). */
export async function GET(_req: NextRequest, props: { params: Promise<{ file: string }> }) {
  const { file } = await props.params;
  const m = /^(\d{4}-W\d{2})\.svg$/.exec(file);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  await ensureZenobiaTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT hash FROM zenobia_season WHERE season=$1`, m[1])) as { hash: string }[];
  if (!rows[0]) return NextResponse.json({ error: "season not closed" }, { status: 404 });
  return new NextResponse(sealSvg(rows[0].hash), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable" } });
}
