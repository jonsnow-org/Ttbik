import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ExploreMore from "@/components/ExploreMore";
import WordGame from "@/components/WordGame";
import { SITE_URL } from "@/lib/siteUrl";
import { wordOfDayGame, WORD_LEN, MAX_GUESSES } from "@/lib/wordGame";

const SITE = SITE_URL;
const PATH = "/guess-word";
const TITLE = "خمّن الكلمة — لعبة الكلمة اليومية بالعربية";
const DESC = `كلمة عربية من ${WORD_LEN} أحرف تتجدد كل يوم — خمّنها خلال ${MAX_GUESSES} محاولات، وشارك نتيجتك. بلا تسجيل، مجانية بالكامل.`;

export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE}${PATH}`, locale: "ar_AR", type: "website" },
  twitter: { card: "summary", title: TITLE, description: DESC },
};

const FAQ = [
  { q: "كيف ألعب؟", a: `اكتب كلمة من ${WORD_LEN} أحرف عربية واضغط تأكيد. يتلوّن كل حرف: أخضر في مكانه الصحيح، أصفر موجود بمكان آخر، رمادي غير موجود. لديك ${MAX_GUESSES} محاولات.` },
  { q: "هل الكلمة نفسها لكل الزوار؟", a: "نعم — كلمة واحدة يومياً للجميع، تتغيّر حسب تاريخ UTC لا حسب منطقتك، تماماً مثل صفحة كلمة اليوم." },
  { q: "هل أحتاج تسجيلاً؟", a: "لا. اللعبة والمشاركة والإحصائيات (عدد مرات اللعب، السلسلة) كلها تُحفظ في متصفحك فقط، بلا حساب." },
  { q: "ماذا لو أخطأت كل المحاولات؟", a: "تظهر لك الكلمة الصحيحة، وسلسلة الفوز تعود للصفر، وتعود غداً بكلمة جديدة." },
];

export default function GuessWordPage() {
  const { word, dateIso, dayIndex } = wordOfDayGame();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "خمّن الكلمة",
    url: `${SITE}${PATH}`,
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    inLanguage: "ar",
    description: DESC,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
      { "@type": "ListItem", position: 2, name: "خمّن الكلمة", item: `${SITE}${PATH}` },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <main className="mx-auto max-w-xl px-4 py-8 text-slate-700" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">خمّن الكلمة</li>
          </ol>
        </nav>
        <h1 className="mb-1 text-center text-2xl font-extrabold text-slate-900 sm:text-3xl">🔤 خمّن الكلمة</h1>
        <p className="mb-1 text-center text-xs text-slate-400">لغز #{dayIndex} — {dateIso}</p>
        <p className="mb-6 text-center text-sm leading-6 text-slate-600">
          كلمة من {WORD_LEN} أحرف، أمامك {MAX_GUESSES} محاولات. كلمة جديدة كل يوم للجميع.
        </p>

        <WordGame key={dayIndex} answer={word} dayIndex={dayIndex} siteUrl={SITE} />

        <div className="my-8">
          <AdSlot position="in-content" label="أسفل لعبة خمّن الكلمة" />
        </div>

        <h2 className="mb-3 text-lg font-extrabold text-slate-900">أسئلة شائعة</h2>
        <dl className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="mb-1 text-sm font-bold text-slate-900">{item.q}</dt>
              <dd className="text-sm leading-6 text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
      </main>
      <ExploreMore from="tools" />
    </>
  );
}
