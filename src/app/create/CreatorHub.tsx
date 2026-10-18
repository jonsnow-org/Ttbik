"use client";
import { useEffect, useState } from "react";

type Resp = { ok: boolean; error?: string; [k: string]: any };
async function call(action: string, data: Record<string, unknown> = {}): Promise<Resp> {
  try {
    const r = await fetch("/api/hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...data }) });
    return await r.json();
  } catch {
    return { ok: false, error: "تعذر الاتصال" };
  }
}

const TABS = [
  { id: "apps", label: "🧱 صانع التطبيقات" },
  { id: "legal", label: "⚖️ المساعد القانوني" },
  { id: "mind", label: "💛 الدعم النفسي" },
  { id: "dialect", label: "🗣️ مترجم اللهجات" },
  { id: "repurpose", label: "♻️ محوّل المحتوى" },
  { id: "points", label: "🏆 نقاطي" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const COUNTRIES: [string, string][] = [
  ["SA", "السعودية"], ["AE", "الإمارات"], ["EG", "مصر"], ["JO", "الأردن"], ["SY", "سوريا"], ["LB", "لبنان"], ["IQ", "العراق"], ["KW", "الكويت"],
  ["QA", "قطر"], ["BH", "البحرين"], ["OM", "عُمان"], ["PS", "فلسطين"], ["MA", "المغرب"], ["DZ", "الجزائر"], ["TN", "تونس"], ["TR", "تركيا"],
];
const box = "w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none";
const btn = "rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

function Out({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-3">
      <textarea readOnly={false} defaultValue={text} key={text} rows={Math.min(22, text.split("\n").length + 2)} className={box + " whitespace-pre-wrap leading-7"} />
      <button className="mt-1 text-xs text-indigo-700 underline" onClick={() => navigator.clipboard?.writeText(text)}>نسخ</button>
    </div>
  );
}

export default function CreatorHub() {
  const [tab, setTab] = useState<Tab>("apps");
  const [state, setState] = useState<Resp | null>(null);
  const refresh = () => call("state").then(setState);
  useEffect(() => { refresh(); }, []);
  const p = state?.profile;
  return (
    <div>
      {p && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-l from-indigo-600 to-violet-600 p-4 text-white">
          <div className="text-2xl font-extrabold">{p.balance} نقطة</div>
          <div className="text-sm opacity-90">المستوى {p.level.level}: {p.level.name}{p.level.next ? ` · ${p.level.progress}% للمستوى التالي` : ""}</div>
          <div className="text-sm">{(p.badges || []).join(" ")}</div>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-full px-3 py-1.5 text-sm font-bold ${tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "apps" && <Apps apps={state?.apps || []} onChange={refresh} />}
      {tab === "legal" && <Legal onDone={refresh} />}
      {tab === "mind" && <Mind onDone={refresh} />}
      {tab === "dialect" && <Dialect onDone={refresh} />}
      {tab === "repurpose" && <Repurpose onDone={refresh} />}
      {tab === "points" && <Points state={state} onChange={refresh} />}
      <p className="mt-6 text-xs text-slate-500">
        الحد المجاني: 25 طلب ذكاء اصطناعي يومياً لكل زائر، 3 تطبيقات لكل مستخدم، 30 عنصراً لكل تطبيق. الأدوات متاحة أيضاً كبوتات تيليجرام من صفحة <a href="/bots" className="underline">/bots</a>.
      </p>
    </div>
  );
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  const [error, setError] = useState("");
  const run = async (action: string, data: Record<string, unknown>, pick: (r: Resp) => string = (r) => r.result) => {
    setBusy(true); setError("");
    const r = await call(action, data);
    setBusy(false);
    if (!r.ok) setError(r.error || "خطأ"); else setOut(pick(r));
    return r;
  };
  return { busy, out, error, run, setOut };
}

const GALLERY = [
  { t: "store", l: "🛒 متجر عطور", d: "متجر عطور اسمه ريحان باللون الذهبي، عطر عود بسعر 30$ ومسك بسعر 15$ وعنبر بسعر 20$" },
  { t: "menu", l: "🍽️ منيو مقهى", d: "قائمة مقهى اسمه ياسمين الشام باللون الأخضر: قهوة عربية 2$، شاي 1$، فطور شامي 6$، كنافة 4$" },
  { t: "booking", l: "📅 صالون", d: "حجز مواعيد صالون حلاقة اسمه الأناقة: قص شعر 8$، حلاقة ذقن 5$، باقة العريس 40$" },
  { t: "portfolio", l: "🎨 مصمم", d: "معرض أعمال مصمم جرافيك اسمه استوديو نور: هويات بصرية، شعارات، تصاميم سوشيال ميديا" },
  { t: "links", l: "🔗 روابطي", d: "صفحة روابط اسمها روابطي: قناتي https://t.me/ttbik5 وموقعي https://ttbik.vercel.app" },
  { t: "quiz", l: "❓ اختبار", d: "اختبار عن عواصم الدول العربية اسمه تحدي العواصم، 5 أسئلة" },
];

function Apps({ apps, onChange }: { apps: any[]; onChange: () => void }) {
  const [desc, setDesc] = useState("");
  const [tpl, setTpl] = useState("");
  const [contact, setContact] = useState("");
  const [created, setCreated] = useState<{ slug: string; editKey: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const { busy, error, run } = useRun();
  const site = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="font-extrabold">صف تطبيقك بالكلام</h2>
        <p className="mt-1 text-xs text-slate-500">مثال: «متجر عطور اسمه ريحان باللون الذهبي، عطر عود بسعر 30$ ومسك بسعر 15$». يُنشأ تطبيق ويب يفتح داخل تيليجرام كتطبيق مصغّر ويمكن تثبيته على الشاشة الرئيسية (ليس تطبيقاً لمتجر Google/Apple).</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {GALLERY.map((g) => (
            <button key={g.t} className="rounded-full bg-slate-100 px-3 py-1 text-xs" onClick={() => { setDesc(g.d); setTpl(g.t); }}>{g.l}</button>
          ))}
        </div>
        <textarea className={box + " mt-2"} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1500} />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <select className={box} value={tpl} onChange={(e) => setTpl(e.target.value)}>
            <option value="">القالب: تلقائي من الوصف</option>
            <option value="store">🛒 متجر</option><option value="booking">📅 حجز مواعيد</option><option value="menu">🍽️ قائمة مطعم</option>
            <option value="portfolio">🎨 معرض أعمال</option><option value="links">🔗 صفحة روابط</option><option value="quiz">❓ اختبار</option>
          </select>
          <input className={box} placeholder="التواصل للطلب/الحجز: @معرف أو رقم واتساب" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <button className={btn + " mt-3"} disabled={busy} onClick={async () => {
          const r = await run("app_create", { text: desc, template: tpl, contact }, () => "");
          if (r.ok) { setCreated({ slug: r.slug, editKey: r.editKey }); onChange(); }
        }}>{busy ? "يبني…" : "اصنع التطبيق"}</button>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        {created && (
          <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm">
            ✅ تطبيقك جاهز: <a className="font-bold underline" href={`/apps/${created.slug}`} target="_blank">{site}/apps/{created.slug}</a>
            <div className="mt-1">🔑 مفتاح التعديل (احفظه، لا يظهر مرة أخرى): <code className="select-all">{created.editKey}</code></div>
            <a className="mt-1 inline-block font-bold text-sky-700 underline" target="_blank" rel="noopener noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(`${site}/apps/${created.slug}`)}&text=${encodeURIComponent("جرّب تطبيقي الجديد 👇")}`}>📤 شارك على تيليجرام</a>
            <div className="mt-1 text-xs text-slate-600">لربطه بزر في بوتك: BotFather ← Bot Settings ← Menu Button ← الصق الرابط.</div>
          </div>
        )}
      </div>
      {apps.map((a) => (
        <div key={a.slug} className={card}>
          <div className="flex items-center justify-between">
            <a href={`/apps/${a.slug}`} target="_blank" className="font-bold underline">{a.config.title}</a>
            <span className="text-xs text-slate-500">{a.views} مشاهدة · {a.config.items.length} عنصر</span>
          </div>
          <div className="mt-2 flex gap-2">
            <input className={box} placeholder="عدّل بالكلام: «أضف قهوة بسعر 3$» أو «اللون أخضر»" value={edit[a.slug] || ""} onChange={(e) => setEdit({ ...edit, [a.slug]: e.target.value })} />
            <button className={btn} disabled={busy} onClick={async () => { const r = await run("app_edit", { slug: a.slug, text: edit[a.slug] }, () => ""); if (r.ok) { setEdit({ ...edit, [a.slug]: "" }); onChange(); } }}>تحديث</button>
          </div>
          <button className="mt-2 text-xs text-rose-600 underline" onClick={async () => { if (confirm("حذف التطبيق نهائياً؟")) { await run("app_delete", { slug: a.slug }, () => ""); onChange(); } }}>حذف</button>
        </div>
      ))}
    </div>
  );
}

const DOCS: Record<string, { label: string; fields: string[] }> = {
  complaint: { label: "خطاب شكوى", fields: ["اسمك", "الجهة المشتكى إليها", "المشتكى عليه", "موضوع الشكوى", "الطلب"] },
  rental: { label: "عقد إيجار سكني", fields: ["المؤجر", "المستأجر", "العقار", "الأجرة الشهرية", "المدة", "تاريخ البداية"] },
  employment: { label: "عقد عمل", fields: ["صاحب العمل", "الموظف", "المسمى الوظيفي", "الراتب", "تاريخ البداية", "مدة التجربة"] },
  nda: { label: "اتفاقية عدم إفصاح", fields: ["الطرف المفصح", "الطرف المتلقي", "الغرض", "المدة بالسنوات"] },
};
function Legal({ onDone }: { onDone: () => void }) {
  const [country, setCountry] = useState("SA");
  const [facts, setFacts] = useState("");
  const [kind, setKind] = useState("complaint");
  const [vals, setVals] = useState<Record<string, string>>({});
  const a = useRun();
  const d = useRun();
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">⚖️ معلومات قانونية عامة وليست استشارة قانونية. لأي قضية فعلية راجع محامياً مرخّصاً. لا نساعد في التزوير أو إخفاء الأدلة أو التهرب من القضاء.</div>
      <select className={box} value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      <div className={card}>
        <h2 className="font-extrabold">اعرض وقائع مشكلتك</h2>
        <textarea className={box + " mt-2"} rows={4} placeholder="من؟ ماذا حدث؟ متى؟ ما المستندات لديك؟" value={facts} onChange={(e) => setFacts(e.target.value)} />
        <button className={btn + " mt-2"} disabled={a.busy} onClick={async () => { await a.run("legal_analyze", { text: facts, country }); onDone(); }}>{a.busy ? "يحلل…" : "حلّل"}</button>
        {a.error && <p className="mt-2 text-sm text-rose-600">{a.error}</p>}
        <Out text={a.out} />
      </div>
      <div className={card}>
        <h2 className="font-extrabold">صياغة مستند قابل للتعديل</h2>
        <select className={box + " mt-2"} value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(DOCS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {DOCS[kind].fields.map((f) => <input key={kind + f} className={box} placeholder={f} value={vals[f] || ""} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} />)}
        </div>
        <button className={btn + " mt-2"} disabled={d.busy} onClick={async () => { await d.run("legal_draft", { kind, values: vals, country }); onDone(); }}>أنشئ المسودة</button>
        {d.error && <p className="mt-2 text-sm text-rose-600">{d.error}</p>}
        <Out text={d.out} />
      </div>
    </div>
  );
}

function Mind({ onDone }: { onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const [crisis, setCrisis] = useState(false);
  const [hist, setHist] = useState<{ score: number; created_at: string }[]>([]);
  const c = useRun();
  const tip = useRun();
  useEffect(() => { call("mood_history").then((r) => r.ok && setHist(r.history)); }, []);
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">💛 دعم أولي فقط: لا تشخيص ولا أدوية. إن كنت في خطر اتصل بالطوارئ فوراً. محادثتك لا تُحفظ.</div>
      <div className={card}>
        <h2 className="font-extrabold">كيف تشعر الآن؟</h2>
        <textarea className={box + " mt-2"} rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={1200} />
        <button className={btn + " mt-2"} disabled={c.busy} onClick={async () => { const r = await c.run("mind_chat", { text: msg }); setCrisis(!!r.crisis); }}>{c.busy ? "…" : "أرسل"}</button>
        {c.error && <p className="mt-2 text-sm text-rose-600">{c.error}</p>}
        {c.out && <div className={`mt-3 whitespace-pre-wrap rounded-xl p-3 text-sm leading-7 ${crisis ? "bg-rose-50 text-rose-900 ring-2 ring-rose-400" : "bg-slate-50"}`}>{c.out}</div>}
      </div>
      <div className={card}>
        <h2 className="font-extrabold">تمارين ومعلومات</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {[["breathing", "تنفّس 4-7-8"], ["box", "التنفس المربّع"], ["grounding", "تثبيت 5-4-3-2-1"], ["muscle", "استرخاء عضلي"], ["anxiety", "عن القلق"], ["sadness", "عن الحزن"], ["stress", "عن الضغط"], ["sleep", "عن النوم"]].map(([k, l]) => (
            <button key={k} className="rounded-full bg-slate-100 px-3 py-1 text-sm" onClick={() => tip.run("mind_tip", { key: k })}>{l}</button>
          ))}
        </div>
        {tip.out && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-emerald-50 p-3 text-sm leading-7">{tip.out}</div>}
      </div>
      <div className={card}>
        <h2 className="font-extrabold">متتبع المزاج</h2>
        <div className="mt-2 flex gap-2 text-2xl">
          {["😞", "🙁", "😐", "🙂", "😄"].map((e, i) => (
            <button key={i} onClick={async () => { const r = await call("mood_log", { score: i + 1 }); if (r.ok) { setHist(r.history); onDone(); } }}>{e}</button>
          ))}
        </div>
        <div className="mt-3 flex h-16 items-end gap-1">
          {hist.map((h, i) => <div key={i} title={new Date(h.created_at).toLocaleDateString("ar")} className="w-3 rounded-t bg-indigo-400" style={{ height: `${h.score * 20}%` }} />)}
        </div>
        <button className="mt-3 text-xs text-rose-600 underline" onClick={async () => { const r = await call("forget"); if (r.ok) { setHist([]); alert(r.result); } }}>انسَ معلوماتي (حذف سجل المزاج)</button>
      </div>
    </div>
  );
}

function Dialect({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [from, setFrom] = useState("msa");
  const [to, setTo] = useState("egyptian");
  const r = useRun();
  const opts = [["msa", "الفصحى"], ["egyptian", "المصرية"], ["levantine", "الشامية"], ["gulf", "الخليجية"], ["maghrebi", "المغاربية"]];
  return (
    <div className={card}>
      <div className="grid grid-cols-2 gap-2">
        <select className={box} value={from} onChange={(e) => setFrom(e.target.value)}>{opts.map(([k, l]) => <option key={k} value={k}>من: {l}</option>)}</select>
        <select className={box} value={to} onChange={(e) => setTo(e.target.value)}>{opts.map(([k, l]) => <option key={k} value={k}>إلى: {l}</option>)}</select>
      </div>
      <textarea className={box + " mt-2"} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} />
      <button className={btn + " mt-2"} disabled={r.busy} onClick={async () => { await r.run("dialect", { text, from, to }); onDone(); }}>{r.busy ? "يترجم…" : "حوّل"}</button>
      {r.error && <p className="mt-2 text-sm text-rose-600">{r.error}</p>}
      <Out text={r.out} />
    </div>
  );
}

function Repurpose({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState("posts");
  const r = useRun();
  return (
    <div className={card}>
      <select className={box} value={format} onChange={(e) => setFormat(e.target.value)}>
        <option value="posts">منشورات تواصل</option><option value="thread">سلسلة تغريدات</option><option value="video">سكربت فيديو قصير</option><option value="newsletter">فقرة نشرة بريدية</option>
      </select>
      <textarea className={box + " mt-2"} rows={6} placeholder="ألصق المقال هنا" value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} />
      <button className={btn + " mt-2"} disabled={r.busy} onClick={async () => { await r.run("repurpose", { text, format }); onDone(); }}>{r.busy ? "يحوّل…" : "حوّل المحتوى"}</button>
      {r.error && <p className="mt-2 text-sm text-rose-600">{r.error}</p>}
      <Out text={r.out} />
    </div>
  );
}

function Points({ state, onChange }: { state: Resp | null; onChange: () => void }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="font-extrabold">كيف تكسب النقاط</h2>
        <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
          <li>هدية ترحيب 20 نقطة · زيارة يومية 5 · استخدام أداة 2 · مستند قانوني 3 · تسجيل مزاج 3 · تطبيق جديد 10 · تحديث تطبيق 1</li>
          <li>حد أقصى 60 نقطة يومياً.</li>
          <li>استبدل 10 نقاط برصيد سؤال في «بشر» (الدردشة مع إنسان).</li>
        </ul>
        <button className={btn + " mt-3"} onClick={async () => { const r = await call("redeem_bashar"); setMsg(r.ok ? "✅ أُضيف رصيد سؤال في «بشر»" : r.error || ""); onChange(); }}>استبدل 10 نقاط برصيد «بشر»</button>
        {msg && <p className="mt-2 text-sm">{msg} {msg.startsWith("✅") && <a href="/bashar" className="underline">افتح بشر</a>}</p>}
      </div>
      <div className={card}>
        <h2 className="font-extrabold">لوحة الصدارة</h2>
        <div className="mt-2 flex gap-2">
          <input className={box} placeholder="اسمك في اللوحة" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
          <button className={btn} onClick={async () => { await call("set_name", { name }); onChange(); }}>حفظ</button>
        </div>
        <ol className="mt-3 space-y-1 text-sm">
          {(state?.board || []).map((b: any) => <li key={b.rank} className="flex justify-between"><span>{b.rank}. {b.name} · {b.level}</span><b>{b.total}</b></li>)}
        </ol>
      </div>
    </div>
  );
}
