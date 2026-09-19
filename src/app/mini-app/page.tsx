"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tab = "trending" | "video" | "audio" | "me" | "admin";
type ProfileSection = "all" | "video" | "audio" | "photo";
type FeedItem = { id: string; media_type: string; title: string; url?: string; thumbnail?: string; sharer_name?: string; sharer_id?: string; clones?: number; likes?: number; views?: number; created_at?: number };
type PartyRoom = { id: string; host_id: string; host_name: string; media_id: string; media_title: string; media_url: string; media_thumb: string; media_type: string; playing: boolean; current_time: number; host_only: boolean; members: { id: string; name: string }[] };
type PartyMsg = { id: number; user_id: string; user_name: string; body: string; kind: string; created_at: number };
type Notif = { id: string; type: "follow"; fromId: string; fromName: string; at: number; read: boolean };

const BOT_USERNAME = process.env.NEXT_PUBLIC_MEDIA_BOT_USERNAME || "";
const OWNER_IDS = (process.env.NEXT_PUBLIC_OWNER_ID || "420066855").split(",").map((s) => s.trim());
const LS = { follow: "mb_following", notifs: "mb_notifs", views: "mb_views", profile: "mb_profile", share: "mb_share_public" };
const REACTIONS = ["😂", "🔥", "😮", "❤️", "👏", "🎉"];

function typeIcon(t: string) { if (t === "audio" || t === "voice") return "🎵"; if (t === "photo") return "🖼️"; return "🎬"; }
function platformBadge(url?: string) { const u = (url || "").toLowerCase(); if (u.includes("tiktok")) return { label: "TikTok", color: "bg-pink-500" }; if (u.includes("youtu")) return { label: "YouTube", color: "bg-red-500" }; if (u.includes("instagram")) return { label: "IG", color: "bg-fuchsia-500" }; return { label: "Media", color: "bg-sky-500" }; }
function timeAgo(ts?: number) { if (!ts) return ""; const s = Math.max(0, Math.floor(Date.now() / 1000) - ts); if (s < 60) return "الآن"; if (s < 3600) return `${Math.floor(s / 60)} د`; if (s < 86400) return `${Math.floor(s / 3600)} س`; return `${Math.floor(s / 86400)} ي`; }
function loadJSON<T>(key: string, fb: T): T { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; } }
function saveJSON(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function ytEmbed(url?: string) { if (!url) return null; const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{6,})/i); return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=0&enablejsapi=1` : null; }

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
  const [viewsMap, setViewsMap] = useState<Record<string, number>>({});
  const [sharePublic, setSharePublic] = useState(true);
  const [party, setParty] = useState<PartyRoom | null>(null);
  const [partyMsgs, setPartyMsgs] = useState<PartyMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [flyReact, setFlyReact] = useState<{ id: number; emoji: string }[]>([]);
  const [creatingParty, setCreatingParty] = useState(false);
  const [search, setSearch] = useState("");
  const [qualityItem, setQualityItem] = useState<FeedItem | null>(null);
  const [broadcastText, setBroadcastText] = useState("");
  const [forceChans, setForceChans] = useState("");
  const [adminStats, setAdminStats] = useState<{ posts: number; hidden: number; clones: number; publishers: number } | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSyncRef = useRef(0);
  const isOwner = !!userId && OWNER_IDS.includes(userId);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready(); tg.expand();
      try { tg.setHeaderColor("#0f172a"); tg.setBackgroundColor("#0b1220"); tg.MainButton.hide(); } catch {}
      const u = tg.initDataUnsafe?.user;
      if (u?.first_name) { const full = u.first_name + (u.last_name ? ` ${u.last_name}` : ""); setDisplayName(full); setEditName(full); }
      if (u?.username) setUsername(u.username);
      if (u?.id) setUserId(String(u.id));
      if (u?.photo_url) setPhotoUrl(u.photo_url);
      try {
        const sp = tg.initDataUnsafe?.start_param || "";
        if (typeof sp === "string" && (sp.includes("room_") || sp.startsWith("party_"))) {
          void joinParty(sp.replace(/^party_/, ""));
        }
      } catch {}
    }
    setFollowing(loadJSON(LS.follow, {}));
    setNotifs(loadJSON(LS.notifs, []));
    setViewsMap(loadJSON(LS.views, {}));
    setSharePublic(loadJSON(LS.share, true));
    const prof = loadJSON<{ name?: string; status?: string }>(LS.profile, {});
    if (prof.name) { setDisplayName(prof.name); setEditName(prof.name); }
    if (prof.status) setStatusLine(prof.status);
    try {
      const q = new URLSearchParams(window.location.search);
      const p = q.get("party") || q.get("tgWebAppStartParam") || "";
      if (p.includes("room_")) void joinParty(p.replace(/^party_/, ""));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (tab === "admin") qs.set("admin", "1");
      const r = await fetch(`/api/media-feed?${qs}`, { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [tab, search]);

  useEffect(() => { if (!party) load(); if (tab === "admin" && isOwner) void loadAdmin(); }, [load, party, tab, isOwner]);

  useEffect(() => {
    if (!party) { if (pollRef.current) clearInterval(pollRef.current); return; }
    const tick = async () => {
      try {
        const r = await fetch(`/api/party?id=${encodeURIComponent(party.id)}`, { cache: "no-store" });
        const j = await r.json();
        if (j.room) {
          setParty(j.room);
          const v = videoRef.current;
          if (v && j.room.host_id !== userId) {
            if (Math.abs((v.currentTime || 0) - (j.room.current_time || 0)) > 1.2) v.currentTime = j.room.current_time || 0;
            if (j.room.playing && v.paused) void v.play().catch(() => {});
            if (!j.room.playing && !v.paused) v.pause();
          }
        }
        if (Array.isArray(j.messages)) setPartyMsgs(j.messages);
      } catch {}
    };
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [party?.id, userId]);

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
    if (search.trim()) { const q = search.trim().toLowerCase(); list = list.filter((i) => i.title.toLowerCase().includes(q) || (i.sharer_name || "").toLowerCase().includes(q)); }
    return list;
  }, [items, tab, viewUserId, profileItems, search]);
  const profileStats = useMemo(() => {
    if (!profileTargetId) return { posts: 0, clones: 0, likes: 0, followers: 0 };
    const mine = items.filter((i) => i.sharer_id === profileTargetId);
    return { posts: mine.length, clones: mine.reduce((a, b) => a + (b.clones || 0), 0), likes: mine.reduce((a, b) => a + (b.likes || 0), 0), followers: isOwnProfile ? notifs.filter((n) => n.type === "follow").length : 0 };
  }, [items, profileTargetId, isOwnProfile, notifs]);
  const badges = useMemo(() => { const b: string[] = []; if (profileStats.posts >= 1) b.push("🌟 مساهم"); if (profileStats.clones >= 5) b.push("⚡ محتوى مطلوب"); if (profileStats.posts >= 10) b.push("🏆 مكتشف"); if (sharePublic && isOwnProfile) b.push("🏅 ناشر عام"); return b; }, [profileStats, sharePublic, isOwnProfile]);
  const unreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  const cloneHref = (id: string) => (BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?start=clone_${id}` : "#");
  const messageHref = (sid?: string) => (sid && /^\d+$/.test(sid) ? `tg://user?id=${sid}` : BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}` : "#");

  async function loadAdmin() {
    try { const r = await fetch("/api/media-admin", { cache: "no-store" }); const j = await r.json(); if (j.stats) setAdminStats(j.stats); if (Array.isArray(j.settings?.force_sub_channels)) setForceChans(j.settings.force_sub_channels.join(", ")); } catch {}
  }
  // Real auth for these calls is the Telegram-signed initData string below,
  // verified server-side against BOT_TOKEN (see verifyTelegramOwner) -- not
  // a secret or an owner_id, since anything in this client bundle is public.
  function tgInitData(): string {
    return (window as any).Telegram?.WebApp?.initData || "";
  }
  async function hideItem(id: string) {
    await fetch("/api/media-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hide", id, init_data: tgInitData() }) });
    setItems((prev) => prev.filter((x) => x.id !== id));
  }
  async function runBroadcast() {
    if (!broadcastText.trim()) return; setAdminBusy(true);
    try { const r = await fetch("/api/media-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "broadcast", text: broadcastText, init_data: tgInitData() }) }); const j = await r.json(); (window as any).Telegram?.WebApp?.showAlert?.(j.ok ? "تم إرسال المعاينة للمالك" : j.error || "فشل"); } finally { setAdminBusy(false); }
  }
  async function saveForceSub() {
    const channels = forceChans.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2); setAdminBusy(true);
    try { await fetch("/api/media-admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_force_sub", channels, init_data: tgInitData() }) }); (window as any).Telegram?.WebApp?.showAlert?.("تم حفظ قنوات الاشتراك"); } finally { setAdminBusy(false); }
  }

  const openProfile = (sid?: string, sname?: string) => { if (!sid) return; setViewUserId(sid); setViewUserName(sname || "مستخدم"); setProfileSection("all"); setTab("me"); setShowNotifs(false); };
  const closeOtherProfile = () => { setViewUserId(null); setViewUserName(""); setProfileSection("all"); };
  const toggleLike = (id: string) => { setLiked((p) => ({ ...p, [id]: !p[id] })); fetch("/api/media-feed", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "like" }) }).catch(() => {}); };
  const toggleFollow = (sid: string) => {
    if (!sid || sid === userId) return;
    setFollowing((prev) => { const next = { ...prev, [sid]: !prev[sid] }; saveJSON(LS.follow, next);
      if (next[sid]) { const n: Notif = { id: `${Date.now()}_${sid}`, type: "follow", fromId: userId || "0", fromName: displayName || username || "مستخدم", at: Math.floor(Date.now() / 1000), read: false }; setNotifs((old) => { const list = [n, ...old].slice(0, 50); saveJSON(LS.notifs, list); return list; }); }
      return next; });
  };

  const createParty = async (item: FeedItem) => {
    setCreatingParty(true);
    try {
      const r = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", host_id: userId || "0", host_name: displayName || "مضيف", media_id: item.id, media_title: item.title, media_url: item.url || "", media_thumb: item.thumbnail || "", media_type: item.media_type, host_only: true }) });
      const j = await r.json();
      if (j.room) { setParty(j.room); setPartyMsgs([]); try { const link = BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}/app?startapp=party_${j.room.id}` : `${window.location.origin}/mini-app?party=${j.room.id}`; await navigator.clipboard?.writeText(link); (window as any).Telegram?.WebApp?.showAlert?.("تم إنشاء الغرفة ونسخ رابط الدعوة"); } catch {} }
    } finally { setCreatingParty(false); }
  };

  async function joinParty(roomId: string) {
    if (!roomId) return; const rid = roomId.replace(/^party_/, "");
    try {
      await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", room_id: rid, user_id: userId || "guest", user_name: displayName || "ضيف" }) });
      const r = await fetch(`/api/party?id=${encodeURIComponent(rid)}`, { cache: "no-store" }); const j = await r.json();
      if (j.room) { setParty(j.room); setPartyMsgs(j.messages || []); }
    } catch {}
  }

  const pushSync = async (patch: Partial<{ playing: boolean; current_time: number; host_only: boolean }>) => {
    if (!party) return; const now = Date.now(); if (now - lastSyncRef.current < 400) return; lastSyncRef.current = now;
    try { const r = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync", room_id: party.id, user_id: userId, ...patch }) }); const j = await r.json(); if (j.room) setParty(j.room); } catch {}
  };
  const sendChat = async () => { if (!party || !chatInput.trim()) return; const body = chatInput.trim(); setChatInput(""); await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "chat", room_id: party.id, user_id: userId, user_name: displayName || "مستخدم", body }) }); };
  const sendReact = async (emoji: string) => { if (!party) return; const flyId = Date.now(); setFlyReact((f) => [...f, { id: flyId, emoji }]); setTimeout(() => setFlyReact((f) => f.filter((x) => x.id !== flyId)), 1800); await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "react", room_id: party.id, user_id: userId, user_name: displayName || "مستخدم", body: emoji }) }); };
  const saveProfile = () => { if (editName.trim()) setDisplayName(editName.trim()); if (editStatus.trim()) setStatusLine(editStatus.trim()); saveJSON(LS.profile, { name: editName.trim() || displayName, status: editStatus.trim() || statusLine }); setEditing(false); };

  const tabs: { id: Tab; label: string; icon: string }[] = [ { id: "trending", label: "رائج", icon: "🔥" }, { id: "video", label: "فيديو", icon: "🎬" }, { id: "audio", label: "صوت", icon: "🎧" }, { id: "me", label: "ملفي", icon: "👤" }, ...(isOwner ? [{ id: "admin" as Tab, label: "أدمن", icon: "👑" }] : []) ];
  const showProfile = (tab === "me" || !!viewUserId) && !party;
  const headerName = viewUserId && !isOwnProfile ? viewUserName : displayName;

  if (party) {
    const canControl = !party.host_only || party.host_id === userId;
    const embed = ytEmbed(party.media_url);
    const shareLink = BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}/app?startapp=party_${party.id}` : `?party=${party.id}`;
    return (
      <div className="relative min-h-screen overflow-hidden bg-[#0b1220] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#1e3a5f_0%,_transparent_55%)]" />
        {flyReact.map((f) => (<span key={f.id} className="pointer-events-none absolute left-1/2 top-1/3 z-50 animate-bounce text-4xl" style={{ transform: `translateX(${(f.id % 7) * 12 - 36}px)` }}>{f.emoji}</span>))}
        <header className="relative z-10 flex items-center justify-between px-3 pb-2 pt-4">
          <button type="button" onClick={() => setParty(null)} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold">← خروج</button>
          <div className="text-center"><p className="text-[10px] font-bold text-sky-300/80">🍿 سينما مشتركة</p><p className="max-w-[180px] truncate text-sm font-black">{party.media_title}</p></div>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(shareLink); (window as any).Telegram?.WebApp?.showAlert?.("تم نسخ رابط الدعوة"); }} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold">مشاركة</button>
        </header>
        <div className="relative z-10 mx-3 overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-2xl backdrop-blur-xl">
          <div className="relative aspect-video bg-black">
            {embed ? (<iframe title="yt" src={embed} className="h-full w-full" allow="autoplay; encrypted-media" allowFullScreen />) : party.media_url && party.media_type === "video" ? (
              <video ref={videoRef} src={party.media_url} poster={party.media_thumb || undefined} className="h-full w-full object-contain" playsInline controls={canControl}
                onPlay={() => canControl && pushSync({ playing: true, current_time: videoRef.current?.currentTime || 0 })}
                onPause={() => canControl && pushSync({ playing: false, current_time: videoRef.current?.currentTime || 0 })}
                onSeeked={() => canControl && pushSync({ current_time: videoRef.current?.currentTime || 0, playing: !videoRef.current?.paused })} />
            ) : (<div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-900 to-slate-800">{party.media_thumb ? <img src={party.media_thumb} alt="" className="max-h-[70%] object-contain" /> : <span className="text-5xl">🎬</span>}<p className="px-4 text-center text-xs text-white/70">المزامنة كل 3 ثوانٍ · استخدم التحميل الفوري للملف</p></div>)}
          </div>
          {canControl && (<div className="flex flex-wrap items-center gap-2 border-t border-white/10 p-3">
            <button type="button" onClick={() => pushSync({ playing: !party.playing, current_time: videoRef.current?.currentTime || party.current_time })} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-black">{party.playing ? "⏸ إيقاف" : "▶ تشغيل"}</button>
            <button type="button" onClick={() => pushSync({ host_only: !party.host_only })} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold">{party.host_only ? "🔒 تحكم المضيف" : "🔓 تحكم الجميع"}</button>
            <span className="text-[11px] text-white/50">أعضاء: {party.members?.length || 1}</span>
          </div>)}
        </div>
        <div className="relative z-10 mx-3 mt-2 flex gap-1.5">{REACTIONS.map((e) => (<button key={e} type="button" onClick={() => sendReact(e)} className="flex-1 rounded-2xl bg-white/10 py-2 text-lg active:scale-95">{e}</button>))}</div>
        <div className="relative z-10 mx-3 mt-2 mb-4 flex max-h-52 flex-col rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl">
          <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2">{partyMsgs.length === 0 && <p className="py-4 text-center text-xs text-white/40">ابدأ الدردشة</p>}{partyMsgs.map((m) => m.kind === "react" ? <p key={m.id} className="text-center text-sm text-white/60">{m.user_name} {m.body}</p> : <div key={m.id} className="rounded-2xl bg-white/10 px-3 py-1.5"><p className="text-[10px] font-bold text-sky-300">{m.user_name}</p><p className="text-sm">{m.body}</p></div>)}</div>
          <div className="flex gap-2 border-t border-white/10 p-2"><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} placeholder="اكتب رسالة..." className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none" /><button type="button" onClick={sendChat} className="rounded-xl bg-sky-500 px-4 text-sm font-black">إرسال</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b1220] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_#1e3a5f55_0%,_transparent_50%)]" />
      <header className="sticky top-0 z-20 border-b border-white/5 bg-[#0b1220]/85 px-4 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div><p className="text-[10px] font-bold tracking-wider text-sky-400/80">TELEGRAM MINI APP</p><h1 className="text-lg font-black text-white">{headerName ? `أهلاً ${headerName.split(" ")[0]}` : "موجز الوسائط"}</h1></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => load()} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg">🔄</button>
            <button type="button" onClick={() => { setShowNotifs(true); setNotifs((o) => { const n = o.map((x) => ({ ...x, read: true })); saveJSON(LS.notifs, n); return n; }); }} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg">🔔{unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black">{unreadCount}</span>}</button>
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 ring-2 ring-white/20">{photoUrl && isOwnProfile ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-lg font-black">{(headerName || "U").slice(0, 1)}</span>}</div>
          </div>
        </div>
        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">{tabs.map((t) => { const active = !viewUserId && tab === t.id; return (<button key={t.id} type="button" onClick={() => { closeOtherProfile(); setShowNotifs(false); setTab(t.id); }} className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${active ? "bg-sky-500 text-white shadow-lg shadow-sky-500/30" : "bg-white/10 text-white/80"}`}><span>{t.icon}</span>{t.label}</button>); })}</nav>
      </header>
      <div className="px-3 pt-2"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="🔍 ابحث في العناوين أو الناشرين..." className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-sky-500/50" /></div>

      {showNotifs && (<div className="relative z-10 mx-3 mt-3 overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-xl backdrop-blur-xl"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><p className="text-sm font-black">الإشعارات</p><button type="button" onClick={() => setShowNotifs(false)} className="text-xs font-bold text-white/50">إغلاق</button></div>{notifs.length === 0 ? <p className="px-4 py-6 text-center text-sm text-white/40">لا إشعارات بعد</p> : <ul className="max-h-72 overflow-y-auto">{notifs.map((n) => (<li key={n.id}><button type="button" onClick={() => openProfile(n.fromId, n.fromName)} className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-white/5"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500/30 text-sm font-black">{(n.fromName || "U").slice(0, 1)}</div><div className="flex-1"><p className="text-sm font-bold"><span className="text-sky-300">{n.fromName}</span> بدأ بمتابعتك</p><p className="text-[11px] text-white/40">{timeAgo(n.at)}</p></div></button></li>))}</ul>}</div>)}

      <div className="relative z-10 px-3 pb-10 pt-3">
        {tab === "admin" && isOwner && !showNotifs && (
          <div className="mb-4 space-y-3">
            <div className="rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-4 backdrop-blur">
              <p className="text-sm font-black text-amber-200">👑 لوحة المالك</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white/5 p-3 text-center"><p className="text-2xl font-black text-sky-300">{items.length}</p><p className="text-[10px] text-white/50">منشورات</p></div>
                <div className="rounded-2xl bg-white/5 p-3 text-center"><p className="text-2xl font-black text-emerald-300">{items.reduce((a, b) => a + (b.clones || 0), 0)}</p><p className="text-[10px] text-white/50">استنساخ</p></div>
              </div>
              <div className="mt-3 space-y-2">
                <p className="text-xs font-bold text-amber-200/80">📢 إذاعة (معاينة للمالك)</p>
                <textarea value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)} rows={3} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none" placeholder="نص الإذاعة..." />
                <button type="button" disabled={adminBusy} onClick={() => void runBroadcast()} className="w-full rounded-xl bg-amber-500 py-2 text-xs font-black text-black disabled:opacity-50">إرسال معاينة</button>
                <p className="text-xs font-bold text-amber-200/80">📣 قنوات الاشتراك الإجباري (حتى 2، فاصلة)</p>
                <input value={forceChans} onChange={(e) => setForceChans(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none" placeholder="@channel1, @channel2" />
                <button type="button" disabled={adminBusy} onClick={() => void saveForceSub()} className="w-full rounded-xl bg-white/10 py-2 text-xs font-bold disabled:opacity-50">حفظ القنوات</button>
                {adminStats && <p className="text-[10px] text-white/40">مخفي: {adminStats.hidden} · ناشرون: {adminStats.publishers}</p>}
              </div>
            </div>
            <div className="space-y-2"><p className="text-xs font-bold text-white/60">مراجعة المحتوى — إخفاء</p>{items.slice(0, 12).map((it) => (<div key={it.id} className="flex items-center gap-2 rounded-2xl border border-white/5 bg-white/5 p-2"><div className="h-12 w-16 overflow-hidden rounded-xl bg-black/40">{it.thumbnail ? <img src={it.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-lg">{typeIcon(it.media_type)}</div>}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{it.title}</p><p className="text-[10px] text-white/40">{it.sharer_name}</p></div><button type="button" onClick={() => void hideItem(it.id)} className="rounded-lg bg-rose-500/20 px-2 py-1 text-[10px] font-bold text-rose-300">إخفاء</button></div>))}</div>
          </div>
        )}

        {showProfile && !showNotifs && (
          <div className="mb-4 overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-xl backdrop-blur-xl">
            <div className="h-20 bg-gradient-to-l from-sky-600 to-indigo-600" />
            <div className="relative px-4 pb-4">
              <div className="-mt-10 flex items-end gap-3">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-[#0b1220] bg-gradient-to-br from-sky-500 to-indigo-600 text-2xl font-black shadow-lg">{isOwnProfile && photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : (headerName || "U").slice(0, 1)}</div>
                <div className="mb-1 flex-1">{editing && isOwnProfile ? <input value={editName} onChange={(e) => setEditName(e.target.value)} className="mb-1 w-full rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-sm font-bold outline-none" /> : <p className="text-lg font-black">{headerName || "زائر"}</p>}<p className="text-xs text-white/50">{isOwnProfile && username ? `@${username}` : profileTargetId ? `ID ${profileTargetId}` : "—"}</p>{editing && isOwnProfile ? <input value={editStatus} onChange={(e) => setEditStatus(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-xs outline-none" /> : <p className="mt-0.5 text-xs text-white/50">{isOwnProfile ? statusLine : "مستخدم نشط"}</p>}</div>
              </div>
              {badges.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{badges.map((b) => <span key={b} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-sky-200">{b}</span>)}</div>}
              <div className="mt-3 flex flex-wrap gap-2">
                {viewUserId && !isOwnProfile && <button type="button" onClick={closeOtherProfile} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold">← رجوع</button>}
                {isOwnProfile && (editing ? <><button type="button" onClick={saveProfile} className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold">حفظ</button><button type="button" onClick={() => setEditing(false)} className="rounded-xl bg-white/10 px-4 py-2 text-xs font-bold">إلغاء</button></> : <button type="button" onClick={() => { setEditName(displayName); setEditStatus(statusLine); setEditing(true); }} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold">✏️ تعديل</button>)}
                {profileTargetId && !isOwnProfile && <><button type="button" onClick={() => toggleFollow(profileTargetId)} className={`rounded-xl px-3 py-2 text-xs font-bold ${following[profileTargetId] ? "bg-white/10" : "bg-sky-500"}`}>{following[profileTargetId] ? "✓ إلغاء المتابعة" : "＋ متابعة"}</button><a href={messageHref(profileTargetId)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold">💬 رسالة</a></>}
              </div>
              {isOwnProfile && <label className="mt-3 flex cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-3"><span className="text-xs font-bold text-white/80">نشر تنزيلاتي في المعرض العام<br /><span className="font-normal text-white/40">يزيد الحد ويمنحك شارة مساهم</span></span><input type="checkbox" checked={sharePublic} onChange={(e) => { setSharePublic(e.target.checked); saveJSON(LS.share, e.target.checked); }} className="h-5 w-5 accent-sky-500" /></label>}
              <div className="mt-4 grid grid-cols-4 gap-2">{[[profileStats.posts, "منشورات", "text-sky-300"], [profileStats.clones, "تحميل", "text-emerald-300"], [profileStats.likes, "إعجاب", "text-rose-300"], [profileStats.followers, "متابع", "text-violet-300"]].map(([v, l, c]) => (<div key={String(l)} className="rounded-2xl bg-white/5 py-2.5 text-center"><p className={`text-lg font-black ${c}`}>{v as number}</p><p className="text-[10px] font-bold text-white/40">{l as string}</p></div>))}</div>
              <div className="mt-3 flex gap-1.5">{(["all", "video", "audio", "photo"] as const).map((id) => (<button key={id} type="button" onClick={() => setProfileSection(id)} className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold ${profileSection === id ? "bg-sky-500 text-white" : "bg-white/5 text-white/60"}`}>{{ all: "الكل", video: "فيديو", audio: "صوت", photo: "صورة" }[id]}</button>))}</div>
            </div>
          </div>
        )}

        {!showNotifs && tab !== "admin" && (loading ? <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-white/5" />)}</div> : visible.length === 0 ? <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-8 text-center"><div className="text-4xl">📭</div><p className="mt-3 font-bold">لا يوجد محتوى بعد</p><button type="button" onClick={() => load()} className="mt-3 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold">🔄 تحديث</button></div> : (
          <div className="space-y-3">{visible.map((item) => {
            const isLiked = !!liked[item.id]; const likeCount = (item.likes || 0) + (isLiked ? 1 : 0); const plays = (item.views || 0) + (viewsMap[item.id] || 0); const badge = platformBadge(item.url);
            return (<article key={item.id} className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-lg backdrop-blur-md transition active:scale-[0.99]" onClick={() => { setViewsMap((prev) => { const next = { ...prev, [item.id]: (prev[item.id] || 0) + 1 }; saveJSON(LS.views, next); return next; }); }}>
              <div className="relative aspect-[16/9] bg-black/40">{item.thumbnail ? <img src={item.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-5xl">{typeIcon(item.media_type)}</div>}<span className={`absolute left-2 top-2 rounded-full ${badge.color} px-2 py-0.5 text-[10px] font-black text-white`}>{badge.label}</span>{tab === "trending" && !viewUserId && <span className="absolute bottom-2 right-2 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-black">🔥 رائج</span>}</div>
              <div className="p-3.5"><h3 className="line-clamp-2 text-[15px] font-extrabold text-white">{item.title}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/50"><button type="button" onClick={(e) => { e.stopPropagation(); openProfile(item.sharer_id, item.sharer_name); }} className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-sky-300">👤 {item.sharer_name || "مستخدم"}</button><span>{timeAgo(item.created_at)}</span><span>▶ {plays}</span><span>⬇ {item.clones || 0}</span></div>
                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  <a href={cloneHref(item.id)} onClick={(e) => e.stopPropagation()} className="rounded-xl bg-sky-500 py-2.5 text-center text-[11px] font-black active:scale-95">⚡ فوري</a>
                  <button type="button" disabled={creatingParty} onClick={(e) => { e.stopPropagation(); void createParty(item); }} className="rounded-xl bg-violet-500/90 py-2.5 text-[11px] font-black disabled:opacity-50 active:scale-95">🍿</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setQualityItem(item); }} className="rounded-xl bg-emerald-500/80 py-2.5 text-[11px] font-black active:scale-95">⬇️</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggleLike(item.id); }} className={`rounded-xl py-2.5 text-[11px] font-black active:scale-95 ${isLiked ? "bg-rose-500/30 text-rose-300" : "bg-white/10"}`}>{isLiked ? "❤️" : "🤍"}</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); const link = BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}/app` : window.location.href; void navigator.clipboard?.writeText(`${item.title}\n${link}`); (window as any).Telegram?.WebApp?.showAlert?.("تم نسخ رابط المشاركة"); }} className="rounded-xl bg-white/10 py-2.5 text-[11px] font-black active:scale-95">🔗</button>
                </div>
                {isOwner && <button type="button" onClick={(e) => { e.stopPropagation(); void hideItem(item.id); }} className="mt-1.5 w-full rounded-xl bg-rose-500/20 py-1.5 text-[10px] font-bold text-rose-300">🚫 إخفاء (أدمن)</button>}
                {item.sharer_id && item.sharer_id !== userId && <button type="button" onClick={(e) => { e.stopPropagation(); toggleFollow(item.sharer_id!); }} className="mt-2 w-full rounded-xl bg-white/5 py-1.5 text-[11px] font-bold text-white/60">{following[item.sharer_id] ? "✓ تتابعه" : "＋ متابعة الناشر"}</button>}
              </div>
            </article>);
          })}</div>
        ))}
      </div>

      {qualityItem && (<div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" onClick={() => setQualityItem(null)}><div className="w-full rounded-t-3xl border border-white/10 bg-[#121a2b] p-4 pb-8" onClick={(e) => e.stopPropagation()}><p className="text-center text-sm font-black">⬇️ خيارات التحميل</p><p className="mt-1 line-clamp-2 text-center text-xs text-white/50">{qualityItem.title}</p><div className="mt-4 grid grid-cols-2 gap-2">{[["720", "فيديو 720p HD"], ["480", "فيديو 480p"], ["360", "فيديو 360p"], ["audio", "صوت MP3"]].map(([q, label]) => (<a key={q} href={BOT_USERNAME ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?text=${encodeURIComponent(qualityItem.url || qualityItem.title)}` : "#"} className="rounded-2xl bg-sky-500/90 py-3 text-center text-xs font-black active:scale-95">{label}</a>))}</div><a href={cloneHref(qualityItem.id)} className="mt-2 block rounded-2xl bg-violet-500 py-3 text-center text-xs font-black">⚡ استنساخ فوري</a><button type="button" onClick={() => setQualityItem(null)} className="mt-2 w-full rounded-2xl bg-white/10 py-3 text-xs font-bold">إغلاق</button></div></div>)}
    </div>
  );
}
