"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "matches" | "profile" | "pref";
type Card = { ref: string; shortId: string; gender: "MALE" | "FEMALE"; age: number; country: string; city: string | null; job: string | null; education: string | null; maritalStatus: string | null; verified: boolean };

const C = {
  bg: "var(--tg-theme-bg-color, #17212b)",
  card: "var(--tg-theme-secondary-bg-color, #232e3c)",
  text: "var(--tg-theme-text-color, #f5f5f5)",
  hint: "var(--tg-theme-hint-color, #708499)",
  accent: "var(--tg-theme-button-color, #5288c1)",
  accentText: "var(--tg-theme-button-text-color, #ffffff)",
};

function tg(): any {
  return typeof window !== "undefined" ? (window as any).Telegram?.WebApp : null;
}

const emptyProfile = { gender: "", name: "", age: "", country: "", city: "", job: "", education: "", maritalStatus: "", attributes: "", contactMethod: "TELEGRAM", contactValue: "" };
const emptyPref = { country: "", ageMin: "", ageMax: "", job: "", education: "", attributes: "" };

export default function MatchMiniApp({ botId }: { botId: string }) {
  const [tab, setTab] = useState<Tab>("matches");
  const [state, setState] = useState<"loading" | "outside" | "start" | "phone" | "ready">("loading");
  const [profile, setProfile] = useState<Record<string, any>>(emptyProfile);
  const [pref, setPref] = useState<Record<string, any>>(emptyPref);
  const [hasProfile, setHasProfile] = useState(false);
  const [visible, setVisible] = useState(true);
  const [cards, setCards] = useState<Card[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const saveRef = useRef<() => void>(() => {});

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const initData = tg()?.initData || "";
    const r = await fetch(`/api/match-app/${encodeURIComponent(botId)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData, action, ...extra }),
    });
    return r.json().catch(() => ({ ok: false, error: "خطأ في الاتصال" }));
  }, [botId]);

  const say = (m: string) => { setToast(m); try { tg()?.HapticFeedback?.notificationOccurred("success"); } catch {} setTimeout(() => setToast(""), 3500); };

  const loadMatches = useCallback(async (reset = false) => {
    const off = reset ? 0 : next;
    if (off == null) return;
    const r = await call("matches", { offset: off });
    if (!r.ok) { say(r.error || "تعذّر التحميل"); return; }
    setCards((c) => (reset ? r.items : [...c, ...r.items]));
    setNext(r.next);
  }, [call, next]);

  useEffect(() => {
    const w = tg();
    if (!w?.initData) { setState("outside"); return; }
    w.ready(); w.expand();
    try { w.setHeaderColor?.("secondary_bg_color"); w.setBackgroundColor?.("bg_color"); } catch {}
    call("me").then((r) => {
      if (!r.ok) { setToast(r.error || ""); setState("outside"); return; }
      if (!r.registered) { setState(r.reason === "phone" ? "phone" : "start"); return; }
      if (r.profile) {
        setHasProfile(r.profile.status === "APPROVED");
        setVisible(!r.profile.isHidden);
        setProfile(Object.fromEntries(Object.entries({ ...emptyProfile, ...r.profile }).map(([k, v]) => [k, v ?? ""])));
      } else setTab("profile");
      if (r.preference) setPref(Object.fromEntries(Object.entries({ ...emptyPref, ...r.preference }).map(([k, v]) => [k, v ?? ""])));
      setState("ready");
    });
  }, [call]);

  useEffect(() => { if (state === "ready" && hasProfile && tab === "matches" && cards.length === 0) loadMatches(true); }, [state, hasProfile, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  saveRef.current = async () => {
    if (busy) return;
    setBusy(true);
    const w = tg();
    w?.MainButton?.showProgress?.();
    try {
      if (tab === "profile") {
        const r = await call("saveProfile", { profile });
        if (r.ok) { setHasProfile(r.status === "APPROVED"); say(r.status === "APPROVED" ? "✅ حُفظ ملفك" : "✅ حُفظ وهو قيد المراجعة"); } else say(r.error);
      } else if (tab === "pref") {
        const r = await call("savePref", { preference: pref });
        if (r.ok) { say("✅ حُفظت المواصفات"); setCards([]); setNext(0); setTab("matches"); } else say(r.error);
      } else {
        setCards([]); setNext(0); await loadMatches(true);
      }
    } finally { w?.MainButton?.hideProgress?.(); setBusy(false); }
  };

  useEffect(() => {
    const w = tg();
    if (!w?.MainButton || state !== "ready") return;
    const label = tab === "matches" ? "🔍 بحث جديد" : "💾 حفظ";
    w.MainButton.setParams({ text: label, color: w.themeParams?.button_color || "#5288c1", is_visible: tab !== "matches" || hasProfile });
    const h = () => saveRef.current();
    w.MainButton.onClick(h);
    return () => w.MainButton.offClick(h);
  }, [tab, state, hasProfile]);

  const act = async (action: "request" | "block" | "report", ref: string) => {
    if (action !== "request") {
      const ok = await new Promise<boolean>((res) => (tg()?.showConfirm ? tg().showConfirm(action === "block" ? "حظر هذا الملف نهائياً؟" : "إبلاغ الإدارة عن هذا الملف؟", res) : res(true)));
      if (!ok) return;
    }
    const r = await call(action, { target: ref });
    say(r.message || r.error || "");
    if (r.ok && action !== "request") setCards((c) => c.filter((x) => x.ref !== ref));
  };

  const field = (obj: Record<string, any>, set: (v: any) => void, key: string, label: string, opts: { type?: string; ph?: string; area?: boolean } = {}) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: C.hint }}>{label}</span>
      {opts.area ? (
        <textarea value={obj[key]} onChange={(e) => set({ ...obj, [key]: e.target.value })} rows={3} placeholder={opts.ph} style={inp} />
      ) : (
        <input value={obj[key]} type={opts.type || "text"} inputMode={opts.type === "number" ? "numeric" : undefined} onChange={(e) => set({ ...obj, [key]: e.target.value })} placeholder={opts.ph} style={inp} />
      )}
    </label>
  );
  const seg = (val: string, options: [string, string][], onPick: (v: string) => void) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onPick(v)} style={{ ...btn, flex: 1, background: val === v ? C.accent : C.card, color: val === v ? C.accentText : C.text }}>{l}</button>
      ))}
    </div>
  );

  if (state !== "ready") {
    const msg = {
      loading: "جارٍ التحميل…",
      outside: toast || "افتح هذا التطبيق من زر القائمة داخل البوت في تلجرام.",
      start: "ابدأ البوت أولاً بالضغط على «ابدأ» ثم ارجع للتطبيق.",
      phone: "وثّق رقم هاتفك داخل البوت أولاً (خطوة أمان إلزامية)، ثم ارجع للتطبيق.",
    }[state];
    return <main dir="rtl" style={{ ...page, display: "grid", placeItems: "center", textAlign: "center" }}><p style={{ maxWidth: 320 }}>{msg}</p></main>;
  }

  return (
    <main dir="rtl" style={page}>
      <nav style={{ display: "flex", gap: 6, position: "sticky", top: 0, background: C.bg, paddingBottom: 10, zIndex: 2 }}>
        {([["matches", "💞 المطابقات"], ["profile", "👤 ملفي"], ["pref", "💍 مواصفات الشريك"]] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btn, flex: 1, fontSize: 13, background: tab === t ? C.accent : C.card, color: tab === t ? C.accentText : C.text }}>{l}</button>
        ))}
      </nav>

      {tab === "matches" && (
        <section>
          {!hasProfile && <p style={{ color: C.hint }}>أنشئ ملفك من تبويب «ملفي» لتظهر لك المطابقات.</p>}
          {hasProfile && cards.length === 0 && <p style={{ color: C.hint }}>لا توجد ملفات مطابقة الآن. جرّب توسيع المواصفات.</p>}
          <div style={{ display: "grid", gap: 12 }}>
            {cards.map((c) => (
              <article key={c.ref} style={{ background: C.card, borderRadius: 16, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 26, background: c.gender === "FEMALE" ? "#6b3a5b" : "#2b5278", display: "grid", placeItems: "center", fontSize: 26 }}>{c.gender === "FEMALE" ? "👩" : "👨"}</div>
                  <div>
                    <b>ملف #{c.shortId} {c.verified ? "☑️" : ""}</b>
                    <div style={{ color: C.hint, fontSize: 13 }}>{c.age} سنة · {c.country}{c.city ? ` · ${c.city}` : ""}</div>
                  </div>
                </div>
                <div style={{ fontSize: 14, marginTop: 8, lineHeight: 1.7 }}>
                  {c.job && <div>💼 {c.job}</div>}
                  {c.education && <div>🎓 {c.education}</div>}
                  {c.maritalStatus && <div>💍 {c.maritalStatus}</div>}
                </div>
                <button onClick={() => act("request", c.ref)} style={{ ...btn, width: "100%", marginTop: 10, background: C.accent, color: C.accentText }}>💌 طلب دردشة مجهولة 🔒</button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => act("report", c.ref)} style={{ ...btn, flex: 1, background: "transparent", color: C.hint, border: `1px solid ${C.hint}` }}>🚩 إبلاغ</button>
                  <button onClick={() => act("block", c.ref)} style={{ ...btn, flex: 1, background: "transparent", color: C.hint, border: `1px solid ${C.hint}` }}>⛔ حظر</button>
                </div>
              </article>
            ))}
          </div>
          {next != null && cards.length > 0 && <button onClick={() => loadMatches()} style={{ ...btn, width: "100%", marginTop: 12, background: C.card, color: C.text }}>المزيد</button>}
        </section>
      )}

      {tab === "profile" && (
        <section>
          {seg(profile.gender, [["MALE", "👨 ذكر"], ["FEMALE", "👩 أنثى"]], (v) => setProfile({ ...profile, gender: v }))}
          {field(profile, setProfile, "name", "الاسم (لا يظهر خارج البوت)")}
          {field(profile, setProfile, "age", "العمر (18+)", { type: "number" })}
          {field(profile, setProfile, "country", "الدولة")}
          {field(profile, setProfile, "city", "المدينة (اختياري)")}
          {field(profile, setProfile, "job", "العمل (اختياري)")}
          {field(profile, setProfile, "education", "التعليم (اختياري)")}
          {field(profile, setProfile, "maritalStatus", "الحالة الاجتماعية (اختياري)")}
          {field(profile, setProfile, "attributes", "نبذة ومواصفات (بدون أرقام أو حسابات)", { area: true })}
          <span style={{ fontSize: 13, color: C.hint }}>وسيلة التواصل (تُكشف فقط بعد موافقة الطرفين)</span>
          {seg(profile.contactMethod, [["TELEGRAM", "تلجرام"], ["WHATSAPP", "واتساب"]], (v) => setProfile({ ...profile, contactMethod: v }))}
          {field(profile, setProfile, "contactValue", profile.contactMethod === "WHATSAPP" ? "رقم واتساب" : "معرّف تلجرام @", {})}
          {hasProfile && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0 16px" }}>
              <input type="checkbox" checked={visible} onChange={async (e) => { setVisible(e.target.checked); const r = await call("visibility", { visible: e.target.checked }); say(r.ok ? (e.target.checked ? "ملفك ظاهر في البحث" : "ملفك مخفي مؤقتاً") : r.error); }} />
              إظهار ملفي في البحث والبحث المضمّن
            </label>
          )}
          <p style={{ fontSize: 12, color: C.hint }}>الصورة والتسجيل الصوتي يُضافان من داخل البوت. للبالغين 18+ فقط.</p>
        </section>
      )}

      {tab === "pref" && (
        <section>
          {field(pref, setPref, "country", "الدولة المفضلة")}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>{field(pref, setPref, "ageMin", "العمر من", { type: "number" })}</div>
            <div style={{ flex: 1 }}>{field(pref, setPref, "ageMax", "إلى", { type: "number" })}</div>
          </div>
          {field(pref, setPref, "job", "العمل (اختياري)")}
          {field(pref, setPref, "education", "التعليم (اختياري)")}
          {field(pref, setPref, "attributes", "مواصفات أخرى (اختياري)", { area: true })}
        </section>
      )}

      {toast && <div role="status" style={{ position: "fixed", bottom: 16, insetInline: 16, background: C.card, padding: 12, borderRadius: 12, textAlign: "center", boxShadow: "0 4px 16px #0006" }}>{toast}</div>}
      <noscript>يتطلب JavaScript</noscript>
      {/* Fallback save button for clients without MainButton */}
      {!tg()?.MainButton && tab !== "matches" && <button onClick={() => saveRef.current()} style={{ ...btn, width: "100%", background: C.accent, color: C.accentText }}>💾 حفظ</button>}
    </main>
  );
}

const page: React.CSSProperties = { minHeight: "100vh", background: C.bg, color: C.text, padding: 14, fontFamily: "system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif" };
const btn: React.CSSProperties = { border: 0, borderRadius: 12, padding: "10px 12px", fontWeight: 600, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", marginTop: 4, padding: "10px 12px", borderRadius: 10, border: "1px solid #2f3b4a", background: "var(--tg-theme-secondary-bg-color, #232e3c)", color: "inherit", fontSize: 15, boxSizing: "border-box" };
