"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// 💼 Work (job postings and professionals) and 🏷 «اطلب وهم يتنافسون» (sealed tenders) of the jobs/store bot's Mini App.
// Same rules as the chat: posting jobs is for «معلن وظيفة», service tenders reach «مهني» profiles of the same trade, product
// tenders reach «تاجر» profiles in the requester's country, bids are sealed and the requester picks one.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Chips, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, inputCls, inputStyle, money, useApp } from "./ui";
import { ago, useInit } from "./JobsMiniApp";

function Report({ kind, target }: { kind: string; target: string }) {
  const { api, toast, confirm, back } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <div className="mt-3 flex justify-center gap-4 text-xs font-bold" style={{ color: "var(--app-hint)" }}>
        <button type="button" onClick={() => setOpen((x) => !x)}>🚩 إبلاغ</button>
        <button type="button" onClick={async () => { if (!(await confirm("حظر هذا المستخدم؟"))) return; const r = await api("block", { target }); if (r.ok) { toast("⛔ تم الحظر."); back(); } else toast(r.error || "", "err"); }}>⛔ حظر</button>
      </div>
      {open && (
        <Section title="سبب البلاغ">
          <Field label="اكتب ما حدث باختصار"><textarea className={inputCls} style={inputStyle} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="p-3"><Btn className="w-full" kind="danger" disabled={!reason.trim()} onClick={async () => { const r = await api("report", { kind, target, reason }); if (r.ok) { setOpen(false); setReason(""); toast("✅ تم إرسال البلاغ للإدارة."); } else toast(r.error || "", "err"); }}>إرسال البلاغ</Btn></div>
        </Section>
      )}
    </>
  );
}

export function WorkScreen({ tab: initialTab }: { tab?: string }) {
  const { init } = useInit();
  const employer = init.profile?.roleType === "EMPLOYER";
  const [tab, setTab] = useState<string>(initialTab || (employer ? "mine" : init.profile?.roleType === "PROFESSIONAL" ? "pros" : "jobs"));
  const tabs = [{ id: "jobs", label: "🔍 وظائف شاغرة" }, { id: "pros", label: "🔨 ابحث عن مهني" }, ...(employer ? [{ id: "mine", label: "📋 وظائفي" }, { id: "post", label: "➕ انشر وظيفة" }] : [])];
  return (
    <>
      <ScreenTitle icon="💼" title="العمل" sub="وظائف شاغرة لمن يبحث عن عمل، ومهنيون لمن يحتاج خدمة." />
      <div className="mb-3"><Chips items={tabs} value={tab} onChange={setTab} /></div>
      {tab === "jobs" ? <JobsList /> : tab === "pros" ? <ProsList /> : tab === "mine" ? <MyJobs onPost={() => setTab("post")} /> : <JobPostForm onDone={() => setTab("mine")} />}
      {!employer && <p className="mt-4 px-1 text-[11.5px] leading-5" style={{ color: "var(--app-hint)" }}>نشر الوظائف متاح لملفات «معلن وظيفة».</p>}
    </>
  );
}

function JobsList() {
  const { api, push, toast } = useApp();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[] | null>(null);
  const [more, setMore] = useState(false);
  const qRef = useRef(q); qRef.current = q;
  const load = useCallback(async (offset = 0) => {
    if (!offset) setItems(null);
    const r = await api<{ items: any[]; more: boolean; q: string }>("jobs_search", { q: qRef.current, offset });
    if (!r.ok) { toast(r.error || "", "err"); setItems([]); return; }
    if (!offset && !qRef.current && r.q) setQ(r.q);
    setItems((x) => (offset ? [...(x || []), ...r.items] : r.items));
    setMore(r.more);
  }, [api, toast]);
  useEffect(() => { void load(0); }, [load]);
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); void load(0); }} className="mb-3 flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: "var(--app-card)" }}>
        <span>🔍</span><input className={inputCls} style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="المهنة أو الكلمة المفتاحية…" enterKeyHint="search" />
      </form>
      {items === null ? <Loading lines={4} /> : items.length === 0 ? <Empty icon="💼" title="لا توجد وظائف مطابقة حالياً" sub="جرّب كلمة أخرى، أو عُد لاحقاً." /> : (
        <Section>{items.map((j) => <Row key={j.id} icon="💼" title={j.title} sub={`📍 ${j.governorate}، ${j.city} · 👥 ${j.workers} · ${ago(j.at)}`} onClick={() => push({ name: "job", params: { id: j.id } })} />)}</Section>
      )}
      {more && <Btn className="mt-2 w-full" kind="soft" onClick={() => void load(items?.length || 0)}>عرض المزيد</Btn>}
    </>
  );
}

function ProsList() {
  const { api, push, toast } = useApp();
  const { init } = useInit();
  const [cat, setCat] = useState("");
  const [custom, setCustom] = useState("");
  const [region, setRegion] = useState("");
  const [items, setItems] = useState<any[] | null>(null);
  const [more, setMore] = useState(false);
  const category = cat === "__other" ? custom : cat;
  const load = async (offset = 0) => {
    if (!category.trim()) { toast("اختر الحرفة أولاً.", "err"); return; }
    if (!offset) setItems(null);
    const r = await api<{ items: any[]; more: boolean }>("pros_search", { category, region, offset });
    if (!r.ok) { toast(r.error || "", "err"); setItems([]); return; }
    setItems((x) => (offset ? [...(x || []), ...r.items] : r.items));
    setMore(r.more);
  };
  return (
    <>
      <Section title="ما الحرفة التي تحتاجها؟">
        <div className="p-3"><Chips items={[...init.categories.map((c) => ({ id: c, label: c })), { id: "__other", label: "✏️ أخرى" }]} value={cat} onChange={setCat} /></div>
        {cat === "__other" && <Field label="اسم الحرفة"><input className={inputCls} style={inputStyle} value={custom} onChange={(e) => setCustom(e.target.value)} /></Field>}
        <Field label="المدينة أو المحافظة (اختياري)"><input className={inputCls} style={inputStyle} value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
        <div className="p-3"><Btn className="w-full" disabled={!category.trim()} onClick={() => void load(0)}>🔍 بحث</Btn></div>
      </Section>
      {items === null ? (cat ? <Loading lines={3} /> : null) : items.length === 0 ? <Empty icon="🔨" title="لا يوجد مهنيون مطابقون" sub="جرّب منطقة أخرى، أو انشر طلباً في «اطلب وهم يتنافسون» لتصلك العروض." action={<Btn kind="soft" onClick={() => push({ name: "tenders" })}>🏷 اطلب وهم يتنافسون</Btn>} /> : (
        <Section>{items.map((p, i) => <Row key={p.id || i} icon="🔨" title={<>{p.name}{p.mine && <span className="ms-1 text-xs" style={{ color: "var(--app-accent)" }}>(أنت)</span>}</>} sub={`${p.category} · 📍 ${p.governorate}، ${p.city}`} onClick={p.id ? () => push({ name: "pro", params: { id: p.id } }) : undefined} />)}</Section>
      )}
      {more && <Btn className="mt-2 w-full" kind="soft" onClick={() => void load(items?.length || 0)}>عرض المزيد</Btn>}
    </>
  );
}

function MyJobs({ onPost }: { onPost: () => void }) {
  const { api, push } = useApp();
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { void api<{ items: any[] }>("my_jobs").then((r) => setItems(r.ok ? r.items : [])); }, [api]);
  if (!items) return <Loading lines={3} />;
  if (!items.length) return <Empty icon="📋" title="لم تنشر وظائف بعد" action={<Btn onClick={onPost}>➕ انشر وظيفة</Btn>} />;
  return <Section>{items.map((j) => <Row key={j.id} icon="💼" title={j.title} sub={`📍 ${j.governorate}، ${j.city} · 👥 ${j.workers} · ${ago(j.at)}`} right={<Pill tone={j.status === "ACTIVE" ? "ok" : "neutral"}>{j.status === "ACTIVE" ? "نشطة" : j.status}</Pill>} onClick={() => push({ name: "job", params: { id: j.id } })} />)}</Section>;
}

function JobPostForm({ onDone }: { onDone: () => void }) {
  const { api, toast, setDirty } = useApp();
  const { init } = useInit();
  const p = init.profile;
  const [f, setF] = useState<any>({ title: "", keywords: "", workersCount: "1", governorate: p?.governorate || "", city: p?.city || "", description: "", contactMethod: p?.contactMethod || "TELEGRAM", contactValue: p?.contactValue || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setDirty(true); };
  const input = (k: string, label: string, ph = "", mode?: "numeric") => <Field label={label}><input className={inputCls} style={inputStyle} value={f[k]} placeholder={ph} inputMode={mode} onChange={(e) => set(k, e.target.value)} /></Field>;
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await api("job_post", { job: f });
    setBusy(false);
    if (!r.ok) { setErr(r.error || ""); return; }
    setDirty(false);
    toast("✅ تم نشر الوظيفة، ويُشعَر الباحثون المطابقون.");
    onDone();
  };
  return (
    <>
      <Section title="الوظيفة">
        {input("title", "المسمى الوظيفي", "مثال: محاسب")}
        {input("keywords", "كلمات مفتاحية للبحث", "مثال: محاسبة، إكسل")}
        {input("workersCount", "عدد العمال المطلوب", "1", "numeric")}
        {input("governorate", "المحافظة")}
        {input("city", "المدينة")}
        <Field label="الوصف (اختياري)"><textarea className={inputCls} style={inputStyle} rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      </Section>
      <Section title="التواصل للتقديم">
        <div className="p-3"><Chips items={[{ id: "TELEGRAM", label: "✈️ تلجرام" }, { id: "WHATSAPP", label: "💬 واتساب" }]} value={f.contactMethod} onChange={(v) => set("contactMethod", v)} /></div>
        {input("contactValue", f.contactMethod === "WHATSAPP" ? "رقم واتساب" : "معرّف تلجرام")}
      </Section>
      {err && <p className="mb-2 px-1 text-sm font-bold" style={{ color: "var(--app-danger)" }}>{err}</p>}
      <MainAction text="📢 نشر الوظيفة" onClick={save} busy={busy} />
    </>
  );
}

export function JobScreen({ id }: { id: string }) {
  const { api, open } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api("job_get", { id }).then((r: any) => (r.ok ? setD(r.job) : setErr(r.error || ""))); }, [api, id]);
  if (err) return <Empty icon="💼" title={err} />;
  if (!d) return <Loading lines={4} />;
  return (
    <>
      <ScreenTitle icon="💼" title={d.title} sub={`${d.poster} · ${ago(d.at)}`} />
      <Section>
        <Row icon="📍" title={`${d.governorate}، ${d.city}`} />
        <Row icon="👥" title={`العدد المطلوب: ${d.workers}`} />
        {d.keywords && <Row icon="🏷" title={d.keywords} />}
      </Section>
      {d.description && <Section title="الوصف"><p className="whitespace-pre-wrap px-4 py-3 text-[14px] leading-6" style={{ color: "var(--app-text)" }}>{d.description}</p></Section>}
      {!d.mine && d.contact && <Btn className="w-full" onClick={() => open(d.contact)}>📩 تواصل للتقديم</Btn>}
      {d.posterId && <Report kind="posting" target={d.posterId} />}
    </>
  );
}

export function ProScreen({ id }: { id: string }) {
  const { api, open } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void api("pro_get", { id }).then((r: any) => (r.ok ? setD(r.pro) : setErr(r.error || ""))); }, [api, id]);
  if (err) return <Empty icon="🔨" title={err} />;
  if (!d) return <Loading lines={4} />;
  return (
    <>
      <ScreenTitle icon="🔨" title={d.name} sub={d.category} />
      <Section><Row icon="📍" title={`${d.governorate}، ${d.city}`} /></Section>
      {d.description && <Section title="عن أعماله"><p className="whitespace-pre-wrap px-4 py-3 text-[14px] leading-6" style={{ color: "var(--app-text)" }}>{d.description}</p></Section>}
      {d.contact && <Btn className="w-full" onClick={() => open(d.contact)}>📩 تواصل مباشر</Btn>}
      <Report kind="profile" target={d.id} />
    </>
  );
}

// ---------------------------------------------------------------- 🏷 tenders
const left = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "انتهت المدة";
  const h = Math.floor(ms / 3_600_000);
  return h >= 24 ? `متبقٍ ${Math.floor(h / 24)} يوم` : h >= 1 ? `متبقٍ ${h} ساعة` : `متبقٍ ${Math.max(1, Math.floor(ms / 60_000))} دقيقة`;
};

export function TendersScreen() {
  const { api, push, toast } = useApp();
  const { init } = useInit();
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<string>("mine");
  const load = useCallback(async () => { const r = await api("tn_home"); if (r.ok) setD(r); else { toast(r.error || "", "err"); setD({ mine: [], inbox: [], provider: false }); } }, [api, toast]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Loading lines={4} />;
  const openCount = d.mine.filter((t: any) => t.live).length;
  return (
    <>
      <ScreenTitle icon="🏷" title="اطلب وهم يتنافسون" sub="اكتب ما تحتاجه مرة واحدة، وتصلك عروض سرية من المختصين ثم تختار الأنسب." />
      <div className="mb-3"><Chips items={[{ id: "mine", label: `📋 طلباتي (${d.mine.length})` }, ...(d.provider ? [{ id: "inbox", label: `📥 طلبات تناسبني (${d.inbox.length})` }] : []), { id: "new", label: "➕ طلب جديد" }]} value={tab} onChange={setTab} /></div>
      {tab === "new" ? (
        openCount >= init.maxOpenTenders ? <Empty icon="⚠️" title={`لديك ${openCount} طلبات مفتوحة بالفعل`} sub={`الحد الأقصى ${init.maxOpenTenders}. أغلق طلباً أو انتظر انتهاءه.`} /> : <TenderForm onDone={async () => { await load(); setTab("mine"); }} />
      ) : tab === "mine" ? (
        d.mine.length === 0 ? <Empty icon="🏷" title="لا توجد طلبات بعد" action={<Btn onClick={() => setTab("new")}>➕ اطلب الآن</Btn>} /> : (
          <Section>{d.mine.map((t: any) => <Row key={t.id} icon={t.kind === "SERVICE" ? "🛠" : "📦"} title={t.category} sub={`${t.bids} عرض · ${t.live ? left(t.expiresAt) : t.status === "AWARDED" ? "✅ تم الاختيار" : "مغلق"}${t.budget != null ? ` · الميزانية ${money(t.budget)}` : ""}`} right={t.live ? <Pill tone="ok">مفتوح</Pill> : undefined} onClick={() => push({ name: "tender_bids", params: { id: t.id } })} />)}</Section>
        )
      ) : d.inbox.length === 0 ? <Empty icon="📥" title="لا توجد طلبات مفتوحة تناسب تخصصك الآن" sub="يصلك إشعار في المحادثة عند وصول طلب جديد." /> : (
        <Section>{d.inbox.map((t: any) => <Row key={t.id} icon={t.kind === "SERVICE" ? "🛠" : "📦"} title={t.category} sub={`📍 ${t.governorate || ""} ${t.city || ""} · ${left(t.expiresAt)}${t.budget != null ? ` · ${money(t.budget)}` : ""}`} right={t.myBid ? <Pill tone="info">عرضك {money(t.myBid.price)}</Pill> : <Pill tone="warn">قدّم عرضك</Pill>} onClick={() => push({ name: "tender_bid", params: { id: t.id } })} />)}</Section>
      )}
    </>
  );
}

function TenderForm({ onDone }: { onDone: () => void }) {
  const { api, toast, setDirty } = useApp();
  const { init } = useInit();
  const [f, setF] = useState<any>({ kind: "", category: "", details: "", budget: "", hours: "" });
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setDirty(true); };
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await api<{ sent: number }>("tn_create", { tender: { ...f, hours: Number(f.hours) } });
    setBusy(false);
    if (!r.ok) { setErr(r.error || ""); return; }
    setDirty(false);
    toast(r.sent ? `✅ تم نشر طلبك وإرساله إلى ${r.sent} مختص.` : "✅ تم نشر طلبك. سيظهر للمختصين المطابقين.");
    onDone();
  };
  return (
    <>
      <Section title="ماذا تحتاج؟">
        <div className="p-3"><Chips items={[{ id: "SERVICE", label: "🛠 خدمة (يصل للمهنيين)" }, { id: "PRODUCT", label: "📦 منتج (يصل للتجار)" }]} value={f.kind} onChange={(v) => { set("kind", v); set("category", ""); setOther(v === "PRODUCT"); }} /></div>
        {f.kind === "SERVICE" && <div className="px-3 pb-3"><Chips items={[...init.categories.map((c) => ({ id: c, label: c })), { id: "__other", label: "✏️ أخرى" }]} value={other ? "__other" : f.category} onChange={(v) => { if (v === "__other") { setOther(true); set("category", ""); } else { setOther(false); set("category", v); } }} /></div>}
        {f.kind && other && <Field label={f.kind === "PRODUCT" ? "اسم المنتج باختصار" : "اسم الخدمة"}><input className={inputCls} style={inputStyle} value={f.category} maxLength={60} onChange={(e) => set("category", e.target.value)} /></Field>}
        <Field label="التفاصيل (10–800 حرف)"><textarea className={inputCls} style={inputStyle} rows={4} value={f.details} maxLength={800} onChange={(e) => set("details", e.target.value)} placeholder="الكمية، المواصفات، الموعد، المكان…" /></Field>
        <Field label="الميزانية بالدولار (اختياري)"><input className={inputCls} style={inputStyle} inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} /></Field>
      </Section>
      <Section title="مدة استقبال العروض">
        <div className="p-3"><Chips items={init.durations.map((d) => ({ id: String(d.hours), label: d.label }))} value={f.hours} onChange={(v) => set("hours", v)} /></div>
      </Section>
      {err && <p className="mb-2 px-1 text-sm font-bold" style={{ color: "var(--app-danger)" }}>{err}</p>}
      <MainAction text="📢 انشر الطلب" onClick={save} busy={busy} />
    </>
  );
}

export function TenderBidsScreen({ id }: { id: string }) {
  const { api, toast, confirm, open } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await api("tn_bids", { id }); if (r.ok) setD(r); else setErr(r.error || ""); }, [api, id]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <Empty icon="🏷" title={err} />;
  if (!d) return <Loading lines={4} />;
  const t = d.tender;
  const award = async (b: any) => {
    if (!(await confirm(`اختيار عرض ${b.name} بسعر ${money(b.price)}؟ سيُبلَّغ الفائز ويُغلق الطلب.`))) return;
    const r = await api<{ contact: string | null; name: string }>("tn_award", { id: b.id });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    toast(`🏆 تم اختيار عرض ${r.name}.`);
    await load();
    if (r.contact) open(r.contact);
  };
  const close = async () => {
    if (!(await confirm("إغلاق الطلب دون اختيار عرض؟"))) return;
    const r = await api("tn_close", { id });
    if (!r.ok) toast(r.error || "", "err"); else { toast("🔒 تم إغلاق الطلب."); await load(); }
  };
  return (
    <>
      <ScreenTitle icon="🏷" title={t.category} sub={t.live ? left(t.expiresAt) : t.status === "AWARDED" ? "✅ تم اختيار عرض" : "مغلق"} />
      {d.bids.length === 0 ? <Empty icon="⏳" title="لم تصل عروض بعد" sub="يصلك إشعار في المحادثة مع كل عرض جديد." /> : (
        <Section title={`العروض (${d.bids.length}) — مرتبة من الأرخص`}>
          {d.bids.map((b: any, i: number) => (
            <div key={b.id} className="border-b p-3 last:border-0" style={{ borderColor: "color-mix(in srgb, var(--app-hint) 18%, transparent)" }}>
              <div className="flex items-center justify-between gap-2">
                <b style={{ color: "var(--app-text)" }}>{i === 0 ? "🥇 " : ""}{b.name} <span className="text-xs font-normal" style={{ color: "var(--app-hint)" }}>· {b.city}</span></b>
                <b style={{ color: "var(--app-accent)" }}>{money(b.price)}</b>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5" style={{ color: "var(--app-text)" }}>{b.note}</p>
              {t.budget != null && b.price > t.budget && <p className="mt-1 text-[11px]" style={{ color: "#b45309" }}>أعلى من ميزانيتك ({money(t.budget)})</p>}
              <div className="mt-2 flex gap-2">
                {b.status === "WON" ? <><Pill tone="ok">🏆 الفائز</Pill>{b.contact && <Btn small kind="soft" onClick={() => open(b.contact)}>📩 تواصل</Btn>}</> : t.live && <Btn small onClick={() => award(b)}>✅ اختر هذا العرض</Btn>}
              </div>
            </div>
          ))}
        </Section>
      )}
      {t.live && <Btn className="w-full" kind="ghost" onClick={close}>🔒 إغلاق الطلب دون اختيار</Btn>}
    </>
  );
}

export function TenderBidScreen({ id }: { id: string }) {
  const { api, toast, back } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api("tn_get", { id }).then((r: any) => {
      if (!r.ok) { setErr(r.error || ""); return; }
      setD(r);
      if (r.mine) { setPrice(String(r.mine.price)); setNote(r.mine.note || ""); }
    });
  }, [api, id]);
  if (err) return <Empty icon="🏷" title={err} />;
  if (!d) return <Loading lines={4} />;
  const t = d.tender;
  const send = async () => {
    setBusy(true);
    const r = await api<{ existed: boolean }>("tn_bid", { id, price, note });
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    toast(r.existed ? "✅ تم تحديث عرضك." : "✅ تم إرسال عرضك السري لصاحب الطلب.");
    back();
  };
  return (
    <>
      <ScreenTitle icon={t.kind === "SERVICE" ? "🛠" : "📦"} title={t.category} sub={left(t.expiresAt)} />
      <Section>
        <p className="whitespace-pre-wrap px-4 py-3 text-[14px] leading-6" style={{ color: "var(--app-text)" }}>{t.details}</p>
        {t.budget != null && <Row icon="💵" title={`الميزانية: ${money(t.budget)}`} />}
        {(t.governorate || t.city) && <Row icon="📍" title={`${t.governorate || ""} ${t.city || ""}`} />}
        <Row icon="👥" title={`عروض المنافسين حتى الآن: ${typeof d.competitors === "number" ? d.competitors : "—"}`} sub="العروض سرية: لا يرى أي مقدّم عرض أسعار الآخرين." />
      </Section>
      <Section title={d.mine ? "✏️ عدّل عرضك" : "💬 قدّم عرضك السري"}>
        <Field label="سعرك بالدولار"><input className={inputCls} style={inputStyle} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="وصف مختصر لعرضك (5–400 حرف)"><textarea className={inputCls} style={inputStyle} rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Section>
      <MainAction text={d.mine ? "💾 تحديث العرض" : "📨 إرسال العرض"} onClick={send} busy={busy} disabled={!price || note.trim().length < 5} />
    </>
  );
}
