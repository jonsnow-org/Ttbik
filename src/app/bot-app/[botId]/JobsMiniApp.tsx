"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// The jobs/store bot's own Mini App (JOBS_BOT, @Saragptbotbot). It mirrors the bot: 🛒 the store (sell listings and buy requests,
// offers, escrow), 🛍 seller shops, 📂 my orders, 💼 work, 🏷 tenders, 💰 balance and 👤 profile — the same rules as the chat
// (src/lib/botApp/jobsApp.ts). Nothing here opens the website.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { waitForPhoneVerification } from "@/lib/botApp/phoneVerification";
import { AppFrame, AppProvider, Btn, Chips, Copyable, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, getTg, inputCls, inputStyle, money, useApp, type Screen } from "./ui";
import { StoreScreen, ProductScreen, WantedScreen, ListingForm, WantedForm, ShopsScreen, ShopScreen, MyShopScreen, OrdersScreen } from "./JobsStore";
import { WorkScreen, JobScreen, ProScreen, TendersScreen, TenderBidsScreen, TenderBidScreen } from "./JobsWork";

export type JobsInit = {
  ok: boolean; error?: string; code?: string; gate: { channel: string } | null; phoneVerified: boolean;
  user: { id: string; firstName: string; username: string }; bot: { username: string }; profile: any | null; balance: number;
  counts: { offersWaiting: number; ordersOpen: number; active: number }; categories: string[]; roles: { id: string; label: string }[];
  durations: { label: string; hours: number }[]; maxOpenTenders: number; feature: { price: number; days: number };
};
const InitCtx = createContext<{ init: JobsInit; reload: () => Promise<void> } | null>(null);
export const useInit = () => useContext(InitCtx)!;
export const photoUrl = (botId: string, f: string) => `/api/bot-app/${encodeURIComponent(botId)}/photo?f=${encodeURIComponent(f)}`;
export const ago = (iso: string) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "قبل لحظات";
  const m = Math.floor(s / 60); if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.floor(m / 60); if (h < 24) return `قبل ${h} ساعة`;
  return `قبل ${Math.floor(h / 24)} يوم`;
};
export const shareLink = (url: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

export default function JobsMiniApp({ botId, section, slug, item }: { botId: string; section: string; slug: string | null; item: string | null }) {
  const [ready, setReady] = useState(false);
  const setLang = useCallback(() => {}, []);
  useEffect(() => {
    const tg = getTg();
    try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); } catch { /* old clients */ }
    setReady(true);
  }, []);
  const initial: Screen = item ? { name: "product", params: { id: item } } : section === "shop" && slug ? { name: "shop", params: { slug } } : section === "home" || section === "shop" ? { name: "home" } : { name: section };
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
  const { api, stack, open, tg, toast } = useApp();
  const [init, setInit] = useState<JobsInit | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneNotice, setPhoneNotice] = useState("");
  const phoneFlowInFlight = useRef(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateNotice, setGateNotice] = useState("");
  const load = useCallback(async (action = "init"): Promise<JobsInit | null> => {
    const r = (await api<JobsInit>(action)) as JobsInit;
    if (!r.ok) { setFailed(r.error || "تعذّر التحميل"); return null; }
    setFailed(null);
    setInit(r);
    return r;
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(async () => { await load(); }, [load]);
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
  if (!init.phoneVerified) {
    const checkPhone = async (alreadyLocked = false) => {
      if (!alreadyLocked) {
        if (phoneFlowInFlight.current) return;
        phoneFlowInFlight.current = true;
      }
      setPhoneBusy(true);
      setPhoneNotice("جارٍ التأكد من وصول رقمك إلى البوت…");
      const verified = await waitForPhoneVerification(async () => {
        const r = (await api<JobsInit>("init")) as JobsInit;
        if (r.ok) {
          setFailed(null);
          setInit(r);
        } else {
          setFailed(r.error || "تعذّر تحديث حالة التحقق");
        }
        return { ok: !!r.ok, phoneVerified: !!r.ok && r.phoneVerified === true };
      }, { attempts: 25, intervalMs: 1_000 });
      phoneFlowInFlight.current = false;
      setPhoneBusy(false);
      if (verified) {
        setPhoneNotice("✅ تم تأكيد رقم هاتفك.");
        toast("✅ تم التحقق من رقم هاتفك.");
      } else {
        setPhoneNotice("لم يصل تأكيد المشاركة بعد. افتح محادثة البوت، وشارك رقمك من زر تيليجرام، ثم اضغط «شاركته، تحقّق» هنا.");
      }
    };
    const share = () => {
      if (phoneFlowInFlight.current) return;
      // Feature-detect the method itself: some Telegram clients expose requestContact
      // without a reliable isVersionAtLeast implementation.
      if (typeof tg?.requestContact === "function") {
        phoneFlowInFlight.current = true;
        setPhoneBusy(true);
        setPhoneNotice("أكمل نافذة Telegram لمشاركة رقم هاتفك…");
        try {
          tg.requestContact((shared: boolean) => {
            if (!shared) {
              phoneFlowInFlight.current = false;
              setPhoneBusy(false);
              setPhoneNotice("لم تتم مشاركة رقم الهاتف. يمكنك المحاولة مجدداً.");
              return;
            }
            void checkPhone(true);
          });
          return;
        } catch {
          phoneFlowInFlight.current = false;
          setPhoneBusy(false);
        }
      }
      setPhoneNotice("افتح محادثة البوت وشارك رقم هاتفك من زر تيليجرام الرسمي، ثم ارجع إلى التطبيق للتحقق.");
      if (init.bot.username) open(`https://t.me/${init.bot.username}`);
    };
    return (
      <main className="mx-auto max-w-md p-4">
        <Empty icon="📱" title="تحقق من رقم هاتفك" sub="التحقق من رقم الهاتف خطوة إلزامية قبل استخدام هذا البوت (يحمي المشترين والبائعين من الحسابات الوهمية)."
          action={<div className="flex flex-col gap-2">
            <Btn disabled={phoneBusy} onClick={share}>{phoneBusy ? "جارٍ التحقق…" : "📱 مشاركة رقم الهاتف"}</Btn>
            <Btn kind="soft" disabled={phoneBusy} onClick={() => void checkPhone()}>شاركته، تحقّق</Btn>
            {init.bot.username && <Btn kind="ghost" disabled={phoneBusy} onClick={() => open(`https://t.me/${init.bot.username}`)}>فتح محادثة البوت</Btn>}
            {phoneNotice && <p role="status" aria-live="polite" className="pt-1 text-center text-xs leading-5" style={{ color: "var(--app-hint)" }}>{phoneNotice}</p>}
          </div>} />
      </main>
    );
  }
  const cur = stack[stack.length - 1];
  const needsProfile = !init.profile && cur.name !== "home";
  return (
    <InitCtx.Provider value={{ init, reload }}>
      <main className="mx-auto max-w-md px-4 pb-6 pt-3">
        {!init.profile ? <ProfileForm first /> : needsProfile ? null : <Screens cur={cur} />}
      </main>
    </InitCtx.Provider>
  );
}

function Screens({ cur }: { cur: Screen }) {
  const p = cur.params || {};
  switch (cur.name) {
    case "home": return <Home />;
    case "store": return <StoreScreen tab={p.tab} />;
    case "product": return <ProductScreen id={p.id} />;
    case "wanted": return <WantedScreen id={p.id} />;
    case "listing_form": return <ListingForm id={p.id} />;
    case "wanted_form": return <WantedForm id={p.id} />;
    case "shops": return <ShopsScreen />;
    case "shop": return <ShopScreen slug={p.slug} />;
    case "myshop": return <MyShopScreen />;
    case "orders": return <OrdersScreen tab={p.tab} />;
    case "work": return <WorkScreen tab={p.tab} />;
    case "job": return <JobScreen id={p.id} />;
    case "pro": return <ProScreen id={p.id} />;
    case "tenders": return <TendersScreen />;
    case "tender_bids": return <TenderBidsScreen id={p.id} />;
    case "tender_bid": return <TenderBidScreen id={p.id} />;
    case "account": return <AccountScreen />;
    case "wallet": return <WalletScreen />;
    case "profile_edit": return <ProfileForm />;
    case "info": return <InfoScreen />;
  }
  return <Home />;
}

function Home() {
  const { init } = useInit();
  const { push } = useApp();
  const p = init.profile;
  const c = init.counts;
  return (
    <>
      <div className="mb-3 flex items-center justify-between text-sm font-bold" style={{ color: "var(--app-hint)" }}>
        <span>أهلاً {p?.name || init.user.firstName} 👋</span>
        <button type="button" onClick={() => push({ name: "account" })} className="rounded-full px-3 py-1 text-xs" style={{ background: "var(--app-card)", color: "var(--app-text)" }}>{p?.roleLabel}</button>
      </div>
      <div className="relative mb-4 overflow-hidden rounded-3xl p-5" style={{ background: "linear-gradient(135deg,#0ea5e9,#1d4ed8)", color: "#fff" }}>
        <div className="text-[13px] font-bold opacity-85">💼 فرص العمل والمتجر</div>
        <div className="mt-1 text-[22px] font-black leading-tight">بيع واشترِ بأمان، وابحث عن عمل أو مهني</div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11.5px] font-bold">
          <button type="button" onClick={() => push({ name: "wallet" })} className="rounded-full bg-white/20 px-2.5 py-1">💰 رصيدك {money(init.balance)}</button>
          <span className="rounded-full bg-white/20 px-2.5 py-1">🔒 حجز آمن حتى الاستلام</span>
        </div>
      </div>
      {(c.offersWaiting > 0 || c.ordersOpen > 0) && (
        <button type="button" onClick={() => push({ name: "orders", params: { tab: c.offersWaiting > 0 ? "offers" : "buy" } })} className="mb-4 flex w-full items-center gap-3 rounded-2xl p-4 text-start" style={{ background: "#fef3c7", color: "#92400e" }}>
          <span className="text-2xl">🔔</span>
          <span className="flex-1 text-sm font-bold">{c.offersWaiting > 0 ? `${c.offersWaiting} عرض سعر ينتظر ردّك` : ""}{c.offersWaiting > 0 && c.ordersOpen > 0 ? " · " : ""}{c.ordersOpen > 0 ? `${c.ordersOpen} طلب محجوز قيد التسليم` : ""}</span>
          <span>‹</span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Tile icon="🛒" title="المتجر" sub="منتجات للبيع وطلبات شراء" tone="#0ea5e9" onClick={() => push({ name: "store" })} />
        <Tile icon="🛍" title="متاجر البائعين" sub="تصفّح المتاجر واطلب" tone="#d97706" onClick={() => push({ name: "shops" })} />
        <Tile icon="📂" title="طلباتي" sub="العروض والمشتريات والمبيعات" tone="#7c3aed" badge={c.offersWaiting || 0} onClick={() => push({ name: "orders" })} />
        <Tile icon="🏪" title="متجري" sub={c.active ? `${c.active} منتج نشط` : "افتح متجرك وشارك رابطه"} tone="#059669" onClick={() => push({ name: "myshop" })} />
        <Tile icon="💼" title="العمل" sub="وظائف شاغرة ومهنيون" tone="#2563eb" onClick={() => push({ name: "work" })} />
        <Tile icon="🏷" title="اطلب وهم يتنافسون" sub="عروض أسعار سرية" tone="#db2777" onClick={() => push({ name: "tenders" })} />
      </div>
      <div className="mt-4" />
      <Section>
        <Row icon="💰" title="رصيدي وإيداع" sub={`${money(init.balance)} · ⭐ نجوم أو 🔷 TON`} onClick={() => push({ name: "wallet" })} />
        <Row icon="👤" title="ملفي الشخصي" sub={p ? `${p.roleLabel} · ${p.city}` : ""} onClick={() => push({ name: "account" })} />
        <Row icon="ℹ️" title="معلومات ومراسلة الإدارة" sub="اقتراح، رسالة للأدمن، مشاركة البوت" onClick={() => push({ name: "info" })} />
      </Section>
    </>
  );
}

function Tile({ icon, title, sub, tone, onClick, badge }: { icon: string; title: string; sub: string; tone: string; onClick: () => void; badge?: number }) {
  return (
    <button type="button" onClick={onClick} className="relative flex flex-col items-start gap-2 rounded-2xl p-4 text-start transition active:scale-[0.98]" style={{ background: "var(--app-card)" }}>
      <span className="grid h-11 w-11 place-items-center rounded-2xl text-2xl" style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>{icon}</span>
      <span className="text-[15px] font-extrabold" style={{ color: "var(--app-text)" }}>{title}</span>
      <span className="text-[11.5px] leading-5" style={{ color: "var(--app-hint)" }}>{sub}</span>
      {!!badge && <span className="absolute end-3 top-3 grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-black" style={{ background: "#ef4444", color: "#fff" }}>{badge}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- 👤 profile
function AccountScreen() {
  const { init, reload } = useInit();
  const { push, api, toast } = useApp();
  const p = init.profile;
  const [busy, setBusy] = useState(false);
  const pause = async () => {
    setBusy(true);
    const r = await api<{ isPaused: boolean }>("profile_pause");
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    toast(r.isPaused ? "⏸ تم إيقاف ظهورك في نتائج البحث عن مهنيين." : "▶️ تم تفعيل ظهورك في نتائج البحث مجدداً.");
    await reload();
  };
  return (
    <>
      <ScreenTitle icon="👤" title={p.name} sub={`${p.roleLabel} · ${p.age} سنة`} />
      <Section title="بياناتي">
        <Row icon="🌍" title={`${p.country}، ${p.governorate}، ${p.city}`} />
        <Row icon={p.contactMethod === "TELEGRAM" ? "✈️" : "💬"} title={p.contactMethod === "TELEGRAM" ? `@${p.contactValue}` : p.contactValue} sub={p.contactMethod === "TELEGRAM" ? "تلجرام" : "واتساب"} />
        {p.seekerProfession && <Row icon="💼" title={`يبحث عن: ${p.seekerProfession}`} />}
        {p.employerBusinessName && <Row icon="🏢" title={p.employerBusinessName} />}
        {p.professionalCategory && <Row icon="🔨" title={p.professionalCategory} sub={p.professionalDescription || undefined} />}
        {p.roleType === "PROFESSIONAL" && <Row icon={p.isPaused ? "⏸" : "🟢"} title={`الظهور في البحث: ${p.isPaused ? "متوقف" : "مفعّل"}`} right={<Btn small kind="soft" disabled={busy} onClick={pause}>{p.isPaused ? "▶️ تفعيل" : "⏸ إيقاف"}</Btn>} />}
      </Section>
      <Btn className="w-full" onClick={() => push({ name: "profile_edit" })}>✏️ تعديل الملف الشخصي</Btn>
      <p className="mt-2 px-1 text-[11.5px] leading-5" style={{ color: "var(--app-hint)" }}>نوع الملف حصري: لا يمكن الجمع بين أكثر من نوع. البيع ونشر طلبات الشراء لملفات «تاجر»، ونشر الوظائف لـ«معلن وظيفة».</p>
    </>
  );
}

export function ProfileForm({ first }: { first?: boolean }) {
  const { init, reload } = useInit();
  const { api, toast, back, setDirty } = useApp();
  const p = init.profile || {};
  const [f, setF] = useState<any>({
    name: p.name || init.user.firstName || "", age: p.age || "", country: p.country || "", governorate: p.governorate || "", city: p.city || "",
    contactMethod: p.contactMethod || "TELEGRAM", contactValue: p.contactValue || (init.user.username ? init.user.username : ""), roleType: p.roleType || "",
    seekerProfession: p.seekerProfession || "", employerBusinessName: p.employerBusinessName || "", professionalCategory: p.professionalCategory || "", professionalDescription: p.professionalDescription || "",
  });
  const [other, setOther] = useState(!!p.professionalCategory && !init.categories.includes(p.professionalCategory));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setDirty(true); };
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await api("profile_save", { profile: f });
    setBusy(false);
    if (!r.ok) { setErr(r.error || ""); toast(r.error || "", "err"); return; }
    setDirty(false);
    toast("✅ تم حفظ ملفك الشخصي.");
    await reload();
    if (!first) back();
  };
  const input = (k: string, label: string, ph = "", type = "text") => (
    <Field label={label}><input className={inputCls} style={inputStyle} value={f[k]} placeholder={ph} type={type} inputMode={type === "number" ? "numeric" : undefined} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  return (
    <>
      <ScreenTitle icon="👤" title={first ? "لنبدأ بإنشاء ملفك الشخصي" : "تعديل الملف الشخصي"} sub={first ? "دقيقة واحدة، ويظهر ملفك في نتائج البحث ويستقبل طلبات الأسعار." : undefined} />
      <Section title="عنك">
        {input("name", "الاسم")}
        {input("age", "العمر", "16 فأكثر", "number")}
        {input("country", "الدولة")}
        {input("governorate", "المحافظة")}
        {input("city", "المدينة")}
      </Section>
      <Section title="وسيلة التواصل">
        <div className="px-4 py-3"><Chips items={[{ id: "TELEGRAM", label: "✈️ تلجرام" }, { id: "WHATSAPP", label: "💬 واتساب" }]} value={f.contactMethod} onChange={(v) => set("contactMethod", v)} /></div>
        {input("contactValue", f.contactMethod === "WHATSAPP" ? "رقم واتساب" : "معرّفك في تلجرام", f.contactMethod === "WHATSAPP" ? "+963…" : "@username")}
      </Section>
      <Section title="نوع ملفك (حصري)" hint="👷 باحث عن عمل · 🏢 معلن وظيفة يحتاج عمالاً · 🔨 مهني يعرض حرفته · 🛒 تاجر يبيع ويشتري في المتجر">
        <div className="px-4 py-3"><Chips items={init.roles} value={f.roleType} onChange={(v) => set("roleType", v)} /></div>
        {f.roleType === "SEEKER" && input("seekerProfession", "المهنة التي تتقنها أو تبحث عنها", "تُستخدم للمطابقة مع الوظائف الشاغرة")}
        {f.roleType === "EMPLOYER" && input("employerBusinessName", "اسم عملك/شركتك/متجرك")}
        {f.roleType === "PROFESSIONAL" && (
          <>
            <div className="px-4 py-3">
              <div className="mb-2 text-xs font-bold" style={{ color: "var(--app-hint)" }}>الحرفة/الخدمة التي تقدّمها</div>
              <Chips items={[...init.categories.map((c) => ({ id: c, label: c })), { id: "__other", label: "✏️ مهنة أخرى" }]} value={other ? "__other" : f.professionalCategory} onChange={(v) => { if (v === "__other") { setOther(true); set("professionalCategory", ""); } else { setOther(false); set("professionalCategory", v); } }} />
            </div>
            {other && input("professionalCategory", "اكتب اسم مهنتك")}
            <Field label="وصف موجز لأعمالك وخبرتك (يظهر لمن يبحث عنك)"><textarea className={inputCls} style={inputStyle} rows={3} value={f.professionalDescription} onChange={(e) => set("professionalDescription", e.target.value)} /></Field>
          </>
        )}
      </Section>
      {err && <p className="mb-2 px-1 text-sm font-bold" style={{ color: "var(--app-danger)" }}>{err}</p>}
      <MainAction text="💾 حفظ الملف" onClick={save} busy={busy} />
    </>
  );
}

// ---------------------------------------------------------------- 💰 wallet
function WalletScreen() {
  const { api, tg, toast, haptic } = useApp();
  const { reload } = useInit();
  const [w, setW] = useState<any>(null);
  const load = useCallback(async () => { const r = await api("wallet"); if (r.ok) setW(r); else toast(r.error || "", "err"); }, [api, toast]);
  useEffect(() => { void load(); }, [load]);
  const buy = async (stars: number) => {
    const r = await api<{ link: string }>("stars_invoice", { stars });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    const done = async (status: string) => {
      if (status === "paid") { haptic("success"); toast("✅ تم الدفع، يُضاف الرصيد خلال ثوانٍ."); window.setTimeout(() => { void load(); void reload(); }, 2500); }
    };
    if (tg?.openInvoice) tg.openInvoice(r.link, done); else window.open(r.link, "_blank");
  };
  if (!w) return <Loading lines={4} />;
  const label = (t: string) => ({ DEPOSIT: "إيداع", ESCROW_HOLD: "حجز لطلب", ESCROW_RELEASE: "تحرير مبلغ طلب", ESCROW_REFUND: "استرداد طلب", STORE_FEATURE: "تمييز منتج", WITHDRAWAL: "سحب" } as Record<string, string>)[t] || t;
  const plus = (t: string) => ["DEPOSIT", "ESCROW_RELEASE", "ESCROW_REFUND"].includes(t);
  return (
    <>
      <ScreenTitle icon="💰" title="رصيدي وإيداع" sub="يُستخدم الرصيد للحجز الآمن عند الشراء ولتمييز المنتجات." />
      <div className="mb-4 rounded-3xl p-5" style={{ background: "linear-gradient(135deg,#059669,#047857)", color: "#fff" }}>
        <div className="text-[13px] font-bold opacity-85">رصيدك الحالي</div>
        <div className="mt-1 text-4xl font-black">{money(w.balance)}</div>
      </div>
      <Section title={`⭐ اشحن بنجوم تيليجرام (${w.starsPerUsd} نجمة = $1)`} hint="يُضاف الرصيد تلقائياً بعد الدفع، ولا حاجة لإرسال إثبات.">
        <div className="grid grid-cols-2 gap-2 p-3">
          {w.tiers.map((t: any) => <Btn key={t.stars} kind="soft" onClick={() => buy(t.stars)}>⭐ {t.stars} ({money(t.usd)})</Btn>)}
        </div>
      </Section>
      {w.ton && (
        <Section title="🔷 إيداع TON / USDT مباشر (شبكة TON فقط)" hint="اكتب المذكرة (Memo) بالضبط كما هي — بدونها لن يُحتسب إيداعك. لا ترسل USDT من شبكة أخرى لهذا العنوان. يُضاف الرصيد تلقائياً خلال دقائق.">
          <Copyable label="العنوان" value={w.ton.address} />
          <Copyable label="المذكرة (Memo)" value={w.ton.memo} />
        </Section>
      )}
      <Section title="آخر الحركات">
        {w.txs.length === 0 ? <Empty icon="🧾" title="لا توجد حركات بعد" /> : w.txs.map((t: any) => (
          <Row key={t.id} icon={plus(t.type) ? "➕" : "➖"} title={label(t.type)} sub={new Date(t.at).toLocaleString("ar")} right={<b style={{ color: plus(t.type) ? "#059669" : "var(--app-text)" }}>{plus(t.type) ? "+" : "−"}{money(t.amount)}</b>} />
        ))}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- ℹ️ info
function InfoScreen() {
  const { init } = useInit();
  const { api, toast, open } = useApp();
  const [mode, setMode] = useState<"admin" | "suggest">("admin");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const r = await api("admin_msg", { text, suggestion: mode === "suggest" });
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    setText("");
    toast(mode === "suggest" ? "✅ تم إرسال اقتراحك للإدارة، شكراً لك!" : "✅ تم إرسال رسالتك للإدارة.");
  };
  const link = init.bot.username ? `https://t.me/${init.bot.username}` : "";
  return (
    <>
      <ScreenTitle icon="ℹ️" title="بوت فرص العمل والمتجر" sub="بوابتك لسوق العمل والتجارة: وظائف، خدمات مهنية، بيع وشراء بحجز آمن، وعروض أسعار تنافسية." />
      <Section title="كيف يعمل؟">
        <Row icon="🔒" title="الحجز الآمن" sub="عند الاتفاق يُحجز المبلغ من رصيد المشتري، ويُحوَّل للبائع فقط عند تأكيد الاستلام، أو تلقائياً بعد 7 أيام بلا نزاع." />
        <Row icon="⚠️" title="مركز النزاعات" sub="أي طرف يفتح نزاعاً ويرسل إفادته ودليله، وتقرر الإدارة الإفراج للبائع أو الاسترداد للمشتري." />
        <Row icon="🏷" title="اطلب وهم يتنافسون" sub="اكتب ما تحتاجه مرة واحدة، تصلك عروض سرية من المختصين وتختار الأنسب." />
      </Section>
      <Section title="راسل الإدارة">
        <div className="px-4 pt-3"><Chips items={[{ id: "admin", label: "📩 مراسلة الأدمن" }, { id: "suggest", label: "💡 اقتراح خاصية" }]} value={mode} onChange={setMode} /></div>
        <Field label={mode === "suggest" ? "اقتراحك لإضافة خاصية أو تعديل شيء محدد" : "رسالتك للإدارة"}><textarea className={inputCls} style={inputStyle} rows={4} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="p-3"><Btn className="w-full" disabled={busy || !text.trim()} onClick={send}>إرسال</Btn></div>
      </Section>
      {link && (
        <Section title="🔗 مشاركة البوت">
          <Copyable value={link} />
          <div className="p-3"><Btn className="w-full" kind="soft" onClick={() => open(shareLink(link, "🔗 بوت فرص العمل والمتجر: وظائف ومهنيون وبيع وشراء بحجز آمن."))}>📤 مشاركة الرابط</Btn></div>
        </Section>
      )}
      <p className="px-1 text-[11.5px] leading-5" style={{ color: "var(--app-hint)" }}>✨ مساعد نوفا وإيداع العملات الرقمية الأخرى متاحان من محادثة البوت.</p>
    </>
  );
}

export { Pill };
