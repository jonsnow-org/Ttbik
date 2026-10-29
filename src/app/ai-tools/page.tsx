import type { Metadata } from "next";
import Link from "next/link";
import AIToolsDirectory from "@/components/AIToolsDirectory";
import { AI_TOOL_CATEGORIES, AI_TOOLS } from "@/lib/aiToolsDirectory";
import { SITE_URL } from "@/lib/siteUrl";

const pageTitle = "دليل أدوات الذكاء الاصطناعي | شام AI";
const pageDescription =
  "اكتشف أكثر من 70 أداة ذكاء اصطناعي للكتابة والترجمة وتوليد الصور والفيديو والبرمجة والبحث والتصميم والتسويق وSEO. ابحث حسب الاستخدام وافتح المواقع الرسمية.";

export const metadata: Metadata = {
  title: { absolute: pageTitle },
  description: pageDescription,
  keywords: [
    "أدوات الذكاء الاصطناعي",
    "دليل أدوات AI",
    "أفضل أدوات الذكاء الاصطناعي",
    "أدوات كتابة بالذكاء الاصطناعي",
    "توليد الصور بالذكاء الاصطناعي",
    "أدوات إنشاء الفيديو بالذكاء الاصطناعي",
    "أدوات برمجة AI",
    "أدوات البحث العلمي",
    "أدوات SEO",
    "أدوات مجانية",
  ],
  alternates: {
    canonical: SITE_URL + "/ai-tools",
    languages: { ar: SITE_URL + "/ai-tools", en: SITE_URL + "/en/ai-tools" },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: SITE_URL + "/ai-tools",
    locale: "ar_AR",
    type: "website",
    siteName: "شام AI",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
  },
};

const DIRECTORY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: pageTitle,
  description: pageDescription,
  url: SITE_URL + "/ai-tools",
  inLanguage: "ar",
  isPartOf: { "@type": "WebSite", name: "شام AI", url: SITE_URL },
  mainEntity: {
    "@type": "ItemList",
    itemListOrder: "https://schema.org/ItemListUnordered",
    numberOfItems: AI_TOOLS.length,
    itemListElement: AI_TOOLS.map((tool, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: tool.name,
      url: tool.url,
    })),
  },
};

const BREADCRUMB_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "شام AI", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "دليل أدوات الذكاء الاصطناعي", item: SITE_URL + "/ai-tools" },
  ],
};

export default function AIToolsPage() {
  return (
    <main lang="ar" dir="rtl" className="mx-auto max-w-6xl px-4 py-7 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(DIRECTORY_SCHEMA) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_SCHEMA) }} />

      <nav aria-label="مسار التنقل" className="mb-5 text-xs font-semibold text-slate-500">
        <Link href="/" className="hover:text-indigo-700">شام AI</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-slate-800">دليل أدوات الذكاء الاصطناعي</span>
      </nav>

      <section
        className="relative isolate overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-950 via-slate-900 to-sky-950 p-5 text-white shadow-lg sm:p-8"
        style={{
          backgroundImage: "linear-gradient(115deg, rgba(15,23,42,.96), rgba(30,27,75,.87), rgba(8,47,73,.82)), url('https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1600&q=82')",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="absolute -left-12 -top-16 -z-10 h-48 w-48 rounded-full bg-sky-400/20 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-sky-100">
              {AI_TOOLS.length} أداة مختارة · {AI_TOOL_CATEGORIES.length} فئات
            </span>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">دليل أدوات الذكاء الاصطناعي</h1>
            <p className="mt-3 text-sm leading-7 text-slate-200 sm:text-base">
              اكتشف أدوات للكتابة والترجمة وتوليد الصور والفيديو والبرمجة والبحث العلمي والإنتاجية والتصميم والتسويق وتحسين محركات البحث. ابحث باسم الأداة أو وظيفتها، ثم انتقل مباشرة إلى موقعها الرسمي.
            </p>
          </div>
          <Link href="/en/ai-tools" hrefLang="en" lang="en" className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-white/20">
            English
          </Link>
        </div>
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-gradient-to-l from-sky-50 via-white to-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-extrabold text-slate-900">هل تريد استكشاف الدليل الأصلي الكامل؟</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            هذه قائمة مستقلة من الأدوات المختارة، مع أوصاف عربية أصلية. قد تتغير الأسعار والخطط والميزات لدى كل مزوّد.
          </p>
        </div>
        <a href="https://dealsbe.com/" target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-700 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-800">
          تصفّح DealsBe ↗
        </a>
      </section>

      <div className="mt-6">
        <AIToolsDirectory lang="ar" />
      </div>

      <section aria-labelledby="choose-ai-tools" className="mt-10 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 id="choose-ai-tools" className="text-xl font-black text-slate-950">كيف تختار أفضل أداة ذكاء اصطناعي لعملك؟</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          ابدأ بالمهمة التي تريد إنجازها، وليس بعدد الميزات التي تعلن عنها الأداة. اختبر جودة النتائج ودعم اللغة العربية وحدود الاستخدام وسياسة الخصوصية وحقوق الاستخدام التجاري وتكلفة الخطة التي تحتاج إليها فعلاً.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <article className="rounded-2xl bg-violet-50 p-4">
            <h3 className="font-extrabold text-violet-950">الكتابة والترجمة والبحث</h3>
            <p className="mt-2 text-sm leading-6 text-violet-900/80">استخدم المساعدات لإعداد المسودات والتلخيص، واختر أدوات البحث بالمصادر عندما تحتاج إلى التحقق من الأدلة والاستشهادات.</p>
          </article>
          <article className="rounded-2xl bg-fuchsia-50 p-4">
            <h3 className="font-extrabold text-fuchsia-950">الصور والفيديو والصوت</h3>
            <p className="mt-2 text-sm leading-6 text-fuchsia-900/80">قارن جودة النتائج والتحكم في التحرير ودقة التصدير وحدود التوليد وشروط الاستخدام التجاري.</p>
          </article>
          <article className="rounded-2xl bg-sky-50 p-4">
            <h3 className="font-extrabold text-sky-950">البرمجة والتسويق وSEO</h3>
            <p className="mt-2 text-sm leading-6 text-sky-900/80">تحقق من تكامل الأداة مع عملك الحالي ومستوى مهارتك والتقارير التي تحتاج إليها والميزانية المتاحة.</p>
          </article>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-600">
          هل تبحث أيضاً عن حاسبات وخدمات تعمل مباشرة في المتصفح؟ استكشف <Link href="/free-tools" className="font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900">الأدوات المجانية على شام AI</Link>.
        </p>
      </section>

      <section aria-labelledby="ai-tools-faq" className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-5 sm:p-7">
        <h2 id="ai-tools-faq" className="text-xl font-black text-slate-950">الأسئلة الشائعة عن أدوات الذكاء الاصطناعي</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">هل جميع أدوات الذكاء الاصطناعي مجانية؟</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">لا. توفر بعض الخدمات خططاً مجانية أو تجريبية، بينما تتطلب ميزات متقدمة الدفع. راجع أسعار المزوّد الحالية قبل الاعتماد على ميزة محددة.</p>
          </article>
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">ما أفضل أدوات الذكاء الاصطناعي التي تدعم العربية؟</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">يختلف دعم العربية حسب الأداة والمهمة. جرّب مثالاً من استخدامك الحقيقي، وراجع النتيجة قبل نشرها أو استخدامها مهنياً.</p>
          </article>
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">هل يمكن رفع ملفات أو معلومات خاصة؟</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">اقرأ سياسة الخصوصية وإعدادات الاحتفاظ بالبيانات أولاً. تجنّب مشاركة كلمات المرور أو بيانات العمل السرية أو المعلومات الشخصية الحساسة دون التحقق من وسائل الحماية.</p>
          </article>
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">كيف أجد أداة لمهمة محددة؟</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">اكتب اسم الأداة أو مهمتها في البحث أعلاه، ثم اختر الفئة المناسبة لتضييق النتائج إلى الكتابة أو الصور أو البرمجة أو البحث أو غيرها.</p>
          </article>
        </div>
      </section>

      <div className="mt-8 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-6 text-amber-950">
        <strong>ملاحظة:</strong> هذه منتجات مستقلة من جهات خارجية وليست خدمات يملكها شام AI. قد تتطلب بعض الميزات حساباً أو اشتراكاً مدفوعاً؛ تحقّق من الشروط وسياسة الخصوصية لدى المزوّد قبل الاستخدام.
      </div>
    </main>
  );
}
