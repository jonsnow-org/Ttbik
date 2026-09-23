import { NextRequest, NextResponse } from "next/server";
import {
  EMPTY_RELATIONS,
  MEDIA_OWNER_ID,
  isBlockedEitherWay,
  loadRelations,
  mediaBotUsername,
  mediaDb,
  mediaUser,
  tgApi,
} from "@/lib/mediaSocial";

export const dynamic = "force-dynamic";

// Media mini-app social layer: follow / mute / block / report / delete own
// post / prepare an in-Telegram share. Every write trusts only the
// Telegram-signed init_data for who the caller is (see verifyTelegramOwner),
// never a client-supplied id.

const REPORT_REASONS: Record<string, string> = {
  sexual: "محتوى جنسي أو غير لائق",
  violence: "عنف أو محتوى صادم",
  hate: "كراهية أو تحرّش",
  spam: "احتيال أو محتوى مزعج (سبام)",
  copyright: "انتهاك حقوق نشر",
  other: "سبب آخر",
};
// Enough independent reports hide a post automatically until the owner reviews it.
const AUTO_HIDE_REPORTS = 3;

/**
 * GET ?init_data=                 → the caller's own relations
 * GET ?init_data=&profile=<id>    → + follower/following counts for that profile
 * GET ?init_data=&reports=1       → owner only: open reports
 */
export async function GET(req: NextRequest) {
  const me = mediaUser(req.nextUrl.searchParams.get("init_data") || "");
  const db = await mediaDb();
  if (!db) return NextResponse.json({ relations: EMPTY_RELATIONS, ready: false });
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const relations = await loadRelations(db, me.id);
    const out: Record<string, unknown> = { relations, ready: true, me: me.id };

    const profile = (req.nextUrl.searchParams.get("profile") || "").trim();
    if (profile) {
      const [followers, followingCount] = await Promise.all([
        db.from("media_follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", profile),
        db.from("media_follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", profile),
      ]);
      out.profile = { id: profile, followers: followers.count || 0, following: followingCount.count || 0 };
    }

    if (req.nextUrl.searchParams.get("reports") === "1" && me.id === MEDIA_OWNER_ID) {
      const { data } = await db
        .from("media_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      out.reports = (data || []).map((r: any) => ({
        ...r,
        reason_label: REPORT_REASONS[r.reason] || r.reason,
        created_at: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : 0,
      }));
    }
    return NextResponse.json(out);
  } catch {
    // Tables not created yet (migration not run) — degrade to "no relations".
    return NextResponse.json({ relations: EMPTY_RELATIONS, ready: false });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const me = mediaUser(String(body.init_data || ""));
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  const action = String(body.action || "");
  const target = String(body.target_id || "").trim();
  const postId = String(body.post_id || "").trim();
  const isOwner = me.id === MEDIA_OWNER_ID;

  try {
    switch (action) {
      case "follow": {
        if (!target || target === me.id) return bad("invalid target");
        if (await isBlockedEitherWay(db, me.id, target)) return bad("blocked", 403);
        const { error } = await db.from("media_follows").upsert({ follower_id: me.id, followee_id: target }, { onConflict: "follower_id,followee_id" });
        if (error) throw error;
        await db.from("media_notifications").insert({ to_id: target, from_id: me.id, from_name: me.name, type: "follow", post_id: null }).then(() => {}, () => {});
        return ok();
      }
      case "unfollow":
        await db.from("media_follows").delete().eq("follower_id", me.id).eq("followee_id", target);
        return ok();
      case "mute":
        if (!target || target === me.id) return bad("invalid target");
        await db.from("media_mutes").upsert({ user_id: me.id, muted_id: target }, { onConflict: "user_id,muted_id" });
        return ok();
      case "unmute":
        await db.from("media_mutes").delete().eq("user_id", me.id).eq("muted_id", target);
        return ok();
      case "block": {
        if (!target || target === me.id) return bad("invalid target");
        if (target === MEDIA_OWNER_ID) return bad("cannot block the app owner", 403);
        await db.from("media_blocks").upsert({ user_id: me.id, blocked_id: target }, { onConflict: "user_id,blocked_id" });
        // A block also ends any follow in both directions.
        await db.from("media_follows").delete().eq("follower_id", me.id).eq("followee_id", target);
        await db.from("media_follows").delete().eq("follower_id", target).eq("followee_id", me.id);
        return ok();
      }
      case "unblock":
        await db.from("media_blocks").delete().eq("user_id", me.id).eq("blocked_id", target);
        return ok();

      case "delete_post": {
        if (!postId) return bad("post_id required");
        const { data: post } = await db.from("media_feed").select("id,sharer_id").eq("id", postId).maybeSingle();
        if (!post) return bad("not found", 404);
        if (String((post as any).sharer_id) !== me.id && !isOwner) return bad("not your post", 403);
        const { error } = await db.from("media_feed").delete().eq("id", postId);
        if (error) {
          // No DELETE grant yet (migration not run) — hide instead so it still disappears.
          await db.from("media_feed").update({ hidden: true }).eq("id", postId);
        }
        await db.from("media_comments").delete().eq("post_id", postId).then(() => {}, () => {});
        const g = globalThis as any;
        if (Array.isArray(g.__mediaFeed)) g.__mediaFeed = g.__mediaFeed.filter((x: any) => x.id !== postId);
        return ok();
      }

      case "report": {
        const reason = String(body.reason || "");
        if (!postId || !REPORT_REASONS[reason]) return bad("invalid report");
        const { data: post } = await db.from("media_feed").select("id,title,sharer_id").eq("id", postId).maybeSingle();
        if (!post) return bad("not found", 404);
        const row = {
          id: `${postId}_${me.id}`,
          post_id: postId,
          post_title: String((post as any).title || "").slice(0, 120),
          post_owner_id: String((post as any).sharer_id || ""),
          reporter_id: me.id,
          reporter_name: me.name,
          reason,
          details: String(body.details || "").slice(0, 500),
          status: "open",
        };
        const { error } = await db.from("media_reports").upsert(row, { onConflict: "post_id,reporter_id" });
        if (error) throw error;

        const { count } = await db
          .from("media_reports")
          .select("id", { count: "exact", head: true })
          .eq("post_id", postId)
          .eq("status", "open");
        const autoHidden = (count || 0) >= AUTO_HIDE_REPORTS;
        if (autoHidden) await db.from("media_feed").update({ hidden: true }).eq("id", postId);

        await tgApi("sendMessage", {
          chat_id: MEDIA_OWNER_ID,
          text:
            `🚩 بلاغ جديد في تطبيق الوسائط\n\n` +
            `المنشور: ${row.post_title || postId}\n` +
            `السبب: ${REPORT_REASONS[reason]}\n` +
            (row.details ? `التفاصيل: ${row.details}\n` : "") +
            `عدد البلاغات المفتوحة عليه: ${count || 1}` +
            (autoHidden ? `\n⚠️ أُخفي المنشور تلقائياً حتى تراجعه.` : "") +
            `\n\nراجعه من تبويب «👑 أدمن» ← البلاغات.`,
        }).catch(() => {});
        return ok({ auto_hidden: autoHidden });
      }

      case "resolve_report": {
        if (!isOwner) return bad("owner only", 403);
        const reportId = String(body.report_id || "");
        const decision = String(body.decision || "");
        const { data: rep } = await db.from("media_reports").select("*").eq("id", reportId).maybeSingle();
        if (!rep) return bad("not found", 404);
        const pid = String((rep as any).post_id);
        if (decision === "hide") {
          await db.from("media_feed").update({ hidden: true }).eq("id", pid);
          await db.from("media_reports").update({ status: "hidden", resolved_at: new Date().toISOString() }).eq("post_id", pid).eq("status", "open");
        } else if (decision === "delete") {
          await db.from("media_feed").delete().eq("id", pid).then(() => {}, () => {});
          await db.from("media_reports").update({ status: "hidden", resolved_at: new Date().toISOString() }).eq("post_id", pid).eq("status", "open");
        } else if (decision === "dismiss") {
          // Dismissing also restores a post that was auto-hidden by reports.
          await db.from("media_feed").update({ hidden: false }).eq("id", pid);
          await db.from("media_reports").update({ status: "dismissed", resolved_at: new Date().toISOString() }).eq("post_id", pid).eq("status", "open");
        } else return bad("unknown decision");
        return ok();
      }

      case "prepare_share": {
        // Real in-Telegram forward: stores the actual media (by its
        // Telegram file_id) as a prepared message the user then sends to
        // any chat they pick via WebApp.shareMessage (Bot API 8.0).
        if (!postId) return bad("post_id required");
        const { data: post } = await db.from("media_feed").select("id,file_id,media_type,title").eq("id", postId).maybeSingle();
        if (!post || !(post as any).file_id) return bad("not found", 404);
        const p = post as any;
        const bot = await mediaBotUsername();
        const caption = `${String(p.title || "").slice(0, 200)}${bot ? `\n\n📥 عبر @${bot}` : ""}`;
        const reply_markup = bot
          ? { inline_keyboard: [[{ text: "⚡ افتح في البوت", url: `https://t.me/${bot}?start=clone_${p.id}` }]] }
          : undefined;
        const kind = String(p.media_type || "video");
        const base = { id: String(p.id).slice(0, 60), caption, reply_markup };
        const result =
          kind === "audio"
            ? { type: "audio", audio_file_id: p.file_id, ...base }
            : kind === "voice"
              ? { type: "voice", voice_file_id: p.file_id, title: String(p.title || "رسالة صوتية").slice(0, 60), ...base }
              : kind === "photo"
                ? { type: "photo", photo_file_id: p.file_id, ...base }
                : { type: "video", video_file_id: p.file_id, title: String(p.title || "فيديو").slice(0, 60) || "فيديو", ...base };
        const r = await tgApi("savePreparedInlineMessage", {
          user_id: Number(me.id),
          result,
          allow_user_chats: true,
          allow_bot_chats: true,
          allow_group_chats: true,
          allow_channel_chats: true,
        });
        if (!r?.ok || !r.result?.id) return bad(r?.description || "prepare failed", 502);
        return ok({ prepared_id: r.result.id });
      }

      default:
        return bad("unknown action");
    }
  } catch (e: any) {
    // Most likely cause: supabase/migration_media_social.sql hasn't been run.
    return NextResponse.json({ error: e?.message || "failed", needs_migration: true }, { status: 500 });
  }
}

function ok(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...extra });
}
function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
