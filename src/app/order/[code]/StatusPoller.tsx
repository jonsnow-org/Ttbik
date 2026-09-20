"use client";

import { useEffect, useState } from "react";
import { supabasePublic } from "@/lib/supabase";

interface OrderStatus {
  order_code: string;
  status: "pending" | "approved" | "rejected";
  amount_usd: number;
  service_name: string;
  delivery_type: "link" | "text";
  delivery_content: string | null;
  created_at: string;
}

export default function StatusPoller({ code, initial }: { code: string; initial: OrderStatus | null }) {
  const [order, setOrder] = useState<OrderStatus | null>(initial);
  const [notFound, setNotFound] = useState(!initial);

  useEffect(() => {
    if (order?.status !== "pending") return;

    const interval = setInterval(async () => {
      const db = supabasePublic();
      const { data } = await db.rpc("get_order_public_status", { p_order_code: code });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setOrder(row);
        setNotFound(false);
      }
    }, 5000);

    // No-op unless this is a still-pending USDT order -- keeps retrying the
    // real on-chain check automatically (a transaction can confirm/index
    // after the single attempt made at order-creation time) so the customer
    // never needs an admin to manually approve a manual USDT payment.
    const verifyInterval = setInterval(() => {
      fetch("/api/orders/verify-usdt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCode: code }),
      }).catch(() => null);
    }, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(verifyInterval);
    };
  }, [code, order?.status]);

  if (notFound) {
    return <p className="text-slate-600">لم يتم العثور على طلب بهذا الرمز.</p>;
  }
  if (!order) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <p className="text-sm text-slate-500">رمز الطلب</p>
      <p className="mb-4 font-mono text-lg font-bold">{order.order_code}</p>

      <p className="text-sm text-slate-500">الخدمة</p>
      <p className="mb-4 font-semibold">{order.service_name}</p>

      <p className="text-sm text-slate-500">الحالة</p>
      <p className="mb-4">
        {order.status === "pending" && (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
            ⏳ قيد المراجعة — سيتم إشعارك تلقائياً فور الموافقة
          </span>
        )}
        {order.status === "approved" && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700">
            ✅ تمت الموافقة — الخدمة جاهزة
          </span>
        )}
        {order.status === "rejected" && (
          <span className="rounded-full bg-red-50 px-3 py-1 text-sm font-bold text-red-700">
            ❌ تم رفض الطلب
          </span>
        )}
      </p>

      {order.status === "approved" && order.delivery_content && (
        <div className="rounded-xl bg-emerald-50 p-4">
          <p className="mb-1 text-sm font-semibold text-emerald-800">رابط/بيانات الوصول:</p>
          {order.delivery_content.startsWith("http") ? (
            <a
              href={order.delivery_content}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm font-semibold text-emerald-900 underline"
            >
              {order.delivery_content}
            </a>
          ) : (
            <p className="break-all text-sm text-emerald-900">{order.delivery_content}</p>
          )}
        </div>
      )}
    </div>
  );
}
