// GitHub webhook receiver for event-triggered coder tasks (src/lib/coderSchedules.ts). ?s=<scheduleId>; the body is verified with that
// schedule's own secret (X-Hub-Signature-256). Only the events/actions the task listens to start a run; a busy run gets the event in its inbox.
import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/coderAuth";
import { eventPrompt, eventSummary, getSchedule, scheduleChatId, verifyHubSignature } from "@/lib/coderSchedules";
import { later, loadState, saveState, startScheduledRun } from "@/lib/coderSections";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("s") || "";
  const raw = await req.text();
  const s = await getSchedule(id);
  if (!s || s.kind !== "event") return NextResponse.json({ error: "unknown" }, { status: 404 });
  const secret = s.hook_secret_enc ? decryptToken(s.hook_secret_enc) : null;
  if (!secret || !verifyHubSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const event = req.headers.get("x-github-event") || "";
  if (event === "ping") return NextResponse.json({ ok: true });
  if (s.paused || !s.events.includes(event)) return NextResponse.json({ status: "ignored" });
  let payload: any = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const summary = eventSummary(event, payload);
  if (!summary) return NextResponse.json({ status: "ignored" });
  const chatId = scheduleChatId(s);
  const botRow = await prisma.bot.findUnique({ where: { id: s.bot_id } }).catch(() => null);
  if (!chatId || !botRow || !botRow.isActive) return NextResponse.json({ status: "ignored" });
  later(async () => {
    const r = await startScheduledRun(new Bot(botRow.token), botRow, chatId, { scheduleId: s.id, title: s.title, prompt: eventPrompt(s, summary), source: "event" });
    if (r === "busy") {
      const st = await loadState(chatId, undefined, `s:${s.id}`);
      st.inbox.push(`[Another GitHub event arrived]\n${summary}`);
      await saveState(chatId, st, undefined, `s:${s.id}`);
    }
  });
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
