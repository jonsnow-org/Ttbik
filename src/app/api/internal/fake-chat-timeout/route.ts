import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredFakeChats } from "@/lib/matchBotLogic";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { startedAt } = await req.json().catch(() => ({ startedAt: Date.now() }));

  await new Promise((r) => setTimeout(r, 55_000));

  const cleaned = await cleanupExpiredFakeChats().catch(() => 0);

  const remaining = await prisma.matchUser
    .count({ where: { pendingAction: { path: ["mode"], equals: "fake_chatting" } } })
    .catch(() => 0);

  if (remaining > 0 && Date.now() - startedAt < 7 * 60 * 1000) {
    const host = req.headers.get("host") || process.env.VERCEL_URL;
    if (host) {
      const proto = host.includes("localhost") ? "http" : "https";
      fetch(`${proto}://${host}/api/internal/fake-chat-timeout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedAt }),
      }).catch(() => null);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return NextResponse.json({ ok: true, cleaned, remaining });
}
