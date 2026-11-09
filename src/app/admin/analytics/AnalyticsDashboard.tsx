"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Totals = {
  total_views: number;
  total_unique: number;
  views_24h: number;
  unique_24h: number;
  views_7d: number;
  unique_7d: number;
  views_30d: number;
  unique_30d: number;
};

type DailyPoint = { day: string; views: number; unique_visitors: number };
type TopPage = { path: string; views: number; unique_visitors: number };
type TopReferrer = { referrer: string; views: number };
type DeviceRow = { device_type: string; views: number };

const DEVICE_LABELS: Record<string, string> = {
  mobile: "📱 جوال",
  desktop: "💻 كمبيوتر",
  tablet: "📲 تابلت",
  unknown: "غير معروف",
};

function StatCard({ label, views, unique }: { label: string; views: number; unique: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-900">{views.toLocaleString("ar")}</p>
      <p className="mt-0.5 text-xs text-slate-400">{unique.toLocaleString("ar")} زائر فريد</p>
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<{
    totals: Totals | null;
    daily: DailyPoint[];
    topPages: TopPage[];
    topReferrers: TopReferrer[];
    devices: DeviceRow[];
    conversions?: { event: string; count: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/analytics")
      .then((res) => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-8 text-center text-slate-500">جارٍ التحميل...</p>;

  const totals = data?.totals;
  const daily = data?.daily ?? [];
  const maxDaily = Math.max(1, ...daily.map((d) => d.views));
  const totalDeviceViews = (data?.devices ?? []).reduce((sum, d) => sum + Number(d.views), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-slate-900">إحصائيات الزوار</h1>
        <Link href="/admin" className="text-sm font-semibold text-brand-700 hover:underline">
          ← لوحة الطلبات
        </Link>
      </div>

      {!totals ? (
        <p className="text-slate-500">لا توجد بيانات زيارات بعد.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="آخر 24 ساعة" views={totals.views_24h} unique={totals.unique_24h} />
            <StatCard label="آخر 7 أيام" views={totals.views_7d} unique={totals.unique_7d} />
            <StatCard label="آخر 30 يوم" views={totals.views_30d} unique={totals.unique_30d} />
            <StatCard label="الإجمالي منذ التفعيل" views={totals.total_views} unique={totals.total_unique} />
          </div>

          {/* Daily views — last 14 days, plain CSS bars (no chart library) */}
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 font-bold text-slate-900">الزيارات اليومية (آخر 14 يوماً)</h2>
            {daily.length === 0 ? (
              <p className="text-sm text-slate-400">لا توجد بيانات كافية بعد.</p>
            ) : (
              <div className="flex items-end gap-1.5" style={{ height: 140 }}>
                {daily.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${d.views} زيارة`}>
                    <div
                      className="w-full rounded-t bg-brand-500"
                      style={{ height: `${Math.max(4, (d.views / maxDaily) * 100)}%` }}
                    />
                    <span className="text-[9px] text-slate-400">{d.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 font-bold text-slate-900">التحويلات (30 يوماً)</h2>
            <p className="mb-3 text-xs text-slate-400">ضغطات المشاركة والدعم والبوتات تحت الأدوات المجانية: أي أداة تجلب زوارًا ومالًا.</p>
            {(data?.conversions ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">لا ضغطات بعد.</p>
            ) : (
              <div className="space-y-2">
                {data!.conversions!.map((c) => (
                  <div key={c.event} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-mono text-slate-600" dir="ltr">{c.event}</span>
                    <span className="shrink-0 font-bold text-slate-900">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {/* Top pages */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-bold text-slate-900">الصفحات الأكثر زيارة (30 يوماً)</h2>
              {(data?.topPages ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">لا توجد بيانات كافية بعد.</p>
              ) : (
                <div className="space-y-2">
                  {data!.topPages.map((p) => (
                    <div key={p.path} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-mono text-slate-600" dir="ltr">{p.path}</span>
                      <span className="shrink-0 font-bold text-slate-900">{p.views}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top referrers */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-bold text-slate-900">أكثر مصادر الزيارات (30 يوماً)</h2>
              {(data?.topReferrers ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">لا توجد بيانات كافية بعد — أغلب الزوار يصلون مباشرة.</p>
              ) : (
                <div className="space-y-2">
                  {data!.topReferrers.map((r) => (
                    <div key={r.referrer} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-mono text-slate-600" dir="ltr">{r.referrer}</span>
                      <span className="shrink-0 font-bold text-slate-900">{r.views}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Device breakdown */}
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-bold text-slate-900">الأجهزة (30 يوماً)</h2>
            {(data?.devices ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">لا توجد بيانات كافية بعد.</p>
            ) : (
              <div className="space-y-2">
                {data!.devices.map((d) => {
                  const pct = totalDeviceViews > 0 ? Math.round((Number(d.views) / totalDeviceViews) * 100) : 0;
                  return (
                    <div key={d.device_type}>
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>{DEVICE_LABELS[d.device_type] ?? d.device_type}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
