import { NextRequest, NextResponse } from "next/server";
import { isBlockedEitherWay, mediaDb } from "@/lib/mediaSocial";
import { verifyTelegramInitData } from "@/lib/verifyTelegramOwner";

export const dynamic = "force-dynamic";

// Real public comments (+ threaded replies) for a feed post. The 💬 button
// on each card used to open a private-message thread with the sharer --
// there was no actual comment feature. As with media-messages.ts, the
// commenter's identity comes from the verified Telegram init_data, never a
// client-supplied id, since a client-supplied id here could be used to
// post as anyone.

function authedUserId(initData: string): string | null {
  const botToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const user = verifyTelegramInitData(initData, botToken);
  return user?.id || null;
}

type Comment = {
  id: string;
  post_id: string;
  parent_id: string | null;
  from_id: string;
  from_name: string;
  body: string;
  created_at: number;
};

const g = globalThis as unknown as { __comments?: Comment[] };
if (!g.__comments) g.__comments = [];

async function sb() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function notify(db: any, toId: string, fromId: string, fromName: string, type: string, postId: string) {
  if (!toId || !fromId || toId === fromId || !db) return;
  try {
    await db.from("media_notifications").insert({ to_id: toId, from_id: fromId, from_name: fromName.slice(0, 40), type, post_id: postId });
  } catch {
    /* ignore */
  }
}

/** GET ?post_id= — all comments for a post (flat, oldest first; client nests by parent_id) */
export async function GET(req: NextRequest) {
  const postId = (req.nextUrl.searchParams.get("post_id") || "").trim();
  if (!postId) return NextResponse.json({ comments: [] });

  let comments: Comment[] = [];
  const db = await sb();
  if (db) {
    try {
      const { data, error } = await db
        .from("media_comments")
        .select("id,post_id,parent_id,from_id,from_name,body,created_at")
        .eq("post_id", postId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (!error && data) {
        comments = data.map((r: any) => ({
          id: String(r.id),
          post_id: String(r.post_id),
          parent_id: r.parent_id ? String(r.parent_id) : null,
          from_id: String(r.from_id),
          from_name: String(r.from_name || "مستخدم"),
          body: String(r.body || ""),
          created_at: r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : 0,
        }));
      }
    } catch {
      /* table may not exist yet */
    }
  }
  for (const c of g.__comments || []) {
    if (c.post_id === postId && !comments.find((x) => x.id === c.id)) comments.push(c);
  }
  comments.sort((a, b) => a.created_at - b.created_at);
  return NextResponse.json({ comments });
}

/** POST — add a comment or a reply, as the verified caller (init_data) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fromId = authedUserId(String(body.init_data || ""));
  if (!fromId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const postId = String(body.post_id || "").trim();
  const text = String(body.body || "").trim().slice(0, 500);
  const parentId = body.parent_id ? String(body.parent_id).trim() : null;
  const fromName = String(body.from_name || "مستخدم").slice(0, 40);
  if (!postId || !text) return NextResponse.json({ error: "post_id, body required" }, { status: 400 });
  // A user blocked by the post's owner (or who blocked them) can't comment there.
  try {
    const bdb = await mediaDb();
    if (bdb) {
      const { data: post } = await bdb.from("media_feed").select("sharer_id").eq("id", postId).maybeSingle();
      const ownerId = String((post as any)?.sharer_id || "");
      if (ownerId && ownerId !== fromId && (await isBlockedEitherWay(bdb, fromId, ownerId))) {
        return NextResponse.json({ error: "blocked" }, { status: 403 });
      }
    }
  } catch {
    /* block table not created yet */
  }

  const comment: Comment = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    post_id: postId,
    parent_id: parentId,
    from_id: fromId,
    from_name: fromName,
    body: text,
    created_at: Math.floor(Date.now() / 1000),
  };
  g.__comments = [...(g.__comments || []), comment].slice(-2000);

  const db = await sb();
  if (db) {
    try {
      await db.from("media_comments").insert({
        id: comment.id,
        post_id: comment.post_id,
        parent_id: comment.parent_id,
        from_id: comment.from_id,
        from_name: comment.from_name,
        body: comment.body,
        created_at: new Date(comment.created_at * 1000).toISOString(),
      });
    } catch {
      /* table may not exist yet */
    }
  }

  // A reply notifies the parent comment's author; a top-level comment
  // notifies the post's owner. Never notify yourself.
  if (parentId) {
    let parentFromId = (g.__comments || []).find((c) => c.id === parentId)?.from_id || "";
    if (!parentFromId && db) {
      try {
        const { data } = await db.from("media_comments").select("from_id").eq("id", parentId).maybeSingle();
        if (data) parentFromId = String((data as any).from_id || "");
      } catch {
        /* ignore */
      }
    }
    if (parentFromId) await notify(db, parentFromId, fromId, fromName, "reply", postId);
  } else if (db) {
    try {
      const { data } = await db.from("media_feed").select("sharer_id").eq("id", postId).maybeSingle();
      const ownerId = data ? String((data as any).sharer_id || "") : "";
      if (ownerId) await notify(db, ownerId, fromId, fromName, "comment", postId);
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json({ ok: true, comment });
}
