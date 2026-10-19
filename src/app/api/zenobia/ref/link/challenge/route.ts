import { NextRequest, NextResponse } from "next/server";
import { tgUserFromInit } from "@/lib/znbtEngage";
import { linkChallenge } from "@/lib/znbtRefs";

export const dynamic = "force-dynamic";

/** The journey page asks for the ton_proof payload the wallet will sign (bound to this Telegram user). */
export async function POST(req: NextRequest) {
  const tg = await tgUserFromInit(req.headers.get("x-tg-init") || "");
  if (!tg) return NextResponse.json({ error: "open in Telegram" }, { status: 401 });
  const payload = await linkChallenge(tg);
  return payload ? NextResponse.json({ payload }) : NextResponse.json({ error: "not available" }, { status: 503 });
}
