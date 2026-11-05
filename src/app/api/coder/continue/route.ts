// The next leg of a long coder answer / agent task (src/lib/coderSections.ts): called by the previous leg just before its 60 s limit,
// signed with the bot's own webhook secret. Answers 202 at once; the work runs in after().
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { continueRun, later, verifyContinue } from "@/lib/coderSections";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { botId?: string; chatId?: string; chain?: string; sig?: string; engineModel?: "coder" | "lfm25" } | null;
  if (!body?.botId || !body.chatId || !body.chain || !body.sig) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const botRow = await prisma.bot.findUnique({ where: { id: body.botId } }).catch(() => null);
  if (!botRow || !botRow.isActive) return NextResponse.json({ status: "ignored" });
  if (body.engineModel !== undefined && body.engineModel !== "coder" && body.engineModel !== "lfm25") return NextResponse.json({ error: "invalid engine model" }, { status: 400 });
  if (!verifyContinue(botRow.webhookSecret || "", botRow.id, body.chatId, body.chain, body.sig, body.engineModel)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const [who, ...rest] = body.chatId.split("#");                    // "<chatId>" or "<chatId>#s:<scheduleId>" (a scheduled task's slot; signed)
  const chatId = Number(who);
  const slot = rest.join("#");
  const chain = body.chain;
  later(() => continueRun(botRow, chatId, chain, undefined, slot, body.engineModel === "lfm25" ? "lfm25" : "coder"));
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
