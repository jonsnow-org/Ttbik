import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { readProofPayload, verifyTonProof } from "@/lib/zenobiaTonProof";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

/** Verifies the wallet's ton_proof and binds the wallet to the Telegram user the payload was issued for. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const botId = String(body.botId || "");
  const bot = botId ? await prisma.bot.findUnique({ where: { id: botId } }) : null;
  if (!bot || bot.template !== "ZENOBIA_BOT" || !bot.isActive) return NextResponse.json({ error: "unknown bot" }, { status: 404 });

  const userId = readProofPayload(bot.token, String(body.proof?.payload || ""));
  if (!userId) return NextResponse.json({ error: "challenge expired" }, { status: 401 });
  const result = verifyTonProof({ account: body.account, proof: body.proof }, { domain: new URL(SITE).host });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  await ensureZenobiaTables();
  const taken = (await prisma.$queryRawUnsafe(
    `SELECT tg_user_id FROM zenobia_user WHERE bot_id=$1 AND wallet=$2 AND wallet_verified=true AND tg_user_id<>$3 LIMIT 1`, botId, result.address, userId,
  )) as unknown[];
  if (taken.length) return NextResponse.json({ error: "this wallet is already linked to another person" }, { status: 409 });
  await prisma.$executeRawUnsafe(
    `UPDATE zenobia_user SET wallet=$3, wallet_verified=true WHERE bot_id=$1 AND tg_user_id=$2`, botId, userId, result.address,
  );
  await new Bot(bot.token).api.sendMessage(Number(userId), `✅ Wallet verified / تم توثيق المحفظة:\n${result.address}`).catch(() => null);
  return NextResponse.json({ ok: true, address: result.address });
}
