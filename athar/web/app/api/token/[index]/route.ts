import { NextResponse } from "next/server";
import { tokenState } from "@/lib/chain";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: { index: string } }) {
  const t = await tokenState(Number(params.index));
  return t ? NextResponse.json(t) : NextResponse.json({ error: "not minted" }, { status: 404 });
}
