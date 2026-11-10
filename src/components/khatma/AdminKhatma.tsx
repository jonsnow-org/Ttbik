"use client";
import { useCallback, useEffect, useState } from "react";

type Data = { sponsors: { code: string; name: string; url: string | null; contact: string; price: number; status: string; paid_via: string | null; starts_at: string | null; ends_at: string | null }[]; stats: { groups: number; memorials: number; rounds: number; juzRead: number; starsPaid: number } };

// 🌙 Khatma sponsors and stats for the promo admin page.
export default function AdminKhatma() {
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await fetch("/api/admin/khatma-sponsors").then((x) => x.json()).catch(() => null);
    if (r?.sponsors) setD(r);
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (code: string, action: string) => {
    const r = await fetch("/api/admin/khatma-sponsors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, action }) }).then((x) => x.json()).catch(() => null);
    setMsg(r?.ok ? `✅ ${code}` : "❌ لم يتغير"); load();
  };
  if (!d) return null;
  return (
    <section className="rounded-xl border p-3">
      <h2 className="font-bold">📖 الختمات · مجموعات {d.stats.groups} · صدقة جارية {d.stats.memorials} ({d.stats.starsPaid}⭐) · ختمات مكتملة {d.stats.rounds} · أجزاء {d.stats.juzRead}</h2>
      {msg && <p className="text-sm">{msg}</p>}
      <div className="mt-2 space-y-1 text-sm">
        {d.sponsors.length === 0 && <p className="text-slate-500">لا رعاة بعد.</p>}
        {d.sponsors.map((s) => (
          <div key={s.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
            <span>{s.code} · {s.name} · ${s.price} · {s.status}{s.starts_at ? ` · ${s.starts_at.slice(0, 10)} → ${s.ends_at?.slice(0, 10)}` : ""} · {s.contact}</span>
            <span className="flex gap-2">
              {s.status === "PENDING_PAYMENT" && <button onClick={() => act(s.code, "confirm_paid")} className="rounded-full bg-amber-100 px-3 py-1">💵 وصل USDT</button>}
              {s.status === "ACTIVE" && <button onClick={() => act(s.code, "stop")} className="rounded-full bg-red-100 px-3 py-1">إيقاف</button>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
