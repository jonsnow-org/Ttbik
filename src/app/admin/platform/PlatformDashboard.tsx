"use client";

import { useEffect, useState } from "react";

type Bot = {
  id: string;
  token: string;
  ownerId: string;
  template: string;
  totalRevenue: number;
  ownerBalance: number;
  pendingBalance: number;
  isActive: boolean;
  requiredChannel: string | null;
  created_at: string;
};

const TEMPLATE_LABELS: Record<string, string> = {
  AD_BOT: "الإعلانات والمهام",
  MARRIAGE_BOT: "التعارف والزواج",
  JOBS_BOT: "فرص العمل والمتجر",
  MEDICAL_BOT: "الطبي",
  NOVA_BOT: "Nova AI",
  STORE: "متجر",
  HOSPITAL: "مشفى",
};

export default function PlatformDashboard() {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/bots");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل التحميل");
      setBots(data.bots);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(bot: Bot) {
    setBusyId(bot.id);
    try {
      const res = await fetch(`/api/admin/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !bot.isActive }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "فشل التحديث");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-slate-900">🖥️ لوحة تتبع البوتات المُنشأة</h1>
      <p className="mt-1 text-sm text-slate-500">
        كل بوت أُنشئ على المنصة عبر منشئ البوتات — عطّل أي بوت فوراً دون المساس بقاعدة البيانات يدوياً.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      )}

      {!bots ? (
        <p className="mt-8 text-sm text-slate-400">جاري التحميل…</p>
      ) : bots.length === 0 ? (
        <p className="mt-8 text-sm text-slate-400">لا توجد بوتات مُنشأة بعد.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-right text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">القالب</th>
                <th className="px-4 py-3">التوكن</th>
                <th className="px-4 py-3">معرّف المالك</th>
                <th className="px-4 py-3">إجمالي الإيرادات</th>
                <th className="px-4 py-3">رصيد المالك</th>
                <th className="px-4 py-3">تاريخ الإنشاء</th>
                <th className="px-4 py-3">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bots.map((bot) => (
                <tr key={bot.id} className={bot.isActive ? "" : "bg-slate-50 opacity-60"}>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        bot.isActive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {bot.isActive ? "نشط" : "معطّل"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {TEMPLATE_LABELS[bot.template] ?? bot.template}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{bot.token}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{bot.ownerId}</td>
                  <td className="px-4 py-3 text-slate-700">${bot.totalRevenue.toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-700">${bot.ownerBalance.toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(bot.created_at).toLocaleDateString("ar")}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(bot)}
                      disabled={busyId === bot.id}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50 ${
                        bot.isActive ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      {busyId === bot.id ? "..." : bot.isActive ? "تعطيل" : "تفعيل"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
