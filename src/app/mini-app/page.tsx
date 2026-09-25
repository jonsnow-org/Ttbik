"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonetagSdkLoader, MonetagBannerSlot, showRewardedAd } from "@/components/MonetagAd";
import { mediaStreamUrl } from "@/lib/mediaStream";
import AdsterraBanner from "@/components/AdsterraBanner";

// "video" was a duplicate of Trending (both listed the latest downloads);
// owner directive 2026-09-24: it became "تتابعه" — posts from the people
// the viewer follows (server-side follows, see /api/media-social).
type Tab = "trending" | "following" | "audio" | "me" | "admin";
type ProfileSection = "all" | "video" | "audio" | "photo";
type FeedItem = { id: string; liked?: boolean; media_type: string; title: string; url?: string; thumbnail?: string; sharer_name?: string; sharer_id?: string; clones?: number; likes?: number; views?: number; created_at?: number; squad_code?: string };
type Notif = { id: string; type: "follow" | "like" | "comment" | "reply"; fromId: string; fromName: string; at: number; read: boolean; postId?: string };
type CommentRow = { id: string; post_id: string; parent_id: string | null; from_id: string; from_name: string; body: string; created_at: number };
type Relations = { following: string[]; mutes: string[]; blocks: string[]; blockedBy: string[] };
type Report = { id: string; post_id: string; post_title: string; post_owner_id: string; reporter_id: string; reporter_name: string; reason: string; reason_label: string; details: string; status: string; created_at: number };

const BOT_USERNAME = process.env.NEXT_PUBLIC_MEDIA_BOT_USERNAME || "";
const OWNER_IDS = (process.env.NEXT_PUBLIC_OWNER_ID || "420066855").split(",").map((s) => s.trim());
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const LS = { follow: "mb_following", profile: "mb_profile", liked: "mb_liked", followMigrated: "mb_follow_migrated", names: "mb_names", autoplay: "mb_autoplay", seen: "mb_seen" };
const EMPTY_REL: Relations = { following: [], mutes: [], blocks: [], blockedBy: [] };

const REPORT_REASONS: { key: string; label: string; icon: string }[] = [
  { key: "sexual", label: "محتوى جنسي أو غير لائق", icon: "🔞" },
  { key: "violence", label: "عنف أو محتوى صادم", icon: "🩸" },
  { key: "hate", label: "كراهية أو تحرّش", icon: "🚫" },
  { key: "spam", label: "احتيال أو محتوى مزعج (سبام)", icon: "📛" },
  { key: "copyright", label: "انتهاك حقوق نشر", icon: "©️" },
  { key: "other", label: "سبب آخر", icon: "❓" },
];

// Each tab has its own colour so the bar reads at a glance, all on the
// same sky-blue background (owner: keep the sky-blue base).
const TAB_STYLES: Record<Tab, { active: string; idle: string }> = {
  trending: { active: "bg-gradient-to-l from-orange-500 to-rose-500 text-white shadow-md shadow-rose-200", idle: "bg-orange-50 text-orange-600 ring-1 ring-orange-100" },
  following: { active: "bg-gradient-to-l from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-200", idle: "bg-violet-50 text-violet-600 ring-1 ring-violet-100" },
  audio: { active: "bg-gradient-to-l from-indigo-500 to-blue-500 text-white shadow-md shadow-indigo-200", idle: "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100" },
  me: { active: "bg-gradient-to-l from-teal-500 to-emerald-500 text-white shadow-md shadow-teal-200", idle: "bg-teal-50 text-teal-700 ring-1 ring-teal-100" },
  admin: { active: "bg-gradient-to-l from-amber-500 to-yellow-500 text-white shadow-md shadow-amber-200", idle: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
};

function typeIcon(t: string) { if (t === "audio" || t === "voice") return "🎵"; if (t === "photo") return "🖼️"; return "🎬"; }
function platformOf(url?: string) {
  const u = (url || "").toLowerCase();
  if (u.includes("tiktok")) return { label: "TikTok", badge: "bg-gradient-to-l from-pink-500 to-cyan-500", tint: "from-pink-100 to-cyan-100", name: "تيك توك", vertical: true };
  if (u.includes("youtu")) return { label: "YouTube", badge: "bg-red-500", tint: "from-red-50 to-rose-100", name: "يوتيوب", vertical: u.includes("shorts") };
  if (u.includes("instagram")) return { label: "Instagram", badge: "bg-gradient-to-l from-fuchsia-500 to-orange-400", tint: "from-fuchsia-50 to-orange-100", name: "إنستغرام", vertical: true };
  if (u.includes("twitter") || u.includes("x.com")) return { label: "X", badge: "bg-slate-800", tint: "from-slate-100 to-slate-200", name: "X", vertical: false };
  if (u.includes("facebook") || u.includes("fb.watch")) return { label: "Facebook", badge: "bg-blue-600", tint: "from-blue-50 to-blue-100", name: "فيسبوك", vertical: false };
  return { label: "Media", badge: "bg-sky-500", tint: "from-sky-100 to-sky-200", name: "", vertical: false };
}
// The downloader sometimes stores the platform's numeric id as the title.
function displayTitle(item: FeedItem) {
  const t = (item.title || "").trim();
  if (!t || /^\d{6,}$/.test(t) || t === "فيديو تيك توك" || t === "بدون عنوان") { const p = platformOf(item.url); return p.name ? `مقطع من ${p.name}` : "مقطع مشارك"; }
  return t;
}
function timeAgo(ts?: number) { if (!ts) return ""; const s = Math.max(0, Math.floor(Date.now() / 1000) - ts); if (s < 60) return "الآن"; if (s < 3600) return `${Math.floor(s / 60)} د`; if (s < 86400) return `${Math.floor(s / 3600)} س`; return `${Math.floor(s / 86400)} ي`; }
function loadJSON<T>(key: string, fb: T): T { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } }
function saveJSON(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function tg(): any { return (window as any).Telegram?.WebApp; }
function haptic(kind: "light" | "success" | "warning" = "light") { try { if (kind === "light") tg()?.HapticFeedback?.impactOccurred?.("light"); else tg()?.HapticFeedback?.notificationOccurred?.(kind); } catch {} }
function confirmBox(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const t = tg();
    if (t?.showConfirm) { try { t.showConfirm(text, (ok: boolean) => resolve(!!ok)); return; } catch {} }
    resolve(window.confirm(text));
  });
}

// A real (not decorative) live-status dot: null while we haven't checked
// yet, a pulsing green ring once Telegram confirms the bot token is alive,
// a plain red dot if it isn't -- never just "always green."
function LiveDot({ online, label }: { online: boolean | null; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex h-2.5 w-2.5">
        {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online == null ? "bg-slate-300" : online ? "bg-emerald-500" : "bg-rose-500"}`} />
      </span>
      {label && <span className="text-[10px] font-bold text-slate-500">{online == null ? "..." : online ? "البوت مباشر" : "البوت غير متصل"}</span>}
    </span>
  );
}

// Renders one comment plus every reply under it, at any depth (a reply to
// a reply nests one level deeper again), since comments are only ever
// related to each other by parent_id -- there's no fixed "depth" field.
function CommentThread({ comment, all, depth, onReply }: { comment: CommentRow; all: CommentRow[]; depth: number; onReply: (c: CommentRow) => void }) {
  const children = all.filter((c) => c.parent_id === comment.id);
  return (
    <div className={depth ? "mr-3 mt-2 border-r-2 border-violet-100 pr-2" : "mt-2"}>
      <div className="rounded-2xl bg-slate-50 px-3 py-2">
        <p className="text-[11px] font-bold text-violet-700">{comment.from_name}</p>
        <p className="whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span>{timeAgo(comment.created_at)}</span>
          <button type="button" onClick={() => onReply(comment)} className="font-bold text-violet-600">رد</button>
        </div>
      </div>
      {children.map((c) => (<CommentThread key={c.id} comment={c} all={all} depth={depth + 1} onReply={onReply} />))}
    </div>
  );
}

// Card preview: TikTok (and other vertical sources) get a taller frame, and
// a failed thumbnail falls back to a tinted placeholder instead of a broken
// image (owner report 2026-09-24: TikTok previews looked empty).
function Thumb({ item }: { item: FeedItem }) {
  const [failed, setFailed] = useState(false);
  const p = platformOf(item.url);
  if (item.thumbnail && !failed) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-slate-900">
        {/* blurred copy fills the frame behind a vertical/odd-sized image */}
        <img src={item.thumbnail} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl" />
        <img src={item.thumbnail} alt="" loading="lazy" onError={() => setFailed(true)} className="relative h-full w-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`relative flex h-full items-end justify-center bg-gradient-to-br ${p.tint} pb-4`}>
      <span className="absolute left-1/2 top-6 -translate-x-1/2 text-4xl opacity-40">{typeIcon(item.media_type)}</span>
      {p.name && <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-slate-600">{p.name}</span>}
    </div>
  );
}

export default function MiniAppPage() {
  const [tab, setTab] = useState<Tab>("trending");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [statusLine, setStatusLine] = useState("محبّ للوسائط ✨");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [relations, setRelations] = useState<Relations>(EMPTY_REL);
  const [socialReady, setSocialReady] = useState<boolean | null>(null);
  const [profileCounts, setProfileCounts] = useState<{ followers: number; following: number } | null>(null);
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [viewUserName, setViewUserName] = useState("");
  const [profileSection, setProfileSection] = useState<ProfileSection>("all");
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [showInbox, setShowInbox] = useState(false);
  const [inboxThreads, setInboxThreads] = useState<{ peer_id: string; peer_name: string; last_body: string; last_at: number; unread: number }[]>([]);
  const [chatPeer, setChatPeer] = useState<{ id: string; name: string } | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ id: string; from_id: string; from_name: string; body: string; created_at: number }[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [inboxUnread, setInboxUnread] = useState(0);
  const [botOnline, setBotOnline] = useState<boolean | null>(null);
  const [adBusy, setAdBusy] = useState(false);
  const [reward, setReward] = useState<{ ads: number; bonus: number; remaining: number; per_ad: number } | null>(null);
  const [menuItem, setMenuItem] = useState<FeedItem | null>(null);
  const [reportItem, setReportItem] = useState<FeedItem | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [toast, setToast] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [notifyOff, setNotifyOff] = useState<string[]>([]);
  const [peopleSheet, setPeopleSheet] = useState<{ kind: "followers" | "following"; of: string; people: { id: string; name: string }[] | null } | null>(null);
  const [autoplay, setAutoplay] = useState(true);
  const [autoId, setAutoId] = useState<string | null>(null);
  const [autoFailed, setAutoFailed] = useState<Record<string, boolean>>({});
  // Ids whose Cloudflare stream failed once — retried through Vercel's /api/media-stream.
  const [viaVercel, setViaVercel] = useState<Record<string, boolean>>({});
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [adminSection, setAdminSection] = useState<"reports" | "chats" | "rooms" | "content" | "settings">("reports");
  const [adminConvs, setAdminConvs] = useState<{ a: string; b: string; a_name: string; b_name: string; last_body: string; last_at: number; count: number }[] | null>(null);
  const [adminConv, setAdminConv] = useState<{ a: string; b: string; a_name: string; b_name: string; messages: { id: string; from_id: string; from_name: string; body: string; created_at: number }[] } | null>(null);
  // Posts this viewer has already had on screen — Trending shows unseen ones first on each refresh.
  const seenRef = useRef<Set<string>>(new Set());
  const openThreadRef = useRef<(id: string, name: string) => Promise<void>>(async () => {});
  const onPlayError = (id: string) => {
    if (!viaVercel[id]) { setViaVercel((v) => ({ ...v, [id]: true })); return; }
    setPlayingId(null); setPlayError(id);
  };
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }

  // Real Monetag rewarded ad, shown only when the user taps this button --
  // no fake "reward" is claimed (e.g. a made-up credit or unlock) since
  // this app has no real credit/limit system to attach one to honestly.
  // It's framed plainly as supporting the app, matching what actually
  // happens: watching it is what generates real ad revenue.
  // Rewarded ad = real reward: each finished ad adds bonus downloads for
  // today in the media bot (see /api/media-reward + media-bot/services/rewards.py).
  async function loadReward() {
    try {
      const j = await (await fetch(`/api/media-reward?init_data=${encodeURIComponent(tgInitData())}`, { cache: "no-store" })).json();
      if (typeof j.remaining === "number") setReward({ ads: j.ads || 0, bonus: j.bonus || 0, remaining: j.remaining, per_ad: j.per_ad || 3 });
    } catch {}
  }
  async function watchSupportAd() {
    if (adBusy) return;
    if (reward && reward.remaining <= 0) { showToast("استهلكت مكافآت اليوم — تتجدد غداً"); return; }
    setAdBusy(true);
    try {
      const played = await showRewardedAd();
      if (!played) { showToast("الإعلان غير متاح الآن، حاول بعد قليل"); return; }
      const r = await fetch("/api/media-reward", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData() }) });
      const j = await r.json().catch(() => ({}));
      if (typeof j.remaining === "number") setReward({ ads: j.ads || 0, bonus: j.bonus || 0, remaining: j.remaining, per_ad: j.per_ad || 3 });
      if (j.granted) { haptic("success"); showToast(`🎉 +${j.granted} تحميلات إضافية اليوم في البوت`); }
      else if (j.reason === "cooldown") showToast("انتظر قليلاً قبل الإعلان التالي");
      else if (j.reason === "daily_cap") showToast("استهلكت مكافآت اليوم — تتجدد غداً");
      else if (j.needs_migration) showToast("المكافآت بانتظار تفعيلها من المالك");
    } finally {
      setAdBusy(false);
    }
  }
  const [showComments, setShowComments] = useState(false);
  const [commentsPost, setCommentsPost] = useState<{ id: string; title: string } | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentInput, setCommentInput] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [broadcastText, setBroadcastText] = useState("");
  const [forceChans, setForceChans] = useState("");
  const [adminStats, setAdminStats] = useState<{ posts: number; hidden: number; clones: number; publishers: number; views: number; likes: number } | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const isOwner = !!userId && OWNER_IDS.includes(userId);

  // Real auth for every personal/admin call is the Telegram-signed initData
  // string, verified server-side against BOT_TOKEN — not a client-supplied
  // value, since anything in this client bundle is public. See
  // src/lib/verifyTelegramOwner.ts.
  function tgInitData(): string {
    return tg()?.initData || "";
  }

  useEffect(() => {
    const t = tg();
    if (t) {
      t.ready(); t.expand();
      // Pull-to-refresh used to drag the whole mini-app down and collapse it
      // (Telegram's swipe-to-minimize). Telegram ≥7.7 lets the app turn that
      // gesture off; the app still closes from its header ✕.
      try { t.disableVerticalSwipes?.(); } catch {}
      try { t.setHeaderColor("#eaf6ff"); t.setBackgroundColor("#eaf6ff"); t.MainButton.hide(); } catch {}
      const u = t.initDataUnsafe?.user;
      if (u?.first_name) { const full = u.first_name + (u.last_name ? ` ${u.last_name}` : ""); setDisplayName(full); setEditName(full); }
      if (u?.username) setUsername(u.username);
      if (u?.id) setUserId(String(u.id));
      if (u?.photo_url) setPhotoUrl(u.photo_url);
      try { if (u?.id) void fetch("/api/media-stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData() }) }); } catch {}
    }
    setLiked(loadJSON(LS.liked, {}));
    seenRef.current = new Set(loadJSON<string[]>(LS.seen, []));
    try { document.documentElement.style.overscrollBehaviorY = "none"; document.body.style.overscrollBehaviorY = "none"; } catch {}
    // Autoplay defaults on, except when the phone asks to save data.
    const saveData = !!(navigator as any).connection?.saveData;
    setAutoplay(loadJSON(LS.autoplay, !saveData));
    // Deep link from the bot's "new share" notification: ?u=<user id> opens that profile.
    try {
      const u = new URLSearchParams(window.location.search).get("u") || t?.initDataUnsafe?.start_param?.replace(/^u_/, "") || "";
      if (/^\d{3,}$/.test(u)) { setViewUserId(u); setTab("me"); }
      const dm = new URLSearchParams(window.location.search).get("dm") || "";
      if (/^\d{3,}$/.test(dm)) setTimeout(() => void openThreadRef.current(dm, "مستخدم"), 600);
    } catch {}
    setNames(loadJSON(LS.names, {}));
    const prof = loadJSON<{ name?: string; status?: string }>(LS.profile, {});
    if (prof.name) { setDisplayName(prof.name); setEditName(prof.name); }
    if (prof.status) setStatusLine(prof.status);
  }, []);

  // Remember display names we've seen, so the muted/blocked lists can show
  // names rather than bare Telegram ids.
  useEffect(() => {
    if (!items.length) return;
    setNames((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of items) if (it.sharer_id && it.sharer_name && next[it.sharer_id] !== it.sharer_name) { next[it.sharer_id] = it.sharer_name; changed = true; }
      if (changed) saveJSON(LS.names, next);
      return changed ? next : prev;
    });
  }, [items]);

  // A profile opened by deep link only knows the id; take the name from their posts.
  useEffect(() => {
    if (!viewUserId || viewUserName) return;
    const n = names[viewUserId] || items.find((i) => i.sharer_id === viewUserId)?.sharer_name;
    if (n) setViewUserName(n);
  }, [viewUserId, viewUserName, names, items]);

  const loadRelations = useCallback(async (profileId?: string | null) => {
    if (!userId) return;
    try {
      const qs = new URLSearchParams({ init_data: tgInitData() });
      if (profileId) qs.set("profile", profileId);
      const r = await fetch(`/api/media-social?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (j.relations) setRelations(j.relations);
      if (Array.isArray(j.notifyOff)) setNotifyOff(j.notifyOff);
      setSocialReady(!!j.ready);
      if (j.profile) setProfileCounts({ followers: j.profile.followers, following: j.profile.following });
      // One-time move of follows that used to live only in this device's
      // localStorage into the real server-side follow list.
      if (j.ready && !loadJSON(LS.followMigrated, false)) {
        const local = loadJSON<Record<string, boolean>>(LS.follow, {});
        const ids = Object.keys(local).filter((k) => local[k] && !(j.relations?.following || []).includes(k));
        saveJSON(LS.followMigrated, true);
        if (ids.length) {
          await Promise.all(ids.map((id) => social("follow", { target_id: id }).catch(() => null)));
          void loadRelations(profileId);
        }
      }
    } catch { setSocialReady(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function social(action: string, extra: Record<string, unknown> = {}) {
    const r = await fetch("/api/media-social", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, init_data: tgInitData(), ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "failed"), { status: r.status, needsMigration: !!j.needs_migration });
    return j;
  }

  const profileTargetId = viewUserId || (tab === "me" ? userId : null);
  const isOwnProfile = !!profileTargetId && profileTargetId === userId;
  const showProfile = tab === "me" || !!viewUserId;

  const buildQuery = useCallback((offset: number) => {
    const qs = new URLSearchParams({ sort: tab === "trending" ? "trending" : "latest", type: tab === "audio" ? "audio" : "all", offset: String(offset), limit: tab === "admin" ? "80" : "30" });
    if (search.trim()) qs.set("q", search.trim());
    const initData = tgInitData();
    if (initData) qs.set("init_data", initData);
    if (showProfile && profileTargetId) qs.set("sharer", profileTargetId);
    else if (tab === "following") qs.set("feed", "following");
    if (tab === "admin") qs.set("admin", "1");
    return qs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, showProfile, profileTargetId]);

  function mergeLiked(list: FeedItem[]) {
    const fromServer = list.filter((i) => typeof i.liked === "boolean");
    if (!fromServer.length) return;
    setLiked((prev) => { const next = { ...prev }; for (const i of fromServer) next[i.id] = !!i.liked; saveJSON(LS.liked, next); return next; });
  }

  const load = useCallback(async () => {
    setLoading(true);
    setNewCount(0);
    try {
      const r = await fetch(`/api/media-feed?${buildQuery(0)}`, { cache: "no-store" });
      const j = await r.json();
      let list: FeedItem[] = Array.isArray(j.items) ? j.items : [];
      // Trending rotates: posts already seen move behind unseen ones (each
      // group keeps its ranking), so every refresh leads with something new.
      if (tab === "trending" && !showProfile && seenRef.current.size) {
        const fresh = list.filter((i) => !seenRef.current.has(i.id));
        const seen = list.filter((i) => seenRef.current.has(i.id));
        list = [...fresh, ...seen];
      }
      setItems(list);
      mergeLiked(list);
      setNextOffset(typeof j.next_offset === "number" ? j.next_offset : null);
    } catch { setItems([]); setNextOffset(null); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildQuery, tab, showProfile]);

  async function loadMore() {
    if (loadingMore || nextOffset == null) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/media-feed?${buildQuery(nextOffset)}`, { cache: "no-store" });
      const j = await r.json();
      const more: FeedItem[] = Array.isArray(j.items) ? j.items : [];
      setItems((prev) => { const have = new Set(prev.map((i) => i.id)); return [...prev, ...more.filter((i) => !have.has(i.id))]; });
      mergeLiked(more);
      setNextOffset(typeof j.next_offset === "number" ? j.next_offset : null);
    } catch {} finally { setLoadingMore(false); }
  }

  // "New posts" pill: checks every minute for posts newer than what's on
  // screen, without yanking the list the user is reading.
  useEffect(() => {
    if (showProfile || (tab !== "trending" && tab !== "following" && tab !== "audio")) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const qs = buildQuery(0); qs.set("sort", "latest"); qs.set("limit", "20");
        const j = await (await fetch(`/api/media-feed?${qs}`, { cache: "no-store" })).json();
        const newest = Math.max(0, ...items.map((i) => i.created_at || 0));
        const have = new Set(items.map((i) => i.id));
        setNewCount((Array.isArray(j.items) ? j.items : []).filter((i: FeedItem) => (i.created_at || 0) > newest && !have.has(i.id)).length);
      } catch {}
    }, 60000);
    return () => clearInterval(t);
  }, [buildQuery, items, tab, showProfile]);

  useEffect(() => { load(); if (tab === "admin" && isOwner) { void loadAdmin(); void loadReports(); } }, [load, tab, isOwner]);
  useEffect(() => { void loadRelations(showProfile ? profileTargetId : null); }, [loadRelations, showProfile, profileTargetId]);
  useEffect(() => { if (isOwnProfile && userId) void loadReward(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isOwnProfile, userId]);

  async function loadAdmin() {
    try {
      const r = await fetch("/api/media-admin", { cache: "no-store" });
      const j = await r.json();
      if (j.stats) setAdminStats(j.stats);
      if (Array.isArray(j.settings?.force_sub_channels)) setForceChans(j.settings.force_sub_channels.join(", "));
    } catch {}
  }
  async function loadReports() {
    try {
      const r = await fetch(`/api/media-social?reports=1&init_data=${encodeURIComponent(tgInitData())}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.reports)) setReports(j.reports);
    } catch {}
  }
  async function loadAdminConvs() {
    try {
      const j = await (await fetch(`/api/media-messages?admin=1&init_data=${encodeURIComponent(tgInitData())}`, { cache: "no-store" })).json();
      setAdminConvs(Array.isArray(j.conversations) ? j.conversations : []);
    } catch { setAdminConvs([]); }
  }
  async function openAdminConv(c: { a: string; b: string; a_name: string; b_name: string }) {
    setAdminConv({ ...c, messages: [] });
    try {
      const j = await (await fetch(`/api/media-messages?admin=1&a=${encodeURIComponent(c.a)}&b=${encodeURIComponent(c.b)}&init_data=${encodeURIComponent(tgInitData())}`, { cache: "no-store" })).json();
      setAdminConv({ ...c, messages: Array.isArray(j.messages) ? j.messages : [] });
    } catch {}
  }
  async function resolveReport(rep: Report, decision: "hide" | "delete" | "dismiss") {
    try {
      await social("resolve_report", { report_id: rep.id, decision });
      setReports((prev) => prev.map((x) => (x.post_id === rep.post_id && x.status === "open" ? { ...x, status: decision === "dismiss" ? "dismissed" : "hidden" } : x)));
      if (decision !== "dismiss") setItems((prev) => prev.filter((x) => x.id !== rep.post_id));
      showToast(decision === "dismiss" ? "تم تجاهل البلاغ" : decision === "hide" ? "تم إخفاء المنشور" : "تم حذف المنشور");
    } catch { showToast("تعذّر تنفيذ الإجراء"); }
  }
  async function hideItem(id: string) {
    await fetch("/api/media-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hide", id, init_data: tgInitData() }) });
    setItems((prev) => prev.filter((x) => x.id !== id));
  }
  async function runBroadcast() {
    if (!broadcastText.trim()) return; setAdminBusy(true);
    try {
      const r = await fetch("/api/media-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "broadcast", text: broadcastText, init_data: tgInitData() }) });
      const j = await r.json();
      tg()?.showAlert?.(j.ok ? "تم إرسال المعاينة للمالك" : j.error || "فشل");
    } finally { setAdminBusy(false); }
  }
  async function saveForceSub() {
    const channels = forceChans.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2); setAdminBusy(true);
    try {
      await fetch("/api/media-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_force_sub", channels, init_data: tgInitData() }) });
      tg()?.showAlert?.("تم حفظ قنوات الاشتراك");
    } finally { setAdminBusy(false); }
  }

  const loadInbox = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/media-messages?init_data=${encodeURIComponent(tgInitData())}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.threads)) setInboxThreads(j.threads);
      setInboxUnread(Number(j.unread || 0));
    } catch {}
  }, [userId]);
  useEffect(() => { void loadInbox(); const t = setInterval(() => void loadInbox(), 15000); return () => clearInterval(t); }, [loadInbox]);

  const loadNotifs = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/media-notifications?init_data=${encodeURIComponent(tgInitData())}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.notifications)) setNotifs(j.notifications.map((n: any) => ({ id: n.id, type: n.type, fromId: n.fromId, fromName: n.fromName, at: n.at, read: n.read, postId: n.postId })));
    } catch {}
  }, [userId]);
  useEffect(() => { void loadNotifs(); const t = setInterval(() => void loadNotifs(), 15000); return () => clearInterval(t); }, [loadNotifs]);

  // Real live-status pulse -- Telegram's own chat header can't be touched
  // by us (no Bot API for that), so this is a real, polled check against
  // our own server (which asks Telegram's getMe with BOT_TOKEN kept
  // server-side) shown here in the one header we do control.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const r = await fetch("/api/media-status", { cache: "no-store" });
        const j = await r.json();
        if (!cancelled) setBotOnline(!!j.online);
      } catch { if (!cancelled) setBotOnline(false); }
    }
    void check();
    const t = setInterval(check, 25000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Real pull-to-refresh: pulling down past a threshold refreshes feed +
  // notifications + inbox, not just the feed.
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStartRef = useRef<number | null>(null);
  const refreshingRef = useRef(false);
  const refreshAllRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    refreshAllRef.current = async () => {
      await Promise.all([load(), loadNotifs(), loadInbox()]);
    };
  }, [load, loadNotifs, loadInbox]);
  useEffect(() => {
    const THRESHOLD = 64;
    function onStart(e: TouchEvent) {
      pullStartRef.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
    }
    function onMove(e: TouchEvent) {
      if (pullStartRef.current == null) return;
      if (window.scrollY > 0) { pullStartRef.current = null; setPullY(0); return; }
      const dy = e.touches[0].clientY - pullStartRef.current;
      if (dy > 0) setPullY(Math.min(dy * 0.5, 90));
    }
    function onEnd() {
      if (pullStartRef.current == null) return;
      pullStartRef.current = null;
      setPullY((py) => {
        if (py > THRESHOLD * 0.5 && !refreshingRef.current) {
          refreshingRef.current = true;
          setRefreshing(true);
          refreshAllRef.current().finally(() => { refreshingRef.current = false; setRefreshing(false); });
        }
        return 0;
      });
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

  // Fetches the open thread's messages and marks it read; also polled while
  // the conversation is open so replies appear live.
  const loadThreadMessages = useCallback(async (peerId: string) => {
    try {
      const r = await fetch(`/api/media-messages?init_data=${encodeURIComponent(tgInitData())}&with=${encodeURIComponent(peerId)}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.messages)) setChatMsgs(j.messages);
      await fetch("/api/media-messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData(), peer_id: peerId }) });
      void loadInbox();
    } catch {}
  }, [loadInbox]);

  async function openThread(peerId: string, peerName: string) {
    setChatPeer({ id: peerId, name: peerName });
    setShowInbox(true); setShowNotifs(false); setShowComments(false);
    await loadThreadMessages(peerId);
  }
  openThreadRef.current = openThread;
  async function sendDm() {
    if (!chatPeer || !dmInput.trim() || !userId) return;
    const body = dmInput.trim(); setDmInput("");
    const r = await fetch("/api/media-messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData(), from_name: displayName || username || "مستخدم", to_id: chatPeer.id, body }) });
    if (r.status === 403) { showToast("لا يمكن مراسلة هذا المستخدم"); return; }
    await loadThreadMessages(chatPeer.id);
  }
  useEffect(() => {
    if (!chatPeer || !showInbox) return;
    const t = setInterval(() => { void loadThreadMessages(chatPeer.id); }, 4000);
    return () => clearInterval(t);
  }, [chatPeer, showInbox, loadThreadMessages]);

  const loadComments = useCallback(async (postId: string) => {
    try {
      const r = await fetch(`/api/media-comments?post_id=${encodeURIComponent(postId)}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.comments)) setComments(j.comments);
    } catch {}
  }, []);
  async function openComments(postId: string, title: string) {
    setCommentsPost({ id: postId, title }); setReplyTo(null);
    setShowComments(true); setShowInbox(false); setShowNotifs(false);
    await loadComments(postId);
  }
  async function sendComment() {
    if (!commentsPost || !commentInput.trim() || !userId) return;
    const bodyText = commentInput.trim(); const parentId = replyTo?.id || null;
    setCommentInput(""); setReplyTo(null);
    const r = await fetch("/api/media-comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData(), post_id: commentsPost.id, parent_id: parentId, from_name: displayName || username || "مستخدم", body: bodyText }) });
    if (r.status === 403) { showToast("لا يمكنك التعليق على هذا المنشور"); return; }
    await loadComments(commentsPost.id);
  }
  useEffect(() => {
    if (!showComments || !commentsPost) return;
    const t = setInterval(() => { void loadComments(commentsPost.id); }, 5000);
    return () => clearInterval(t);
  }, [showComments, commentsPost, loadComments]);

  const followingSet = useMemo(() => new Set(relations.following), [relations.following]);
  const hiddenUsers = useMemo(() => new Set([...relations.mutes, ...relations.blocks, ...relations.blockedBy]), [relations]);

  const visible = useMemo(() => {
    let list = items;
    if (!showProfile) list = list.filter((i) => !i.sharer_id || !hiddenUsers.has(i.sharer_id));
    else if (!isOwnProfile && profileTargetId && (relations.blocks.includes(profileTargetId) || relations.blockedBy.includes(profileTargetId))) list = [];
    if (showProfile) {
      if (profileSection === "video") list = list.filter((i) => i.media_type === "video");
      if (profileSection === "audio") list = list.filter((i) => i.media_type === "audio" || i.media_type === "voice");
      if (profileSection === "photo") list = list.filter((i) => i.media_type === "photo");
    } else if (tab === "audio") list = list.filter((i) => i.media_type === "audio" || i.media_type === "voice");
    if (search.trim()) { const q = search.trim().toLowerCase(); list = list.filter((i) => displayTitle(i).toLowerCase().includes(q) || (i.sharer_name || "").toLowerCase().includes(q)); }
    return list;
  }, [items, tab, showProfile, isOwnProfile, profileTargetId, profileSection, search, hiddenUsers, relations]);

  // Picks the one video card most in view (≥60% visible) for the muted
  // autoplay preview — only one at a time, to keep data use sane — and
  // records which posts this viewer has had on screen (Trending rotation).
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ratios = new Map<string, number>();
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.feedId;
        if (!id) continue;
        ratios.set(id, (e.target as HTMLElement).dataset.autoId ? e.intersectionRatio : 0);
        if (e.intersectionRatio >= 0.6 && !seenRef.current.has(id)) {
          seenRef.current.add(id);
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = setTimeout(() => saveJSON(LS.seen, Array.from(seenRef.current).slice(-600)), 1500);
        }
      }
      if (!autoplay) return;
      let best: string | null = null;
      let bestR = 0.6;
      ratios.forEach((r, id) => { if (r >= bestR) { best = id; bestR = r; } });
      setAutoId(best);
    }, { threshold: [0, 0.3, 0.6, 0.8, 1] });
    document.querySelectorAll<HTMLElement>("article[data-feed-id]").forEach((el) => obs.observe(el));
    return () => { obs.disconnect(); if (saveTimer) clearTimeout(saveTimer); };
  }, [autoplay, visible, playingId]);
  useEffect(() => { if (playingId) setAutoId(null); }, [playingId]);

  const profileStats = useMemo(() => {
    const mine = profileTargetId ? items.filter((i) => i.sharer_id === profileTargetId) : [];
    return {
      posts: mine.length,
      clones: mine.reduce((a, b) => a + (b.clones || 0), 0),
      likes: mine.reduce((a, b) => a + (b.likes || 0), 0),
      views: mine.reduce((a, b) => a + (b.views || 0), 0),
      followers: profileCounts?.followers ?? 0,
      following: profileCounts?.following ?? 0,
    };
  }, [items, profileTargetId, profileCounts]);
  const unreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);
  const openReports = useMemo(() => reports.filter((r) => r.status === "open"), [reports]);
  const cloneHref = (id: string) => (BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?start=clone_${id}` : "#");
  const shareLink = (id: string) => `${SITE}/m/${id}`;

  const openProfile = (sid?: string, sname?: string) => { if (!sid) return; setViewUserId(sid); setViewUserName(sname || names[sid] || "مستخدم"); setProfileSection("all"); setProfileCounts(null); setTab("me"); setShowNotifs(false); setShowInbox(false); setShowComments(false); };
  const closeOtherProfile = () => { setViewUserId(null); setViewUserName(""); setProfileSection("all"); setProfileCounts(null); };
  const toggleLike = (item: FeedItem) => {
    const id = item.id;
    const was = !!liked[id];
    haptic();
    setLiked((p) => { const next = { ...p, [id]: !was }; saveJSON(LS.liked, next); return next; });
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, likes: Math.max(0, (it.likes || 0) + (was ? -1 : 1)) } : it));
    fetch("/api/media-feed", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: was ? "unlike" : "like", init_data: tgInitData() }) }).catch(() => {});
    if (!was && item.sharer_id && item.sharer_id !== userId) {
      void fetch("/api/media-notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData(), to_id: item.sharer_id, from_name: displayName || username || "مستخدم", type: "like", post_id: id }) }).catch(() => {});
    }
  };
  // A view counts once someone has actually watched ≥3 seconds (autoplay
  // included), once per person per post — the server dedupes per verified
  // Telegram user and ignores the post's own sharer.
  const viewedRef = useRef<Set<string>>(new Set());
  const markViewed = (item: FeedItem, seconds: number) => {
    if (seconds < 3 || viewedRef.current.has(item.id)) return;
    viewedRef.current.add(item.id);
    if (item.sharer_id && item.sharer_id === userId) return;
    fetch("/api/media-feed", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action: "view", init_data: tgInitData() }) })
      .then((r) => r.json())
      .then((j) => { if (j?.counted) setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, views: (it.views || 0) + 1 } : it))); })
      .catch(() => {});
  };
  const playItem = (item: FeedItem) => {
    setPlayError(null);
    setPlayingId(item.id);
  };

  function relationError(e: any) {
    if (e?.needsMigration) showToast("هذه الميزة بانتظار تفعيلها من المالك");
    else if (e?.status === 403) showToast("غير مسموح");
    else showToast("تعذّر التنفيذ، حاول مجدداً");
  }
  async function toggleFollow(sid: string) {
    if (!sid || sid === userId) return;
    const was = followingSet.has(sid);
    haptic();
    setRelations((r) => ({ ...r, following: was ? r.following.filter((x) => x !== sid) : [...r.following, sid] }));
    setProfileCounts((c) => (c && sid === profileTargetId ? { ...c, followers: Math.max(0, c.followers + (was ? -1 : 1)) } : c));
    try { await social(was ? "unfollow" : "follow", { target_id: sid }); showToast(was ? "أُلغيت المتابعة" : "تتابعه الآن — ستجد تحميلاته في «تتابعه»"); }
    catch (e) { void loadRelations(profileTargetId); relationError(e); }
  }
  async function openPeople(kind: "followers" | "following", of: string) {
    haptic();
    setPeopleSheet({ kind, of, people: null });
    try {
      const r = await fetch(`/api/media-social?list=${kind}&of=${encodeURIComponent(of)}&init_data=${encodeURIComponent(tgInitData())}`, { cache: "no-store" });
      const j = await r.json();
      setPeopleSheet({ kind, of, people: Array.isArray(j.people) ? j.people : [] });
    } catch { setPeopleSheet({ kind, of, people: [] }); }
  }
  async function toggleNotify(sid: string) {
    const off = notifyOff.includes(sid);
    haptic();
    setNotifyOff((prev) => (off ? prev.filter((x) => x !== sid) : [...prev, sid]));
    try { await social("set_notify", { target_id: sid, on: off }); showToast(off ? "🔔 ستصلك رسالة من البوت عند كل مشاركة جديدة له" : "🔕 أُوقفت إشعاراته"); }
    catch (e) { setNotifyOff((prev) => (off ? [...prev, sid] : prev.filter((x) => x !== sid))); relationError(e); }
  }
  function setAutoplayPref(on: boolean) { setAutoplay(on); saveJSON(LS.autoplay, on); if (!on) setAutoId(null); showToast(on ? "▶️ التشغيل التلقائي مفعّل" : "⏸ التشغيل التلقائي متوقف"); }
  async function toggleMute(sid: string, name?: string) {
    const was = relations.mutes.includes(sid);
    if (!was && !(await confirmBox(`كتم ${name || "هذا المستخدم"}؟ لن ترى منشوراته بعد الآن، ولن يعلم بذلك.`))) return;
    setRelations((r) => ({ ...r, mutes: was ? r.mutes.filter((x) => x !== sid) : [...r.mutes, sid] }));
    try { await social(was ? "unmute" : "mute", { target_id: sid }); haptic("success"); showToast(was ? "أُلغي الكتم" : "تم الكتم 🔇"); }
    catch (e) { void loadRelations(profileTargetId); relationError(e); }
  }
  async function toggleBlock(sid: string, name?: string) {
    const was = relations.blocks.includes(sid);
    if (!was && !(await confirmBox(`حظر ${name || "هذا المستخدم"}؟ لن يرى أيٌّ منكما منشورات الآخر، ولن يستطيع متابعتك أو مراسلتك أو التعليق على منشوراتك.`))) return;
    setRelations((r) => ({
      ...r,
      blocks: was ? r.blocks.filter((x) => x !== sid) : [...r.blocks, sid],
      following: was ? r.following : r.following.filter((x) => x !== sid),
    }));
    try { await social(was ? "unblock" : "block", { target_id: sid }); haptic("success"); showToast(was ? "أُلغي الحظر" : "تم الحظر ⛔"); }
    catch (e) { void loadRelations(profileTargetId); relationError(e); }
  }
  async function deletePost(item: FeedItem) {
    if (!(await confirmBox("حذف هذا المنشور نهائياً؟"))) return;
    try {
      await social("delete_post", { post_id: item.id });
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      haptic("success"); showToast("تم حذف المنشور 🗑");
    } catch (e) { relationError(e); }
  }
  // "Forward" inside Telegram: the real video (by its Telegram file) is
  // prepared server-side and the user picks any chat to send it to
  // (WebApp.shareMessage, Bot API 8.0). Older Telegram apps fall back to
  // Telegram's own share sheet with the post's link.
  async function forwardInTelegram(item: FeedItem) {
    const t = tg();
    haptic();
    const fallback = () => {
      const url = `https://t.me/share/url?url=${encodeURIComponent(shareLink(item.id))}&text=${encodeURIComponent(displayTitle(item))}`;
      if (t?.openTelegramLink) t.openTelegramLink(url); else window.open(url, "_blank");
    };
    if (!t?.shareMessage || !t?.isVersionAtLeast?.("8.0")) return fallback();
    try {
      const j = await social("prepare_share", { post_id: item.id });
      t.shareMessage(j.prepared_id, (sent: boolean) => { if (sent) showToast("تم الإرسال ✅"); });
    } catch { fallback(); }
  }
  async function copyExternalLink(item: FeedItem) {
    const link = shareLink(item.id);
    try { await navigator.clipboard.writeText(link); showToast("تم نسخ الرابط — يظهر مع معاينة عند إرساله 🔗"); }
    catch { tg()?.showPopup?.({ title: "رابط المنشور", message: link, buttons: [{ type: "close" }] }) ?? window.prompt("انسخ الرابط", link); }
  }
  async function submitReport() {
    if (!reportItem || !reportReason) return;
    try {
      const j = await social("report", { post_id: reportItem.id, reason: reportReason, details: reportDetails.trim() });
      haptic("success");
      showToast(j.auto_hidden ? "شكراً — أُخفي المنشور حتى مراجعته" : "شكراً، وصل بلاغك إلى الإدارة 🚩");
      if (j.auto_hidden) setItems((prev) => prev.filter((x) => x.id !== reportItem.id));
      setReportItem(null); setReportReason(""); setReportDetails("");
    } catch (e) { relationError(e); }
  }
  const saveProfile = () => { if (editName.trim()) setDisplayName(editName.trim()); if (editStatus.trim()) setStatusLine(editStatus.trim()); saveJSON(LS.profile, { name: editName.trim() || displayName, status: editStatus.trim() || statusLine }); setEditing(false); };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "trending", label: "رائج", icon: "🔥" },
    { id: "following", label: "تتابعه", icon: "💜" },
    { id: "audio", label: "صوت", icon: "🎧" },
    { id: "me", label: "ملفي", icon: "👤" },
    ...(isOwner ? [{ id: "admin" as Tab, label: "أدمن", icon: "👑" }] : []),
  ];
  const headerName = viewUserId && !isOwnProfile ? viewUserName || "ملف مستخدم" : displayName;
  const viewedIsBlocked = !!profileTargetId && relations.blocks.includes(profileTargetId);
  const viewedIsMuted = !!profileTargetId && relations.mutes.includes(profileTargetId);
  const viewedBlockedMe = !!profileTargetId && relations.blockedBy.includes(profileTargetId);
  const overlayOpen = showNotifs || showInbox || showComments;

  const emptyText = tab === "following" && !showProfile
    ? (socialReady === false ? "ميزة «تتابعه» بانتظار تفعيلها من المالك" : relations.following.length ? "لم يحمّل من تتابعهم شيئاً بعد" : "لا تتابع أحداً بعد — افتح ملف أي مستخدم من «رائج» واضغط «متابعة»")
    : tab === "audio" ? "لا يوجد صوت بعد" : showProfile ? "لا منشورات هنا بعد" : "لا يوجد محتوى";

  return (
    <div className="min-h-screen bg-[#eaf6ff] text-slate-800">
      <MonetagSdkLoader />
      <header className="sticky top-0 z-20 border-b border-sky-100 bg-[#eaf6ff]/95 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div><p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-sky-500">TELEGRAM MINI APP <LiveDot online={botOnline} /></p><h1 className="text-lg font-black text-slate-800">{headerName ? `أهلاً ${headerName.split(" ")[0]}` : "موجز الوسائط"}</h1></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { haptic(); void load(); }} title="تحديث" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-100 text-lg shadow-sm ring-1 ring-teal-200">🔄</button>
            <button type="button" title="الإشعارات" onClick={async () => { setShowNotifs(true); setShowInbox(false); setShowComments(false); await loadNotifs(); if (userId) { await fetch("/api/media-notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData() }) }).catch(() => {}); setNotifs((prev) => prev.map((n) => ({ ...n, read: true }))); } }} className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-lg shadow-sm ring-1 ring-rose-200">🔔{unreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{unreadCount}</span>}</button>
            <button type="button" title="الرسائل" onClick={() => { setShowInbox(true); setChatPeer(null); setShowNotifs(false); setShowComments(false); void loadInbox(); }} className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-lg shadow-sm ring-1 ring-violet-200">✉️{inboxUnread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-black text-white">{inboxUnread}</span>}</button>
            <button type="button" onClick={() => { closeOtherProfile(); setShowNotifs(false); setShowInbox(false); setShowComments(false); setTab("me"); }} className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 ring-2 ring-white shadow">{photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-lg font-black text-white">{(displayName || "U").slice(0, 1)}</span>}</button>
          </div>
        </div>
        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">{tabs.map((t) => { const active = !viewUserId && tab === t.id; return (<button key={t.id} type="button" onClick={() => { haptic(); closeOtherProfile(); setShowNotifs(false); setShowInbox(false); setShowComments(false); setTab(t.id); }} className={`relative flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${active ? TAB_STYLES[t.id].active : TAB_STYLES[t.id].idle}`}><span>{t.icon}</span>{t.label}{t.id === "admin" && openReports.length > 0 && <span className="mr-0.5 rounded-full bg-rose-500 px-1.5 text-[9px] font-black text-white">{openReports.length}</span>}</button>); })}</nav>
      </header>

      {newCount > 0 && !overlayOpen && !showProfile && (
        <button type="button" onClick={() => { haptic(); window.scrollTo({ top: 0, behavior: "smooth" }); void load(); }} className="fixed left-1/2 top-[132px] z-30 -translate-x-1/2 rounded-full bg-gradient-to-l from-sky-500 to-indigo-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-sky-300">⬆ {newCount} {newCount === 1 ? "منشور جديد" : "منشورات جديدة"}</button>
      )}
      <div className="flex items-center justify-center overflow-hidden text-xl text-sky-500" style={{ height: refreshing ? 36 : pullY, transition: refreshing ? "height 0.15s ease-out" : pullY === 0 ? "height 0.2s ease-out" : undefined }}>
        {(refreshing || pullY > 0) && <span className={refreshing ? "animate-spin" : ""}>🔄</span>}
      </div>

      <div className="px-3 pt-2"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="🔍 ابحث بالعنوان أو اسم المستخدم..." className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-2.5 text-sm shadow-sm outline-none placeholder:text-slate-400 focus:border-sky-400" /></div>

      <MonetagBannerSlot className="mx-3 mt-2 overflow-hidden rounded-2xl" />
      {!overlayOpen && tab !== "admin" && <div className="mx-3 mt-2 flex justify-center overflow-hidden rounded-2xl bg-white/70 py-1 ring-1 ring-sky-100"><AdsterraBanner adKey="560a1eb1632771185b888243a7d36a07" width={320} height={50} /></div>}

      {showInbox && (
        <div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-violet-100 bg-violet-50 px-4 py-3">
            <p className="text-sm font-black text-violet-800">{chatPeer ? `محادثة · ${chatPeer.name}` : "✉️ صندوق الرسائل"}</p>
            <div className="flex items-center gap-3">
              {chatPeer && !OWNER_IDS.includes(chatPeer.id) && <button type="button" onClick={() => { const p = chatPeer; void toggleBlock(p.id, p.name).then(() => { setChatPeer(null); void loadInbox(); }); }} className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-600">⛔ حظر</button>}
              <button type="button" onClick={() => { if (chatPeer) setChatPeer(null); else setShowInbox(false); }} className="text-xs font-bold text-slate-500">{chatPeer ? "← رجوع" : "إغلاق"}</button>
            </div>
          </div>

          {!chatPeer ? (inboxThreads.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">لا محادثات — اضغط «💬 رسالة» من ملف مستخدم</p> : (
            <ul className="max-h-80 overflow-y-auto">{inboxThreads.filter((th) => !relations.blocks.includes(th.peer_id)).map((th) => (<li key={th.peer_id}><button type="button" onClick={() => void openThread(th.peer_id, th.peer_name)} className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-violet-50"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-300 to-fuchsia-300 text-sm font-black text-white">{(th.peer_name || "U").slice(0, 1)}</div><div className="min-w-0 flex-1"><p className="text-sm font-bold">{th.peer_name || th.peer_id}</p><p className="truncate text-[11px] text-slate-500">{th.last_body}</p></div>{th.unread > 0 && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-white">{th.unread}</span>}</button></li>))}</ul>
          )) : (
            <><div className="max-h-64 space-y-2 overflow-y-auto px-3 py-2">{chatMsgs.length === 0 && <p className="py-4 text-center text-xs text-slate-500">ابدأ المحادثة</p>}{chatMsgs.map((m) => (<div key={m.id} className={`rounded-2xl px-3 py-2 text-sm ${m.from_id === userId ? "mr-6 bg-violet-100" : "ml-6 bg-slate-100"}`}><p className="text-[10px] font-bold text-violet-700">{m.from_name}</p><p>{m.body}</p></div>))}</div>
            <div className="flex gap-2 border-t border-violet-100 p-2"><input value={dmInput} onChange={(e) => setDmInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void sendDm()} placeholder="اكتب رسالة..." className="flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm outline-none" /><button type="button" onClick={() => void sendDm()} className="rounded-xl bg-gradient-to-l from-violet-500 to-fuchsia-500 px-4 text-sm font-black text-white">إرسال</button></div></>
          )}
        </div>
      )}

      {showNotifs && (
        <div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-rose-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-4 py-3"><p className="text-sm font-black text-rose-700">🔔 الإشعارات</p><button type="button" onClick={() => setShowNotifs(false)} className="text-xs font-bold text-slate-500">إغلاق</button></div>
          {notifs.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">لا إشعارات بعد</p> : <ul className="max-h-72 overflow-y-auto">{notifs.filter((n) => !hiddenUsers.has(n.fromId)).map((n) => (<li key={n.id}><button type="button" onClick={() => { if ((n.type === "comment" || n.type === "reply") && n.postId) { const it = items.find((x) => x.id === n.postId); void openComments(n.postId, it ? displayTitle(it) : "منشور"); } else { openProfile(n.fromId, n.fromName); } }} className={`flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-rose-50 ${n.read ? "" : "bg-rose-50/60"}`}><div className={`flex h-10 w-10 items-center justify-center rounded-full text-base ${n.type === "like" ? "bg-rose-100" : n.type === "follow" ? "bg-violet-100" : "bg-amber-100"}`}>{n.type === "like" ? "❤️" : n.type === "follow" ? "💜" : "💬"}</div><div className="flex-1"><p className="text-sm font-bold"><span className="text-sky-700">{n.fromName}</span> {n.type === "like" ? "أعجب بمنشورك" : n.type === "comment" ? "علّق على منشورك" : n.type === "reply" ? "ردّ على تعليقك" : "بدأ بمتابعتك"}</p><p className="text-[11px] text-slate-500">{timeAgo(n.at)}</p></div></button></li>))}</ul>}
        </div>
      )}

      {showComments && commentsPost && (
        <div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-4 py-3">
            <p className="truncate text-sm font-black text-amber-800">💬 تعليقات · {commentsPost.title}</p>
            <button type="button" onClick={() => setShowComments(false)} className="shrink-0 text-xs font-bold text-slate-500">إغلاق</button>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto px-3 py-2">
            {comments.filter((c) => !c.parent_id && !hiddenUsers.has(c.from_id)).length === 0 && <p className="py-4 text-center text-xs text-slate-500">لا تعليقات بعد — كن أول من يعلّق</p>}
            {comments.filter((c) => !c.parent_id && !hiddenUsers.has(c.from_id)).map((c) => (<CommentThread key={c.id} comment={c} all={comments.filter((x) => !hiddenUsers.has(x.from_id))} depth={0} onReply={setReplyTo} />))}
          </div>
          <div className="border-t border-amber-100 p-2">
            {replyTo && <div className="mb-1.5 flex items-center justify-between rounded-lg bg-amber-50 px-2 py-1"><p className="text-[11px] text-slate-600">الرد على <span className="font-bold text-amber-700">{replyTo.from_name}</span></p><button type="button" onClick={() => setReplyTo(null)} className="text-[11px] font-bold text-rose-500">إلغاء</button></div>}
            <div className="flex gap-2"><input value={commentInput} onChange={(e) => setCommentInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void sendComment()} placeholder={replyTo ? "اكتب ردك..." : "اكتب تعليقاً..."} className="flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none" /><button type="button" onClick={() => void sendComment()} className="rounded-xl bg-gradient-to-l from-amber-500 to-orange-500 px-4 text-sm font-black text-white">إرسال</button></div>
          </div>
        </div>
      )}

      <div className="relative z-10 px-3 pb-10 pt-3">
        {showProfile && !overlayOpen && (
          <div className="mb-4 overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm">
            <div className="h-20 bg-gradient-to-l from-teal-400 via-sky-500 to-indigo-500" />
            <div className="relative px-4 pb-4">
              <div className="-mt-10 flex items-end gap-3">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-gradient-to-br from-sky-400 to-indigo-500 text-2xl font-black text-white shadow">{isOwnProfile && photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : (headerName || "U").slice(0, 1)}</div>
                <div className="mb-1 flex-1">{editing && isOwnProfile ? <input value={editName} onChange={(e) => setEditName(e.target.value)} className="mb-1 w-full rounded-xl border border-sky-200 bg-white px-2 py-1 text-sm font-bold outline-none" /> : <p className="text-lg font-black">{headerName || "زائر"}</p>}<p className="text-xs text-slate-500">{isOwnProfile && username ? `@${username}` : profileTargetId ? `ID ${profileTargetId}` : "—"}</p></div>
              </div>
              {isOwnProfile && <p className="mt-2 text-xs text-slate-500">{statusLine}</p>}
              {viewedBlockedMe && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-500">لا يمكنك التفاعل مع هذا الحساب.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {viewUserId && !isOwnProfile && <button type="button" onClick={closeOtherProfile} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">← رجوع</button>}
                {isOwnProfile && (editing ? <button type="button" onClick={saveProfile} className="rounded-xl bg-teal-500 px-4 py-2 text-xs font-bold text-white">حفظ</button> : <button type="button" onClick={() => { setEditName(displayName); setEditStatus(statusLine); setEditing(true); }} className="rounded-xl bg-teal-50 px-3 py-2 text-xs font-bold text-teal-700 ring-1 ring-teal-100">✏️ تعديل</button>)}
                {profileTargetId && !isOwnProfile && !viewedBlockedMe && !viewedIsBlocked && (<>
                  <button type="button" onClick={() => void toggleFollow(profileTargetId)} className={`rounded-xl px-4 py-2 text-xs font-bold ${followingSet.has(profileTargetId) ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "bg-gradient-to-l from-violet-500 to-fuchsia-500 text-white shadow"}`}>{followingSet.has(profileTargetId) ? "✓ تتابعه" : "＋ متابعة"}</button>
                  {followingSet.has(profileTargetId) && (
                    <button type="button" onClick={() => void toggleNotify(profileTargetId)} title="إشعار عند مشاركاته الجديدة" className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${notifyOff.includes(profileTargetId) ? "bg-slate-50 text-slate-500 ring-slate-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>{notifyOff.includes(profileTargetId) ? "🔕" : "🔔"}</button>
                  )}
                  <button type="button" onClick={() => void openThread(profileTargetId, viewUserName || "مستخدم")} className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 ring-1 ring-sky-100">💬 رسالة</button>
                  <button type="button" onClick={() => void toggleMute(profileTargetId, viewUserName)} className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${viewedIsMuted ? "bg-slate-600 text-white ring-slate-600" : "bg-slate-50 text-slate-600 ring-slate-200"}`}>{viewedIsMuted ? "🔈 إلغاء الكتم" : "🔇 كتم"}</button>
                </>)}
                {profileTargetId && !isOwnProfile && !OWNER_IDS.includes(profileTargetId) && (
                  <button type="button" onClick={() => void toggleBlock(profileTargetId, viewUserName)} className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${viewedIsBlocked ? "bg-rose-500 text-white ring-rose-500" : "bg-rose-50 text-rose-600 ring-rose-100"}`}>{viewedIsBlocked ? "✓ إلغاء الحظر" : "⛔ حظر"}</button>
                )}
              </div>
              <div className="mt-4 grid grid-cols-5 gap-1.5">{([[profileStats.posts, "منشورات", "text-sky-600 bg-sky-50"], [profileStats.views, "مشاهدة", "text-indigo-600 bg-indigo-50"], [profileStats.clones, "تحميل", "text-emerald-600 bg-emerald-50"], [profileStats.likes, "إعجاب", "text-rose-600 bg-rose-50"]] as [number, string, string][]).map(([v, l, c]) => (<div key={l} className={`rounded-2xl py-2.5 text-center ${c.split(" ")[1]}`}><p className={`text-base font-black ${c.split(" ")[0]}`}>{v}</p><p className="text-[9px] font-bold text-slate-500">{l}</p></div>))}<button type="button" onClick={() => profileTargetId && void openPeople("followers", profileTargetId)} className="rounded-2xl bg-violet-50 py-2.5 text-center ring-1 ring-violet-100 active:scale-95"><p className="text-base font-black text-violet-600">{profileStats.followers}</p><p className="text-[9px] font-bold text-violet-500">متابِع ›</p></button></div>
              {profileTargetId && <button type="button" onClick={() => void openPeople("following", profileTargetId)} className="mt-2 text-[11px] font-bold text-violet-600">يتابع {profileStats.following} شخصاً ›</button>}
              <div className="mt-3 flex gap-1.5">{(["all", "video", "audio", "photo"] as const).map((id) => (<button key={id} type="button" onClick={() => setProfileSection(id)} className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold ${profileSection === id ? "bg-gradient-to-l from-teal-500 to-sky-500 text-white" : "bg-slate-50 text-slate-600"}`}>{{ all: "الكل", video: "فيديو", audio: "صوت", photo: "صورة" }[id]}</button>))}</div>
            </div>
          </div>
        )}

        {isOwnProfile && !overlayOpen && (
          <div className="mb-4 rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4">
            <div className="flex items-center justify-between"><p className="text-sm font-black text-teal-700">📋 استخدامي</p><LiveDot online={botOnline} label /></div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <div className="rounded-2xl bg-white p-2.5 text-center shadow-sm"><p className="text-lg font-black text-rose-500">{Object.values(liked).filter(Boolean).length}</p><p className="text-[9px] font-bold text-slate-500">إعجاباتي</p></div>
              <div className="rounded-2xl bg-white p-2.5 text-center shadow-sm"><p className="text-lg font-black text-violet-600">{relations.following.length}</p><p className="text-[9px] font-bold text-slate-500">أتابع</p></div>
              <div className="rounded-2xl bg-white p-2.5 text-center shadow-sm"><p className="text-lg font-black text-emerald-600">{inboxUnread}</p><p className="text-[9px] font-bold text-slate-500">رسائل جديدة</p></div>
              <div className="rounded-2xl bg-white p-2.5 text-center shadow-sm"><p className="text-lg font-black text-amber-600">{unreadCount}</p><p className="text-[9px] font-bold text-slate-500">إشعارات جديدة</p></div>
            </div>
            <div className="mt-3 rounded-2xl bg-gradient-to-l from-amber-100 via-yellow-50 to-orange-50 p-3 shadow-sm ring-1 ring-amber-200">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-amber-800">🎁 تحميلات إضافية مجاناً</p>
                  <p className="text-[11px] font-semibold text-amber-700/80">شاهد إعلاناً قصيراً = +{reward?.per_ad ?? 3} تحميلات اليوم في البوت</p>
                </div>
                <button type="button" disabled={adBusy || (reward ? reward.remaining <= 0 : false)} onClick={() => void watchSupportAd()} className="shrink-0 rounded-xl bg-gradient-to-l from-amber-500 to-orange-500 px-3 py-2 text-xs font-black text-white shadow disabled:opacity-50">{adBusy ? "..." : "🎬 شاهد"}</button>
              </div>
              {reward && (
                <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-amber-800/80">
                  <span>ربحت اليوم: +{reward.bonus} تحميل</span>
                  <span>متبقٍ: {reward.remaining} {reward.remaining === 1 ? "إعلان" : "إعلانات"}</span>
                </div>
              )}
            </div>
            {/* Paid upgrade (media-bot/services/premium.py): order on the site,
                then /premium <code> in the bot. Limits from media-bot/services/store.py. */}
            <button
              type="button"
              onClick={() => {
                const url = `${window.location.origin}/service/media-bot-premium`;
                const w = tg();
                if (w?.openLink) w.openLink(url); else window.open(url, "_blank", "noopener");
              }}
              className="mt-3 flex w-full items-center justify-between gap-2 rounded-2xl bg-gradient-to-l from-violet-600 to-indigo-600 px-3 py-2.5 text-right text-white shadow"
            >
              <span>
                <span className="block text-sm font-black">💎 الترقية المدفوعة — 50 تحميلاً يومياً</span>
                <span className="block text-[11px] font-semibold text-white/80">بدل 8 مجاناً + أولوية في المعالجة · ادفع ثم أرسل /premium ورمز طلبك للبوت</span>
              </span>
              <span className="shrink-0 rounded-xl bg-white/20 px-2.5 py-1 text-xs font-black">اطلب ←</span>
            </button>
            <button type="button" onClick={() => setAutoplayPref(!autoplay)} className="mt-3 flex w-full items-center justify-between rounded-xl bg-white px-3 py-2.5 shadow-sm">
              <span className="text-xs font-bold text-slate-700">▶️ تشغيل الفيديو تلقائياً (بلا صوت) أثناء التمرير</span>
              <span className={`relative h-5 w-9 rounded-full transition ${autoplay ? "bg-teal-500" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoplay ? "right-0.5" : "right-[18px]"}`} /></span>
            </button>
            {(relations.mutes.length > 0 || relations.blocks.length > 0) && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs font-bold text-slate-600">المكتومون والمحظورون</p>
                {[...relations.mutes.map((id) => ({ id, kind: "mute" as const })), ...relations.blocks.map((id) => ({ id, kind: "block" as const }))].map(({ id, kind }) => (
                  <div key={`${kind}_${id}`} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm">
                    <span className="text-xs font-bold">{kind === "mute" ? "🔇" : "⛔"} {names[id] || `مستخدم ${id}`}</span>
                    <button type="button" onClick={() => void (kind === "mute" ? toggleMute(id) : toggleBlock(id))} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{kind === "mute" ? "إلغاء الكتم" : "إلغاء الحظر"}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "admin" && isOwner && !viewUserId && !overlayOpen && (
          <div className="mb-4 space-y-3">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">{([["reports", "🚩 البلاغات"], ["chats", "💬 المحادثات"], ["rooms", "🔒 الغرف"], ["content", "🗂 المحتوى"], ["settings", "⚙️ الإعدادات"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setAdminSection(k); if (k === "chats" && adminConvs === null) void loadAdminConvs(); }} className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ${adminSection === k ? "bg-amber-500 text-white shadow" : "bg-white text-amber-700 ring-1 ring-amber-100"}`}>{l}{k === "reports" && openReports.length > 0 ? ` (${openReports.length})` : ""}</button>
            ))}</div>
            {adminSection === "reports" && (
            <div className="rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4">
              <div className="flex items-center justify-between"><p className="text-sm font-black text-rose-700">🚩 البلاغات {openReports.length > 0 && <span className="mr-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] text-white">{openReports.length} مفتوح</span>}</p><button type="button" onClick={() => void loadReports()} className="text-[11px] font-bold text-rose-600">تحديث</button></div>
              {openReports.length === 0 ? <p className="mt-3 text-center text-xs text-slate-500">لا بلاغات مفتوحة ✅</p> : (
                <div className="mt-3 space-y-2">{openReports.map((rep) => (
                  <div key={rep.id} className="rounded-2xl border border-rose-100 bg-white p-3 shadow-sm">
                    <p className="truncate text-xs font-black">{rep.post_title && !/^\d{6,}$/.test(rep.post_title) ? rep.post_title : `منشور ${rep.post_id}`}</p>
                    <p className="mt-1 text-[11px] font-bold text-rose-600">{rep.reason_label}</p>
                    {rep.details && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{rep.details}</p>}
                    <p className="mt-1 text-[10px] text-slate-400">من {rep.reporter_name || rep.reporter_id} · {timeAgo(rep.created_at)} · {reports.filter((r) => r.post_id === rep.post_id && r.status === "open").length} بلاغ على المنشور</p>
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      <a href={shareLink(rep.post_id)} target="_blank" rel="noreferrer" className="rounded-lg bg-sky-50 py-1.5 text-center text-[11px] font-bold text-sky-700">👁 عرض</a>
                      <button type="button" onClick={() => void resolveReport(rep, "hide")} className="rounded-lg bg-amber-100 py-1.5 text-[11px] font-bold text-amber-700">🙈 إخفاء</button>
                      <button type="button" onClick={() => void resolveReport(rep, "delete")} className="rounded-lg bg-rose-100 py-1.5 text-[11px] font-bold text-rose-700">🗑 حذف</button>
                      <button type="button" onClick={() => void resolveReport(rep, "dismiss")} className="rounded-lg bg-slate-100 py-1.5 text-[11px] font-bold text-slate-600">تجاهل</button>
                    </div>
                  </div>
                ))}</div>
              )}
              {reports.some((r) => r.status !== "open") && <p className="mt-2 text-[10px] text-slate-400">بلاغات تمت معالجتها: {reports.filter((r) => r.status !== "open").length}</p>}
            </div>
            )}
            {adminSection === "chats" && (
            <div className="rounded-3xl border border-violet-200 bg-white p-3">
              {adminConv ? (
                <>
                  <div className="mb-2 flex items-center justify-between"><p className="text-xs font-black text-violet-800">💬 {adminConv.a_name} ↔ {adminConv.b_name}</p><button type="button" onClick={() => setAdminConv(null)} className="text-[11px] font-bold text-slate-500">← رجوع</button></div>
                  <div className="mb-2 flex gap-2"><button type="button" onClick={() => openProfile(adminConv.a, adminConv.a_name)} className="rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">👤 {adminConv.a_name}</button><button type="button" onClick={() => openProfile(adminConv.b, adminConv.b_name)} className="rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">👤 {adminConv.b_name}</button></div>
                  <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">{adminConv.messages.length === 0 ? <p className="py-4 text-center text-xs text-slate-400">...</p> : adminConv.messages.map((m) => (
                    <div key={m.id} className={`rounded-2xl px-3 py-2 text-sm ${m.from_id === adminConv.a ? "ml-8 bg-slate-100" : "mr-8 bg-violet-100"}`}><p className="text-[10px] font-bold text-violet-700">{m.from_name || m.from_id} · {timeAgo(m.created_at)}</p><p className="whitespace-pre-wrap">{m.body}</p></div>
                  ))}</div>
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between"><p className="text-xs font-black text-violet-800">💬 المحادثات بين المستخدمين</p><button type="button" onClick={() => void loadAdminConvs()} className="text-[11px] font-bold text-violet-600">تحديث</button></div>
                  {adminConvs === null ? <p className="py-4 text-center text-xs text-slate-400">جاري التحميل...</p> : adminConvs.length === 0 ? <p className="py-4 text-center text-xs text-slate-500">لا محادثات بعد</p> : (
                    <ul className="space-y-1.5">{adminConvs.map((c) => (
                      <li key={`${c.a}|${c.b}`}><button type="button" onClick={() => void openAdminConv(c)} className="w-full rounded-2xl bg-violet-50/60 px-3 py-2 text-right"><p className="text-xs font-black">{c.a_name} ↔ {c.b_name} <span className="font-normal text-slate-400">· {c.count} رسالة · {timeAgo(c.last_at)}</span></p><p className="truncate text-[11px] text-slate-500">{c.last_body}</p></button></li>
                    ))}</ul>
                  )}
                </>
              )}
            </div>
            )}
            {adminSection === "rooms" && (
            <div className="space-y-3">
              {(() => {
                const rooms = new Map<string, FeedItem[]>();
                for (const it of items) if (it.squad_code) rooms.set(it.squad_code, [...(rooms.get(it.squad_code) || []), it]);
                if (!rooms.size) return <p className="rounded-2xl bg-white p-4 text-center text-xs text-slate-500">لا منشورات في الغرف الخاصة بعد</p>;
                return Array.from(rooms.entries()).map(([code, list]) => (
                  <div key={code} className="rounded-3xl border border-amber-200 bg-amber-50/60 p-3">
                    <p className="mb-2 text-xs font-black text-amber-800">🔒 غرفة {code} · {list.length} منشور · {new Set(list.map((x) => x.sharer_id)).size} مشارك</p>
                    <div className="space-y-2">{list.slice(0, 40).map((it) => (
                      <div key={it.id} className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm">
                        <a href={mediaStreamUrl(it.id)} target="_blank" rel="noreferrer" className="h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">{it.thumbnail ? <img src={it.thumbnail} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-lg">{typeIcon(it.media_type)}</span>}</a>
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{displayTitle(it)}</p><button type="button" onClick={() => openProfile(it.sharer_id, it.sharer_name)} className="text-[10px] font-bold text-amber-700">👤 {it.sharer_name} · {timeAgo(it.created_at)}</button></div>
                        <a href={mediaStreamUrl(it.id)} target="_blank" rel="noreferrer" className="rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-700">▶</a>
                        <button type="button" onClick={() => void hideItem(it.id)} className="rounded-lg bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-600">إخفاء</button>
                      </div>
                    ))}</div>
                  </div>
                ));
              })()}
            </div>
            )}
            {adminSection === "content" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-600">مراجعة المحتوى العام — إخفاء</p>
              {items.filter((it) => !it.squad_code).slice(0, 80).map((it) => (
                <div key={it.id} className="flex items-center gap-2 rounded-2xl border border-sky-100 bg-white p-2">
                  <div className="h-12 w-16 overflow-hidden rounded-xl bg-sky-50">{it.thumbnail ? <img src={it.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-lg">{typeIcon(it.media_type)}</div>}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{displayTitle(it)}</p><p className="text-[10px] text-slate-500">{it.sharer_name}</p></div>
                  <button type="button" onClick={() => void hideItem(it.id)} className="rounded-lg bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-600">إخفاء</button>
                </div>
              ))}
            </div>
            )}
            {adminSection === "settings" && (
            <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4">
              <div className="flex items-center justify-between"><p className="text-sm font-black text-amber-700">👑 لوحة المالك</p><LiveDot online={botOnline} label /></div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-xl font-black text-sky-600">{adminStats?.posts ?? items.length}</p><p className="text-[9px] text-slate-500">منشورات</p></div>
                <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-xl font-black text-emerald-600">{adminStats?.clones ?? items.reduce((a, b) => a + (b.clones || 0), 0)}</p><p className="text-[9px] text-slate-500">استنساخ</p></div>
                <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-xl font-black text-indigo-600">{adminStats?.views ?? items.reduce((a, b) => a + (b.views || 0), 0)}</p><p className="text-[9px] text-slate-500">مشاهدات</p></div>
                <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-xl font-black text-rose-600">{adminStats?.likes ?? items.reduce((a, b) => a + (b.likes || 0), 0)}</p><p className="text-[9px] text-slate-500">إعجابات</p></div>
              </div>
              <div className="mt-3 space-y-2">
                <p className="text-xs font-bold text-amber-700/80">📢 إذاعة (معاينة للمالك)</p>
                <textarea value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)} rows={3} className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs outline-none" placeholder="نص الإذاعة..." />
                <button type="button" disabled={adminBusy} onClick={() => void runBroadcast()} className="w-full rounded-xl bg-amber-500 py-2 text-xs font-black text-white disabled:opacity-50">إرسال معاينة</button>
                <p className="text-xs font-bold text-amber-700/80">📣 قنوات الاشتراك الإجباري (حتى 2، فاصلة)</p>
                <input value={forceChans} onChange={(e) => setForceChans(e.target.value)} className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs outline-none" placeholder="@channel1, @channel2" />
                <button type="button" disabled={adminBusy} onClick={() => void saveForceSub()} className="w-full rounded-xl bg-sky-100 py-2 text-xs font-bold disabled:opacity-50">حفظ القنوات</button>
                {adminStats && <p className="text-[10px] text-slate-500">مخفي: {adminStats.hidden} · ناشرون: {adminStats.publishers}</p>}
                {socialReady === false && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">⚠️ المتابعة والكتم والحظر والبلاغات تحتاج تشغيل ملف supabase/migration_media_social.sql في Supabase مرة واحدة.</p>}
              </div>
            </div>
            )}
          </div>
        )}

        {tab !== "admin" && !overlayOpen && !(showProfile && viewedBlockedMe) && (loading ? <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-sky-100" />)}</div> : visible.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sky-200 bg-white p-8 text-center"><div className="text-4xl">{tab === "following" && !showProfile ? "💜" : "📭"}</div><p className="mt-3 text-sm font-bold text-slate-700">{emptyText}</p><button type="button" onClick={() => load()} className="mt-3 rounded-xl bg-gradient-to-l from-sky-500 to-indigo-500 px-4 py-2 text-xs font-bold text-white">🔄 تحديث</button></div>
        ) : (
          <div className="space-y-4">{visible.map((item, idx) => {
            const isAudio = item.media_type === "audio" || item.media_type === "voice";
            const isLiked = !!liked[item.id];
            const p = platformOf(item.url);
            const mine = !!userId && item.sharer_id === userId;
            return (
              <FeedAdBefore key={item.id} index={idx}>
              <article data-feed-id={item.id} data-auto-id={!isAudio ? item.id : undefined} className="overflow-hidden rounded-3xl bg-white shadow-md shadow-sky-100 ring-1 ring-sky-100">
                <div className={`relative bg-slate-900 ${isAudio ? "aspect-[16/7]" : p.vertical ? "aspect-[4/5]" : "aspect-video"}`}>
                  {playingId === item.id ? (
                    isAudio ? (<div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-indigo-100 to-sky-200"><span className="text-5xl">🎵</span><audio key={viaVercel[item.id] ? "v" : "c"} src={mediaStreamUrl(item.id, !!viaVercel[item.id])} controls autoPlay className="w-[90%]" onError={() => onPlayError(item.id)} onTimeUpdate={(e) => markViewed(item, e.currentTarget.currentTime)} /></div>)
                    : (<video key={viaVercel[item.id] ? "v" : "c"} src={mediaStreamUrl(item.id, !!viaVercel[item.id])} poster={item.thumbnail || undefined} controls autoPlay playsInline className="h-full w-full bg-black object-contain" onError={() => onPlayError(item.id)} onTimeUpdate={(e) => markViewed(item, e.currentTarget.currentTime)} />)
                  ) : autoplay && autoId === item.id && !isAudio && !autoFailed[item.id] ? (
                    // Muted preview while the card is on screen; a tap switches to the full player with sound.
                    <button type="button" onClick={() => playItem(item)} className="relative block h-full w-full">
                      <video src={mediaStreamUrl(item.id)} poster={item.thumbnail || undefined} muted autoPlay loop playsInline preload="auto" className="h-full w-full bg-black object-contain" onError={() => setAutoFailed((f) => ({ ...f, [item.id]: true }))} onTimeUpdate={(e) => markViewed(item, e.currentTarget.currentTime)} />
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">🔇 اضغط للصوت</span>
                    </button>
                  ) : (
                    <button type="button" onClick={() => playItem(item)} className="group relative block h-full w-full">
                      {isAudio ? (<div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-indigo-100 via-sky-100 to-violet-100"><span className="text-5xl">{item.media_type === "voice" ? "🎙" : "🎵"}</span><p className="text-xs font-bold text-indigo-700">{item.media_type === "voice" ? "رسالة صوتية" : "مقطع صوتي"}</p></div>) : <Thumb item={item} />}
                      <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/30 via-transparent to-transparent"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-2xl text-slate-800 shadow-xl transition group-active:scale-90">▶</span></span>
                    </button>
                  )}
                  <span className={`absolute left-2 top-2 rounded-full ${isAudio ? "bg-indigo-500" : p.badge} px-2.5 py-0.5 text-[10px] font-black text-white shadow`}>{isAudio ? "صوت" : p.label}</span>
                  <button type="button" aria-label="المزيد" onClick={() => { haptic(); setMenuItem(item); }} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-lg font-black leading-none text-white backdrop-blur">⋮</button>
                </div>
                {playError === item.id && <p className="bg-rose-50 px-3.5 py-2 text-[11px] font-bold text-rose-600">تعذّر التشغيل هنا (قد يكون الملف أكبر من 20MB) — استخدم «⚡ فوري» لاستلامه في البوت.</p>}
                <div className="p-3.5">
                  <h3 className="line-clamp-2 text-[15px] font-extrabold text-slate-800">{displayTitle(item)}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <button type="button" onClick={() => openProfile(item.sharer_id, item.sharer_name)} className="rounded-full bg-teal-50 px-2 py-0.5 font-semibold text-teal-700 ring-1 ring-teal-100">👤 {item.sharer_name || "مستخدم"}{item.sharer_id && followingSet.has(item.sharer_id) ? " 💜" : ""}</button>
                    <span>{timeAgo(item.created_at)}</span>
                    <span>👁 {item.views || 0}</span>
                    <span>⬇ {item.clones || 0}</span>
                    <span>❤ {item.likes || 0}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    <a href={cloneHref(item.id)} onClick={() => haptic()} className="col-span-1 rounded-xl bg-gradient-to-l from-sky-500 to-blue-600 py-2.5 text-center text-[11px] font-black text-white shadow-sm">⚡ فوري</a>
                    <button type="button" onClick={() => toggleLike(item)} className={`rounded-xl py-2.5 text-[13px] font-black transition ${isLiked ? "bg-rose-500 text-white shadow-sm" : "bg-rose-50 text-rose-500 ring-1 ring-rose-100"}`}>{isLiked ? "❤️" : "🤍"}</button>
                    <button type="button" onClick={() => void openComments(item.id, displayTitle(item))} className="rounded-xl bg-amber-50 py-2.5 text-[13px] font-black text-amber-600 ring-1 ring-amber-100">💬</button>
                    <a href={item.url || "#"} target="_blank" rel="noreferrer" title="المصدر الأصلي" className="rounded-xl bg-emerald-50 py-2.5 text-center text-[13px] font-black text-emerald-600 ring-1 ring-emerald-100">🌐</a>
                    <button type="button" onClick={() => void forwardInTelegram(item)} title="إرسال في تيليجرام" className="rounded-xl bg-gradient-to-l from-violet-500 to-fuchsia-500 py-2.5 text-[13px] font-black text-white shadow-sm">↪️</button>
                  </div>
                  {mine && showProfile && isOwnProfile && (
                    <button type="button" onClick={() => void deletePost(item)} className="mt-2 w-full rounded-xl bg-rose-50 py-2 text-[11px] font-bold text-rose-600 ring-1 ring-rose-100">🗑 حذف المنشور</button>
                  )}
                </div>
              </article>
              </FeedAdBefore>
            );
          })}
          {nextOffset != null && <LoadMoreSentinel onVisible={() => void loadMore()} loading={loadingMore} />}
          {nextOffset == null && visible.length > 5 && <p className="py-4 text-center text-[11px] font-bold text-slate-400">— وصلت إلى النهاية —</p>}
          </div>
        ))}
      </div>

      {/* ⋮ menu — bottom sheet */}
      {menuItem && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setMenuItem(null)}>
          <div className="w-full rounded-t-3xl bg-white p-4 pb-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
            <p className="mb-3 line-clamp-1 text-center text-xs font-bold text-slate-500">{displayTitle(menuItem)}</p>
            <div className="space-y-1.5">
              <SheetButton icon="↪️" label="إرسال في تيليجرام" hint="اختر محادثة وأرسل الفيديو نفسه" color="text-violet-700 bg-violet-50" onClick={() => { const it = menuItem; setMenuItem(null); void forwardInTelegram(it); }} />
              <SheetButton icon="🔗" label="نسخ رابط خارجي" hint="رابط يظهر مع صورة معاينة في واتساب وغيره" color="text-sky-700 bg-sky-50" onClick={() => { const it = menuItem; setMenuItem(null); void copyExternalLink(it); }} />
              {menuItem.sharer_id === userId ? (
                <SheetButton icon="🗑" label="حذف منشوري" color="text-rose-700 bg-rose-50" onClick={() => { const it = menuItem; setMenuItem(null); void deletePost(it); }} />
              ) : (
                <>
                  <SheetButton icon="🚩" label="إبلاغ عن المنشور" hint="يصل للإدارة للمراجعة" color="text-rose-700 bg-rose-50" onClick={() => { setReportItem(menuItem); setReportReason(""); setReportDetails(""); setMenuItem(null); }} />
                  {menuItem.sharer_id && (
                    <>
                      <SheetButton icon={relations.mutes.includes(menuItem.sharer_id) ? "🔈" : "🔇"} label={`${relations.mutes.includes(menuItem.sharer_id) ? "إلغاء كتم" : "كتم"} ${menuItem.sharer_name || "المستخدم"}`} hint="لن ترى منشوراته" color="text-slate-700 bg-slate-50" onClick={() => { const it = menuItem; setMenuItem(null); void toggleMute(it.sharer_id!, it.sharer_name); }} />
                      {!OWNER_IDS.includes(menuItem.sharer_id) && <SheetButton icon="⛔" label={`حظر ${menuItem.sharer_name || "المستخدم"}`} hint="لن يتفاعل أيٌّ منكما مع الآخر" color="text-rose-700 bg-rose-50" onClick={() => { const it = menuItem; setMenuItem(null); void toggleBlock(it.sharer_id!, it.sharer_name); }} />}
                    </>
                  )}
                  {isOwner && <SheetButton icon="🙈" label="إخفاء (أدمن)" color="text-amber-700 bg-amber-50" onClick={() => { const it = menuItem; setMenuItem(null); void hideItem(it.id); }} />}
                </>
              )}
            </div>
            <button type="button" onClick={() => setMenuItem(null)} className="mt-3 w-full rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-600">إلغاء</button>
          </div>
        </div>
      )}

      {/* Report sheet */}
      {reportItem && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setReportItem(null)}>
          <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
            <p className="text-center text-base font-black text-rose-700">🚩 إبلاغ عن منشور</p>
            <p className="mb-3 mt-1 line-clamp-1 text-center text-xs text-slate-500">{displayTitle(reportItem)}</p>
            <p className="mb-2 text-xs font-bold text-slate-600">ما المشكلة؟</p>
            <div className="space-y-1.5">{REPORT_REASONS.map((r) => (
              <button key={r.key} type="button" onClick={() => setReportReason(r.key)} className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-right text-sm font-bold ring-1 ${reportReason === r.key ? "bg-rose-500 text-white ring-rose-500" : "bg-slate-50 text-slate-700 ring-slate-100"}`}><span>{r.icon}</span>{r.label}</button>
            ))}</div>
            <textarea value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} rows={2} maxLength={500} placeholder="تفاصيل إضافية (اختياري)" className="mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-300" />
            <button type="button" disabled={!reportReason} onClick={() => void submitReport()} className="mt-3 w-full rounded-2xl bg-gradient-to-l from-rose-500 to-red-600 py-3 text-sm font-black text-white disabled:opacity-40">إرسال البلاغ</button>
            <button type="button" onClick={() => setReportItem(null)} className="mt-2 w-full rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-600">إلغاء</button>
          </div>
        </div>
      )}

      {peopleSheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setPeopleSheet(null)}>
          <div className="max-h-[75vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 pb-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
            <p className="mb-3 text-center text-base font-black text-violet-700">{peopleSheet.kind === "followers" ? "💜 المتابِعون" : "👥 يتابع"}</p>
            {peopleSheet.people === null ? <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-violet-50" />)}</div>
              : peopleSheet.people.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{socialReady === false ? "الميزة بانتظار تفعيلها من المالك" : "لا أحد بعد"}</p>
              : <ul className="space-y-1.5">{peopleSheet.people.map((pp) => (
                <li key={pp.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                  <button type="button" onClick={() => { setPeopleSheet(null); if (pp.id === userId) { closeOtherProfile(); setTab("me"); } else openProfile(pp.id, pp.name); }} className="flex min-w-0 flex-1 items-center gap-3 text-right">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400 text-sm font-black text-white">{(pp.name || "U").slice(0, 1)}</span>
                    <span className="truncate text-sm font-bold">{pp.name}{pp.id === userId ? " (أنت)" : ""}</span>
                  </button>
                  {pp.id !== userId && <button type="button" onClick={() => void toggleFollow(pp.id)} className={`shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-bold ${followingSet.has(pp.id) ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "bg-gradient-to-l from-violet-500 to-fuchsia-500 text-white"}`}>{followingSet.has(pp.id) ? "✓ تتابعه" : "＋ متابعة"}</button>}
                </li>
              ))}</ul>}
            <button type="button" onClick={() => setPeopleSheet(null)} className="mt-3 w-full rounded-2xl bg-slate-100 py-3 text-sm font-bold text-slate-600">إغلاق</button>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-slate-900/90 px-4 py-2.5 text-center text-xs font-bold text-white shadow-xl">{toast}</div>}
    </div>
  );
}

function SheetButton({ icon, label, hint, color, onClick }: { icon: string; label: string; hint?: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-right ${color}`}>
      <span className="text-xl">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-black">{label}</span>
        {hint && <span className="block text-[11px] font-semibold opacity-70">{hint}</span>}
      </span>
    </button>
  );
}

// Every 5th post is preceded by one in-feed ad card (300×250), mounted only
// when it scrolls near the screen so ads don't slow the first load.
function FeedAdBefore({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <>
      {index > 0 && index % 5 === 0 && <LazyFeedAd />}
      {children}
    </>
  );
}
function LazyFeedAd() {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShow(true); return; }
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setShow(true); o.disconnect(); } }, { rootMargin: "400px" });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return (
    <div ref={ref} className="overflow-hidden rounded-3xl bg-white p-2 shadow-sm ring-1 ring-sky-100">
      <p className="mb-1 px-1 text-[10px] font-bold text-slate-400">إعلان</p>
      <div className="flex min-h-[250px] justify-center">{show && <AdsterraBanner adKey="3ee970813986977775e962f26938d143" width={300} height={250} />}</div>
    </div>
  );
}
function LoadMoreSentinel({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) cb.current(); }, { rootMargin: "600px" });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return <div ref={ref} className="flex justify-center py-4">{loading ? <span className="animate-spin text-xl text-sky-500">🔄</span> : <button type="button" onClick={onVisible} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-sky-700 ring-1 ring-sky-200">تحميل المزيد</button>}</div>;
}
