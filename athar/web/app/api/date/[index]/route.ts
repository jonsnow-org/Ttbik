import { NextResponse } from "next/server";
import { dateInfo } from "@/lib/chain";
import { TOTAL_DATES } from "@/lib/dates";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { index: string } }) {
  const i = Number(params.index);
  if (!Number.isInteger(i) || i < 0 || i >= TOTAL_DATES) return NextResponse.json({ error: "bad date" }, { status: 400 });
  return NextResponse.json(await dateInfo(i));
}
