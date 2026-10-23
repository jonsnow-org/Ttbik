import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTmaInitData } from "@/lib/tmaInitData";
import { listTasks, taskEvents } from "@/lib/coderTasks";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

let cached: { at: number; row: any } | null = null;
async function coderBot() {
  if (cached && Date.now() - cached.at < 60000) return cached.row;
  const id = process.env.CODER_BOT_ID || "";
  let row = id ? await prisma.bot.findUnique({ where: { id } }).catch(() => null) : null;
  // Must match /api/coder/app exactly so initData is verified against the same bot token.
  if (!row) row = await prisma.bot.findFirst({ where: { template: "NOVA_BOT", isActive: true }, orderBy: { created_at: "asc" } as any }).catch(() => null);
  cached = { at: Date.now(), row };
  return row;
}

/** Mini App terminal feed. Telegram initData is verified server-side; every runId is scoped to that Telegram user. */
export async function GET(req: NextRequest) {
  const botRow = await coderBot();
  if (!botRow) return NextResponse.json({ error: "terminal unavailable (no bot found)" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const user = verifyTmaInitData(req.headers.get("x-telegram-init-data") || "", botRow.token);
  if (!user) return NextResponse.json({ error: "open this from Telegram" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const q = req.nextUrl.searchParams;
  const runId = String(q.get("runId") || "").slice(0, 64);
  const after = Math.max(0, Math.min(2_000_000_000, Number(q.get("after") || 0) || 0));
  const limit = Math.max(1, Math.min(60, Number(q.get("limit") || 30) || 30));
  try {
    if (!runId) {
      const tasks = await listTasks(user.id, { limit });
      return NextResponse.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
    }
    const events = await taskEvents(user.id, runId, after);
    return NextResponse.json({ events: events.slice(0, 200) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "could not read terminal logs" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
