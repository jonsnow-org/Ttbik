import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTmaInitData } from "@/lib/tmaInitData";
import { prismaDb } from "@/lib/coderAuth";
import { taskEvents, type TaskModelFilter } from "@/lib/coderTasks";
import { terminalAllowed } from "@/lib/coderPlans";

export const dynamic = "force-dynamic";
// Reconnect with the last event id before this ceiling; the stream never owns or runs the task.
export const maxDuration = 300;

let cached: { at: number; row: any } | null = null;
async function coderBot() {
  if (cached && Date.now() - cached.at < 60000) return cached.row;
  const id = process.env.CODER_BOT_ID || "";
  let row = id ? await prisma.bot.findUnique({ where: { id } }).catch(() => null) : null;
  if (!row) row = await prisma.bot.findFirst({ where: { template: "NOVA_BOT", isActive: true }, orderBy: { created_at: "asc" } as any }).catch(() => null);
  cached = { at: Date.now(), row };
  return row;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Authenticated live task feed. The event log is durable; reconnecting with after replays anything missed. */
export async function GET(req: NextRequest) {
  const botRow = await coderBot();
  if (!botRow) return NextResponse.json({ error: "terminal unavailable (no bot found)" }, { status: 503 });
  const user = verifyTmaInitData(req.headers.get("x-telegram-init-data") || "", botRow.token);
  if (!user) return NextResponse.json({ error: "open this from Telegram" }, { status: 401 });

  if (!(await terminalAllowed(user.id))) return NextResponse.json({ error: "not available on this plan", hidden: true }, { status: 403 });   // free plan: no terminal (owner and paid plans only)
  const q = req.nextUrl.searchParams;
  const runId = String(q.get("runId") || "").slice(0, 64);
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
  const requestedModel = String(q.get("model") || "all");
  if (!["all", "coder", "sham", "sham_v2"].includes(requestedModel)) return NextResponse.json({ error: "bad model" }, { status: 400 });
  const modelFilter = requestedModel === "all" ? undefined : requestedModel as TaskModelFilter;
  let cursor = Math.max(0, Math.min(2_000_000_000, Number(q.get("after") || 0) || 0));

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const started = Date.now();
      let lastPing = Date.now();
      const write = (s: string) => {
        if (!closed && !cancelled) controller.enqueue(encoder.encode(s));
      };
      try {
        write(": connected\n\n");
        while (!closed && !cancelled && Date.now() - started < 270000) {
          const rows = await taskEvents(user.id, runId, cursor, prismaDb, modelFilter);
          for (const ev of rows) {
            if (closed) break;
            cursor = Math.max(cursor, ev.id);
            write("id: " + ev.id + "\nevent: task\ndata: " + JSON.stringify(ev) + "\n\n");
            if (ev.kind === "done" || ev.kind === "failed") {
              closed = true;
              break;
            }
          }
          if (closed) break;
          if (Date.now() - lastPing >= 15000) {
            write(": keep-alive\n\n");
            lastPing = Date.now();
          }
          await pause(1200);
        }
      } catch {
        // Network disconnects are expected; the client reconnects from its last durable event id.
      } finally {
        try { controller.close(); } catch { /* already closed or cancelled */ }
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
