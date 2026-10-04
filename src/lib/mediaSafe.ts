// The media mini-app writes to Supabase in many places. supabase-js does NOT throw when a write fails (a missing table, a missing
// column, a permission problem): it returns { error }. Code that wrapped such calls in try/catch therefore treated every failed
// write as a success, and the app looked fine until the in-memory copy was lost. Everything in the media layer now goes through
// `write`, which looks at the error, remembers it (the owner's "فحص النظام" shows the latest), and tells the caller the truth.

export type WriteResult<T = unknown> = { ok: boolean; data: T | null; error?: string; code?: string };

const g = globalThis as unknown as { __mediaErrors?: { at: number; label: string; error: string }[] };
if (!g.__mediaErrors) g.__mediaErrors = [];

export function recordError(label: string, error: string) {
  console.error(`[media] ${label}: ${error}`);
  g.__mediaErrors = [{ at: Date.now(), label, error: String(error).slice(0, 300) }, ...(g.__mediaErrors || [])].slice(0, 40);
}
export const recentErrors = () => g.__mediaErrors || [];

/** Await a supabase query builder, never throw, never hide a failure. */
export async function write<T = unknown>(label: string, q: PromiseLike<{ data?: T | null; error?: { message?: string; code?: string } | null }>): Promise<WriteResult<T>> {
  try {
    const r = await q;
    if (r?.error) {
      if (r.error.code !== "23505") recordError(label, r.error.message || "unknown error");     // a duplicate key is an answer, not a fault
      return { ok: false, data: null, error: r.error.message || "unknown error", code: r.error.code };
    }
    return { ok: true, data: (r?.data ?? null) as T | null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordError(label, msg);
    return { ok: false, data: null, error: msg };
  }
}

/** One probe per thing the media layer relies on: does the table (and the column that is easy to miss) really exist? */
export async function selfTest(db: any) {
  const probes: { name: string; table: string; columns: string; what: string }[] = [
    { name: "feed", table: "media_feed", columns: "id,views,likes,clones,hidden,tags,squad_code,duration_sec,quality", what: "المنشورات والعدّادات" },
    { name: "views", table: "media_views", columns: "post_id,viewer_id,last_at,times", what: "سجل المشاهدات" },
    { name: "likes", table: "media_likes", columns: "post_id,user_id", what: "سجل الإعجابات" },
    { name: "follows", table: "media_follows", columns: "follower_id,followee_id,notify,notified_at", what: "المتابعات" },
    { name: "mutes", table: "media_mutes", columns: "user_id,muted_id", what: "الكتم" },
    { name: "blocks", table: "media_blocks", columns: "user_id,blocked_id", what: "الحظر" },
    { name: "reports", table: "media_reports", columns: "id,post_id,status", what: "البلاغات" },
    { name: "comments", table: "media_comments", columns: "id,post_id,parent_id,from_id,body", what: "التعليقات" },
    { name: "messages", table: "direct_messages", columns: "id,from_id,to_id,body,read", what: "الرسائل الخاصة" },
    { name: "notifications", table: "media_notifications", columns: "id,to_id,from_id,type,read,post_id", what: "الإشعارات داخل التطبيق" },
    { name: "notify_prefs", table: "media_notify_prefs", columns: "user_id,push_off,off_types", what: "تفضيلات إشعارات البوت" },
    { name: "push_log", table: "media_push_log", columns: "id,to_id,type,ok", what: "سجل إشعارات البوت" },
    { name: "premium", table: "media_premium_users", columns: "tg_user_id", what: "المشتركون المدفوعون" },
    { name: "users", table: "mini_app_users", columns: "id,name,last_seen", what: "مستخدمو التطبيق" },
  ];
  const out: { name: string; what: string; ok: boolean; error?: string }[] = [];
  for (const p of probes) {
    const r = await db.from(p.table).select(p.columns).limit(1);
    out.push({ name: p.name, what: p.what, ok: !r.error, error: r.error?.message });
  }
  return out;
}
