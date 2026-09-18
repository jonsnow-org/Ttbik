"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "trending" | "video" | "audio" | "me";
type ProfileSection = "all" | "video" | "audio" | "photo";

type FeedItem = {
  id: string;
  media_type: string;
  title: string;
  url?: string;
  thumbnail?: string;
  sharer_name?: string;
  sharer_id?: string;
  clones?: number;
  likes?: number;
  views?: number;
  created_at?: number;
};

type Notif = {
  id: string;
  type: "follow";
  fromId: string;
  fromName: string;
  at: number;
  read: boolean;
};

const BOT_USERNAME = process.env.NEXT_PUBLIC_MEDIA_BOT_USERNAME || "";
const LS_FOLLOW = "mb_following";
const LS_NOTIFS = "mb_notifs";
const LS_VIEWS = "mb_views";
const LS_PROFILE = "mb_profile";

function typeIcon(t: string) {
  if (t === "audio" || t === "voice") return "🎵";
  if (t === "photo") return "🖼️";
  return "🎬";
}

function timeAgo(ts?: number) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return "الآن";
  if (s < 3600) return `${Math.floor(s / 60)} د`;
  if (s < 86400) return `${Math.floor(s / 3600)} س`;
  return `${Math.floor(s / 86400)} ي`;
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
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
  const [viewsMap, setViewsMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#1e88e5");
      tg.setBackgroundColor("#e3f2fd");
      tg.MainButton.hide();
    } catch {}
    const u = tg.initDataUnsafe?.user;
    if (u?.first_name) {
      const full = u.first_name + (u.last_name ? ` ${u.last_name}` : "");
      setDisplayName(full);
      setEditName(full);
    }
    if (u?.username) setUsername(u.username);
    if (u?.id) setUserId(String(u.id));
    if (u?.photo_url) setPhotoUrl(u.photo_url);

    // restore local social state
    setFollowing(loadJSON<Record<string, boolean>>(LS_FOLLOW, {}));
    setNotifs(loadJSON<Notif[]>(LS_NOTIFS, []));
    setViewsMap(loadJSON<Record<string, number>>(LS_VIEWS, {}));
    const prof = loadJSON<{ name?: string; status?: string }>(LS_PROFILE, {});
    if (prof.name) {
      setDisplayName(prof.name);
      setEditName(prof.name);
    }
    if (prof.status) setStatusLine(prof.status);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let type = "all";
      if (tab === "video") type = "video";
      if (tab === "audio") type = "audio";
      const sort = tab === "trending" ? "trending" : "latest";
      const r = await fetch(`/api/media-feed?sort=${sort}&type=${type}`, { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

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
    if (viewUserId || tab === "me") return profileItems;
    return items;
  }, [items, tab, viewUserId, profileItems]);

  const profileStats = useMemo(() => {
    if (!profileTargetId) return { posts: 0, clones: 0, likes: 0, followers: 0 };
    const mine = items.filter((i) => i.sharer_id === profileTargetId);
    // approximate followers from local following map when viewing self
    const followersApprox = isOwnProfile
      ? notifs.filter((n) => n.type === "follow").length
      : 0;
    return {
      posts: mine.length,
      clones: mine.reduce((a, b) => a + (b.clones || 0), 0),
      likes: mine.reduce((a, b) => a + (b.likes || 0), 0),
      followers: followersApprox,
    };
  }, [items, profileTargetId, isOwnProfile, notifs]);

  const unreadCount = useMemo(() => notifs.filter((n) => !n.read).length, [notifs]);

  const cloneHref = (id: string) => {
    if (BOT_USERNAME) return `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?start=clone_${id}`;
    return "https://t.me/ArabicAds_bot";
  };

  const messageHref = (sid?: string) => {
    // Prefer Telegram user deep link by numeric id (works for any user who ever interacted with bots)
    if (sid && /^\d+$/.test(sid)) {
      return `tg://user?id=${sid}`;
    }
    if (BOT_USERNAME) return `https://t.me/${BOT_USERNAME.replace(/^@/, "")}`;
    return "https://t.me/share/url?url=";
  };

  const openProfile = (sid?: string, sname?: string) => {
    if (!sid) return;
    setViewUserId(sid);
    setViewUserName(sname || "مستخدم");
    setProfileSection("all");
    setTab("me");
    setShowNotifs(false);
  };

  const closeOtherProfile = () => {
    setViewUserId(null);
    setViewUserName("");
    setProfileSection("all");
  };

  const toggleLike = (id: string) => setLiked((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleFollow = (sid: string, sname?: string) => {
    if (!sid || sid === userId) return;
    setFollowing((prev) => {
      const next = { ...prev, [sid]: !prev[sid] };
      saveJSON(LS_FOLLOW, next);
      // When someone "follows" you in this demo we push a notif to the target locally
      // (real multi-device needs server; local gives UX now)
      if (next[sid]) {
        const n: Notif = {
          id: `${Date.now()}_${sid}`,
          type: "follow",
          fromId: userId || "0",
          fromName: displayName || username || "مستخدم",
          at: Math.floor(Date.now() / 1000),
          read: false,
        };
        // Store notif under a key scoped to target so when they open app they could see it
        // For same-device testing we also append if viewing own profile of target later
        setNotifs((old) => {
          // only record notif if following self-test? skip self
          const list = [n, ...old].slice(0, 50);
          saveJSON(LS_NOTIFS, list);
          return list;
        });
      }
      return next;
    });
    try {
      (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    } catch {}
  };

  const markNotifsRead = () => {
    setNotifs((old) => {
      const next = old.map((n) => ({ ...n, read: true }));
      saveJSON(LS_NOTIFS, next);
      return next;
    });
  };

  const openNotifs = () => {
    setShowNotifs(true);
    markNotifsRead();
  };

  const bumpView = (id: string) => {
    setViewsMap((prev) => {
      const next = { ...prev, [id]: (prev[id] || 0) + 1 };
      saveJSON(LS_VIEWS, next);
      return next;
    });
  };

  const saveProfile = () => {
    if (editName.trim()) setDisplayName(editName.trim());
    if (editStatus.trim()) setStatusLine(editStatus.trim());
    saveJSON(LS_PROFILE, {
      name: editName.trim() || displayName,
      status: editStatus.trim() || statusLine,
    });
    setEditing(false);
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "trending", label: "رائج", icon: "🔥" },
    { id: "video", label: "فيديو", icon: "🎬" },
    { id: "audio", label: "صوت", icon: "🎧" },
    { id: "me", label: "ملفي", icon: "👤" },
  ];

  const showProfile = tab === "me" || !!viewUserId;
  const headerName = viewUserId && !isOwnProfile ? viewUserName : displayName;

  return (
    <div className="min-h-screen bg-[#e3f2fd] text-slate-800">
      <header className="sticky top-0 z-20 bg-gradient-to-l from-[#1565c0] to-[#1e88e5] px-4 pb-3 pt-4 text-white shadow-lg shadow-blue-900/20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-wider text-blue-100/90">TELEGRAM MINI APP</p>
            <h1 className="text-lg font-black">{headerName ? `أهلاً ${headerName.split(" ")[0]}` : "موجز الوسائط"}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* زر التحديث */}
            <button
              type="button"
              onClick={() => load()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-lg active:bg-white/30"
              title="تحديث"
            >
              🔄
            </button>
            {/* زر الإشعارات */}
            <button
              type="button"
              onClick={openNotifs}
              className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-lg active:bg-white/30"
              title="الإشعارات"
            >
              🔔
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white/20 ring-2 ring-white/40">
              {photoUrl && isOwnProfile ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg font-black">{(headerName || "U").slice(0, 1)}</span>
              )}
            </div>
          </div>
        </div>

        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {tabs.map((t) => {
            const active = !viewUserId && tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  closeOtherProfile();
                  setShowNotifs(false);
                  setTab(t.id);
                }}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  active ? "bg-white text-[#1565c0] shadow" : "bg-white/15 text-white/90"
                }`}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* لوحة الإشعارات */}
      {showNotifs && (
        <div className="mx-3 mt-3 overflow-hidden rounded-3xl bg-white shadow-lg ring-1 ring-blue-100">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-black text-slate-800">الإشعارات</p>
            <button type="button" onClick={() => setShowNotifs(false)} className="text-xs font-bold text-slate-500">
              إغلاق
            </button>
          </div>
          {notifs.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">لا إشعارات بعد — عند متابعة أحد لك تظهر هنا</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {notifs.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openProfile(n.fromId, n.fromName)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-right hover:bg-blue-50 active:bg-blue-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-sky-400 text-sm font-black text-white">
                      {(n.fromName || "U").slice(0, 1)}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-800">
                        <span className="text-[#1565c0]">{n.fromName}</span> بدأ بمتابعتك
                      </p>
                      <p className="text-[11px] text-slate-400">{timeAgo(n.at)}</p>
                    </div>
                    <span className="text-xs font-bold text-blue-600">عرض الملف ←</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="px-3 pb-8 pt-3">
        {showProfile && !showNotifs && (
          <div className="mb-4 overflow-hidden rounded-3xl bg-white shadow-md shadow-blue-900/10">
            <div className="h-20 bg-gradient-to-l from-[#1565c0] to-[#42a5f5]" />
            <div className="relative px-4 pb-4">
              <div className="-mt-10 flex items-end gap-3">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-gradient-to-br from-blue-500 to-sky-400 text-2xl font-black text-white shadow-lg">
                  {isOwnProfile && photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (headerName || "U").slice(0, 1)
                  )}
                </div>
                <div className="mb-1 flex-1">
                  {editing && isOwnProfile ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="mb-1 w-full rounded-xl border border-blue-200 px-2 py-1 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"
                      placeholder="الاسم"
                    />
                  ) : (
                    <p className="text-lg font-black text-slate-800">{headerName || "زائر"}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {isOwnProfile && username ? `@${username}` : profileTargetId ? `ID ${profileTargetId}` : "—"}
                  </p>
                  {editing && isOwnProfile ? (
                    <input
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-blue-200 px-2 py-1 text-xs outline-none"
                      placeholder="الحالة / البايو"
                    />
                  ) : (
                    <p className="mt-0.5 text-xs text-slate-500">{isOwnProfile ? statusLine : "مستخدم نشط في الموجز"}</p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {viewUserId && !isOwnProfile && (
                  <button type="button" onClick={closeOtherProfile} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                    ← رجوع
                  </button>
                )}
                {isOwnProfile ? (
                  editing ? (
                    <>
                      <button type="button" onClick={saveProfile} className="rounded-xl bg-[#1565c0] px-4 py-2 text-xs font-bold text-white">
                        حفظ
                      </button>
                      <button type="button" onClick={() => setEditing(false)} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600">
                        إلغاء
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditName(displayName);
                        setEditStatus(statusLine);
                        setEditing(true);
                      }}
                      className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-[#1565c0]"
                    >
                      ✏️ تعديل
                    </button>
                  )
                ) : null}

                {/* متابعة + رسالة متاحة لأي ملف غير ملفك */}
                {profileTargetId && !isOwnProfile && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleFollow(profileTargetId, viewUserName)}
                      className={`rounded-xl px-3 py-2 text-xs font-bold ${
                        following[profileTargetId] ? "bg-slate-100 text-slate-600" : "bg-[#1565c0] text-white"
                      }`}
                    >
                      {following[profileTargetId] ? "✓ إلغاء المتابعة" : "＋ متابعة"}
                    </button>
                    <a
                      href={messageHref(profileTargetId)}
                      className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700"
                    >
                      💬 رسالة
                    </a>
                  </>
                )}

                {/* على ملفك: زر إشعارات سريع */}
                {isOwnProfile && (
                  <button
                    type="button"
                    onClick={openNotifs}
                    className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"
                  >
                    🔔 الإشعارات{unreadCount > 0 ? ` (${unreadCount})` : ""}
                  </button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                <div className="rounded-2xl bg-blue-50 py-2.5 text-center">
                  <p className="text-lg font-black text-[#1565c0]">{profileStats.posts}</p>
                  <p className="text-[10px] font-bold text-slate-500">منشورات</p>
                </div>
                <div className="rounded-2xl bg-sky-50 py-2.5 text-center">
                  <p className="text-lg font-black text-sky-600">{profileStats.clones}</p>
                  <p className="text-[10px] font-bold text-slate-500">تحميل</p>
                </div>
                <div className="rounded-2xl bg-rose-50 py-2.5 text-center">
                  <p className="text-lg font-black text-rose-500">{profileStats.likes}</p>
                  <p className="text-[10px] font-bold text-slate-500">إعجابات</p>
                </div>
                <div className="rounded-2xl bg-violet-50 py-2.5 text-center">
                  <p className="text-lg font-black text-violet-600">{profileStats.followers}</p>
                  <p className="text-[10px] font-bold text-slate-500">متابعون</p>
                </div>
              </div>

              <div className="mt-3 flex gap-1.5">
                {(
                  [
                    ["all", "الكل"],
                    ["video", "فيديو"],
                    ["audio", "صوت"],
                    ["photo", "صورة"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setProfileSection(id)}
                    className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold ${
                      profileSection === id ? "bg-[#1565c0] text-white" : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!showNotifs &&
          (loading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-36 animate-pulse rounded-3xl bg-white/80" />)}</div>
          ) : visible.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-blue-200 bg-white p-8 text-center shadow-sm">
              <div className="text-4xl">📭</div>
              <p className="mt-3 font-bold text-slate-700">لا يوجد محتوى بعد</p>
              <button type="button" onClick={() => load()} className="mt-3 rounded-xl bg-[#1565c0] px-4 py-2 text-xs font-bold text-white">
                🔄 تحديث
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((item) => {
                const isLiked = !!liked[item.id];
                const likeCount = (item.likes || 0) + (isLiked ? 1 : 0);
                const plays = (item.views || 0) + (viewsMap[item.id] || 0);
                const downloads = item.clones || 0;
                return (
                  <article
                    key={item.id}
                    className="overflow-hidden rounded-3xl bg-white shadow-md ring-1 ring-blue-100"
                    onClick={() => bumpView(item.id)}
                  >
                    <div className="relative aspect-[16/9] bg-slate-100">
                      {item.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-100 to-sky-100 text-5xl">
                          {typeIcon(item.media_type)}
                        </div>
                      )}
                      <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-bold text-white">
                        {typeIcon(item.media_type)}{" "}
                        {item.media_type === "audio" || item.media_type === "voice" ? "صوت" : item.media_type === "photo" ? "صورة" : "فيديو"}
                      </span>
                      {tab === "trending" && !viewUserId && (
                        <span className="absolute right-2 top-2 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-black text-white">🔥 رائج</span>
                      )}
                    </div>
                    <div className="p-3.5">
                      <h3 className="line-clamp-2 text-[15px] font-extrabold text-slate-800">{item.title}</h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openProfile(item.sharer_id, item.sharer_name);
                          }}
                          className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 active:bg-blue-100"
                        >
                          👤 {item.sharer_name || "مستخدم"}
                        </button>
                        <span>{timeAgo(item.created_at)}</span>
                        <span title="مرات التشغيل">▶ {plays}</span>
                        <span title="مرات التحميل">⬇ {downloads}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLike(item.id);
                          }}
                          className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold ${
                            isLiked ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"
                          }`}
                        >
                          {isLiked ? "❤️" : "🤍"} {likeCount}
                        </button>
                        {/* متابعة سريعة من البطاقة */}
                        {item.sharer_id && item.sharer_id !== userId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFollow(item.sharer_id!, item.sharer_name);
                            }}
                            className={`rounded-xl px-2.5 py-2 text-[11px] font-bold ${
                              following[item.sharer_id]
                                ? "bg-slate-100 text-slate-500"
                                : "bg-blue-50 text-[#1565c0]"
                            }`}
                          >
                            {following[item.sharer_id] ? "✓" : "＋"} متابعة
                          </button>
                        )}
                        <a
                          href={cloneHref(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex flex-1 items-center justify-center rounded-xl bg-gradient-to-l from-[#1565c0] to-[#1e88e5] py-2.5 text-sm font-black text-white"
                        >
                          تحميل فوري
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}
