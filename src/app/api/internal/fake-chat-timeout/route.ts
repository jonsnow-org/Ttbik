import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { dispatchFakeChatCheck, expireFakeChatIfIdle, isValidFakeChatSecret } from "@/lib/matchBotLogic";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const STEP_MS = 50_000;
const TIMEOUT_MS = 5 * 60 * 1000;

async function run(userId: string, lastAt: number) {
  const remaining = lastAt + TIMEOUT_MS - Date.now();
  if (remaining > 0) await new Promise((r) => setTimeout(r, Math.min(remaining + 500, STEP_MS)));
  const state = await expireFakeChatIfIdle(userId, lastAt).catch((e) => {
    console.error("[fake-chat-timeout] check failed", e);
    return "stale" as const;
  });
  if (state === "waiting") await dispatchFakeChatCheck(userId, lastAt);
}

// Answers immediately so the caller never has to cut the request short;
// the actual wait-and-check keeps running in the background via waitUntil.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const lastAt = typeof body?.lastAt === "number" ? body.lastAt : 0;
  if (!userId || !lastAt) return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await isValidFakeChatSecret(userId, req.headers.get("x-fake-chat-secret") || ""))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  waitUntil(run(userId, lastAt));
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}

// Anonymous status: how many fake chats are open and how long each has been
// idle. No user IDs are exposed.
export async function GET() {
  const rows = await prisma.matchUser.findMany({
    where: { pendingAction: { path: ["mode"], equals: "fake_chatting" } },
    select: { pendingAction: true },
  });
  const now = Date.now();
  const chats = rows.map((r) => {
    const p = r.pendingAction as any;
    return { idleSec: p?.lastAt ? Math.round((now - p.lastAt) / 1000) : null, step: p?.step ?? null };
  });
  return NextResponse.json({ open: chats.length, chats });
}
