// One scheduled run (fanned out by /api/coder/schedules/tick, signed). Answers 202 at once; the task runs in after() and continues
// itself through /api/coder/continue like any long task.
import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { cronPrompt, getSchedule, scheduleChatId, scheduleRunFinished, verifyRun } from "@/lib/coderSchedules";
import { later, startScheduledRun } from "@/lib/coderSections";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; at?: number; sig?: string } | null;
  if (!body?.id || !body.sig || !verifyRun(body.id, Number(body.at), body.sig)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const s = await getSchedule(body.id);
  if (!s || s.paused) return NextResponse.json({ status: "ignored" });
  const chatId = scheduleChatId(s);
  const botRow = await prisma.bot.findUnique({ where: { id: s.bot_id } }).catch(() => null);
  if (!chatId || !botRow || !botRow.isActive) return NextResponse.json({ status: "ignored" });
  later(async () => {
    const r = await startScheduledRun(new Bot(botRow.token), botRow, chatId, { scheduleId: s.id, title: s.title, prompt: cronPrompt(s), source: "scheduled" });
    if (r !== "started") await scheduleRunFinished(s.id, r === "busy" ? "skipped_busy" : "off");
  });
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
