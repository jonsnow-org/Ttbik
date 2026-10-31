// The next leg of a long candidate task (src/lib/coderSections.ts, followDonorJob): the previous leg hands the running Studio job here,
// signed with the bot's own webhook secret. Answers 202 at once; the polling runs in after().
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { continueDonorRun, later, verifyContinue, type DonorChain } from "@/lib/coderSections";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { botId?: string; chatId?: string; chain?: string; sig?: string } | null;
  if (!body?.botId || !body.chatId || !body.chain || !body.sig) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const botRow = await prisma.bot.findUnique({ where: { id: body.botId } }).catch(() => null);
  if (!botRow || !botRow.isActive) return NextResponse.json({ status: "ignored" });
  if (!verifyContinue(botRow.webhookSecret || "", botRow.id, body.chatId, body.chain, body.sig)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let chain: DonorChain;
  try { chain = JSON.parse(Buffer.from(body.chain, "base64url").toString("utf8")) as DonorChain; } catch { return NextResponse.json({ error: "bad chain" }, { status: 400 }); }
  const chatId = Number(body.chatId);
  if (!Number.isFinite(chatId) || !chain.runId || !chain.jobId || !chain.id) return NextResponse.json({ error: "bad chain" }, { status: 400 });
  later(() => continueDonorRun(botRow, chatId, chain));
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
