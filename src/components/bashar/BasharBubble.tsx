"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import BasharWindow, { type Live, type WinPos } from "./BasharWindow";

const HIDE_KEY = "bashar_bubble_hidden";
// Open window survives page changes (the site's header links do full loads):
// { qid?: string; pos?: WinPos } while open, removed once closed with ×× .
const WIN_KEY = "bashar_window";

type Saved = { qid?: string; pos?: WinPos };

function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(WIN_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}
function writeSaved(v: Saved | null) {
  try {
    if (v) sessionStorage.setItem(WIN_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(WIN_KEY);
  } catch {
    // storage blocked — window just won't follow to the next page
  }
}

/**
 * Floating «بَشَر» pill with live numbers, on every page of the site (from the
 * root layout) and on shared question links (auto-opened). Tapping it opens
 * the draggable window. Hidden on /bashar itself (the app is inline there).
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
  const [qid, setQid] = useState<string | undefined>(questionId);
  const [pos, setPos] = useState<WinPos | null>(null);

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
    const saved = readSaved();
    if (saved) {
      // a window left open on another page comes back where it was
      setQid(questionId ?? saved.qid);
      setPos(saved.pos ?? null);
      setOpen(true);
      setHidden(false);
    } else if (autoOpen) {
      const t = setTimeout(() => {
        setOpen(true);
        writeSaved({ qid: questionId });
      }, 600);
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
    if (skip || (hidden && !open)) return;
    void refresh();
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [skip, hidden, open, refresh]);

  if (skip) return null;

  return (
    <>
      {!hidden && !open && (
        <div className="fixed bottom-[76px] left-3 z-50 flex items-center gap-1 sm:bottom-6 sm:left-6" dir="rtl">
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              writeSaved({ qid, pos: pos ?? undefined });
            }}
            className="flex items-center gap-2 rounded-full bg-gradient-to-l from-slate-900 to-indigo-800 py-2 pl-4 pr-2 text-white shadow-xl ring-2 ring-white transition hover:scale-105"
          >
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg">
              💬
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-ping rounded-full bg-emerald-400" />
              <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-emerald-400" />
            </span>
            <span className="text-right leading-tight">
              <span className="block text-xs font-extrabold">{qid ? "سؤال ينتظر جوابك!" : "اسأل إنساناً حقيقياً"}</span>
              <span className="block text-[10px] text-white/75">
                {live && live.online > 1
                  ? `🟢 ${live.online} متصل · ${live.today} جواب اليوم`
                  : live && live.today > 0
                    ? `${live.today} جواب اليوم`
                    : "بَشَر — جرّبها الآن"}
              </span>
            </span>
          </button>
          {!qid && (
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
      {open && (
        <BasharWindow
          onClose={() => {
            setOpen(false);
            writeSaved(null);
          }}
          isOwner={isOwner}
          questionId={qid}
          live={live}
          pos={pos}
          onMove={(p) => {
            setPos(p);
            writeSaved({ qid, pos: p });
          }}
        />
      )}
    </>
  );
}
