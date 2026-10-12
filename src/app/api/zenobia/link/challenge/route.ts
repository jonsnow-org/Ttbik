import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { makeProofPayload, readLinkToken } from "@/lib/zenobiaTonProof";

export const dynamic = "force-dynamic";

/** The connect page asks for the ton_proof payload with the signed link token the bot gave the user. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const botId = String(body.botId || "");
  const bot = botId ? await prisma.bot.findUnique({ where: { id: botId } }) : null;
  if (!bot || bot.template !== "ZENOBIA_BOT" || !bot.isActive) return NextResponse.json({ error: "unknown bot" }, { status: 404 });
  const userId = readLinkToken(bot.token, String(body.t || ""));
  if (!userId) return NextResponse.json({ error: "link expired" }, { status: 401 });
  return NextResponse.json({ payload: makeProofPayload(bot.token, userId) });
}
