"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// 📖 الختمة الجماعية inside the chains bot's Mini App: the same boards as the groups and the memorial khatmas (take a juz, mark it
// read, undo; 30 juz complete a khatma and the next one starts), plus a memorial khatma ordered with Stars like in the chat.
import React, { useCallback, useEffect, useState } from "react";
import { Btn, Chips, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, inputCls, inputStyle, useApp, useInnerBack, useInterval } from "./ui";

type Mine = { id: string; kind: string; title: string; round: number; completedRounds: number; slug: string | null; done: number; taken: number; myJuz: { juz: number; done: boolean }[] };
type Home = { mine: Mine[]; open: { slug: string; title: string; completedRounds: number; round: number }[]; bot: string; maxOpen: number; juzCount: number; tiers: { id: string; stars: number; label: string }[]; intents: { id: string; label: string }[] };
type Cell = { juz: number; state: "free" | "taken" | "done"; mine: boolean; by: string | null };
type Board = { id: string; kind: string; title: string; dedication: string | null; round: number; completedRounds: number; slug: string | null; board: Cell[]; sponsor: string | null };
type View = { v: "home" } | { v: "board"; id?: string; slug?: string } | { v: "memorial" };
const AR = "٠١٢٣٤٥٦٧٨٩";
const ar = (n: number) => String(n).replace(/[0-9]/g, (d) => AR[Number(d)]);
const TEAL = "#0f766e";

export default function KhatmaSection({ startK }: { startK: string | null }) {
  const { api } = useApp();
  const [home, setHome] = useState<Home | null>(null);
  const [view, setView] = useState<View>(startK ? (/^\d+$/.test(startK) ? { v: "board", id: startK } : { v: "board", slug: startK }) : { v: "home" });
  const load = useCallback(async () => { const r = await api<Home>("kh_home"); if (r.ok) setHome(r); }, [api]);
  useEffect(() => { void load(); }, [load]);
  useInnerBack(view.v !== "home", () => { setView({ v: "home" }); void load(); });

  if (view.v === "board") return <BoardView id={view.id} slug={view.slug} />;
  if (!home) return <><ScreenTitle icon="📖" title="الختمة الجماعية" /><Loading /></>;
  if (view.v === "memorial") return <Memorial home={home} onDone={() => { setView({ v: "home" }); void load(); }} />;
  return <KhatmaHome home={home} onOpen={(id, slug) => setView({ v: "board", id, slug })} onMemorial={() => setView({ v: "memorial" })} />;
}

function Progress({ done, taken, total }: { done: number; taken: number; total: number }) {
  return (
    <div className="flex h-2 overflow-hidden rounded-full" style={{ background: "var(--app-chip)" }}>
      <div style={{ width: `${(done / total) * 100}%`, background: TEAL }} />
      <div style={{ width: `${((taken - done) / total) * 100}%`, background: "#f59e0b" }} />
    </div>
  );
}

function KhatmaHome({ home, onOpen, onMemorial }: { home: Home; onOpen: (id?: string, slug?: string) => void; onMemorial: () => void }) {
  const { open } = useApp();
  return (
    <>
      <div className="mb-4 overflow-hidden rounded-3xl p-5" style={{ background: `linear-gradient(135deg,${TEAL},#134e4a)`, color: "#fff" }}>
        <div className="text-[13px] font-bold opacity-85">📖 الختمة الجماعية</div>
        <div className="mt-1 text-[21px] font-black leading-snug">اختموا القرآن معاً</div>
        <p className="mt-1 text-[12.5px] leading-5 opacity-90">كل مشارك يأخذ جزءاً ويسجّله حين ينتهي. عند اكتمال {ar(home.juzCount)} جزءاً تصل رسالة الختم والدعاء، وتبدأ الختمة التالية.</p>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => open(`https://t.me/${home.bot}?startgroup=khatma`)} className="rounded-2xl p-4 text-start active:scale-[0.98]" style={{ background: TEAL, color: "#fff" }}>
          <div className="text-2xl">👥</div><div className="mt-1 text-[15px] font-extrabold">ختمة لمجموعتك</div><div className="text-[11px] opacity-85">أضف البوت لمجموعة العائلة أو المسجد. مجاناً</div>
        </button>
        <button type="button" onClick={onMemorial} className="rounded-2xl p-4 text-start active:scale-[0.98]" style={{ background: "var(--app-card)" }}>
          <div className="text-2xl">🕊</div><div className="mt-1 text-[15px] font-extrabold">ختمة صدقة جارية</div><div className="text-[11px]" style={{ color: "var(--app-hint)" }}>باسم من تحب، لا تتوقف</div>
        </button>
      </div>
      <Section title="ختماتي">
        {home.mine.length === 0 ? <Empty icon="📖" title="لم تشارك في ختمة بعد" sub="خذ جزءاً من لوحة ختمة في مجموعتك أو من الختمات المفتوحة بالأسفل." /> : home.mine.map((k) => {
          const openJuz = k.myJuz.filter((j) => !j.done).map((j) => ar(j.juz));
          return (
            <button key={k.id} type="button" onClick={() => onOpen(k.id)} className="block w-full border-b px-4 py-3 text-start last:border-b-0" style={{ borderColor: "var(--app-sep)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[15px] font-bold">{k.kind === "MEMORIAL" ? "🕊 " : "👥 "}{k.title}</span>
                <span className="shrink-0 text-xs font-bold" style={{ color: TEAL }}>{ar(k.done)}/{ar(home.juzCount)}</span>
              </div>
              <div className="mt-2"><Progress done={k.done} taken={k.taken} total={home.juzCount} /></div>
              <div className="mt-1.5 text-[11.5px]" style={{ color: "var(--app-hint)" }}>
                {openJuz.length ? `معك: الجزء ${openJuz.join("، ")}` : "لا جزء مفتوح معك الآن"} · الختمة {ar(k.round)}{k.completedRounds ? ` · ختمات مكتملة ${ar(k.completedRounds)}` : ""}
              </div>
            </button>
          );
        })}
      </Section>
      {home.open.length > 0 && (
        <Section title="ختمات صدقة جارية مفتوحة للجميع" hint="شارك بجزء في ختمة يُهدى ثوابها لصاحبها.">
          {home.open.map((m) => <Row key={m.slug} icon="🕊" title={m.title} sub={`الختمة ${ar(m.round)}${m.completedRounds ? ` · اكتملت ${ar(m.completedRounds)}` : ""}`} onClick={() => onOpen(undefined, m.slug)} />)}
        </Section>
      )}
      <Section title="في مجموعتك">
        <Row icon="➕" title="أضف البوت للمجموعة" sub="تظهر لوحة الختمة فيها تلقائياً." onClick={() => open(`https://t.me/${home.bot}?startgroup=khatma`)} />
        <Row icon="⌨️" title={`/khatma@${home.bot} ختمة رمضان`} sub="لعرض اللوحة لاحقاً أو بعنوان خاص." />
      </Section>
    </>
  );
}

function BoardView({ id, slug }: { id?: string; slug?: string }) {
  const { api, toast, open, haptic } = useApp();
  const [b, setB] = useState<Board | null | false>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ khatma: Board; joinUrl: string | null }>("kh_board", { id, slug });
    if (!r.ok) { setB(false); return; }
    setB(r.khatma);
    setJoinUrl(r.joinUrl);
  }, [api, id, slug]);
  useEffect(() => { void load(); }, [load]);
  useInterval(() => { void load(); }, 15_000);
  if (b === null) return <Loading lines={4} />;
  if (b === false) return <Section><Empty icon="📕" title="هذه الختمة غير متاحة" /></Section>;
  const tapJuz = async (c: Cell) => {
    if (c.state !== "free" && !c.mine) { toast(`الجزء ${ar(c.juz)} مع ${c.by || "مشارك"}`, "err"); return; }
    setBusy(c.juz);
    const r = await api<{ message: string; completed: boolean }>("kh_tap", { id: b.id, round: b.round, juz: c.juz });
    setBusy(null);
    if (r.ok) { haptic("success"); toast(r.completed ? "🎉 اكتملت الختمة! تقبّل الله منا ومنكم" : r.message); }
    else toast(r.error || "", "err");
    void load();
  };
  const done = b.board.filter((c) => c.state === "done").length;
  const taken = b.board.filter((c) => c.state !== "free").length;
  const mine = b.board.filter((c) => c.mine);
  return (
    <>
      <ScreenTitle icon={b.kind === "MEMORIAL" ? "🕊" : "👥"} title={b.title} sub={`الختمة ${ar(b.round)}${b.completedRounds ? ` · ختمات مكتملة ${ar(b.completedRounds)}` : ""}`} />
      {b.dedication && <p className="-mt-2 mb-3 px-1 text-[13px] leading-6" style={{ color: "var(--app-hint)" }}>«{b.dedication}»</p>}
      <div className="mb-3 rounded-2xl p-4" style={{ background: "var(--app-card)" }}>
        <div className="flex items-center justify-between text-sm font-bold"><span>قُرئ {ar(done)} من ٣٠</span><span style={{ color: "var(--app-hint)" }}>متاح {ar(30 - taken)}</span></div>
        <div className="mt-2"><Progress done={done} taken={taken} total={30} /></div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-bold" style={{ color: "var(--app-hint)" }}>
          <span>⬜ متاح</span><span style={{ color: "#b45309" }}>📖 قيد القراءة</span><span style={{ color: TEAL }}>✅ مقروء</span><span style={{ color: "var(--app-link)" }}>▢ أجزائي</span>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-5 gap-2">
        {b.board.map((c) => {
          const bg = c.state === "done" ? TEAL : c.state === "taken" ? "#fef3c7" : "var(--app-card)";
          const fg = c.state === "done" ? "#fff" : c.state === "taken" ? "#92400e" : "var(--app-text)";
          return (
            <button key={c.juz} type="button" onClick={() => tapJuz(c)} disabled={busy !== null}
              className="relative aspect-square rounded-xl text-[17px] font-black transition active:scale-95 disabled:opacity-60"
              style={{ background: bg, color: fg, outline: c.mine ? "2.5px solid var(--app-link)" : undefined, outlineOffset: -2 }}>
              {busy === c.juz ? "…" : ar(c.juz)}
              {c.state === "done" && <span className="absolute left-1 top-0.5 text-[9px]">✓</span>}
            </button>
          );
        })}
      </div>
      <p className="mb-3 px-1 text-[11.5px] leading-5" style={{ color: "var(--app-hint)" }}>اضغط رقماً متاحاً لتأخذه، واضغطه مرة أخرى حين تنتهي من قراءته. معك حتى ٣ أجزاء مفتوحة في وقت واحد.{b.kind === "GROUP" ? " هذه لوحة مجموعة: تتحدث رسالة اللوحة في المجموعة أيضاً." : ""}</p>
      {mine.length > 0 && (
        <Section title="أجزائي">
          {mine.map((c) => <Row key={c.juz} icon={c.state === "done" ? "✅" : "📖"} title={`الجزء ${ar(c.juz)}`} sub={c.state === "done" ? "مقروء، تقبّل الله" : "قيد القراءة: اضغطه حين تنتهي"} right={<Btn small kind={c.state === "done" ? "ghost" : "primary"} onClick={() => tapJuz(c)}>{c.state === "done" ? "تراجع" : "أنهيته ✅"}</Btn>} />)}
        </Section>
      )}
      {b.sponsor && <p className="mb-3 px-1 text-[11px]" style={{ color: "var(--app-hint)" }}>{b.sponsor}</p>}
      {joinUrl && <Btn className="w-full" onClick={() => open(`https://t.me/share/url?url=${encodeURIComponent(joinUrl)}&text=${encodeURIComponent(`شاركنا بجزء في ${b.title}`)}`)}>📤 ادعُ الأهل والأصدقاء للمشاركة</Btn>}
    </>
  );
}

function Memorial({ home, onDone }: { home: Home; onDone: () => void }) {
  const { api, toast, tg, open, setDirty } = useApp();
  const [f, setF] = useState({ name: "", intent: home.intents[0]?.id || "ruh", dedication: "", tier: home.tiers[0]?.id || "basic" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };
  const tier = home.tiers.find((t) => t.id === f.tier);
  const submit = async () => {
    setBusy(true);
    const r = await api<{ link: string }>("kh_memorial", f);
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    const paid = () => { setDirty(false); toast("✅ تقبّل الله. تُفتح الختمة الآن ويصلك رابطها في البوت."); window.setTimeout(onDone, 2500); };
    if (tg?.openInvoice) tg.openInvoice(r.link, (status: string) => { if (status === "paid") paid(); });
    else open(r.link);
  };
  const intentLabel = home.intents.find((i) => i.id === f.intent)?.label || "";
  return (
    <>
      <ScreenTitle icon="🕊" title="ختمة صدقة جارية" sub="ختمة لا تتوقف: كلما اكتملت ٣٠ جزءاً بدأت التالية، ولها رابط ترسله للأهل والأصدقاء ليشاركوا بالقراءة." />
      <Section>
        <Field label="الاسم الذي تُهدى له الختمة"><input className={inputCls} style={inputStyle} maxLength={60} placeholder="مثال: والدي محمد" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
      </Section>
      <Section title="النية"><div className="p-3"><Chips items={home.intents} value={f.intent} onChange={(v) => set("intent", v)} /></div></Section>
      <Section>
        <Field label="دعاء أو كلمة (اختياري)" hint="تظهر في رسالة الختم.">
          <textarea rows={3} maxLength={300} className={`${inputCls} resize-none`} style={inputStyle} placeholder="اللهم اغفر له وارحمه…" value={f.dedication} onChange={(e) => set("dedication", e.target.value)} />
        </Field>
      </Section>
      <Section title="الباقة (تُدفع مرة واحدة بنجوم تيليجرام)">
        {home.tiers.map((t) => (
          <button key={t.id} type="button" onClick={() => set("tier", t.id)} className="flex w-full items-center gap-3 border-b px-4 py-3 text-start last:border-b-0" style={{ borderColor: "var(--app-sep)" }}>
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: f.tier === t.id ? TEAL : "var(--app-hint)" }}>{f.tier === t.id && <span className="h-2.5 w-2.5 rounded-full" style={{ background: TEAL }} />}</span>
            <span className="min-w-0 flex-1 text-[13.5px] leading-5">{t.label}</span>
            <Pill tone="warn">{t.stars} ⭐</Pill>
          </button>
        ))}
      </Section>
      {f.name.trim().length >= 2 && <p className="mb-2 px-1 text-xs" style={{ color: "var(--app-hint)" }}>{intentLabel} · «{f.name.trim()}»</p>}
      <MainAction text={`ادفع ${tier?.stars || ""} ⭐ وافتح الختمة`} onClick={submit} disabled={f.name.trim().length < 2} busy={busy} color={TEAL} />
    </>
  );
}
