import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ExploreMore from "@/components/ExploreMore";
import { SITE_URL } from "@/lib/siteUrl";
import WidgetBuilder from "./WidgetBuilder";

const SITE = SITE_URL;
const PATH = "/prayer-widget";
const TITLE = "أضف مواقيت الصلاة إلى موقعك مجاناً — ودجت جاهز";
const DESC =
  "كود تضمين مجاني لمواقيت الصلاة بعدّاد الصلاة القادمة لأكثر من 20 مدينة عربية. انسخ سطراً واحداً والصقه في موقعك أو مدونتك، بلا تسجيل وبلا إعلانات داخل الودجت.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: { title: TITLE, description: DESC, url: `${SITE}${PATH}`, locale: "ar_AR", type: "website", images: [{ url: `${SITE}/opengraph-image` }] },
};

const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
      { "@type": "ListItem", position: 2, name: "مواقيت الصلاة", item: `${SITE}/prayer-times` },
      { "@type": "ListItem", position: 3, name: "ودجت المواقيت", item: `${SITE}${PATH}` },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "ودجت مواقيت الصلاة",
    url: `${SITE}${PATH}`,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Web",
    inLanguage: "ar",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
];

export default function PrayerWidgetPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li><Link href="/" className="hover:text-slate-800">الرئيسة</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/prayer-times" className="hover:text-slate-800">مواقيت الصلاة</Link></li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">ودجت المواقيت</li>
          </ol>
        </nav>
        <h1 className="mb-2 text-2xl font-extrabold text-slate-900">{TITLE}</h1>
        <p className="mb-6 text-sm leading-7 text-slate-600">
          لمواقع المساجد والمدارس والمدونات والمتاجر: اختر المدينة والشكل، ثم انسخ الكود والصقه في صفحتك. تتحدّث
          المواقيت تلقائياً كل يوم، وتُحسب بمكتبة adhan بنفس طريقة صفحة كل مدينة عندنا. الودجت لا يحوي إعلانات.
        </p>
        <WidgetBuilder site={SITE} />
        <div className="my-8">
          <AdSlot position="in-content" label="أسفل منشئ الودجت" />
        </div>
        <h2 className="mb-2 text-lg font-extrabold text-slate-900">أسئلة شائعة</h2>
        <dl className="space-y-3 text-sm leading-7 text-slate-700">
          <div>
            <dt className="font-bold">هل الودجت مجاني؟</dt>
            <dd>نعم، بلا تسجيل ولا حد للاستخدام. نطلب فقط إبقاء رابط «سوق تولز» أسفله.</dd>
          </div>
          <div>
            <dt className="font-bold">ما طريقة الحساب؟</dt>
            <dd>طريقة كل مدينة مذكورة في صفحتها (أم القرى، الهيئة المصرية، رابطة العالم الإسلامي، كراتشي). الحساب فلكي تقريبي وليس بياناً رسمياً لوزارة.</dd>
          </div>
          <div>
            <dt className="font-bold">مدينتي غير موجودة؟</dt>
            <dd>نضيف مدناً باستمرار — راجع <Link href="/prayer-times" className="font-bold text-indigo-700 hover:underline">دليل المدن</Link>.</dd>
          </div>
        </dl>
      </main>
      <ExploreMore from="prayer" />
    </>
  );
}
