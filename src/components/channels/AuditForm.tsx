"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuditForm({ initial = "" }: { initial?: string }) {
  const [u, setU] = useState(initial);
  const router = useRouter();
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const name = u.trim().replace(/^https?:\/\//i, "").replace(/^(www\.)?(t|telegram)\.me\/(s\/)?/i, "").replace(/^@/, "").split(/[/?#\s]/)[0];
    if (name) router.push(`/channel-audit/${encodeURIComponent(name)}`);
  };
  return (
    <form onSubmit={go} className="flex gap-2">
      <input value={u} onChange={(e) => setU(e.target.value)} dir="ltr" placeholder="@channel أو t.me/channel" className="min-w-0 flex-1 rounded-xl border px-3 py-2" aria-label="معرّف القناة" />
      <button className="rounded-xl bg-amber-500 px-4 py-2 font-bold text-white">افحص مجاناً</button>
    </form>
  );
}
