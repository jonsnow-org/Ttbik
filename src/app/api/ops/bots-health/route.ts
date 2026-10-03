import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

// Live health of every hosted bot (template, @username, webhook registered correctly, pending updates,
// last Telegram delivery error). Read-only, no tokens in the output. Key = the same token-derived ops key.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

async function tg(token: string, method: string) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j?.ok ? j.result : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-ops-key") || "", s)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const bots = await prisma.bot.findMany({ select: { id: true, token: true, template: true, isActive: true } });
  const rows = await Promise.all(
    bots.map(async (b) => {
      const [me, wh] = await Promise.all([tg(b.token, "getMe"), tg(b.token, "getWebhookInfo")]);
      return {
        template: b.template,
        username: me?.username ?? null,
        active: b.isActive,
        tokenValid: !!me,
        webhookOk: !!wh && wh.url === `${SITE_URL}/api/telegram/${b.id}`,
        pending: wh?.pending_update_count ?? null,
        lastError: wh?.last_error_message ? String(wh.last_error_message).slice(0, 120) : null,
        lastErrorAgoMin: wh?.last_error_date ? Math.round((Date.now() / 1000 - wh.last_error_date) / 60) : null,
      };
    }),
  );
  return NextResponse.json({ checked: rows.length, bad: rows.filter((r) => r.active && (!r.tokenValid || !r.webhookOk)).length, bots: rows });
}
