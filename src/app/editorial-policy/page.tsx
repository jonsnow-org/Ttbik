import type { Metadata } from "next";
import Link from "next/link";

const SITE = "https://souqtools.com";
const PATH = "/editorial-policy";

export const metadata: Metadata = {
  title: "سياسة التحرير | سوق تولز",
  description:
    "كيف نكتب الأخبار والمقالات: مصادر موثوقة، بلا اختلاق، بلا نسخ كامل، وتصحيح ظاهر عند الخطأ.",
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "سياسة التحرير | سوق تولز",
    description: "مصادر، تصحيحات، ومساعدة أدوات ذكاء اصطناعي معلنة.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
};

const BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "سياسة التحرير", item: `${SITE}${PATH}` },
  ],
};

export default function EditorialPolicyPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }}
      />
      <main className="mx-auto max-w-2xl px-4 py-8 text-slate-700" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">سياسة التحرير</li>
          </ol>
        </nav>

        <h1 className="mb-4 text-2xl font-extrabold text-slate-900">سياسة التحرير</h1>
        <p className="mb-6 text-sm leading-7">
          صفحات الأخبار والأحداث في سوق تولز ليست وكالة أنباء. نلخّص ما نشرته مصادر يمكن فتحها،
          ونضع الرابط الأصلي. أي رقم أو تاريخ أو اسم لا يظهر في المصدر لا يُكتب هنا.
        </p>

        <section className="mb-6 space-y-2 text-sm leading-7">
          <h2 className="font-bold text-slate-900">المصادر</h2>
          <p>
            كل خبر أو مقال يحتاج مصدراً واحداً على الأقل من منفذ يمكن التحقق منه (وكالة، صحيفة،
            معهد علمي، أو موجز رسمي). نفضّل مصدرين عند اختلاف التفاصيل. لا نعتمد إشاعات أو حسابات
            مجهولة.
          </p>
        </section>

        <section className="mb-6 space-y-2 text-sm leading-7">
          <h2 className="font-bold text-slate-900">ما لا نفعله</h2>
          <ul className="list-disc space-y-1 pr-5">
            <li>لا نختلق اقتباساً أو رقم ضحايا أو موعداً.</li>
            <li>لا ننسخ المقال كاملاً ولا نعيد نشر صور ليست لنا.</li>
            <li>لا نضع فيديو إلا عبر التضمين الرسمي للقناة الأصلية.</li>
          </ul>
        </section>

        <section className="mb-6 space-y-2 text-sm leading-7">
          <h2 className="font-bold text-slate-900">التصحيح</h2>
          <p>
            إذا تبين خطأ بعد النشر نحدّث الصفحة ونكتب سطراً ظاهراً بعنوان «تصحيح» مع التاريخ. لا
            نعيد كتابة الوقائع بصمت.
          </p>
        </section>

        <section className="mb-6 space-y-2 text-sm leading-7">
          <h2 className="font-bold text-slate-900">الذكاء الاصطناعي</h2>
          <p>
            نستخدم أدوات مساعدة للصياغة والترتيب. المسؤولية التحريرية على فريق الموقع: التحقق من
            المصدر قبل النشر. تذييل الصفحات يذكر ذلك صراحة.
          </p>
        </section>

        <p className="text-sm">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار ←
          </Link>
          {" · "}
          <Link href="/events" className="font-bold text-indigo-800 hover:underline">
            الأحداث والمقالات ←
          </Link>
        </p>
      </main>
    </>
  );
}
