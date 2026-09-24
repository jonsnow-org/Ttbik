"use client";

import { useEffect, useRef, useState } from "react";
import AdsterraBanner from "@/components/AdsterraBanner";
import BasharApp from "./BasharApp";
import QuestionPanel from "./QuestionPanel";
import { AD_300x250 } from "./client";

export type Live = { online: number; today: number; total: number; waiting: number };
export type WinPos = { x: number; y: number };

const MARGIN = 8;

function size() {
  const w = Math.min(360, window.innerWidth - MARGIN * 2);
  const h = Math.min(560, Math.round(window.innerHeight * 0.72));
  return { w, h };
}

function clamp(p: WinPos, w: number, h: number): WinPos {
  return {
    x: Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, p.x)),
    y: Math.max(MARGIN, Math.min(window.innerHeight - h - MARGIN, p.y)),
  };
}

/**
 * Floating, draggable window (owner spec 2026-09-24): stays on screen while
 * the page underneath keeps working, is moved by dragging its title bar, can
 * be shrunk to its title bar, and only closes after × is pressed twice.
 * Ad card first (hidden for the owner, like every AdSlot), then the shared
 * question or the full ask/answer app.
 */
export default function BasharWindow({
  onClose,
  isOwner,
  questionId,
  live,
  pos,
  onMove,
}: {
  onClose: () => void;
  isOwner: boolean;
  questionId?: string;
  live: Live | null;
  pos: WinPos | null;
  onMove: (p: WinPos) => void;
}) {
  const [view, setView] = useState<"question" | "app">(questionId ? "question" : "app");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [at, setAt] = useState<WinPos | null>(null);
  const [mini, setMini] = useState(false);
  const [armed, setArmed] = useState(false);
  const drag = useRef<{ dx: number; dy: number; id: number } | null>(null);

  // size + initial position (bottom-left, above the sticky ad), re-clamped on resize
  useEffect(() => {
    function fit() {
      const d = size();
      setDims(d);
      setAt((cur) => clamp(cur ?? pos ?? { x: MARGIN + 4, y: window.innerHeight - d.h - 84 }, d.w, d.h));
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «×» once arms, twice closes; disarms after 3 seconds
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  function down(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button") || !at) return;
    drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drag.current || !dims) return;
    setAt(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, dims.w, mini ? 56 : dims.h));
  }
  function up() {
    if (drag.current && at) onMove(at);
    drag.current = null;
  }

  if (!dims || !at) return null;

  return (
    <div
      role="dialog"
      aria-label="بَشَر"
      dir="rtl"
      style={{ left: at.x, top: at.y, width: dims.w, height: mini ? "auto" : dims.h }}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/10"
    >
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="flex cursor-grab touch-none select-none items-center justify-between gap-2 bg-gradient-to-l from-slate-900 to-indigo-900 px-3 py-2 text-white active:cursor-grabbing"
      >
        <div className="min-w-0">
          <p className="truncate text-[13px] font-extrabold">💬 بَشَر — يجيبك إنسان</p>
          <p className="truncate text-[10px] text-white/70">
            {live && live.online + live.today + live.waiting > 0 ? (
              <>
                <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" />
                {live.online} متصل · {live.today} جواب اليوم · {live.waiting} ينتظر
              </>
            ) : (
              "اسحبني من هنا لتحريكي"
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMini((m) => !m)}
            aria-label={mini ? "تكبير" : "تصغير"}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-sm font-bold"
          >
            {mini ? "▢" : "—"}
          </button>
          <button
            type="button"
            onClick={() => (armed ? onClose() : setArmed(true))}
            aria-label="إغلاق (اضغط مرتين)"
            className={`flex h-7 items-center justify-center rounded-full text-sm font-bold transition ${
              armed ? "bg-rose-500 px-2 text-[10px]" : "w-7 bg-white/15"
            }`}
          >
            {armed ? "× مرة أخرى" : "✕"}
          </button>
        </div>
      </div>
      {!mini && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50">
          {!isOwner && (
            <div className="flex justify-center border-b border-slate-100 py-2">
              <div style={{ transform: dims.w < 316 ? `scale(${(dims.w - 16) / 300})` : undefined, transformOrigin: "top center" }}>
                <AdsterraBanner adKey={AD_300x250} width={300} height={250} />
              </div>
            </div>
          )}
          {view === "question" && questionId ? (
            <QuestionPanel id={questionId} onAskOwn={() => setView("app")} />
          ) : (
            <div className="p-2">
              <BasharApp compact />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
