import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// force-dynamic: no request-scoped input, so Next.js would otherwise bake
// this list into the build output instead of reading it live.
export const dynamic = "force-dynamic";

function maskToken(token: string): string {
  // BotFather tokens look like "123456789:AA...xyz" — keep just enough to
  // recognize the bot without exposing a working credential in an admin
  // screen (matches AGENT_BUS.md: never let an endpoint leak a working
  // token to anyone but the owner — this route itself IS the owner-only
  // path, but there's no reason to render the raw secret on screen either).
  const [id, secret] = token.split(":");
  if (!secret) return token.slice(0, 6) + "…";
  return `${id}:${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export async function GET() {
  const bots = await prisma.bot.findMany({
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      token: true,
      ownerId: true,
      template: true,
      totalRevenue: true,
      ownerBalance: true,
      pendingBalance: true,
      isActive: true,
      requiredChannel: true,
      created_at: true,
    },
  });

  return NextResponse.json({
    bots: bots.map((b) => ({ ...b, token: maskToken(b.token) })),
  });
}
