import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import BasharBubble from "@/components/bashar/BasharBubble";
import { cookies } from "next/headers";
import { isOwnerServer } from "@/lib/isOwner";
import { SITE_URL } from "@/lib/siteUrl";
import { answersFor, countryLabel, getQuestion } from "@/lib/bashar";

export const dynamic = "force-dynamic";

async function load(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  try {
    const q = await getQuestion(id);
    if (!q || q.hidden) return null;
    return { q, answers: await answersFor(q.id, 30) };
  } catch {
    return null;
  }
}

// Shared link preview (WhatsApp/Telegram show this title). User-written
// content, so it stays out of search indexes.
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const d = await load(params.id);
  if (!d) return { title: "بَشَر", robots: { index: false } };
  const title = `«${d.q.body.slice(0, 80)}» — أجبني خلال 75 ثانية`;
  const n = d.answers.length;
  const description = `سؤال من إنسان حقيقي على «بَشَر» — ${n === 0 ? "كن أول من يجيب" : `${n} ${n <= 10 ? "إجابات" : "إجابة"} حتى الآن`}. افتح وأجب خلال 75 ثانية.`;
  return {
    title,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/bashar/q/${d.q.id}` },
    openGraph: { title, description, url: `${SITE_URL}/bashar/q/${d.q.id}`, locale: "ar_AR", type: "article", images: [{ url: `${SITE_URL}/bashar-og.jpg`, width: 1200, height: 630, alt: "بَشَر — سؤال من إنسان حقيقي" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${SITE_URL}/bashar-og.jpg`] },
  };
}

export default async function BasharQuestionPage({ params }: { params: { id: string } }) {
  const d = await load(params.id);
  if (!d) notFound();
  const { q, answers } = d;
  const mine = cookies().get("bashar_id")?.value === q.asker;
  return (
    <main className="mx-auto max-w-xl px-4 py-8" dir="rtl" lang="ar">
      <p className="mb-3 text-xs font-bold text-indigo-700">💬 بَشَر · سؤال من إنسان في {countryLabel(q.asker_cc)}</p>
      <h1 className="rounded-2xl bg-indigo-600 px-5 py-4 text-xl font-extrabold leading-9 text-white">{q.body}</h1>
      <p className="mt-2 text-xs text-slate-500">
        {answers.length === 0 ? "لا إجابات بعد" : `${answers.length} إجابة من بشر حقيقيين`} ·{" "}
        {mine ? "هذا سؤالك — شارك الرابط ليجيبك غيرك" : "اضغط الفقاعة العائمة لتجيب أنت"}
      </p>
      <div className="my-6">
        <AdSlot position="in-content" label="تحت سؤال بَشَر" />
      </div>
      <ul className="space-y-2">
        {answers.map((a) => (
          <li key={a.id} className="rounded-2xl bg-white px-4 py-3 text-sm leading-7 shadow-sm ring-1 ring-slate-200">
            {a.body}
            <span className="block text-[11px] text-slate-500">— إنسان من {countryLabel(a.cc)}</span>
          </li>
        ))}
      </ul>
      <Link href="/bashar" className="mt-8 block rounded-2xl bg-slate-900 px-5 py-4 text-center font-extrabold text-white hover:bg-indigo-900">
        اسأل إنساناً أنت أيضاً ←
      </Link>
      <BasharBubble isOwner={isOwnerServer()} questionId={q.id} autoOpen />
    </main>
  );
}
