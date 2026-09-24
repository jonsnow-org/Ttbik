"use client";

import { useState } from "react";
import { inviteText, questionUrl, telegramQuestionUrl } from "./client";

export default function ShareButtons({ id, text, compact }: { id: string; text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = questionUrl(id);
  const msg = inviteText(text);

  async function anywhere() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: "بَشَر", text: msg, url });
        return;
      } catch {
        // cancelled — fall through to copy
      }
    }
    copy();
  }

  function copy() {
    navigator.clipboard?.writeText(`${msg}\n${url}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const btn = `rounded-full px-3 ${compact ? "py-1 text-[11px]" : "py-1.5 text-xs"} font-bold text-white`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <a href={`https://wa.me/?text=${encodeURIComponent(`${msg}\n${url}`)}`} target="_blank" rel="noopener noreferrer" className={`${btn} bg-emerald-600`}>
        واتساب
      </a>
      <a
        href={`https://t.me/share/url?url=${encodeURIComponent(telegramQuestionUrl(id))}&text=${encodeURIComponent(msg)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${btn} bg-sky-600`}
      >
        تليجرام
      </a>
      <button type="button" onClick={() => void anywhere()} className={`${btn} bg-slate-700`}>
        أي مكان ↗
      </button>
      <button type="button" onClick={copy} className={`${btn} bg-slate-400`}>
        {copied ? "✅ نُسخ" : "نسخ الرابط"}
      </button>
    </div>
  );
}
