"use client";

import { useEffect, useState } from "react";
import AdsterraBanner from "@/components/AdsterraBanner";
import BasharApp from "./BasharApp";
import QuestionPanel from "./QuestionPanel";
import { AD_300x250 } from "./client";

export type Live = { online: number; today: number; total: number; waiting: number };

/**
 * The floating window: a bottom sheet on phones, a centred card on desktop.
 * Ad card first (hidden for the owner, like every AdSlot), then either the
 * shared question or the full ask/answer app.
 */
export default function BasharWindow({
  onClose,
  isOwner,
  questionId,
  live,
}: {
  onClose: () => void;
  isOwner: boolean;
  questionId?: string;
  live: Live | null;
}) {
  const [view, setView] = useState<"question" | "app">(questionId ? "question" : "app");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center" onClick={onClose} dir="rtl">
      <div
        role="dialog"
        aria-label="بَشَر"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[88vh] sm:w-[440px] sm:rounded-3xl"
      >
        <div className="flex items-center justify-between bg-gradient-to-l from-slate-900 to-indigo-900 px-4 py-2.5 text-white">
          <div>
            <p className="text-sm font-extrabold">🧍 بَشَر — يجيبك إنسان لا ذكاء اصطناعي</p>
            {live && live.online + live.today + live.waiting > 0 && (
              <p className="text-[11px] text-white/70">
                <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />
                {live.online} متصل · {live.today} جواب اليوم · {live.waiting} سؤال ينتظر
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-lg">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto">
          {!isOwner && (
            <div className="flex justify-center border-b border-slate-100 bg-slate-50 py-2">
              <AdsterraBanner adKey={AD_300x250} width={300} height={250} />
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
      </div>
    </div>
  );
}
