import { NextRequest, NextResponse } from "next/server";
import { dispatchFakeChatCheck, expireFakeChatIfIdle, isValidFakeChatSecret } from "@/lib/matchBotLogic";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const STEP_MS = 50_000;
const TIMEOUT_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const lastAt = typeof body?.lastAt === "number" ? body.lastAt : 0;
  if (!userId || !lastAt) return NextResponse.json({ ok: false }, { status: 400 });
  if (!(await isValidFakeChatSecret(userId, req.headers.get("x-fake-chat-secret") || ""))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const remaining = lastAt + TIMEOUT_MS - Date.now();
  if (remaining > 0) await new Promise((r) => setTimeout(r, Math.min(remaining + 500, STEP_MS)));

  const state = await expireFakeChatIfIdle(userId, lastAt).catch(() => "stale" as const);
  if (state === "waiting") await dispatchFakeChatCheck(userId, lastAt);
  return NextResponse.json({ ok: true, state });
}
