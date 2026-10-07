"use client";

import { useState } from "react";
import ShareCard from "@/components/ShareCard";

export default function StoryCardMaker() {
  const [title, setTitle] = useState("نتيجتي اليوم");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [ready, setReady] = useState(false);
  return (
    <div className="space-y-3">
      <input className="w-full rounded-xl border px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان البطاقة" />
      <input className="w-full rounded-xl border px-3 py-2" value={a} onChange={(e) => setA(e.target.value)} placeholder="السطر الأول" />
      <input className="w-full rounded-xl border px-3 py-2" value={b} onChange={(e) => setB(e.target.value)} placeholder="السطر الثاني" />
      <button type="button" onClick={() => setReady(true)} className="rounded-full bg-amber-600 px-4 py-2 text-sm font-extrabold text-white">اصنع البطاقة</button>
      {ready && <ShareCard kicker="بطاقة شام" title={title} lines={[{ label: "الأول", value: a || "—" }, { label: "الثاني", value: b || "—" }]} path="/free-tools/story-card" />}
    </div>
  );
}
