"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// WhatsApp / Telegram share for the current page — daily pages like prayer
// times spread mostly through these two apps in the Arab world.
export default function ShareRow({ text }: { text?: string }) {
  const pathname = usePathname();
  const [href, setHref] = useState("");
  const [title, setTitle] = useState(text ?? "");
  useEffect(() => {
    setHref(window.location.origin + pathname);
    if (!text) setTitle(document.title.split("|")[0].trim());
  }, [pathname, text]);
  if (!href) return null;
  const msg = `${title}\n${href}`;
  return (
    <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 pt-6 text-sm" dir="rtl">
      <span className="font-bold text-slate-700">شارك الصفحة:</span>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(msg)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-700"
      >
        واتساب
      </a>
      <a
        href={`https://t.me/share/url?url=${encodeURIComponent(href)}&text=${encodeURIComponent(title)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full bg-sky-600 px-3 py-1 font-bold text-white hover:bg-sky-700"
      >
        تليجرام
      </a>
    </div>
  );
}
