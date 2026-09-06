"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import type { Order } from "@/types";

export default function AdminDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/orders");
    if (res.ok) {
      const data = await res.json();
      setOrders(data.orders ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000); // in-site live notifications, no Telegram needed
    return () => clearInterval(interval);
  }, [load]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    await fetch(`/api/admin/orders/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await load();
    setBusyId(null);
  }

  const pending = orders.filter((o) => o.status === "pending");
  const others = orders.filter((o) => o.status !== "pending");

  if (loading) return <p className="p-8 text-center text-slate-500">جارٍ التحميل...</p>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-slate-900">
          لوحة التحكم — {pending.length} طلب بانتظار المراجعة
        </h1>
        <div className="flex gap-4">
          <Link href="/admin/nova" className="text-sm font-semibold text-brand-700 hover:underline">
            لوحة Nova AI ←
          </Link>
          <Link href="/admin/analytics" className="text-sm font-semibold text-brand-700 hover:underline">
            إحصائيات الزوار ←
          </Link>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        إدارة البوتات (بث، إعلانات إجبارية، إحصائيات، سحوبات) انتقلت بالكامل إلى أمر <code className="font-mono">/admin</code> داخل بوت تليجرام نفسه.
      </p>

      <div className="space-y-4">
        {pending.map((o) => (
          <div key={o.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-sm text-slate-500">{o.order_code}</p>
                <p className="font-bold text-slate-900">{o.services?.name_ar}</p>
              </div>
              <p className="text-lg font-extrabold text-brand-700">${o.amount_usd}</p>
            </div>
            <div className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
              <p>العميل: {o.customer_name}</p>
              <p>التواصل: {o.customer_contact}</p>
              <p>
                طريقة الدفع:{" "}
                {o.payment_method === "bank"
                  ? "تحويل بنكي (ACH)"
                  : o.payment_method === "crypto_auto"
                    ? "⚡ دفع تلقائي (NOWPayments)"
                    : "USDT (يدوي)"}
              </p>
              <p>مرجع التحويل: {o.transfer_reference}</p>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                disabled={busyId === o.id}
                onClick={() => decide(o.id, "approve")}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                موافقة ✅
              </button>
              <button
                disabled={busyId === o.id}
                onClick={() => decide(o.id, "reject")}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                رفض ❌
              </button>
            </div>
          </div>
        ))}
        {pending.length === 0 && <p className="text-slate-500">لا توجد طلبات بانتظار المراجعة حالياً 🎉</p>}
      </div>

      {others.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 font-bold text-slate-700">طلبات سابقة</h2>
          <div className="space-y-2">
            {others.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
              >
                <span className="font-mono text-slate-500">{o.order_code}</span>
                <span>{o.services?.name_ar}</span>
                <span
                  className={
                    o.status === "approved" ? "font-bold text-emerald-600" : "font-bold text-red-600"
                  }
                >
                  {o.status === "approved" ? "تمت الموافقة" : "مرفوض"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
