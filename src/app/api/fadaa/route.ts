import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { verifyTmaInitData } from "@/lib/tmaInitData";

export const dynamic = "force-dynamic";

const botUsernameCache = new Map<string, { username: string; expiresAt: number }>();

async function getBotUsername(botToken: string): Promise<string | null> {
  const cached = botUsernameCache.get(botToken);
  if (cached && cached.expiresAt > Date.now()) return cached.username;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    const payload = await response.json() as { ok?: boolean; result?: { username?: string } };
    const username = payload.ok && payload.result?.username ? payload.result.username : null;
    if (username) botUsernameCache.set(botToken, { username, expiresAt: Date.now() + 60 * 60 * 1000 });
    return username;
  } catch {
    return null;
  }
}

type TelegramUser = { id: string; name: string; username?: string };
type SessionRow = {
  id: string; bot_id: string | null; kind: string; title: string; purpose: string;
  duration_hours: number; visibility: string; plan: string; status: string;
  owner_id: string; owner_name: string; created_at: string; closes_at: string;
  closed_at?: string | null; participant_ids: string[]; roles: Record<string, string>;
};
type ContributionRow = {
  id: string; session_id: string; author_id: string; author_name: string;
  role: string; kind: string; text: string; created_at: string; hidden?: boolean;
};

const PAGE_SIZE = 80;
const SESSION_KINDS = new Set(["knowledge", "experience", "decision"]);
const CONTRIBUTION_KINDS = new Set([
  "clarify", "example", "correct", "step", "precise_q", "stage_update",
  "companion_note", "companion_q", "new_angle", "missing_option", "risk",
  "criterion", "rephrase", "decisive_q",
]);
function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Verify Telegram Mini App initData using the shared official validator. */
function verifyTelegramInitData(initData: string, botToken: string): TelegramUser | null {
  const verified = verifyTmaInitData(initData, botToken);
  if (!verified) return null;

  try {
    const params = new URLSearchParams(initData);
    const rawUser = params.get("user");
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser) as {
      id?: number | string; first_name?: string; last_name?: string; username?: string;
    };
    if (!parsed.id || String(parsed.id) !== verified.id) return null;
    const name = [parsed.first_name, parsed.last_name].filter(Boolean).join(" ").trim()
      || parsed.username || verified.firstName || "مستخدم";
    return { id: verified.id, name: name.slice(0, 40), username: parsed.username };
  } catch {
    return null;
  }
}

async function getContext(req: NextRequest) {
  const botId = req.nextUrl.searchParams.get("bot") || "";
  if (!/^[0-9a-f-]{36}$/i.test(botId)) {
    return { error: jsonError("رابط فضاء غير مكتمل. افتح التطبيق من البوت.", 400) } as const;
  }

  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot || !bot.isActive || bot.template !== "FADAA_BOT") {
    return { error: jsonError("بوت فضاء غير نشط أو غير معروف.", 404) } as const;
  }

  const initData = req.headers.get("x-telegram-init-data") || "";
  const user = verifyTelegramInitData(initData, bot.token);
  if (!user) return { error: jsonError("تعذّر التحقق من جلسة Telegram. أعد فتح التطبيق من داخل البوت.", 401) } as const;

  const db = getDatabase();
  if (!db) return { error: jsonError("قاعدة بيانات فضاء غير مهيأة. يلزم ضبط SUPABASE_SERVICE_ROLE_KEY على الخادم.", 503) } as const;
  return { botId, bot, user, isOwner: user.id === String(bot.ownerId), db } as const;
}

function getDatabase(): SupabaseClient | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function mapSession(row: SessionRow) {
  return {
    id: String(row.id),
    kind: String(row.kind || "knowledge"),
    title: String(row.title || ""),
    purpose: String(row.purpose || ""),
    durationHours: Number(row.duration_hours || 24),
    visibility: String(row.visibility || "public"),
    plan: String(row.plan || "free"),
    status: String(row.status || "open"),
    ownerId: String(row.owner_id || ""),
    ownerName: String(row.owner_name || ""),
    createdAt: new Date(row.created_at).getTime(),
    closesAt: new Date(row.closes_at).getTime(),
    closedAt: row.closed_at ? new Date(row.closed_at).getTime() : undefined,
    participantIds: Array.isArray(row.participant_ids) ? row.participant_ids : [],
    roles: row.roles && typeof row.roles === "object" ? row.roles : {},
  };
}

function mapContribution(row: ContributionRow) {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    authorId: String(row.author_id),
    authorName: String(row.author_name || "مستخدم"),
    role: String(row.role || ""),
    kind: String(row.kind || "clarify"),
    text: String(row.text || ""),
    createdAt: new Date(row.created_at).getTime(),
    hidden: Boolean(row.hidden),
  };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext(req);
    if ("error" in ctx) return ctx.error;

    if (req.nextUrl.searchParams.get("meta") === "1") {
      return NextResponse.json({
        ok: true,
        botUsername: await getBotUsername(ctx.bot.token),
      });
    }

    const requestedStatus = req.nextUrl.searchParams.get("status") || "open";
    const requestedOffset = Number(req.nextUrl.searchParams.get("offset") || "0");
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0
      ? Math.min(requestedOffset, 10000)
      : 0;
    let query = ctx.db.from("fadaa_sessions").select("*")
      .eq("bot_id", ctx.botId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (requestedStatus === "open" || requestedStatus === "closed") {
      query = query.eq("status", requestedStatus);
    }
    const { data: rawSessions, error } = await query;
    if (error) throw error;

    const requestedSessionId = req.nextUrl.searchParams.get("session");
    let sessionRows = rawSessions || [];
    if (requestedSessionId && !sessionRows.some((row) => String(row.id) === requestedSessionId)) {
      const { data: invitedSession, error: invitedError } = await ctx.db.from("fadaa_sessions").select("*")
        .eq("id", requestedSessionId).eq("bot_id", ctx.botId).maybeSingle();
      if (invitedError) throw invitedError;
      if (invitedSession) sessionRows = [invitedSession, ...sessionRows];
    }

    const allSessions = sessionRows.map((row) => mapSession(row as SessionRow));
    const sessions = allSessions.filter((session) =>
      session.visibility === "public"
      || session.ownerId === ctx.user.id
      || session.participantIds.includes(ctx.user.id)
    );
    const sessionIds = sessions.map((session) => session.id);

    let contributions: ReturnType<typeof mapContribution>[] = [];
    if (sessionIds.length) {
      let contributionQuery = ctx.db.from("fadaa_contributions").select("*")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true })
        .limit(500);
      if (!ctx.isOwner) contributionQuery = contributionQuery.eq("hidden", false);
      const { data, error: contributionError } = await contributionQuery;
      if (contributionError) throw contributionError;
      contributions = (data || []).map((row) => mapContribution(row as ContributionRow));
    }

    // Expiry is enforced by the server, not a browser timer or localStorage.
    const expired = sessions.filter((session) => session.status === "open" && session.closesAt <= Date.now());
    if (expired.length) {
      const { error: expireError } = await ctx.db.from("fadaa_sessions")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .in("id", expired.map((session) => session.id))
        .eq("bot_id", ctx.botId);
      if (expireError) throw expireError;
      for (const session of expired) {
        session.status = "closed";
        session.closedAt = Date.now();
      }
    }

    return NextResponse.json({
      ok: true,
      source: "supabase",
      user: ctx.user,
      isOwner: ctx.isOwner,
      sessions,
      contributions,
      hasMore: (rawSessions || []).length === PAGE_SIZE,
      nextOffset: offset + (rawSessions || []).length,
    });
  } catch (error) {
    console.error("[fadaa] GET failed", error);
    return jsonError("تعذّر تحميل جلسات فضاء من قاعدة البيانات.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ctx = await getContext(req);
    if ("error" in ctx) return ctx.error;

    const action = String(body.action || "");
    if (action === "create_session") {
      const kind = String(body.kind || "knowledge");
      const title = String(body.title || "").trim().slice(0, 120);
      const purpose = String(body.purpose || "").trim().slice(0, 500);
      const durationHours = Number(body.durationHours || 24);
      const visibility = String(body.visibility || "public");
      if (!SESSION_KINDS.has(kind)) return jsonError("نوع الجلسة غير صالح.", 400);
      if (title.length < 3 || !purpose) return jsonError("أدخل عنواناً وغرضاً واضحين للجلسة.", 400);
      if (![12, 24, 48, 72].includes(durationHours)) return jsonError("مدة الجلسة غير صالحة.", 400);
      if (!["public", "private"].includes(visibility)) return jsonError("إعداد الظهور غير صالح.", 400);

      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: recentSessions, error: rateError } = await ctx.db.from("fadaa_sessions")
        .select("id", { count: "exact", head: true })
        .eq("bot_id", ctx.botId)
        .eq("owner_id", ctx.user.id)
        .gte("created_at", hourAgo);
      if (rateError) throw rateError;
      if ((recentSessions || 0) >= 3) return jsonError("أنشأت الحد الأقصى للجلسات خلال الساعة. حاول لاحقاً.", 429);

      const now = new Date();
      const session = {
        id: randomUUID(),
        bot_id: ctx.botId,
        kind,
        title,
        purpose,
        duration_hours: durationHours,
        visibility,
        plan: "free",
        status: "open",
        owner_id: ctx.user.id,
        owner_name: ctx.user.name,
        created_at: now.toISOString(),
        closes_at: new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString(),
        participant_ids: [ctx.user.id],
        roles: { [ctx.user.id]: "منظّم" },
      };
      const { data, error } = await ctx.db.from("fadaa_sessions").insert(session).select("*").single();
      if (error) throw error;
      return NextResponse.json({ ok: true, session: mapSession(data as SessionRow) });
    }

    if (action === "join_session") {
      const sessionId = String(body.sessionId || "");
      const role = String(body.role || "").trim().slice(0, 40);
      if (!sessionId || !role) return jsonError("اختر دورك قبل الدخول.", 400);
      const { data: row, error } = await ctx.db.from("fadaa_sessions").select("*")
        .eq("id", sessionId).eq("bot_id", ctx.botId).maybeSingle();
      if (error) throw error;
      if (!row) return jsonError("الجلسة غير موجودة.", 404);
      const session = row as SessionRow;
      if (session.status !== "open" || new Date(session.closes_at).getTime() <= Date.now()) {
        return jsonError("انتهت هذه الجلسة وأُغلقت.", 409);
      }
      if (session.visibility !== "public"
        && session.owner_id !== ctx.user.id
        && !(Array.isArray(session.participant_ids) && session.participant_ids.includes(ctx.user.id))) {
        return jsonError("هذه الجلسة خاصة.", 403);
      }
      const participantIds = Array.isArray(session.participant_ids) ? session.participant_ids : [];
      const roles = session.roles && typeof session.roles === "object" ? session.roles : {};
      if (!participantIds.includes(ctx.user.id)) participantIds.push(ctx.user.id);
      roles[ctx.user.id] = role;
      const { error: updateError } = await ctx.db.from("fadaa_sessions")
        .update({ participant_ids: participantIds, roles })
        .eq("id", sessionId).eq("bot_id", ctx.botId);
      if (updateError) throw updateError;
      return NextResponse.json({ ok: true });
    }

    if (action === "add_contribution") {
      const sessionId = String(body.sessionId || "");
      const text = String(body.text || "").trim().slice(0, 2000);
      const kind = String(body.kind || "clarify");
      if (!sessionId || text.length < 2) return jsonError("اكتب إسهامة واضحة.", 400);
      if (!CONTRIBUTION_KINDS.has(kind)) return jsonError("نوع الإسهامة غير صالح.", 400);
      const { data: row, error } = await ctx.db.from("fadaa_sessions").select("*")
        .eq("id", sessionId).eq("bot_id", ctx.botId).maybeSingle();
      if (error) throw error;
      if (!row) return jsonError("الجلسة غير موجودة.", 404);
      const session = row as SessionRow;
      if (session.status !== "open" || new Date(session.closes_at).getTime() <= Date.now()) {
        return jsonError("لا يمكن الإسهام في جلسة مغلقة.", 409);
      }
      const role = session.roles?.[ctx.user.id];
      if (!role || !session.participant_ids?.includes(ctx.user.id)) {
        return jsonError("انضم إلى الجلسة واختر دورك قبل الكتابة.", 403);
      }
      const fiveSecondsAgo = new Date(Date.now() - 5 * 1000).toISOString();
      const { count: recentContributions, error: rateError } = await ctx.db.from("fadaa_contributions")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("author_id", ctx.user.id)
        .gte("created_at", fiveSecondsAgo);
      if (rateError) throw rateError;
      if ((recentContributions || 0) >= 1) return jsonError("انتظر بضع ثوانٍ قبل إرسال إسهامة أخرى.", 429);

      const contribution = {
        id: randomUUID(),
        session_id: sessionId,
        author_id: ctx.user.id,
        author_name: ctx.user.name,
        role,
        kind,
        text,
      };
      const { data, error: insertError } = await ctx.db.from("fadaa_contributions")
        .insert(contribution).select("*").single();
      if (insertError) throw insertError;
      return NextResponse.json({ ok: true, contribution: mapContribution(data as ContributionRow) });
    }

    if (action === "close_session") {
      const sessionId = String(body.sessionId || "");
      if (!sessionId) return jsonError("الجلسة غير محددة.", 400);
      const { data: session, error } = await ctx.db.from("fadaa_sessions").select("owner_id,status")
        .eq("id", sessionId).eq("bot_id", ctx.botId).maybeSingle();
      if (error) throw error;
      if (!session) return jsonError("الجلسة غير موجودة.", 404);
      if (String(session.owner_id) !== ctx.user.id) return jsonError("إغلاق الجلسة متاح لمنشئها فقط.", 403);
      const { error: updateError } = await ctx.db.from("fadaa_sessions")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", sessionId).eq("bot_id", ctx.botId);
      if (updateError) throw updateError;
      return NextResponse.json({ ok: true });
    }

    if (action === "hide_contribution" || action === "unhide_contribution" || action === "delete_contribution" || action === "delete_session") {
      if (!ctx.isOwner) return jsonError("هذا الإجراء متاح لمالك البوت فقط.", 403);
      if (action === "delete_session") {
        const sessionId = String(body.sessionId || "");
        const { error } = await ctx.db.from("fadaa_sessions").delete()
          .eq("id", sessionId).eq("bot_id", ctx.botId);
        if (error) throw error;
      } else {
        const contributionId = String(body.contributionId || "");
        if (!contributionId) return jsonError("الإسهامة غير محددة.", 400);
        const { data: contribution, error: lookupError } = await ctx.db.from("fadaa_contributions")
          .select("session_id").eq("id", contributionId).maybeSingle();
        if (lookupError) throw lookupError;
        if (!contribution) return jsonError("الإسهامة غير موجودة.", 404);
        const { data: parentSession, error: parentError } = await ctx.db.from("fadaa_sessions")
          .select("id").eq("id", contribution.session_id).eq("bot_id", ctx.botId).maybeSingle();
        if (parentError) throw parentError;
        if (!parentSession) return jsonError("الإسهامة لا تتبع هذا البوت.", 403);
        if (action === "hide_contribution" || action === "unhide_contribution") {
          const { error } = await ctx.db.from("fadaa_contributions")
            .update({ hidden: action === "hide_contribution" })
            .eq("id", contributionId);
          if (error) throw error;
        } else {
          const { error } = await ctx.db.from("fadaa_contributions").delete().eq("id", contributionId);
          if (error) throw error;
        }
      }
      return NextResponse.json({ ok: true });
    }

    return jsonError("إجراء غير معروف.", 400);
  } catch (error) {
    console.error("[fadaa] POST failed", error);
    return jsonError("تعذّر تنفيذ العملية وحفظها في قاعدة البيانات.", 500);
  }
}
