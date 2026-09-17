"use client";

import { useEffect, useState } from "react";

type Tab = "home" | "video" | "photo" | "audio";

export default function MiniAppPage() {
  const [tab, setTab] = useState<Tab>("home");
  const [name, setName] = useState("");

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#17212b");
      tg.setBackgroundColor("#17212b");
    } catch {}
    const u = tg.initDataUnsafe?.user;
    if (u?.first_name) setName(u.first_name);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "home", label: "الرئيسية" },
    { id: "video", label: "فيديو" },
    { id: "photo", label: "صور" },
    { id: "audio", label: "صوت" },
  ];

  return (
    <div className="min-h-screen bg-[#17212b] px-4 pb-8 pt-5 text-white">
      <header className="mb-5">
        <p className="text-xs text-white/60">التطبيق المصغر</p>
        <h1 className="mt-1 text-xl font-extrabold">{name ? `مرحباً ${name}` : "الرئيسية"}</h1>
        <p className="mt-1 text-sm text-white/70">الأحدث من التنزيلات المسموح بنشرها فقط.</p>
      </header>

      <div className="mb-5 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold ${
              tab === t.id ? "bg-[#6ab3f3] text-[#17212b]" : "bg-white/10 text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/70">
        لا يوجد محتوى منشور بعد.
        <br />
        من إعدادات البوت فعّل السماح بعرض تنزيلاتك ثم حمّل رابطاً.
      </div>
    </div>
  );
}
