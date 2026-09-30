import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

// Data-retention cleanup (owner spec, 2026-09-05): none of these tables
// store actual message content — random-chat text is relayed live through
// Telegram's own servers and never touches our DB — so this is purely
// metadata-row housekeeping, not a privacy-driven purge. Runs daily
// (Vercel Hobby cron only supports daily granularity anyway); every
// delete is bounded by created_at, so running it more often than the
// nominal "monthly" framing is harmless and keeps the tables consistently
// small instead of doing one big delete at a time.
const PAGE_VIEW_RETENTION_DAYS = 90;
const RANDOM_CHAT_QUEUE_RETENTION_HOURS = 24;
const RANDOM_CHAT_SESSION_RETENTION_DAYS = 180;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const queueCutoff = new Date(Date.now() - RANDOM_CHAT_QUEUE_RETENTION_HOURS * 60 * 60 * 1000);
  const deletedQueue = await prisma.randomChatQueue.deleteMany({ where: { created_at: { lt: queueCutoff } } });

  const sessionCutoff = new Date(Date.now() - RANDOM_CHAT_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deletedSessions = await prisma.randomChatSession.deleteMany({ where: { created_at: { lt: sessionCutoff } } });

  const pageViewCutoff = new Date(Date.now() - PAGE_VIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: pageViewError, count: deletedPageViews } = await supabaseAdmin()
    .from("page_views")
    .delete({ count: "exact" })
    .lt("created_at", pageViewCutoff);

  return NextResponse.json({
    ok: true,
    deletedRandomChatQueue: deletedQueue.count,
    deletedRandomChatSessions: deletedSessions.count,
    deletedPageViews: deletedPageViews ?? 0,
    pageViewError: pageViewError?.message ?? null,
  });
}
