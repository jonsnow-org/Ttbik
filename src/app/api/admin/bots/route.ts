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

// Real live webhook check per bot, same underlying Telegram call already
// proven in adBotLogic.ts's "🔌 فحص الويبهوك" super-admin button and in
// /api/bots/health-check — done here automatically for EVERY deployed
// bot at once, so a broken webhook (the other real, previously-confirmed
// cause of "this bot doesn't respond to anyone" -- see that button's own
// comment) shows up right next to user counts instead of needing the
// owner to open each bot individually. Only ever returns safe,
// non-secret fields to the client -- the raw token stays server-side.
type WebhookHealth = { ok: boolean; pendingUpdateCount: number; lastErrorMessage: string | null };

async function checkWebhook(token: string, expectedUrl: string): Promise<WebhookHealth> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!data?.ok) return { ok: false, pendingUpdateCount: 0, lastErrorMessage: "توكن غير صالح أو تعذّر الاتصال" };
    const url = data.result?.url || "";
    return {
      ok: url === expectedUrl,
      pendingUpdateCount: data.result?.pending_update_count ?? 0,
      lastErrorMessage: data.result?.last_error_message || null,
    };
  } catch {
    return { ok: false, pendingUpdateCount: 0, lastErrorMessage: "تعذّر الوصول لخوادم تليجرام" };
  }
}

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

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

  // Real per-bot reach, from BotVisit -- not User.count({ where: { botId
  // } }): that undercounts any bot a person didn't happen to start FIRST
  // on the platform (see migration_31_bot_visit_tracking.sql). This is
  // what actually answers "is this specific bot's promotion working" --
  // the one place the owner asked to see it across every bot at once.
  const visitCounts = await prisma.botVisit.groupBy({ by: ["botId"], _count: { _all: true } });
  const usersByBotId = new Map(visitCounts.map((v) => [v.botId, v._count._all]));

  // A broken webhook silently produces the exact same symptom the owner
  // is chasing ("no growth despite promotion") -- Telegram just stops
  // delivering /start to a bot whose registered URL went stale, and
  // nothing in the app itself would ever show that. Check all of them
  // live, in parallel, rather than requiring one-by-one manual review.
  const webhooks = await Promise.all(
    bots.map((b) => checkWebhook(b.token, `${SITE_URL}/api/telegram/${b.id}`)),
  );
  const webhookByBotId = new Map(bots.map((b, i) => [b.id, webhooks[i]]));

  return NextResponse.json({
    bots: bots.map((b) => ({
      ...b,
      token: maskToken(b.token),
      userCount: usersByBotId.get(b.id) ?? 0,
      webhook: webhookByBotId.get(b.id),
    })),
  });
}
