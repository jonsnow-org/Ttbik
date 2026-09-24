import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";
import { countryLabel, getQuestion } from "@/lib/bashar";

export const dynamic = "force-dynamic";

async function load(id: string) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  try {
    const q = await getQuestion(id);
    return q && q.answer && !q.hidden ? q : null;
  } catch {
    return null;
  }
}

// User-written content: shareable, but kept out of search indexes.
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const q = await load(params.id);
  if (!q) return { title: "بَشَر", robots: { index: false } };
  const title = `«${q.body.slice(0, 70)}» — أجاب إنسان من ${countryLabel(q.answer_cc).split(" ").slice(1).join(" ")}`;
  return {
    title,
    description: `${q.answer?.slice(0, 150)} — على «بَشَر»: دردشة يجيبك فيها إنسان حقيقي.`,
    robots: { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/bashar/a/${q.id}` },
    openGraph: { title, description: q.answer ?? "", url: `${SITE_URL}/bashar/a/${q.id}`, locale: "ar_AR", type: "article", images: [{ url: `${SITE_URL}/opengraph-image` }] },
  };
}

export default async function BasharAnswerPage({ params }: { params: { id: string } }) {
  const q = await load(params.id);
  if (!q) notFound();
  return (
    <main className="mx-auto max-w-xl px-4 py-10" dir="rtl" lang="ar">
      <p className="mb-4 text-xs font-bold text-indigo-700">بَشَر · سؤال أجاب عنه إنسان حقيقي خلال 75 ثانية</p>
      <div className="space-y-3">
        <div className="mr-auto max-w-[90%] rounded-2xl rounded-bl-sm bg-indigo-600 px-4 py-3 leading-7 text-white">{q.body}</div>
        <p className="text-[11px] text-slate-500">— سأل إنسان من {countryLabel(q.asker_cc)}</p>
        <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-white px-4 py-3 leading-7 text-slate-800 shadow ring-1 ring-slate-200">
          {q.answer}
        </div>
        <p className="text-left text-[11px] text-slate-500">— أجاب إنسان من {countryLabel(q.answer_cc)}</p>
      </div>
      <Link
        href="/bashar"
        className="mt-8 block rounded-2xl bg-slate-900 px-5 py-4 text-center font-extrabold text-white hover:bg-indigo-900"
      >
        اسأل إنساناً أنت أيضاً — أو كن أنت «الذكاء» ←
      </Link>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل جواب بَشَر" />
      </div>
    </main>
  );
}
