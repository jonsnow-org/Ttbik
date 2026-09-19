"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "trending" | "video" | "audio" | "me";
type ProfileSection = "all" | "video" | "audio" | "photo";
type FeedItem = { id: string; media_type: string; title: string; url?: string; thumbnail?: string; sharer_name?: string; sharer_id?: string; clones?: number; likes?: number; views?: number; created_at?: number };
type Notif = { id: string; type: "follow"; fromId: string; fromName: string; at: number; read: boolean };

const BOT_USERNAME = process.env.NEXT_PUBLIC_MEDIA_BOT_USERNAME || "";
const OWNER_IDS = (process.env.NEXT_PUBLIC_OWNER_ID || "420066855").split(",").map((s) => s.trim());
const LS = { follow: "mb_following", views: "mb_views", profile: "mb_profile", share: "mb_share_public", liked: "mb_liked" };

function typeIcon(t: string) { if (t === "audio" || t === "voice") return "🎵"; if (t === "photo") return "🖼️"; return "🎬"; }
function platformBadge(url?: string) { const u = (url || "").toLowerCase(); if (u.includes("tiktok")) return { label: "TikTok", color: "bg-pink-500" }; if (u.includes("youtu")) return { label: "YouTube", color: "bg-red-500" }; if (u.includes("instagram")) return { label: "IG", color: "bg-fuchsia-500" }; if (u.includes("twitter") || u.includes("x.com")) return { label: "X", color: "bg-slate-700" }; return { label: "Media", color: "bg-sky-500" }; }
function timeAgo(ts?: number) { if (!ts) return ""; const s = Math.max(0, Math.floor(Date.now() / 1000) - ts); if (s < 60) return "الآن"; if (s < 3600) return `${Math.floor(s / 60)} د`; if (s < 86400) return `${Math.floor(s / 3600)} س`; return `${Math.floor(s / 86400)} ي`; }
function loadJSON<T>(key: string, fb: T): T { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } }
function saveJSON(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

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
  const [sharePublic, setSharePublic] = useState(true);
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [showInbox, setShowInbox] = useState(false);
  const [inboxThreads, setInboxThreads] = useState<{ peer_id: string; peer_name: string; last_body: string; last_at: number; unread: number }[]>([]);
  const [chatPeer, setChatPeer] = useState<{ id: string; name: string } | null>(null);
  const [chatMsgs, setChatMsgs] = useState<{ id: string; from_id: string; from_name: string; body: string; created_at: number }[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [inboxUnread, setInboxUnread] = useState(0);

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
    setSharePublic(loadJSON(LS.share, true));
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
      const r = await fetch(`/api/media-feed?${qs}`, { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [tab, search]);
  useEffect(() => { load(); }, [load]);

  const loadInbox = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/media-messages?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" });
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
      if (Array.isArray(j.notifications)) setNotifs(j.notifications.map((n: any) => ({ id: n.id, type: n.type, fromId: n.fromId, fromName: n.fromName, at: n.at, read: n.read })));
    } catch {}
  }, [userId]);
  useEffect(() => { void loadNotifs(); const t = setInterval(() => void loadNotifs(), 15000); return () => clearInterval(t); }, [loadNotifs]);

  async function openThread(peerId: string, peerName: string) {
    setChatPeer({ id: peerId, name: peerName });
    setShowInbox(true); setShowNotifs(false);
    try {
      const r = await fetch(`/api/media-messages?user_id=${encodeURIComponent(userId)}&with=${encodeURIComponent(peerId)}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.messages)) setChatMsgs(j.messages);
      await fetch("/api/media-messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: userId, peer_id: peerId }) });
      void loadInbox();
    } catch {}
  }
  async function sendDm() {
    if (!chatPeer || !dmInput.trim() || !userId) return;
    const body = dmInput.trim(); setDmInput("");
    await fetch("/api/media-messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from_id: userId, from_name: displayName || username || "مستخدم", to_id: chatPeer.id, body }) });
    await openThread(chatPeer.id, chatPeer.name);
  }

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
    if (!profileTargetId) return { posts: 0, clones: 0, likes: 0, followers: 0 };
    const mine = items.filter((i) => i.sharer_id === profileTargetId);
    return { posts: mine.length, clones: mine.reduce((a, b) => a + (b.clones || 0), 0), likes: mine.reduce((a, b) => a + (b.likes || 0), 0), followers: isOwnProfile ? notifs.filter((n) => n.type === "follow").length : 0 };
  }, [items, profileTargetId, isOwnProfile, notifs]);
  const unreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);
  const cloneHref = (id: string) => (BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?start=clone_${id}` : "#");

  const openProfile = (sid?: string, sname?: string) => { if (!sid) return; setViewUserId(sid); setViewUserName(sname || "مستخدم"); setProfileSection("all"); setTab("me"); setShowNotifs(false); setShowInbox(false); };
  const closeOtherProfile = () => { setViewUserId(null); setViewUserName(""); setProfileSection("all"); };
  const toggleLike = (id: string) => {
    const was = !!liked[id];
    setLiked((p) => { const next = { ...p, [id]: !was }; saveJSON(LS.liked, next); return next; });
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, likes: Math.max(0, (it.likes || 0) + (was ? -1 : 1)) } : it));
    fetch("/api/media-feed", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "like" }) }).catch(() => {});
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

  const tabs: { id: Tab; label: string; icon: string }[] = [ { id: "trending", label: "رائج", icon: "🔥" }, { id: "video", label: "فيديو", icon: "🎬" }, { id: "audio", label: "صوت", icon: "🎧" }, { id: "me", label: "ملفي", icon: "👤" } ];
  const showProfile = tab === "me" || !!viewUserId;
  const headerName = viewUserId && !isOwnProfile ? viewUserName : displayName;

  return (
    <div className="min-h-screen bg-[#eaf6ff] text-slate-800">
      <header className="sticky top-0 z-20 border-b border-sky-100 bg-[#eaf6ff]/95 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div><p className="text-[10px] font-bold tracking-wider text-sky-500">TELEGRAM MINI APP</p><h1 className="text-lg font-black text-slate-800">{headerName ? `أهلاً ${headerName.split(" ")[0]}` : "موجز الوسائط"}</h1></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => load()} className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">🔄</button>
            <button type="button" onClick={() => { setShowNotifs(true); setShowInbox(false); void loadNotifs(); }} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">🔔{unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{unreadCount}</span>}</button>
            <button type="button" onClick={() => { setShowInbox(true); setChatPeer(null); setShowNotifs(false); void loadInbox(); }} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-lg">💬{inboxUnread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-black text-white">{inboxUnread}</span>}</button>
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-400 to-sky-600 ring-2 ring-sky-200">{photoUrl && isOwnProfile ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-lg font-black text-white">{(headerName || "U").slice(0, 1)}</span>}</div>
          </div>
        </div>
        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">{tabs.map((t) => { const active = !viewUserId && tab === t.id; return (<button key={t.id} type="button" onClick={() => { closeOtherProfile(); setShowNotifs(false); setShowInbox(false); setTab(t.id); }} className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold ${active ? "bg-sky-500 text-white" : "bg-sky-100 text-slate-700"}`}><span>{t.icon}</span>{t.label}</button>); })}</nav>
      </header>

      <div className="px-3 pt-2"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="🔍 ابحث..." className="w-full rounded-2xl border border-sky-200 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-slate-400" /></div>

      {showInbox && (
        <div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-sky-100 px-4 py-3">
            <p className="text-sm font-black">{chatPeer ? `محادثة · ${chatPeer.name}` : "صندوق الرسائل"}</p>
            <button type="button" onClick={() => { if (chatPeer) setChatPeer(null); else setShowInbox(false); }} className="text-xs font-bold text-slate-500">{chatPeer ? "← رجوع" : "إغلاق"}</button>
          </div>
          {!chatPeer ? (inboxThreads.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">لا محادثات — اضغط 💬 من بطاقة أو ملف مستخدم</p> : (
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
          {notifs.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">لا إشعارات بعد</p> : <ul className="max-h-72 overflow-y-auto">{notifs.map((n) => (<li key={n.id}><button type="button" onClick={() => openProfile(n.fromId, n.fromName)} className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-sky-50"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-200 text-sm font-black">{(n.fromName || "U").slice(0, 1)}</div><div className="flex-1"><p className="text-sm font-bold"><span className="text-sky-600">{n.fromName}</span> بدأ بمتابعتك</p><p className="text-[11px] text-slate-500">{timeAgo(n.at)}</p></div></button></li>))}</ul>}
        </div>
      )}

      <div className="relative z-10 px-3 pb-10 pt-3">
        {showProfile && !showNotifs && !showInbox && (
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
              <div className="mt-4 grid grid-cols-4 gap-2">{[[profileStats.posts, "منشورات"], [profileStats.clones, "تحميل"], [profileStats.likes, "إعجاب"], [profileStats.followers, "متابع"]].map(([v, l]) => (<div key={String(l)} className="rounded-2xl bg-sky-50 py-2.5 text-center"><p className="text-lg font-black text-sky-600">{v as number}</p><p className="text-[10px] font-bold text-slate-500">{l as string}</p></div>))}</div>
              <div className="mt-3 flex gap-1.5">{(["all", "video", "audio", "photo"] as const).map((id) => (<button key={id} type="button" onClick={() => setProfileSection(id)} className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold ${profileSection === id ? "bg-sky-500 text-white" : "bg-sky-50 text-slate-600"}`}>{{ all: "الكل", video: "فيديو", audio: "صوت", photo: "صورة" }[id]}</button>))}</div>
            </div>
          </div>
        )}

        {!showNotifs && !showInbox && (loading ? <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-sky-100" />)}</div> : visible.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-sky-200 bg-white p-8 text-center"><div className="text-4xl">📭</div><p className="mt-3 font-bold">{tab === "audio" ? "لا يوجد صوت بعد" : "لا يوجد محتوى"}</p><button type="button" onClick={() => load()} className="mt-3 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white">🔄 تحديث</button></div>
        ) : (
          <div className="space-y-3">{visible.map((item) => {
            const isAudio = item.media_type === "audio" || item.media_type === "voice";
            const isLiked = !!liked[item.id];
            const badge = platformBadge(item.url);
            return (
              <article key={item.id} className="overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-sm">
                <div className={`relative bg-sky-50 ${isAudio ? "aspect-[16/7]" : "aspect-[16/9]"}`}>
                  {playingId === item.id ? (
                    isAudio ? (<div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-sky-100 to-sky-200"><span className="text-5xl">🎵</span><audio src={`/api/media-stream?id=${item.id}`} controls autoPlay className="w-[90%]" onError={() => { setPlayingId(null); setPlayError(item.id); }} /></div>)
                    : (<video src={`/api/media-stream?id=${item.id}`} poster={item.thumbnail || undefined} controls autoPlay playsInline className="h-full w-full object-contain bg-black" onError={() => { setPlayingId(null); setPlayError(item.id); }} />)
                  ) : (
                    <button type="button" onClick={() => { setPlayError(null); setPlayingId(item.id); }} className="group relative block h-full w-full">
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
                    <span>⬇ {item.clones || 0}</span>
                    <span>❤ {item.likes || 0}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-1.5">
                    <a href={cloneHref(item.id)} className="rounded-xl bg-sky-500 py-2.5 text-center text-[11px] font-black text-white">⚡ فوري</a>
                    <button type="button" onClick={() => toggleLike(item.id)} className={`rounded-xl py-2.5 text-[11px] font-black ${isLiked ? "bg-rose-100 text-rose-600" : "bg-sky-100 text-slate-700"}`}>{isLiked ? "❤️" : "🤍"}</button>
                    <button type="button" onClick={() => item.sharer_id && void openThread(item.sharer_id, item.sharer_name || "مستخدم")} className="rounded-xl bg-sky-100 py-2.5 text-[11px] font-black text-slate-700">💬</button>
                    <a href={item.url || "#"} target="_blank" rel="noreferrer" className="rounded-xl bg-emerald-500 py-2.5 text-center text-[11px] font-black text-white">⬇️</a>
                    <button type="button" onClick={() => openProfile(item.sharer_id, item.sharer_name)} className="rounded-xl bg-violet-500 py-2.5 text-[11px] font-black text-white">👤</button>
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
