"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "trending" | "video" | "audio" | "me";

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
  created_at?: number;
};

const BOT_USERNAME = process.env.NEXT_PUBLIC_MEDIA_BOT_USERNAME || "";

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

export default function MiniAppPage() {
  const [tab, setTab] = useState<Tab>("trending");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [following, setFollowing] = useState(false);

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
      setName(full);
      setDisplayName(full);
      setEditName(full);
    }
    if (u?.username) setUsername(u.username);
    if (u?.id) setUserId(String(u.id));
    if (u?.photo_url) setPhotoUrl(u.photo_url);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let type = "all";
      if (tab === "video") type = "video";
      if (tab === "audio") type = "audio";
      const sort = tab === "trending" ? "trending" : "latest";
      const r = await fetch(`/api/media-feed?sort=${sort}&type=${type === "all" && tab === "me" ? "all" : type}`, {
        cache: "no-store",
      });
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

  const visible = useMemo(() => {
    if (tab === "me") return items.filter((i) => i.sharer_id && userId && i.sharer_id === userId);
    return items;
  }, [items, tab, userId]);

  const myStats = useMemo(() => {
    const mine = items.filter((i) => i.sharer_id && userId && i.sharer_id === userId);
    return {
      posts: mine.length,
      clones: mine.reduce((a, b) => a + (b.clones || 0), 0),
      likes: mine.reduce((a, b) => a + (b.likes || 0), 0),
    };
  }, [items, userId]);

  const cloneHref = (id: string) => {
    if (BOT_USERNAME) return `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?start=clone_${id}`;
    return "https://t.me/ArabicAds_bot";
  };

  const messageHref = username
    ? `https://t.me/${username}`
    : BOT_USERNAME
      ? `https://t.me/${BOT_USERNAME.replace(/^@/, "")}`
      : "https://t.me/ArabicAds_bot";

  const toggleLike = (id: string) => {
    setLiked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const saveProfile = () => {
    if (editName.trim()) setDisplayName(editName.trim());
    setEditing(false);
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "trending", label: "رائج", icon: "🔥" },
    { id: "video", label: "فيديو", icon: "🎬" },
    { id: "audio", label: "صوت", icon: "🎧" },
    { id: "me", label: "ملفي", icon: "👤" },
  ];

  return (
    <div className="min-h-screen bg-[#e3f2fd] text-slate-800">
      <header className="sticky top-0 z-20 bg-gradient-to-l from-[#1565c0] to-[#1e88e5] px-4 pb-3 pt-4 text-white shadow-lg shadow-blue-900/20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-wider text-blue-100/90">TELEGRAM MINI APP</p>
            <h1 className="text-lg font-black">{displayName ? `أهلاً ${displayName.split(" ")[0]}` : "موجز الوسائط"}</h1>
          </div>
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white/20 ring-2 ring-white/40">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-lg font-black">{(displayName || "U").slice(0, 1)}</span>
            )}
          </div>
        </div>

        <nav className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  active ? "bg-white text-[#1565c0] shadow" : "bg-white/15 text-white/90 hover:bg-white/25"
                }`}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="px-3 pb-8 pt-3">
        {tab === "me" && (
          <div className="mb-4 overflow-hidden rounded-3xl bg-white shadow-md shadow-blue-900/10">
            <div className="h-20 bg-gradient-to-l from-[#1565c0] to-[#42a5f5]" />
            <div className="relative px-4 pb-4">
              <div className="-mt-10 flex items-end gap-3">
                <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-gradient-to-br from-blue-500 to-sky-400 text-2xl font-black text-white shadow-lg">
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (displayName || "U").slice(0, 1)
                  )}
                </div>
                <div className="mb-1 flex-1">
                  {editing ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-xl border border-blue-200 px-2 py-1 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-300"
                      placeholder="الاسم الظاهر"
                    />
                  ) : (
                    <p className="text-lg font-black text-slate-800">{displayName || "زائر"}</p>
                  )}
                  <p className="text-xs text-slate-500">{username ? `@${username}` : userId ? `ID ${userId}` : "—"}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={saveProfile}
                      className="rounded-xl bg-[#1565c0] px-4 py-2 text-xs font-bold text-white"
                    >
                      حفظ
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600"
                    >
                      إلغاء
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditName(displayName);
                        setEditing(true);
                      }}
                      className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-[#1565c0]"
                    >
                      ✏️ تعديل الاسم
                    </button>
                    <button
                      type="button"
                      onClick={() => setFollowing((f) => !f)}
                      className={`rounded-xl px-3 py-2 text-xs font-bold ${
                        following ? "bg-slate-100 text-slate-600" : "bg-[#1565c0] text-white"
                      }`}
                    >
                      {following ? "✓ متابَع" : "＋ متابعة"}
                    </button>
                    <a
                      href={messageHref}
                      className="rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700"
                    >
                      💬 رسالة
                    </a>
                  </>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-blue-50 py-2.5 text-center">
                  <p className="text-lg font-black text-[#1565c0]">{myStats.posts}</p>
                  <p className="text-[10px] font-bold text-slate-500">منشورات</p>
                </div>
                <div className="rounded-2xl bg-sky-50 py-2.5 text-center">
                  <p className="text-lg font-black text-sky-600">{myStats.clones}</p>
                  <p className="text-[10px] font-bold text-slate-500">استنساخ</p>
                </div>
                <div className="rounded-2xl bg-rose-50 py-2.5 text-center">
                  <p className="text-lg font-black text-rose-500">{myStats.likes}</p>
                  <p className="text-[10px] font-bold text-slate-500">إعجابات</p>
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] text-slate-400">
                تنزيلاتك المنشورة تظهر هنا عند تشغيل المشاركة من إعدادات البوت
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-3xl bg-white/80" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-blue-200 bg-white p-8 text-center shadow-sm">
            <div className="text-4xl">📭</div>
            <p className="mt-3 font-bold text-slate-700">لا يوجد محتوى بعد</p>
            <p className="mt-1 text-sm text-slate-500">
              من البوت: إعداداتي ← تشغيل المشاركة، ثم حمّل رابطاً ليظهر هنا.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((item) => {
              const isLiked = !!liked[item.id];
              const likeCount = (item.likes || 0) + (isLiked ? 1 : 0);
              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-3xl bg-white shadow-md shadow-blue-900/8 ring-1 ring-blue-100"
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
                    <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                      {typeIcon(item.media_type)}{" "}
                      {item.media_type === "audio" || item.media_type === "voice" ? "صوت" : "فيديو"}
                    </span>
                    {tab === "trending" && (
                      <span className="absolute right-2 top-2 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-black text-white">
                        🔥 رائج
                      </span>
                    )}
                  </div>
                  <div className="p-3.5">
                    <h3 className="line-clamp-2 text-[15px] font-extrabold leading-snug text-slate-800">{item.title}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
                        {item.sharer_name || "مستخدم"}
                      </span>
                      <span>{timeAgo(item.created_at)}</span>
                      <span>⚡ {item.clones || 0}</span>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleLike(item.id)}
                        className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold transition ${
                          isLiked ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200" : "bg-slate-50 text-slate-600"
                        }`}
                      >
                        {isLiked ? "❤️" : "🤍"} {likeCount}
                      </button>
                      <a
                        href={cloneHref(item.id)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-[#1565c0] to-[#1e88e5] py-2.5 text-sm font-black text-white shadow-md shadow-blue-600/25 active:scale-[0.98]"
                      >
                        تحميل فوري
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
