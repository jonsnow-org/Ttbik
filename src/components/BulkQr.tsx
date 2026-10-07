"use client";

import { useState } from "react";
import QR from "@/lib/qrMin";

function png(text: string) {
  const matrix = QR(text) as number[][];
  const canvas = document.createElement("canvas");
  const n = matrix.length;
  canvas.width = n * 4;
  canvas.height = n * 4;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  matrix.forEach((row, y) => row.forEach((cell, x) => { if (cell) ctx.fillRect(x * 4, y * 4, 4, 4); }));
  return canvas.toDataURL("image/png");
}

export default function BulkQr() {
  const [text, setText] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  async function buy() {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || lines.length > 100) return setMsg("من سطر واحد حتى 100.");
    const res = await fetch("/api/ads/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "bulk", placement: "qr-generator", altText: `رموز ${lines.length}`, bannerUrl: "bulk", targetUrl: "https://ttbik.vercel.app", days: 7 }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "تعذر");
    setCode(data.code);
    const pay = await fetch("/api/ads/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: data.code, method: "nowpayments" }) });
    const paid = await pay.json();
    if (paid.invoiceUrl) window.location.href = paid.invoiceUrl;
    else setMsg(paid.error || "تعذر الدفع");
  }

  async function download() {
    const status = await fetch(`/api/ads/status?code=${code}`).then((r) => r.json());
    if (!status.ok) return setMsg("الدفع أو الموافقة لم تكتمل.");
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 100);
    const html = lines.map((line) => `<p>${line}</p><img src="${png(line)}" />`).join("");
    const blob = new Blob([`<!doctype html><meta charset="utf-8"><body>${html}</body>`], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "qr-list.html";
    a.click();
  }

  return (
    <div className="mt-8 rounded-2xl border p-4">
      <p className="text-sm font-bold">توليد حتى 100 رمز في ملف · 3$</p>
      <textarea className="mt-2 h-28 w-full rounded-xl border px-3 py-2 text-sm" placeholder="رابط في كل سطر" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={buy} className="rounded-full bg-slate-900 px-3 py-1 text-sm font-bold text-white">ادفع 3$</button>
        <button type="button" onClick={download} className="rounded-full border px-3 py-1 text-sm font-bold">نزّل الملف بعد الموافقة</button>
      </div>
      {code && <p className="mt-2 text-xs">{code}</p>}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </div>
  );
}
