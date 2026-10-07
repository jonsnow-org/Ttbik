"use client";

import { useState } from "react";

export default function VerifyForm({ state, code }: { state: string; code: string }) {
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  async function send() {
    const res = await fetch("/api/verify/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state, url }) });
    const data = await res.json();
    setMsg(data.ok ? "تم الربط. ارجع إلى البوت." : data.error || "فشل التحقق");
  }
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold">ضع هذا الكود في وصف الحساب أو الصفحة: {code}</p>
      <input dir="ltr" className="w-full rounded-xl border px-3 py-2 text-left" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button type="button" onClick={send} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">تحقق</button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
