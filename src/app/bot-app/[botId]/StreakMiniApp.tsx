"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// The daily chains bot's own Mini App (STREAK_BOT, @Slaselbot): it works like the bot (daily chains: check in, streaks, share)
// and holds the two sections that live in this bot: 📖 الختمة الجماعية and 🏆 مسابقات الجروبات. Nothing here opens the website.
import React, { useCallback, useEffect, useState } from "react";
import { AppFrame, AppProvider, Btn, Empty, Loading, ScreenTitle, Section, Row, getTg, useApp, type Screen } from "./ui";
import KhatmaSection from "./Khatma";
import ContestsSection from "./Contests";

type Streak = { id: string; emoji: string; title: string; current: number; longest: number; today: boolean; atRisk: boolean };
type Init = { ok: boolean; error?: string; gate: { channel: string } | null; user: { id: string; firstName: string; username: string }; bot: { username: string }; streaks: Streak[] };

export default function StreakMiniApp({ botId, section, khatma }: { botId: string; section: "home" | "khatma" | "contests"; khatma: string | null }) {
  const [ready, setReady] = useState(false);
  const setLang = useCallback(() => {}, []);
  useEffect(() => {
    const tg = getTg();
    try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); } catch { /* old clients */ }
    setReady(true);
  }, []);
  const initial: Screen = section === "home" ? { name: "home" } : { name: section, params: khatma ? { k: khatma } : {} };
  return (
    <AppFrame lang="ar">
      {ready && (
        <AppProvider botId={botId} initial={initial} lang="ar" setLang={setLang}>
          <Shell />
        </AppProvider>
      )}
    </AppFrame>
  );
}

function Shell() {
  const { api, stack, open } = useApp();
  const [init, setInit] = useState<Init | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateNotice, setGateNotice] = useState("");
  const load = useCallback(async (action = "init"): Promise<Init | null> => {
    const r = (await api<Init>(action)) as Init;
    if (!r.ok) { setFailed(r.error || "تعذّر التحميل"); return null; }
    setFailed(null);
    setInit(r);
    return r;
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const checkGate = async () => {
    if (gateBusy) return;
    setGateBusy(true);
    setGateNotice("جارٍ فحص اشتراكك لدى Telegram…");
    const result = await load("gate_check");
    setGateNotice(result
      ? result.gate ? "لم يظهر اشتراكك بعد. تأكد من الانضمام إلى القناة ثم أعد الفحص." : "✅ تم تأكيد الاشتراك."
      : "تعذّر فحص الاشتراك الآن. تحقق من اتصالك وحاول مجدداً.");
    setGateBusy(false);
  };

  if (failed && !init) return <div className="mx-auto max-w-md p-4"><Empty icon="⚠️" title={failed} sub="افتح التطبيق من زر «التطبيق» في محادثة البوت." action={<Btn onClick={() => void load()}>إعادة المحاولة</Btn>} /></div>;
  if (!init) return <div className="mx-auto max-w-md p-4"><div className="h-40 animate-pulse rounded-3xl" style={{ background: "var(--app-card)" }} /><div className="mt-4"><Loading lines={4} /></div></div>;
  if (init.gate) {
    return (
      <main className="mx-auto max-w-md p-4">
        <Empty icon="📡" title="اشترك في القناة أولاً" sub={`هذا البوت يطلب الاشتراك في @${init.gate.channel} قبل الاستخدام.`}
          action={<div className="flex flex-col gap-2">
            <Btn disabled={gateBusy} onClick={() => open(`https://t.me/${init.gate!.channel}`)}>اشترك في القناة</Btn>
            <Btn kind="soft" disabled={gateBusy} onClick={() => void checkGate()}>{gateBusy ? "جارٍ فحص الاشتراك…" : "اشتركت، تحقّق"}</Btn>
            {gateNotice && <p role="status" aria-live="polite" className="pt-1 text-center text-xs leading-5" style={{ color: "var(--app-hint)" }}>{gateNotice}</p>}
          </div>} />
      </main>
    );
  }
  const cur = stack[stack.length - 1];
  return (
    <main className="mx-auto max-w-md px-4 pb-6 pt-3">
      {cur.name === "home" && <Home init={init} onChange={(streaks) => setInit({ ...init, streaks })} />}
      {cur.name === "khatma" && <KhatmaSection startK={cur.params?.k || null} />}
      {cur.name === "contests" && <ContestsSection />}
    </main>
  );
}

function Home({ init, onChange }: { init: Init; onChange: (s: Streak[]) => void }) {
  const { api, toast, push, open, haptic } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const total = init.streaks.reduce((a, s) => a + s.current, 0);
  const best = init.streaks.reduce((a, s) => Math.max(a, s.longest), 0);
  const doneToday = init.streaks.filter((s) => s.today).length;
  const checkIn = async (s: Streak) => {
    setBusy(s.id);
    const r = await api<{ already: boolean; continued: boolean; current: number; streaks: Streak[] }>("check_in", { category: s.id });
    setBusy(null);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    onChange(r.streaks);
    if (r.already) { toast("✅ سجّلت اليوم بالفعل، عد غداً لتكمل سلسلتك!"); return; }
    haptic("success");
    setBurst(s.id);
    window.setTimeout(() => setBurst(null), 1400);
    toast(`${r.continued ? "🔥" : "🌱"} تم التسجيل! سلسلتك الآن ${r.current} يوم متتالي.`);
  };
  const share = (s: Streak) => {
    const text = `🔥 سلسلتي في ${s.title} ${s.emoji}: ${s.current} يوم متتالي!\n\nانضم إلي وابدأ سلسلتك الخاصة 💪`;
    const url = init.bot.username ? `https://t.me/${init.bot.username}` : "";
    open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  };
  return (
    <>
      <div className="mb-3 text-sm font-bold" style={{ color: "var(--app-hint)" }}>أهلاً{init.user.firstName ? ` ${init.user.firstName}` : ""} 👋</div>
      <div className="relative mb-4 overflow-hidden rounded-3xl p-5" style={{ background: "linear-gradient(135deg,#f97316,#b45309)", color: "#fff" }}>
        <div className="text-[13px] font-bold opacity-85">🔥 سلاسلك اليومية</div>
        <div className="mt-1 flex items-end gap-2"><span className="text-5xl font-black leading-none">{doneToday}</span><span className="pb-1 text-sm font-bold opacity-90">/ {init.streaks.length} سجّلت اليوم</span></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white" style={{ width: `${(doneToday / Math.max(1, init.streaks.length)) * 100}%` }} /></div>
        <div className="mt-3 flex gap-2 text-[11.5px] font-bold">
          <span className="rounded-full bg-white/20 px-2.5 py-1">مجموع الأيام {total}</span>
          <span className="rounded-full bg-white/20 px-2.5 py-1">🏆 أطول سلسلة {best} يوم</span>
        </div>
      </div>

      <div className="space-y-2.5">
        {init.streaks.map((s) => (
          <div key={s.id} className="rounded-2xl p-4 transition" style={{ background: "var(--app-card)", boxShadow: burst === s.id ? "0 0 0 3px #f9731655" : undefined }}>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: "color-mix(in srgb,#f97316 14%, transparent)" }}>{s.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-extrabold">{s.title}</div>
                <div className="mt-0.5 text-xs" style={{ color: "var(--app-hint)" }}>
                  🔥 <b style={{ color: "var(--app-text)" }}>{s.current}</b> يوم متتالي · أطول {s.longest}
                  {s.atRisk && <span style={{ color: "#c2410c" }}> · سجّل اليوم لتحافظ عليها</span>}
                </div>
              </div>
              {s.today ? (
                <span className="rounded-xl px-3 py-2 text-xs font-extrabold" style={{ background: "#dcfce7", color: "#166534" }}>✅ اليوم</span>
              ) : (
                <Btn onClick={() => checkIn(s)} disabled={busy === s.id}>{busy === s.id ? "…" : "✅ سجلت اليوم"}</Btn>
              )}
            </div>
            {s.current > 0 && <div className="mt-2 text-end"><Btn small kind="ghost" onClick={() => share(s)}>📤 مشاركة</Btn></div>}
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[11.5px] leading-5" style={{ color: "var(--app-hint)" }}>⏰ يصلك تذكير يومي في البوت إن لم تسجّل سلسلة نشطة. فوات يوم بلا تسجيل يعيد السلسلة إلى البداية.</p>

      <h2 className="mb-2 mt-5 px-1 text-[13px] font-bold" style={{ color: "var(--app-section-header)" }}>في هذا البوت أيضاً</h2>
      <div className="space-y-2.5">
        <Feature icon="📖" title="الختمة الجماعية" sub="ختمة قرآن لمجموعتك أو صدقة جارية لمن تحب: خذ جزءاً وسجّله حين تنتهي." tone="#0f766e" onClick={() => push({ name: "khatma" })} />
        <Feature icon="🏆" title="مسابقات الجروبات" sub="أسئلة في جروبك، صدارة أسبوعية، وجوائز تصل الفائزين تلقائياً." tone="#ca8a04" onClick={() => push({ name: "contests" })} />
      </div>
      <div className="mt-5" />
      <Section title="كيف تعمل السلاسل؟">
        <Row icon="1️⃣" title="اختر عادتك" sub="الصيام، الصلاة، القراءة أو الرياضة." />
        <Row icon="2️⃣" title="سجّل كل يوم" sub="ضغطة واحدة يومياً تزيد سلسلتك يوماً." />
        <Row icon="3️⃣" title="شارك وحفّز أصدقاءك" sub="أرسل بطاقة سلسلتك لمن تحب." />
      </Section>
    </>
  );
}

function Feature({ icon, title, sub, tone, onClick }: { icon: string; title: string; sub: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl p-4 text-start transition active:scale-[0.99]" style={{ background: "var(--app-card)" }}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-extrabold" style={{ color: "var(--app-text)" }}>{title}</span>
        <span className="mt-0.5 block text-xs leading-5" style={{ color: "var(--app-hint)" }}>{sub}</span>
      </span>
      <span className="text-lg" style={{ color: "var(--app-hint)" }}>‹</span>
    </button>
  );
}
