import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ExploreMore from "@/components/ExploreMore";
import { SITE_URL } from "@/lib/siteUrl";
import { countryLabel, recentAnswered } from "@/lib/bashar";
import BasharApp from "@/components/bashar/BasharApp";
import TelegramStart from "./TelegramStart";

export const dynamic = "force-dynamic";

const SITE = SITE_URL;
const PATH = "/bashar";
const TITLE = "بَشَر — دردشة يجيبك فيها إنسان حقيقي بدل الذكاء الاصطناعي";
const DESC =
  "اسأل أي شيء فيجيبك إنسان عربي حقيقي خلال 75 ثانية، ثم تعرف من أي بلد هو. وأجب أنت عن أسئلة الآخرين لتكسب رصيداً. بلا تسجيل.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE}${PATH}`, locale: "ar_AR", type: "website", images: [{ url: `${SITE}/bashar-og.jpg`, width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: [`${SITE}/bashar-og.jpg`] },
};

const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
      { "@type": "ListItem", position: 2, name: "بَشَر", item: `${SITE}${PATH}` },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "بَشَر",
    url: `${SITE}${PATH}`,
    applicationCategory: "SocialNetworkingApplication",
    operatingSystem: "Web",
    inLanguage: "ar",
    description: DESC,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
];

async function wall() {
  try {
    return await recentAnswered(8);
  } catch {
    return [];
  }
}

export default async function BasharPage() {
  const recent = await wall();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <TelegramStart />
      <main className="mx-auto max-w-xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-4 text-sm text-slate-500" aria-label="مسار التنقل">
          <Link href="/" className="hover:text-slate-800">
            الرئيسة
          </Link>{" "}
          / <span className="font-semibold text-slate-800">بَشَر</span>
        </nav>
        <h1 className="text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">
          كل تطبيقات الدردشة يجيبك فيها ذكاء اصطناعي… <span className="text-indigo-700">هنا يجيبك إنسان.</span>
        </h1>
        <p className="mb-5 mt-2 text-sm leading-7 text-slate-600">
          سؤالك يصل إلى شخص حقيقي عشوائي من العالم العربي، لديه 75 ثانية ليكتب جوابه. لتسأل تحتاج رصيداً، وتكسبه بأن تصبح أنت
          «الذكاء» وتجيب غيرك.
        </p>
        <BasharApp />
        <p className="mt-3 text-center text-[11px] text-slate-400">
          لا روابط ولا أرقام هواتف ولا ألفاظ مسيئة. أي جواب يُبلَّغ عنه مرتين يُخفى تلقائياً.
        </p>

        <div className="my-8">
          <AdSlot position="in-content" label="أسفل بَشَر" />
        </div>

        {recent.length > 0 && (
          <section aria-labelledby="bashar-wall">
            <h2 id="bashar-wall" className="mb-3 text-lg font-extrabold text-slate-900">
              آخر ما أجاب به البشر
            </h2>
            <ul className="space-y-3">
              {recent.map((q) => (
                <li key={q.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-7">
                  <p className="font-bold text-slate-900">❓ {q.body}</p>
                  <p className="text-slate-700">💬 {q.answer}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    سؤال من {countryLabel(q.asker_cc)} · جواب من {countryLabel(q.answer_cc)} ·{" "}
                    <Link href={`/bashar/q/${q.id}`} className="font-bold text-indigo-700">
                      رابط
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <ExploreMore from="tools" />
    </>
  );
}
