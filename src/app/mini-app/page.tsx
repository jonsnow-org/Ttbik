"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tab = "trending" | "video" | "audio" | "me" | "admin";
type ProfileSection = "all" | "video" | "audio" | "photo";
type FeedItem = { id: string; media_type: string; title: string; url?: string; thumbnail?: string; sharer_name?: string; sharer_id?: string; clones?: number; likes?: number; views?: number; created_at?: number };
type Notif = { id: string; type: "follow" | "like" | "comment" | "reply"; fromId: string; fromName: string; at: number; read: boolean; postId?: string };
type CommentRow = { id: string; post_id: string; parent_id: string | null; from_id: string; from_name: string; body: string; created_at: number };

const BOT_USERNAME = process.env.NEXT_PUBLIC_MEDIA_BOT_USERNAME || "";
const OWNER_IDS = (process.env.NEXT_PUBLIC_OWNER_ID || "420066855").split(",").map((s) => s.trim());
const LS = { follow: "mb_following", profile: "mb_profile", liked: "mb_liked" };

function typeIcon(t: string) { if (t === "audio" || t === "voice") return "🎵"; if (t === "photo") return "🖼️"; return "🎬"; }
function platformBadge(url?: string) { const u = (url || "").toLowerCase(); if (u.includes("tiktok")) return { label: "TikTok", color: "bg-pink-500" }; if (u.includes("youtu")) return { label: "YouTube", color: "bg-red-500" }; if (u.includes("instagram")) return { label: "IG", color: "bg-fuchsia-500" }; if (u.includes("twitter") || u.includes("x.com")) return { label: "X", color: "bg-slate-700" }; return { label: "Media", color: "bg-sky-500" }; }
function timeAgo(ts?: number) { if (!ts) return ""; const s = Math.max(0, Math.floor(Date.now() / 1000) - ts); if (s < 60) return "الآن"; if (s < 3600) return `${Math.floor(s / 60)} د`; if (s < 86400) return `${Math.floor(s / 3600)} س`; return `${Math.floor(s / 86400)} ي`; }
function loadJSON<T>(key: string, fb: T): T { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } }
function saveJSON(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

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
    <div className={depth ? "mr-3 mt-2 border-r-2 border-sky-100 pr-2" : "mt-2"}>
      <div className="rounded-2xl bg-slate-50 px-3 py-2">
        <p className="text-[11px] font-bold text-sky-700">{comment.from_name}</p>
        <p className="whitespace-pre-wrap text-sm text-slate-800">{comment.body}</p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          <span>{timeAgo(comment.created_at)}</span>
          <button type="button" onClick={() => onReply(comment)} className="font-bold text-sky-600">رد</button>
        </div>
      </div>
      {children.map((c) => (<CommentThread key={c.id} comment={c} all={all} depth={depth + 1} onReply={onReply} />))}
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
  const [following, setFollowing] = useState<Record<string, boolean>>({});
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

  // Real auth for admin calls is the Telegram-signed initData string,
  // verified server-side against BOT_TOKEN — not a client-supplied value,
  // since anything in this client bundle is public. See
  // src/lib/verifyTelegramOwner.ts.
  function tgInitData(): string {
    return (window as any).Telegram?.WebApp?.initData || "";
  }

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready(); tg.expand();
      try { tg.setHeaderColor("#eaf6ff"); tg.setBackgroundColor("#eaf6ff"); tg.MainButton.hide(); } catch {}
      const u = tg.initDataUnsafe?.user;
      if (u?.first_name) { const full = u.first_name + (u.last_name ? ` ${u.last_name}` : ""); setDisplayName(full); setEditName(full); }
      if (u?.username) setUsername(u.username);
      if (u?.id) setUserId(String(u.id));
      if (u?.photo_url) setPhotoUrl(u.photo_url);
      try { if (u?.id) void fetch("/api/media-stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: String(u.id), name: u.first_name || "" }) }); } catch {}
    }
    setFollowing(loadJSON(LS.follow, {}));
    setLiked(loadJSON(LS.liked, {}));
    const prof = loadJSON<{ name?: string; status?: string }>(LS.profile, {});
    if (prof.name) { setDisplayName(prof.name); setEditName(prof.name); }
    if (prof.status) setStatusLine(prof.status);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let type = "all";
      if (tab === "video") type = "video";
      if (tab === "audio") type = "audio";
      const sort = tab === "trending" ? "trending" : "latest";
      const qs = new URLSearchParams({ sort, type });
      if (search.trim()) qs.set("q", search.trim());
      if (tab === "admin") { qs.set("admin", "1"); qs.set("init_data", tgInitData()); }
      const r = await fetch(`/api/media-feed?${qs}`, { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [tab, search]);
  useEffect(() => { load(); if (tab === "admin" && isOwner) void loadAdmin(); }, [load, tab, isOwner]);

  async function loadAdmin() {
    try {
      const r = await fetch("/api/media-admin", { cache: "no-store" });
      const j = await r.json();
      if (j.stats) setAdminStats(j.stats);
      if (Array.isArray(j.settings?.force_sub_channels)) setForceChans(j.settings.force_sub_channels.join(", "));
    } catch {}
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
      (window as any).Telegram?.WebApp?.showAlert?.(j.ok ? "تم إرسال المعاينة للمالك" : j.error || "فشل");
    } finally { setAdminBusy(false); }
  }
  async function saveForceSub() {
    const channels = forceChans.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2); setAdminBusy(true);
    try {
      await fetch("/api/media-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_force_sub", channels, init_data: tgInitData() }) });
      (window as any).Telegram?.WebApp?.showAlert?.("تم حفظ قنوات الاشتراك");
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
      const r = await fetch(`/api/media-notifications?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" });
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

  // Real pull-to-refresh -- there was only a manual 🔄 button before;
  // pulling down (the gesture every Telegram/mobile user actually tries
  // first) did nothing at all. This tracks a real touch gesture and, past
  // a threshold, refreshes everything (feed + notifications + inbox), not
  // just the feed, since "pull to refresh" implies a real full refresh.
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

  // Fetches the open thread's messages and marks it read. Used both for
  // the initial open AND on a recurring interval below -- previously this
  // only ran once when a thread was opened, so a reply sent while the
  // conversation was already on screen never appeared; the user had to
  // back out to the inbox list and reopen the thread to see it, which is
  // not how a normal chat behaves.
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
  async function sendDm() {
    if (!chatPeer || !dmInput.trim() || !userId) return;
    const body = dmInput.trim(); setDmInput("");
    await fetch("/api/media-messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData(), from_name: displayName || username || "مستخدم", to_id: chatPeer.id, body }) });
    await loadThreadMessages(chatPeer.id);
  }
  // Keep an open conversation live like a normal chat, instead of only
  // ever fetching once on open.
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
    await fetch("/api/media-comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ init_data: tgInitData(), post_id: commentsPost.id, parent_id: parentId, from_name: displayName || username || "مستخدم", body: bodyText }) });
    await loadComments(commentsPost.id);
  }
  useEffect(() => {
    if (!showComments || !commentsPost) return;
    const t = setInterval(() => { void loadComments(commentsPost.id); }, 5000);
    return () => clearInterval(t);
  }, [showComments, commentsPost, loadComments]);

  const profileTargetId = viewUserId || (tab === "me" ? userId : null);
  const isOwnProfile = !!profileTargetId && profileTargetId === userId;
  const profileItems = useMemo(() => {
    if (!profileTargetId) return [];
    let list = items.filter((i) => i.sharer_id === profileTargetId);
    if (profileSection === "video") list = list.filter((i) => i.media_type === "video");
    if (profileSection === "audio") list = list.filter((i) => i.media_type === "audio" || i.media_type === "voice");
    if (profileSection === "photo") list = list.filter((i) => i.media_type === "photo");
    return list;
  }, [items, profileTargetId, profileSection]);
  const visible = useMemo(() => {
    let list = viewUserId || tab === "me" ? profileItems : items;
    if (!viewUserId && tab !== "me") {
      if (tab === "audio") list = list.filter((i) => i.media_type === "audio" || i.media_type === "voice");
      else if (tab === "video") list = list.filter((i) => i.media_type === "video" || !i.media_type);
    }
    if (search.trim()) { const q = search.trim().toLowerCase(); list = list.filter((i) => i.title.toLowerCase().includes(q) || (i.sharer_name || "").toLowerCase().includes(q)); }
    return list;
  }, [items, tab, viewUserId, profileItems, search]);
  const profileStats = useMemo(() => {
    if (!profileTargetId) return { posts: 0, clones: 0, likes: 0, views: 0, followers: 0 };
    const mine = items.filter((i) => i.sharer_id === profileTargetId);
    return {
      posts: mine.length,
      clones: mine.reduce((a, b) => a + (b.clones || 0), 0),
      likes: mine.reduce((a, b) => a + (b.likes || 0), 0),
      views: mine.reduce((a, b) => a + (b.views || 0), 0),
      followers: isOwnProfile ? notifs.filter((n) => n.type === "follow").length : 0,
    };
  }, [items, profileTargetId, isOwnProfile, notifs]);
  const unreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);
  const cloneHref = (id: string) => (BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?start=clone_${id}` : "#");

  const openProfile = (sid?: string, sname?: string) => { if (!sid) return; setViewUserId(sid); setViewUserName(sname || "مستخدم"); setProfileSection("all"); setTab("me"); setShowNotifs(false); setShowInbox(false); setShowComments(false); };
  const closeOtherProfile = () => { setViewUserId(null); setViewUserName(""); setProfileSection("all"); };
  const toggleLike = (item: FeedItem) => {
    const id = item.id;
    const was = !!liked[id];
    setLiked((p) => { const next = { ...p, [id]: !was }; saveJSON(LS.liked, next); return next; });
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, likes: Math.max(0, (it.likes || 0) + (was ? -1 : 1)) } : it));
    // Real bug (fixed): this always sent action:"like" whether liking OR
    // un-liking, so the stored count only ever went up regardless of the
    // actual toggle state -- now each direction maps to its own real
    // +1/-1 on the server (see media-feed/route.ts's PATCH_DELTAS).
    fetch("/api/media-feed", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: was ? "unlike" : "like" }) }).catch(() => {});
    // Real bell notification for a like -- previously only "follow" ever
    // notified anyone; liking a post silently updated the counter with no
    // way for the post's owner to know it happened.
    if (!was && item.sharer_id && item.sharer_id !== userId) {
      void fetch("/api/media-notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to_id: item.sharer_id, from_id: userId || "0", from_name: displayName || username || "مستخدم", type: "like", post_id: id }) }).catch(() => {});
    }
  };
  // Real view counting -- there was no code anywhere that ever incremented
  // "views"; the column existed and was displayed but was permanently
  // stuck wherever it started. Counts once per item per page load (not on
  // every re-render) the moment someone actually presses play, which is a
  // real signal of interest, unlike just having scrolled past the card.
  const viewedRef = useRef<Set<string>>(new Set());
  const playItem = (item: FeedItem) => {
    setPlayError(null);
    setPlayingId(item.id);
    if (viewedRef.current.has(item.id)) return;
    viewedRef.current.add(item.id);
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, views: (it.views || 0) + 1 } : it)));
    fetch("/api/media-feed", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action: "view" }) }).catch(() => {});
  };
  const toggleFollow = (sid: string) => {
    if (!sid || sid === userId) return;
    setFollowing((prev) => {
      const next = { ...prev, [sid]: !prev[sid] }; saveJSON(LS.follow, next);
      if (next[sid]) void fetch("/api/media-notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to_id: sid, from_id: userId || "0", from_name: displayName || username || "مستخدم", type: "follow" }) }).catch(() => {});
      return next;
    });
  };
  const saveProfile = () => { if (editName.trim()) setDisplayName(editName.trim()); if (editStatus.trim()) setStatusLine(editStatus.trim()); saveJSON(LS.profile, { name: editName.trim() || displayName, status: editStatus.trim() || statusLine }); setEditing(false); };

  const tabs: { id: Tab; label: string; icon: string }[] = [ { id: "trending", label: "رائج", icon: "🔥" }, { id: "video", label: "فيديو", icon: "🎬" }, { id: "audio", label: "صوت", icon: "🎧" }, { id: "me", label: "ملفي", icon: "👤" }, ...(isOwner ? [{ id: "admin" as Tab, label: "أدمن", icon: "👑" }] : []) ];
  const showProfile = tab === "me" || !!viewUserId;
  const headerName = viewUserId && !isOwnProfile ? viewUserName : displayName;

  return (
    <div className="min-h-screen bg-[#eaf6ff] text-slate-800">
      <header className="sticky top-0 z-20 border-b border-sky-100 bg-[#eaf6ff]/95 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div><p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-sky-500">TELEGRAM MINI APP <LiveDot online={botOnline} /></p><h1 className="text-lg font-black text-slate-800">{headerName ? `أهلاً ${headerName.split(" ")[0]}` : "موجز الوسائط"}</h1></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => load()} className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">🔄</button>
            <button type="button" onClick={async () => { setShowNotifs(true); setShowInbox(false); setShowComments(false); await loadNotifs(); if (userId) { await fetch("/api/media-notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: userId }) }).catch(() => {}); setNotifs((prev) => prev.map((n) => ({ ...n, read: true }))); } }} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">🔔{unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{unreadCount}</span>}</button>
            <button type="button" onClick={() => { setShowInbox(true); setChatPeer(null); setShowNotifs(false); setShowComments(false); void loadInbox(); }} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">✉️{inboxUnread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-black text-white">{inboxUnread}</span>}</button>
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-400 to-sky-600 ring-2 ring-sky-200">{photoUrl && isOwnProfile ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-lg font-black text-white">{(headerName || "U").slice(0, 1)}</span>}</div>
          </div>
        </div>
        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">{tabs.map((t) => { const active = !viewUserId && tab === t.id; return (<button key={t.id} type="button" onClick={() => { closeOtherProfile(); setShowNotifs(false); setShowInbox(false); setShowComments(false); setTab(t.id); }} className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold ${active ? "bg-sky-500 text-white" : "bg-sky-100 text-slate-700"}`}><span>{t.icon}</span>{t.label}</button>); })}</nav>
      </header>

      <div
        className="flex items-center justify-center overflow-hidden text-xl text-sky-500"
        style={{ height: refreshing ? 36 : pullY, transition: refreshing ? "height 0.15s ease-out" : pullY === 0 ? "height 0.2s ease-out" : undefined }}
      >
        {(refreshing || pullY > 0) && <span className={refreshing ? "animate-spin" : ""}>🔄</span>}
      </div>

      <div className="px-3 pt-2"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="🔍 ابحث..." className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-slate-400" /></div>

      {showInbox && (
        <div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-sky-100 px-4 py-3">
            <p className="text-sm font-black">{chatPeer ? `محادثة · ${chatPeer.name}` : "صندوق الرسائل"}</p>
            <button type="button" onClick={() => { if (chatPeer) setChatPeer(null); else setShowInbox(false); }} className="text-xs font-bold text-slate-500">{chatPeer ? "← رجوع" : "إغلاق"}</button>
          </div>
          {!chatPeer ? (inboxThreads.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">لا محادثات — اضغط «💬 رسالة» من ملف مستخدم</p> : (
            <ul className="max-h-80 overflow-y-auto">{inboxThreads.map((th) => (<li key={th.peer_id}><button type="button" onClick={() => void openThread(th.peer_id, th.peer_name)} className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-sky-50"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-200 text-sm font-black">{(th.peer_name || "U").slice(0, 1)}</div><div className="min-w-0 flex-1"><p className="text-sm font-bold">{th.peer_name || th.peer_id}</p><p className="truncate text-[11px] text-slate-500">{th.last_body}</p></div>{th.unread > 0 && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-black text-white">{th.unread}</span>}</button></li>))}</ul>
          )) : (
            <><div className="max-h-64 space-y-2 overflow-y-auto px-3 py-2">{chatMsgs.length === 0 && <p className="py-4 text-center text-xs text-slate-500">ابدأ المحادثة</p>}{chatMsgs.map((m) => (<div key={m.id} className={`rounded-2xl px-3 py-2 text-sm ${m.from_id === userId ? "mr-6 bg-sky-200" : "ml-6 bg-slate-100"}`}><p className="text-[10px] font-bold text-sky-700">{m.from_name}</p><p>{m.body}</p></div>))}</div>
            <div className="flex gap-2 border-t border-sky-100 p-2"><input value={dmInput} onChange={(e) => setDmInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void sendDm()} placeholder="اكتب رسالة..." className="flex-1 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm outline-none" /><button type="button" onClick={() => void sendDm()} className="rounded-xl bg-sky-500 px-4 text-sm font-black text-white">إرسال</button></div></>
          )}
        </div>
      )}

      {showNotifs && (
        <div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-sky-200 bg-white">
          <div className="flex items-center justify-between border-b border-sky-100 px-4 py-3"><p className="text-sm font-black">الإشعارات</p><button type="button" onClick={() => setShowNotifs(false)} className="text-xs font-bold text-slate-500">إغلاق</button></div>
          {notifs.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">لا إشعارات بعد</p> : <ul className="max-h-72 overflow-y-auto">{notifs.map((n) => (<li key={n.id}><button type="button" onClick={() => { if ((n.type === "comment" || n.type === "reply") && n.postId) { const it = items.find((x) => x.id === n.postId); void openComments(n.postId, it?.title || "منشور"); } else { openProfile(n.fromId, n.fromName); } }} className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-sky-50"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-200 text-sm font-black">{(n.fromName || "U").slice(0, 1)}</div><div className="flex-1"><p className="text-sm font-bold"><span className="text-sky-600">{n.fromName}</span> {n.type === "like" ? "أعجب بمنشورك ❤️" : n.type === "comment" ? "علّق على منشورك 💬" : n.type === "reply" ? "ردّ على تعليقك 💬" : "بدأ بمتابعتك"}</p><p className="text-[11px] text-slate-500">{timeAgo(n.at)}</p></div></button></li>))}</ul>}
        </div>
      )}

      {showComments && commentsPost && (
        <div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-sky-100 px-4 py-3">
            <p className="truncate text-sm font-black">تعليقات · {commentsPost.title}</p>
            <button type="button" onClick={() => setShowComments(false)} className="shrink-0 text-xs font-bold text-slate-500">إغلاق</button>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto px-3 py-2">
            {comments.filter((c) => !c.parent_id).length === 0 && <p className="py-4 text-center text-xs text-slate-500">لا تعليقات بعد — كن أول من يعلّق</p>}
            {comments.filter((c) => !c.parent_id).map((c) => (<CommentThread key={c.id} comment={c} all={comments} depth={0} onReply={setReplyTo} />))}
          </div>
          <div className="border-t border-sky-100 p-2">
            {replyTo && <div className="mb-1.5 flex items-center justify-between rounded-lg bg-sky-50 px-2 py-1"><p className="text-[11px] text-slate-600">الرد على <span className="font-bold text-sky-700">{replyTo.from_name}</span></p><button type="button" onClick={() => setReplyTo(null)} className="text-[11px] font-bold text-rose-500">إلغاء</button></div>}
            <div className="flex gap-2"><input value={commentInput} onChange={(e) => setCommentInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void sendComment()} placeholder={replyTo ? "اكتب ردك..." : "اكتب تعليقاً..."} className="flex-1 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm outline-none" /><button type="button" onClick={() => void sendComment()} className="rounded-xl bg-sky-500 px-4 text-sm font-black text-white">إرسال</button></div>
          </div>
        </div>
      )}

      <div className="relative z-10 px-3 pb-10 pt-3">
        {showProfile && !showNotifs && !showInbox && !showComments && (
          <div className="mb-4 overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm">
            <div className="h-20 bg-gradient-to-l from-sky-400 to-sky-600" />
            <div className="relative px-4 pb-4">
              <div className="-mt-10 flex items-end gap-3">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-gradient-to-br from-sky-400 to-sky-600 text-2xl font-black text-white">{isOwnProfile && photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : (headerName || "U").slice(0, 1)}</div>
                <div className="mb-1 flex-1">{editing && isOwnProfile ? <input value={editName} onChange={(e) => setEditName(e.target.value)} className="mb-1 w-full rounded-xl border border-sky-200 bg-white px-2 py-1 text-sm font-bold outline-none" /> : <p className="text-lg font-black">{headerName || "زائر"}</p>}<p className="text-xs text-slate-500">{isOwnProfile && username ? `@${username}` : profileTargetId ? `ID ${profileTargetId}` : "—"}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {viewUserId && !isOwnProfile && <button type="button" onClick={closeOtherProfile} className="rounded-xl bg-sky-100 px-3 py-2 text-xs font-bold">← رجوع</button>}
                {isOwnProfile && (editing ? <button type="button" onClick={saveProfile} className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white">حفظ</button> : <button type="button" onClick={() => { setEditName(displayName); setEditStatus(statusLine); setEditing(true); }} className="rounded-xl bg-sky-100 px-3 py-2 text-xs font-bold">✏️ تعديل</button>)}
                {profileTargetId && !isOwnProfile && (<><button type="button" onClick={() => toggleFollow(profileTargetId)} className={`rounded-xl px-3 py-2 text-xs font-bold ${following[profileTargetId] ? "bg-sky-100" : "bg-sky-500 text-white"}`}>{following[profileTargetId] ? "✓ إلغاء المتابعة" : "＋ متابعة"}</button><button type="button" onClick={() => void openThread(profileTargetId, viewUserName || "مستخدم")} className="rounded-xl bg-sky-100 px-3 py-2 text-xs font-bold">💬 رسالة</button></>)}
              </div>
              <div className="mt-4 grid grid-cols-5 gap-1.5">{[[profileStats.posts, "منشورات"], [profileStats.views, "مشاهدة"], [profileStats.clones, "تحميل"], [profileStats.likes, "إعجاب"], [profileStats.followers, "متابع"]].map(([v, l]) => (<div key={String(l)} className="rounded-2xl bg-sky-50 py-2.5 text-center"><p className="text-base font-black text-sky-600">{v as number}</p><p className="text-[9px] font-bold text-slate-500">{l as string}</p></div>))}</div>
              <div className="mt-3 flex gap-1.5">{(["all", "video", "audio", "photo"] as const).map((id) => (<button key={id} type="button" onClick={() => setProfileSection(id)} className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold ${profileSection === id ? "bg-sky-500 text-white" : "bg-sky-50 text-slate-600"}`}>{{ all: "الكل", video: "فيديو", audio: "صوت", photo: "صورة" }[id]}</button>))}</div>
            </div>
          </div>
        )}

        {/* A lightweight parallel to the owner's "👑 لوحة المالك" panel,
            scoped to a regular user's own account -- previously only the
            owner had any "usage & control" glance; a normal user's own
            profile had stats about their POSTS but nothing about their own
            account activity (messages, notifications, who they follow). */}
        {isOwnProfile && !isOwner && !showNotifs && !showInbox && !showComments && (
          <div className="mb-4 rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4">
            <div className="flex items-center justify-between"><p className="text-sm font-black text-sky-700">📋 استخدامي</p><LiveDot online={botOnline} label /></div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-lg font-black text-sky-600">{Object.values(liked).filter(Boolean).length}</p><p className="text-[9px] font-bold text-slate-500">إعجاباتي</p></div>
              <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-lg font-black text-sky-600">{Object.values(following).filter(Boolean).length}</p><p className="text-[9px] font-bold text-slate-500">أتابع</p></div>
              <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-lg font-black text-emerald-600">{inboxUnread}</p><p className="text-[9px] font-bold text-slate-500">رسائل جديدة</p></div>
              <div className="rounded-2xl bg-white p-2.5 text-center"><p className="text-lg font-black text-rose-600">{unreadCount}</p><p className="text-[9px] font-bold text-slate-500">إشعارات جديدة</p></div>
            </div>
          </div>
        )}

        {tab === "admin" && isOwner && !showNotifs && !showInbox && !showComments && (
          <div className="mb-4 space-y-3">
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
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-600">مراجعة المحتوى (تشمل الغرف الخاصة) — إخفاء</p>
              {items.slice(0, 30).map((it) => (
                <div key={it.id} className="flex items-center gap-2 rounded-2xl border border-sky-100 bg-white p-2">
                  <div className="h-12 w-16 overflow-hidden rounded-xl bg-sky-50">{it.thumbnail ? <img src={it.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-lg">{typeIcon(it.media_type)}</div>}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{it.title}</p><p className="text-[10px] text-slate-500">{it.sharer_name}{(it as any).squad_code ? ` · 🔒 غرفة ${(it as any).squad_code}` : ""}</p></div>
                  <button type="button" onClick={() => void hideItem(it.id)} className="rounded-lg bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-600">إخفاء</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab !== "admin" && !showNotifs && !showInbox && !showComments && (loading ? <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-sky-100" />)}</div> : visible.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sky-200 bg-white p-8 text-center"><div className="text-4xl">📭</div><p className="mt-3 font-bold">{tab === "audio" ? "لا يوجد صوت بعد" : "لا يوجد محتوى"}</p><button type="button" onClick={() => load()} className="mt-3 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white">🔄 تحديث</button></div>
        ) : (
          <div className="space-y-3">{visible.map((item) => {
            const isAudio = item.media_type === "audio" || item.media_type === "voice";
            const isLiked = !!liked[item.id];
            const badge = platformBadge(item.url);
            return (
              <article key={item.id} className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${isAudio ? "border-indigo-200" : "border-sky-200"}`}>
                <div className={`relative ${isAudio ? "bg-indigo-50" : "bg-sky-50"} ${isAudio ? "aspect-[16/7]" : "aspect-[16/9]"}`}>
                  {playingId === item.id ? (
                    isAudio ? (<div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-sky-100 to-sky-200"><span className="text-5xl">🎵</span><audio src={`/api/media-stream?id=${item.id}`} controls autoPlay className="w-[90%]" onError={() => { setPlayingId(null); setPlayError(item.id); }} /></div>)
                    : (<video src={`/api/media-stream?id=${item.id}`} poster={item.thumbnail || undefined} controls autoPlay playsInline className="h-full w-full object-contain bg-black" onError={() => { setPlayingId(null); setPlayError(item.id); }} />)
                  ) : (
                    <button type="button" onClick={() => playItem(item)} className="group relative block h-full w-full">
                      {isAudio ? (<div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-sky-100 to-sky-200"><span className="text-5xl">{item.media_type === "voice" ? "🎙" : "🎵"}</span><p className="text-xs font-bold text-slate-600">{item.media_type === "voice" ? "رسالة صوتية" : "مقطع صوتي"}</p></div>)
                      : item.thumbnail ? (<img src={item.thumbnail} alt="" className="h-full w-full object-cover" />)
                      : (<div className="flex h-full items-center justify-center bg-gradient-to-br from-sky-100 to-sky-200 text-5xl">{typeIcon(item.media_type)}</div>)}
                      <span className="absolute inset-0 flex items-center justify-center bg-sky-900/10"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl text-slate-800 shadow-lg">▶</span></span>
                    </button>
                  )}
                  <span className={`absolute left-2 top-2 rounded-full ${isAudio ? "bg-indigo-500" : badge.color} px-2 py-0.5 text-[10px] font-black text-white`}>{isAudio ? "صوت" : badge.label}</span>
                </div>
                <div className="p-3.5">
                  <h3 className="line-clamp-2 text-[15px] font-extrabold text-slate-800">{item.title}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                    <button type="button" onClick={() => openProfile(item.sharer_id, item.sharer_name)} className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">👤 {item.sharer_name || "مستخدم"}</button>
                    <span>{timeAgo(item.created_at)}</span>
                    <span>👁 {item.views || 0}</span>
                    <span>⬇ {item.clones || 0}</span>
                    <span>❤ {item.likes || 0}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    <a href={cloneHref(item.id)} className="rounded-xl bg-sky-500 py-2.5 text-center text-[11px] font-black text-white">⚡ فوري</a>
                    <button type="button" onClick={() => toggleLike(item)} className={`rounded-xl py-2.5 text-[11px] font-black ${isLiked ? "bg-rose-100 text-rose-600" : "bg-sky-100 text-slate-700"}`}>{isLiked ? "❤️" : "🤍"}</button>
                    <button type="button" onClick={() => void openComments(item.id, item.title)} className="rounded-xl bg-sky-100 py-2.5 text-[11px] font-black text-slate-700">💬</button>
                    {/* Was ⬇️, same "download" look as the ⚡ فوري clone button
                        right next to it despite being a different action
                        (opening the ORIGINAL source link) -- 🌐 reads as
                        "open elsewhere" instead of a second download. */}
                    <a href={item.url || "#"} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-500 py-2.5 text-center text-[11px] font-black text-white">🌐</a>
                    {/* Was a second 👤 button opening the same profile the
                        name chip above already opens -- replaced with a
                        real, distinct action (share the clone link). */}
                    <button
                      type="button"
                      onClick={() => {
                        const link = cloneHref(item.id);
                        const nav = navigator as any;
                        if (nav.share) { nav.share({ title: item.title, url: link }).catch(() => {}); }
                        else { nav.clipboard?.writeText?.(link); (window as any).Telegram?.WebApp?.showAlert?.("تم نسخ رابط المشاركة"); }
                      }}
                      className="rounded-xl bg-violet-500 py-2.5 text-[11px] font-black text-white"
                    >🔗</button>
                  </div>
                </div>
              </article>
            );
          })}</div>
        ))}
      </div>
    </div>
  );
}
