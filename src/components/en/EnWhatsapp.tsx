"use client";

import { useState } from "react";
import { Card, Field } from "./EnUi";

export default function EnWhatsapp() {
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("Hi! I'd like to order: ");
  const [copied, setCopied] = useState(false);
  const digits = phone.replace(/\D/g, "");
  const link = digits.length >= 8 ? `https://wa.me/${digits}${msg ? `?text=${encodeURIComponent(msg)}` : ""}` : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <Card>
      <Field label="WhatsApp number with country code, digits only" value={phone} set={setPhone} hint="Example: 14155550123 (no + or spaces needed)." />
      <label className="block text-sm font-bold text-slate-700">
        Pre-filled message
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-base font-normal" />
      </label>
      {link && (
        <div className="space-y-2">
          <div className="break-all rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900" dir="ltr">{link}</div>
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white">{copied ? "✓ Copied" : "Copy link"}</button>
            <a href={link} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-xl border border-emerald-600 py-2.5 text-center font-bold text-emerald-700">Test it</a>
          </div>
        </div>
      )}
    </Card>
  );
}
