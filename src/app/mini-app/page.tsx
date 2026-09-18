"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "trending" | "latest" | "video" | "audio" | "me";

type FeedItem = {
  id: string;
  media_type: string;
  title: string;
  url?: string;
  thumbnail?: string;
  sharer_name?: string;
  sharer_id?: string;
  clones?: number;
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
  if (s < 3600) return `${Math.floor(s / 60)} د`
  if (s < 86400) return `${Math.floor(s / 3600)} س`;
  return `${Math.floor(s / 86400)} ي`;
}

export default function MiniAppPage() {
  const [tab, setTab] = useState<Tab>("trending");
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#0e1621");
      tg.setBackgroundColor("#0e1621");
      tg.MainButton.hide();
    } catch {}
    const u = tg.initDataUnsafe?.user;
    if (u?.first_name) setName(u.first_name);
    if (u?.id) setUserId(String(u.id));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = tab === "trending" ? "trending" : "latest";
      let type = "all";
      if (tab === "video") type = "video";
      if (tab === "audio") type = "audio";
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
    if (tab === "me") {
      setLoading(false);
      return;
    }
    load();
  }, [tab, load]);

  const visible = useMemo(() => {
    if (tab === "me") return items.filter((i) => i.sharer_id && userId && i.sharer_id === userId);
    return items;
  }, [items, tab, userId]);

  const cloneHref = (id: string) => {
    if (BOT_USERNAME) return `https://t.me/${BOT_USERNAME.replace(/^@/, "")}?start=clone_${id}`;
    return `https://ttbik.vercel.app/mini-app`;
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "trending", label: "رائج", icon: "🔥" },
    { id: "latest", label: "أحدث", icon: "✨" },
    { id: "video", label: "فيديو", icon: "🎬" },
    { id: "audio", label: "صوت", icon: "🎧" },
    { id: "me", label: "ملفي", icon: "👤" },
  ];

  return (
    <div className="min-h-screen bg-[#0e1621] text-white pb-24">
      {/* Hero */}
      <div className="relative overflow-hidden px-4 pt-6 pb-4">
        <div className="absolute -top-20 -left-10 h-40 w-40 rounded-full bg-violet-600/30 blur-3xl" />
        <div className="absolute -top-10 right-0 h-32 w-32 rounded-full bg-sky-500/20 blur-3xl" />
        <p className="relative text-[11px] font-bold tracking-wide text-sky-300/90">TELEGRAM MINI APP</p>
        <h1 className="relative mt-1 text-2xl font-black">{name ? `أهلاً ${name}` : "موجز الوسائط"}</h1>
        <p className="relative mt-1 text-sm text-white/55">
          الرائج · استنساخ فوري · مشاركة اختيارية
        </p>
      </div>

      {/* Content */}
      <div className="px-4">
        {tab === "me" ? (
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-xl font-black">
                {(name || "U").slice(0, 1)}
              </div>
              <div>
                <p className="font-extrabold">{name || "زائر"}</p>
                <p className="text-xs text-white/50">مشاركاتك في الموجز تظهر هنا</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-black/25 p-3 text-center">
                <p className="text-lg font-black text-sky-300">{visible.length}</p>
                <p className="text-[11px] text-white/50">منشورات</p>
              </div>
              <div className="rounded-2xl bg-black/25 p-3 text-center">
                <p className="text-lg font-black text-violet-300">
                  {visible.reduce((a, b) => a + (b.clones || 0), 0)}
                </p>
                <p className="text-[11px] text-white/50">استنساخ</p>
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-3xl bg-white/5" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-white/5 p-8 text-center">
            <div className="text-4xl">📭</div>
            <p className="mt-3 font-bold">لا يوجد محتوى بعد</p>
            <p className="mt-1 text-sm text-white/50">
              من البوت: إعداداتي ← تفعيل المشاركة، ثم حمّل رابطاً ليظهر هنا.
            </p>
          </div>
        ) : (
          <div className={`${tab === "me" ? "mt-4" : "mt-1"} space-y-3`}>
            {visible.map((item) => (
              <article
                key={item.id}
                className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/[0.03] shadow-lg shadow-black/20"
              >
                <div className="relative aspect-[16/9] bg-[#15202b]">
                  {item.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnail} alt="" className="h-full w-full object-cover opacity-90" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-900/40 to-sky-900/40 text-5xl">
                      {typeIcon(item.media_type)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0e1621] via-transparent to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-bold backdrop-blur">
                    {typeIcon(item.media_type)}{" "}
                    {item.media_type === "audio" || item.media_type === "voice" ? "صوت" : "فيديو"}
                  </span>
                  {tab === "trending" && (
                    <span className="absolute right-3 top-3 rounded-full bg-orange-500/90 px-2.5 py-1 text-[11px] font-black">
                      🔥 رائج
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="line-clamp-2 text-[15px] font-extrabold leading-snug">{item.title}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/55">
                    <span className="rounded-full bg-white/10 px-2 py-0.5">
                      بواسطة {item.sharer_name || "مستخدم"}
                    </span>
                    <span>{timeAgo(item.created_at)}</span>
                    <span>⚡ {item.clones || 0} استنساخ</span>
                  </div>
                  <a
                    href={cloneHref(item.id)}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-sky-500 to-violet-600 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-900/30 active:scale-[0.98]"
                  >
                    تحميل فوري
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#0e1621]/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[10px] font-bold transition ${
                  active ? "text-sky-300" : "text-white/45"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-xl text-base ${
                    active ? "bg-sky-500/20 ring-1 ring-sky-400/40" : "bg-transparent"
                  }`}
                >
                  {t.icon}
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
