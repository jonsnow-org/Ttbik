"use client";

import { useCallback, useEffect, useState } from "react";

type Stats = {
  totalUsers: number;
  proUsers: number;
  freeUsers: number;
  pendingSubscriptions: number;
  messages24h: number;
  messages7d: number;
  byChannel: { channel: string; count: number }[];
  byQueryType: { queryType: string; count: number }[];
};

type NovaUser = {
  id: string;
  telegramId: string | null;
  email: string | null;
  apiKey: string | null;
  plan: string;
  subscriptionExpiresAt: string | null;
  dailyUsed: number;
  dailyResetAt: string;
  created_at: string;
};

type Subscription = {
  id: string;
  novaUserId: string;
  plan: string;
  amountUsd: number;
  status: string;
  created_at: string;
  novaUser: NovaUser;
};

type ConversationLog = {
  id: string;
  channel: string;
  queryType: string;
  message: string | null;
  answer: string | null;
  created_at: string;
  novaUser: { telegramId: string | null; email: string | null };
};

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export default function NovaAdminDashboard() {
  const [tab, setTab] = useState<"overview" | "subscriptions" | "users" | "conversations" | "broadcast">("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [users, setUsers] = useState<NovaUser[]>([]);
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<ConversationLog[]>([]);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    const { data } = await jsonFetch("/api/admin/nova/stats");
    setStats(data);
  }, []);
  const loadSubscriptions = useCallback(async () => {
    const { data } = await jsonFetch("/api/admin/nova/subscriptions");
    setSubscriptions(data.subscriptions ?? []);
  }, []);
  const loadUsers = useCallback(async (q: string) => {
    const { data } = await jsonFetch(`/api/admin/nova/users?q=${encodeURIComponent(q)}`);
    setUsers(data.users ?? []);
  }, []);
  const loadConversations = useCallback(async () => {
    const { data } = await jsonFetch("/api/admin/nova/conversations");
    setConversations(data.logs ?? []);
  }, []);

  useEffect(() => {
    loadStats();
    loadSubscriptions();
    loadUsers("");
    loadConversations();
  }, [loadStats, loadSubscriptions, loadUsers, loadConversations]);

  async function decideSubscription(id: string, action: "approve" | "reject") {
    setBusy(id);
    await jsonFetch(`/api/admin/nova/subscriptions/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await Promise.all([loadSubscriptions(), loadStats(), loadUsers(query)]);
    setBusy(null);
  }

  async function userAction(id: string, action: string, extra?: Record<string, unknown>) {
    setBusy(id + action);
    await jsonFetch(`/api/admin/nova/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    await Promise.all([loadUsers(query), loadStats()]);
    setBusy(null);
  }

  async function sendBroadcast() {
    setBusy("broadcast");
    setBroadcastResult(null);
    const { ok, data } = await jsonFetch("/api/admin/nova/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: broadcastText }),
    });
    setBroadcastResult(ok ? `تم الإرسال: ${data.sent}/${data.total} نجح، ${data.failed} فشل` : data.error || "فشل الإرسال");
    setBusy(null);
  }

  const TABS: { id: typeof tab; label: string }[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "subscriptions", label: `طلبات الاشتراك${stats?.pendingSubscriptions ? ` (${stats.pendingSubscriptions})` : ""}` },
    { id: "users", label: "المستخدمون" },
    { id: "conversations", label: "المحادثات الأخيرة" },
    { id: "broadcast", label: "بث رسالة" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8" dir="rtl">
      <h1 className="mb-6 text-2xl font-extrabold text-slate-900">لوحة تحكم Nova AI</h1>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              tab === t.id ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="إجمالي المستخدمين" value={stats.totalUsers} />
          <StatCard label="مشتركو PRO" value={stats.proUsers} />
          <StatCard label="مجانيون" value={stats.freeUsers} />
          <StatCard label="طلبات بانتظار الموافقة" value={stats.pendingSubscriptions} />
          <StatCard label="رسائل آخر 24 ساعة" value={stats.messages24h} />
          <StatCard label="رسائل آخر 7 أيام" value={stats.messages7d} />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
            <p className="mb-2 text-xs font-bold text-slate-500">حسب القناة</p>
            {stats.byChannel.map((c) => (
              <div key={c.channel} className="flex justify-between text-sm">
                <span>{c.channel}</span>
                <span className="font-bold">{c.count}</span>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
            <p className="mb-2 text-xs font-bold text-slate-500">حسب نوع السؤال</p>
            {stats.byQueryType.map((q) => (
              <div key={q.queryType} className="flex justify-between text-sm">
                <span>{q.queryType}</span>
                <span className="font-bold">{q.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "subscriptions" && (
        <div className="space-y-3">
          {subscriptions.length === 0 && <p className="text-slate-500">لا توجد طلبات بانتظار المراجعة 🎉</p>}
          {subscriptions.map((s) => (
            <div key={s.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-bold text-slate-900">{s.novaUser.telegramId ? `تيليجرام: ${s.novaUser.telegramId}` : s.novaUser.email}</p>
                  <p className="text-slate-500">{s.plan} — ${s.amountUsd} — {new Date(s.created_at).toLocaleString("ar")}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy === s.id}
                    onClick={() => decideSubscription(s.id, "approve")}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    موافقة ✅
                  </button>
                  <button
                    disabled={busy === s.id}
                    onClick={() => decideSubscription(s.id, "reject")}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    رفض ❌
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <div>
          <div className="mb-4 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadUsers(query)}
              placeholder="ابحث بمعرف تيليجرام أو البريد أو API key"
              className="flex-1 rounded-xl border px-3 py-2 text-sm"
            />
            <button onClick={() => loadUsers(query)} className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white">
              بحث
            </button>
          </div>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{u.telegramId ? `TG: ${u.telegramId}` : u.email || "—"}</p>
                    <p className="text-xs text-slate-500">
                      {u.plan} — استخدام اليوم: {u.dailyUsed} — منذ {new Date(u.created_at).toLocaleDateString("ar")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      disabled={busy === u.id + "grant_pro"}
                      onClick={() => userAction(u.id, "grant_pro", { days: 30 })}
                      className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                    >
                      منح PRO (30 يوم)
                    </button>
                    <button
                      disabled={busy === u.id + "revoke_pro"}
                      onClick={() => userAction(u.id, "revoke_pro")}
                      className="rounded-lg bg-slate-500 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                    >
                      إلغاء PRO
                    </button>
                    <button
                      disabled={busy === u.id + "reset_quota"}
                      onClick={() => userAction(u.id, "reset_quota")}
                      className="rounded-lg bg-brand-700 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                    >
                      إعادة تعيين الحد اليومي
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "conversations" && (
        <div className="space-y-3">
          {conversations.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="text-xs text-slate-400">
                {c.channel} · {c.queryType} · {new Date(c.created_at).toLocaleString("ar")} ·{" "}
                {c.novaUser.telegramId || c.novaUser.email}
              </p>
              <p className="mt-1 font-semibold text-slate-800">س: {c.message}</p>
              <p className="mt-1 text-slate-600">ج: {(c.answer || "").slice(0, 300)}</p>
            </div>
          ))}
          {conversations.length === 0 && <p className="text-slate-500">لا توجد محادثات بعد.</p>}
        </div>
      )}

      {tab === "broadcast" && (
        <div className="max-w-lg space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <textarea
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            placeholder="اكتب الرسالة التي تريد إرسالها لكل مستخدمي Nova على تيليجرام..."
            rows={5}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
          <button
            disabled={busy === "broadcast" || !broadcastText.trim()}
            onClick={sendBroadcast}
            className="w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy === "broadcast" ? "جارٍ الإرسال..." : "إرسال للجميع"}
          </button>
          {broadcastResult && <p className="text-sm text-slate-600">{broadcastResult}</p>}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-900">{value}</p>
    </div>
  );
}
