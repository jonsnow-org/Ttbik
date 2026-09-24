"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import BasharWindow, { type Live } from "./BasharWindow";

const HIDE_KEY = "bashar_bubble_hidden";

/**
 * Floating «بَشَر» pill with live numbers, on every page of the site (from the
 * root layout) and on shared question links (auto-opened). Sits above the
 * mobile sticky ad. Hidden on /bashar itself (the app is inline there).
 */
export default function BasharBubble({
  isOwner,
  questionId,
  autoOpen = false,
}: {
  isOwner: boolean;
  questionId?: string;
  autoOpen?: boolean;
}) {
  const pathname = usePathname() || "";
  const [live, setLive] = useState<Live | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(true);

  const onBasharHome = pathname === "/bashar";
  const inQuestionPage = pathname.startsWith("/bashar/q/");
  const offPage = pathname.startsWith("/admin") || pathname.startsWith("/mini-app") || pathname.startsWith("/embed");
  // The layout's global bubble steps aside on question pages, which render their own.
  const skip = offPage || onBasharHome || (inQuestionPage && !questionId);

  useEffect(() => {
    if (skip) return;
    try {
      setHidden(!questionId && sessionStorage.getItem(HIDE_KEY) === "1");
    } catch {
      setHidden(false);
    }
    if (autoOpen) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [skip, autoOpen, questionId]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/bashar", { cache: "no-store" });
      setLive((await r.json()) as Live);
    } catch {
      // keep the last numbers
    }
  }, []);

  useEffect(() => {
    if (skip || hidden) return;
    void refresh();
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [skip, hidden, refresh]);

  if (skip) return null;

  return (
    <>
      {!hidden && !open && (
        <div className="fixed bottom-[76px] left-3 z-50 flex items-center gap-1 sm:bottom-6 sm:left-6" dir="rtl">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full bg-gradient-to-l from-slate-900 to-indigo-800 py-2 pl-4 pr-2 text-white shadow-xl ring-2 ring-white transition hover:scale-105"
          >
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg">
              🧍
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-ping rounded-full bg-emerald-400" />
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-emerald-400" />
            </span>
            <span className="text-right leading-tight">
              <span className="block text-xs font-extrabold">{questionId ? "سؤال ينتظر جوابك!" : "اسأل إنساناً حقيقياً"}</span>
              <span className="block text-[10px] text-white/75">
                {live && live.online > 1
                  ? `🟢 ${live.online} متصل · ${live.today} جواب اليوم`
                  : live && live.today > 0
                    ? `${live.today} جواب اليوم`
                    : "بَشَر — جرّبها الآن"}
              </span>
            </span>
          </button>
          {!questionId && (
            <button
              type="button"
              aria-label="إخفاء"
              onClick={() => {
                setHidden(true);
                try {
                  sessionStorage.setItem(HIDE_KEY, "1");
                } catch {
                  // hidden for this page only
                }
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600 shadow"
            >
              ✕
            </button>
          )}
        </div>
      )}
      {open && <BasharWindow onClose={() => setOpen(false)} isOwner={isOwner} questionId={questionId} live={live} />}
    </>
  );
}
