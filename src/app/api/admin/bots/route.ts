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

// Who made this bot and what is it called: getMe gives the @username, and
// getChat(ownerId) (answered only if that customer ever started their own
// bot) gives the customer's name/@username. Best-effort, never throws.
async function botIdentity(token: string, ownerId: string): Promise<{ username: string | null; ownerName: string | null; ownerUsername: string | null }> {
  const call = async (method: string, qs = "") => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}${qs}`, { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      return j?.ok ? j.result : null;
    } catch {
      return null;
    }
  };
  const [me, chat] = await Promise.all([call("getMe"), call("getChat", `?chat_id=${encodeURIComponent(ownerId)}`)]);
  const name = chat ? [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || null : null;
  return { username: me?.username ?? null, ownerName: name, ownerUsername: chat?.username ?? null };
}

// Does the template's main table exist in the database yet? (a bot whose
// migration was never run answers every /start with a Prisma P2021).
const TABLE_PROBE: Record<string, () => Promise<unknown>> = {
  AD_BOT: () => prisma.user.findFirst({ select: { id: true } }),
  MARRIAGE_BOT: () => prisma.matchUser.findFirst({ select: { id: true } }),
  JOBS_BOT: () => prisma.jobsUser.findFirst({ select: { id: true } }),
  MEDICAL_BOT: () => prisma.medUser.findFirst({ select: { id: true } }),
  CONFESSION_BOT: () => prisma.confessionUser.findFirst({ select: { id: true } }),
  NAME_COMPAT_BOT: () => prisma.nameCompatUser.findFirst({ select: { id: true } }),
  QUIZ_BOT: () => prisma.quizUser.findFirst({ select: { id: true } }),
  STREAK_BOT: () => prisma.streakUser.findFirst({ select: { id: true } }),
  PRAYER_BOT: () => prisma.prayerUser.findFirst({ select: { id: true } }),
  CAPSULE_BOT: () => prisma.capsuleUser.findFirst({ select: { id: true } }),
};

async function tablesReady(template: string): Promise<boolean | null> {
  const probe = TABLE_PROBE[template];
  if (!probe) return null;
  try {
    await probe();
    return true;
  } catch {
    return false;
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
  const identities = await Promise.all(bots.map((b) => botIdentity(b.token, b.ownerId)));
  const identityByBotId = new Map(bots.map((b, i) => [b.id, identities[i]]));
  const templates = Array.from(new Set(bots.map((b) => b.template)));
  const readiness = await Promise.all(templates.map((t) => tablesReady(t)));
  const readyByTemplate = new Map(templates.map((t, i) => [t, readiness[i]]));

  return NextResponse.json({
    bots: bots.map((b) => ({
      ...b,
      token: maskToken(b.token),
      userCount: usersByBotId.get(b.id) ?? 0,
      webhook: webhookByBotId.get(b.id),
      identity: identityByBotId.get(b.id),
      tablesReady: readyByTemplate.get(b.template) ?? null,
    })),
  });
}
