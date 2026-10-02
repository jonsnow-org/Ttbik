"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Session = {
  id: string;
  kind: string;
  title: string;
  purpose: string;
  durationHours: number;
  status: string;
  ownerName: string;
  ownerId: string;
  closesAt: number;
  createdAt: number;
};

type Contribution = {
  id: string;
  sessionId: string;
  authorName: string;
  role: string;
  kind: string;
  text: string;
  createdAt: number;
  hidden?: boolean;
};

const KINDS = [
  { id: "knowledge", label: "جلسة معرفة", desc: "لأفهم شيئاً بوضوح" },
  { id: "experience", label: "جلسة تجربة", desc: "لأرافق مرحلة جارية" },
  { id: "decision", label: "جلسة قرار", desc: "لأحسم خياراً موثقاً" },
];

function tgUser(): { id: string; name: string } {
  try {
    const u = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
    if (u?.id) return { id: String(u.id), name: [u.first_name, u.last_name].filter(Boolean).join(" ") || "مستخدم" };
  } catch {}
  return { id: "local_" + (typeof window !== "undefined" ? localStorage.getItem("fadaa_uid") || Math.random().toString(36).slice(2, 9) : "x"), name: "زائر" };
}

export default function FadaaMiniApp() {
  const sp = useSearchParams();
  const botId = sp.get("bot") || "";
  const [tab, setTab] = useState<"home" | "open" | "create" | "room" | "archive">("home");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [kind, setKind] = useState("knowledge");
  const [hours, setHours] = useState(24);
  const [text, setText] = useState("");
  const [toast, setToast] = useState("");
  const user = useMemo(() => (typeof window !== "undefined" ? tgUser() : { id: "x", name: "زائر" }), []);

  useEffect(() => {
    try {
      const t = (window as any).Telegram?.WebApp;
      t?.ready?.();
      t?.expand?.();
      if (!localStorage.getItem("fadaa_uid") && user.id.startsWith("local_")) {
        localStorage.setItem("fadaa_uid", user.id.replace("local_", ""));
      }
    } catch {}
  }, [user.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ status: "all" });
      if (botId) q.set("bot", botId);
      const j = await (await fetch(`/api/fadaa?${q}`, { cache: "no-store" })).json();
      setSessions(Array.isArray(j.sessions) ? j.sessions : []);
      setContribs(Array.isArray(j.contributions) ? j.contributions : []);
    } catch {
      setSessions([]);
      setContribs([]);
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSessions = sessions.filter((s) => s.status === "open");
  const closedSessions = sessions.filter((s) => s.status === "closed");
  const active = sessions.find((s) => s.id === activeId) || null;
  const roomContribs = contribs.filter((c) => c.sessionId === activeId && !c.hidden);

  async function createSession() {
    if (!title.trim()) return setToast("أدخل عنوان الجلسة");
    const r = await fetch("/api/fadaa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create_session",
        kind,
        title: title.trim(),
        purpose: purpose.trim(),
        durationHours: hours,
        ownerId: user.id,
        ownerName: user.name,
        botId: botId || undefined,
        role: "منظّم",
      }),
    });
    const j = await r.json();
    if (j.session) {
      setTitle("");
      setPurpose("");
      setActiveId(j.session.id);
      setTab("room");
      await load();
      setToast("تم فتح الجلسة");
    } else setToast(j.error || "تعذّر الإنشاء");
  }

  async function addContribution() {
    if (!activeId || !text.trim()) return;
    await fetch("/api/fadaa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add_contribution",
        sessionId: activeId,
        authorId: user.id,
        authorName: user.name,
        role: "مساهم",
        kind: "clarify",
        text: text.trim(),
      }),
    });
    setText("");
    await load();
  }

  async function closeSession() {
    if (!activeId) return;
    await fetch("/api/fadaa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close_session", sessionId: activeId }),
    });
    await load();
    setToast("أُغلقت الجلسة");
    setTab("archive");
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-zinc-950 text-zinc-100" dir="rtl">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <h1 className="text-center text-xl font-black tracking-wide">فضاء</h1>
        <p className="text-center text-[11px] text-zinc-500">جلسة مؤقتة لغرض واضح… ثم تُغلق</p>
      </header>

      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-1.5 text-xs font-bold shadow-lg">
          {toast}
        </div>
      )}

      <main className="px-4 pb-24 pt-4">
        {tab === "home" && (
          <div className="space-y-3">
            <p className="text-center text-sm text-zinc-400">تُفتح لغرض واحد، تُبنى بإسهامات محددة، ثم تُغلق في وقتها.</p>
            <button type="button" onClick={() => setTab("create")} className="w-full rounded-2xl bg-zinc-100 py-3.5 text-sm font-black text-zinc-900">
              افتح جلسة
            </button>
            <button type="button" onClick={() => setTab("open")} className="w-full rounded-2xl bg-zinc-800 py-3.5 text-sm font-bold text-zinc-100 ring-1 ring-zinc-700">
              ادخل جلسة مفتوحة
            </button>
            <button type="button" onClick={() => setTab("archive")} className="w-full rounded-2xl border border-zinc-700 py-3.5 text-sm font-bold text-zinc-300">
              استعرض الخلاصات
            </button>
            <div className="pt-4">
              <p className="mb-2 text-xs font-bold text-zinc-500">أنواع الجلسات</p>
              {KINDS.map((k) => (
                <div key={k.id} className="mb-2 rounded-2xl bg-zinc-900 px-4 py-3 ring-1 ring-zinc-800">
                  <p className="font-bold text-zinc-100">{k.label}</p>
                  <p className="text-xs text-zinc-500">{k.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "create" && (
          <div className="space-y-3">
            <button type="button" onClick={() => setTab("home")} className="text-xs font-bold text-violet-400">
              ← رجوع
            </button>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${kind === k.id ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان الجلسة"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-violet-500"
            />
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="الغرض بوضوح..."
              rows={3}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm outline-none focus:border-violet-500"
            />
            <div className="flex gap-2">
              {[12, 24, 48, 72].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHours(h)}
                  className={`flex-1 rounded-xl py-2 text-xs font-bold ${hours === h ? "bg-violet-600" : "bg-zinc-800 text-zinc-400"}`}
                >
                  {h}س
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void createSession()} className="w-full rounded-2xl bg-violet-600 py-3 text-sm font-black">
              إنشاء ودخول
            </button>
          </div>
        )}

        {tab === "open" && (
          <div className="space-y-3">
            <button type="button" onClick={() => setTab("home")} className="text-xs font-bold text-violet-400">
              ← رجوع
            </button>
            {loading ? (
              <p className="text-center text-sm text-zinc-500">جاري التحميل...</p>
            ) : openSessions.length === 0 ? (
              <p className="text-center text-sm text-zinc-500">لا جلسات مفتوحة حالياً</p>
            ) : (
              openSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveId(s.id);
                    setTab("room");
                  }}
                  className="w-full rounded-2xl bg-zinc-900 p-4 text-right ring-1 ring-zinc-800"
                >
                  <p className="font-bold">{s.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{s.purpose}</p>
                  <p className="mt-2 text-[10px] text-zinc-600">
                    {s.ownerName} · {s.durationHours}س
                  </p>
                </button>
              ))
            )}
          </div>
        )}

        {tab === "room" && active && (
          <div className="space-y-3">
            <button type="button" onClick={() => setTab("open")} className="text-xs font-bold text-violet-400">
              ← الجلسات
            </button>
            <div className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
              <p className="text-xs font-bold text-violet-400">{active.kind}</p>
              <h2 className="text-lg font-black">{active.title}</h2>
              <p className="mt-1 text-sm text-zinc-400">{active.purpose}</p>
            </div>
            <div className="space-y-2">
              {roomContribs.map((c) => (
                <div key={c.id} className="rounded-xl bg-zinc-900/80 px-3 py-2 ring-1 ring-zinc-800">
                  <p className="text-[11px] font-bold text-violet-300">
                    {c.authorName} · {c.role}
                  </p>
                  <p className="text-sm text-zinc-200">{c.text}</p>
                </div>
              ))}
              {roomContribs.length === 0 && <p className="text-center text-xs text-zinc-600">لا إسهامات بعد — كن أول من يوضح</p>}
            </div>
            {active.status === "open" && (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="أضف إسهاماً..."
                  rows={3}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => void addContribution()} className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-bold">
                    إرسال
                  </button>
                  <button type="button" onClick={() => void closeSession()} className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-bold text-zinc-300">
                    إغلاق
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "archive" && (
          <div className="space-y-3">
            <button type="button" onClick={() => setTab("home")} className="text-xs font-bold text-violet-400">
              ← رجوع
            </button>
            {closedSessions.length === 0 ? (
              <p className="text-center text-sm text-zinc-500">لا خلاصات بعد</p>
            ) : (
              closedSessions.map((s) => {
                const cs = contribs.filter((c) => c.sessionId === s.id);
                return (
                  <div key={s.id} className="rounded-2xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
                    <p className="font-bold">{s.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">{s.purpose}</p>
                    <ul className="mt-2 list-inside list-disc text-xs text-zinc-400">
                      {cs.slice(0, 5).map((c) => (
                        <li key={c.id}>{c.text.slice(0, 100)}</li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-10 border-t border-zinc-800 bg-zinc-950/95 px-2 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-lg justify-around text-[10px] font-bold text-zinc-500">
          {(
            [
              ["home", "الرئيسية"],
              ["open", "المفتوحة"],
              ["create", "جلسة"],
              ["archive", "الأرشيف"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1 ${tab === id ? "text-violet-400" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
