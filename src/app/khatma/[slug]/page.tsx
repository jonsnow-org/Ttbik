import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { memorialPage } from "@/lib/khatma/khatma";
import { SITE_URL } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const k = await memorialPage((await params).slug).catch(() => null);
  return k ? { title: k.title, description: `${k.title}: شارك بقراءة جزء. ${k.dedication || ""}`.slice(0, 160), robots: { index: false } } : { title: "ختمة" };
}

export default async function MemorialKhatma({ params }: P) {
  const slug = (await params).slug;
  const k = await memorialPage(slug).catch(() => null);
  if (!k) notFound();
  const done = k.board.filter((j) => j.state === "done").length;
  const share = `${SITE_URL}/khatma/${slug}`;
  return (
    <main className="mx-auto max-w-xl px-4 py-10 text-center">
      <p className="text-4xl">🕊</p>
      <h1 className="mt-2 text-2xl font-extrabold">{k.title}</h1>
      {k.dedication && <p className="mt-3 text-sm leading-7 text-slate-700">🤲 {k.dedication}</p>}
      <p className="mt-4 text-sm font-bold text-emerald-700">ختمات مكتملة: {k.completedRounds} · أجزاء مقروءة: {k.juzRead}</p>
      <p className="mt-1 text-xs text-slate-500">الختمة الحالية رقم {k.round}: {done} من 30 جزءاً</p>
      <div className="mx-auto mt-4 grid max-w-xs grid-cols-6 gap-1" aria-label="أجزاء الختمة الحالية">
        {k.board.map((j) => <span key={j.juz} title={`الجزء ${j.juz}`} className={`rounded py-1 text-xs ${j.state === "done" ? "bg-emerald-500 text-white" : j.state === "taken" ? "bg-amber-200" : "bg-slate-100"}`}>{j.juz}</span>)}
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {k.joinUrl && <a className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white" href={k.joinUrl}>📖 شارك بقراءة جزء</a>}
        <a className="rounded-xl border px-4 py-2 text-sm font-bold" href={`https://t.me/share/url?url=${encodeURIComponent(share)}&text=${encodeURIComponent(`شاركنا بجزء في ${k.title}`)}`} target="_blank" rel="noopener noreferrer">📤 أرسل الصفحة</a>
      </div>
      {k.sponsor && <p className="mt-6 text-xs text-slate-500">🌙 {k.sponsor}</p>}
      <p className="mt-8 text-xs text-slate-400"><a className="underline" href="/khatma">ختمة جماعية لمجموعتك مجاناً</a></p>
    </main>
  );
}
