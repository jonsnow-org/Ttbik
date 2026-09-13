"use client";

import { useCallback, useEffect, useState } from "react";

type Connection = { id: string; service: string; label: string; created_at: string };

const SERVICE_LABELS: Record<string, string> = { github: "GitHub" };

export default function NovaConnectionsClient({ uid }: { uid: string }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const [service, setService] = useState("github");
  const [label, setLabel] = useState("");
  const [credential, setCredential] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const res = await fetch(`/api/nova/connections?uid=${uid}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "تعذّر تحميل الحسابات المربوطة");
      setLoaded(true);
      return;
    }
    setConnections(data.connections || []);
    setLoaded(true);
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  async function addConnection(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormMessage(null);
    const res = await fetch("/api/nova/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, service, label, credential, baseBranch: baseBranch || null }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setFormMessage(data.error || "تعذّر إضافة الربط");
      return;
    }
    setLabel("");
    setCredential("");
    setBaseBranch("");
    setFormMessage("✅ تم الربط — يمكنك الآن أن تطلب من نوفا العمل على هذا المستودع عبر تيليجرام.");
    load();
  }

  async function revoke(connectionId: string) {
    if (!confirm("إلغاء هذا الربط؟ لن يستطيع نوفا الوصول إليه بعد ذلك.")) return;
    setBusy(true);
    await fetch("/api/nova/connections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, connectionId }),
    });
    setBusy(false);
    load();
  }

  if (!uid) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center" dir="rtl">
        <p className="text-red-700">رابط غير صالح — افتح هذه الصفحة من زر «🔗 ربط حساباتي» داخل بوت Nova.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center" dir="rtl">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-slate-500" dir="rtl">
        جارِ التحميل...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10" dir="rtl">
      <h1 className="mb-1 text-2xl font-extrabold text-slate-900">ربط الحسابات — Nova AI</h1>
      <p className="mb-6 text-sm text-slate-500">
        اربط نوفا بمستودعاتك الخاصة ليعمل عليها — بناءً وتعديلاً وإصلاحاً — بموافقتك عند كل تغيير حقيقي.
        نوفا لن يلمس أي شيء لم تربطه هنا صراحة.
      </p>

      <div className="mb-8 space-y-3">
        <h2 className="text-sm font-bold text-slate-700">المربوط حالياً</h2>
        {connections.length === 0 && <p className="text-sm text-slate-400">لا شيء مربوط بعد.</p>}
        {connections.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">{SERVICE_LABELS[c.service] || c.service}</p>
              <p className="text-xs text-slate-500">{c.label}</p>
            </div>
            <button
              onClick={() => revoke(c.id)}
              disabled={busy}
              className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              إلغاء الربط
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-slate-700">ربط جديد</h2>
        <form onSubmit={addConnection} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">الخدمة</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="github">GitHub</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">المستودع (owner/repo)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="مثال: myaccount/my-shop"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              dir="ltr"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              التوكن (Fine-grained PAT بصلاحية contents + pull_requests فقط)
            </label>
            <input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="github_pat_..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              dir="ltr"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">الفرع الأساسي (اختياري)</label>
            <input
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main (افتراضي إن تُرك فارغاً)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              dir="ltr"
            />
          </div>
          {formMessage && <p className="text-sm text-slate-700">{formMessage}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-700 px-4 py-2 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {busy ? "جارٍ الربط..." : "ربط"}
          </button>
        </form>
      </div>
    </div>
  );
}
