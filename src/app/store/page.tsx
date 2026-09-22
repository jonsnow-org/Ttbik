import type { Metadata } from "next";
import { supabasePublic } from "@/lib/supabase";
import type { StoreProduct } from "@/types";
import SectionBackdrop from "@/components/SectionBackdrop";
import AdSlot from "@/components/AdSlot";
import StoreProductCard from "./StoreProductCard";

export const revalidate = 30;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const OG_IMAGE = `${SITE_URL}/opengraph-image`;

export const metadata: Metadata = {
  title: "متجر منتجات رقمية مختارة — روابط شراء مباشرة",
  description:
    "تصفح متجر سوق تولز: منتجات رقمية مختارة بروابط شراء مباشرة من متاجر موثوقة. أسعار وعروض محدّثة بدون حساب وبدون كود للبيع.",
  keywords: [
    "متجر رقمي",
    "منتجات رقمية",
    "سوق تولز",
    "شراء أونلاين",
    "عروض رقمية",
    "روابط شراء مباشرة",
  ],
  alternates: { canonical: "/store" },
  openGraph: {
    type: "website",
    locale: "ar_AR",
    url: `${SITE_URL}/store`,
    siteName: "سوق تولز",
    title: "متجر منتجات رقمية مختارة — سوق تولز",
    description: "منتجات مختارة بروابط شراء مباشرة من متاجر موثوقة.",
    images: [{ url: OG_IMAGE, alt: "متجر سوق تولز" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "متجر سوق تولز — منتجات رقمية مختارة",
    description: "روابط شراء مباشرة من متاجر موثوقة. لا عمولة مفعّلة حتى موافقة حساب الشريك.",
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (/[<>\s]/.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function categoryAnchor(category: string) {
  return `cat-${encodeURIComponent(category).replace(/%/g, "")}`;
}

async function getProducts(): Promise<StoreProduct[]> {
  const db = supabasePublic();
  const { data } = await db
    .from("store_products")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return (data as StoreProduct[]) || [];
}

function groupByCategory(products: StoreProduct[]): { category: string; items: StoreProduct[] }[] {
  const groups: { category: string; items: StoreProduct[] }[] = [];
  for (const p of products) {
    const group = groups.find((g) => g.category === p.category);
    if (group) group.items.push(p);
    else groups.push({ category: p.category, items: [p] });
  }
  return groups;
}

function breadcrumbJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "المتجر", item: `${SITE_URL}/store` },
    ],
  };
}

const STORE_FAQ = [
  {
    q: "هل الشراء من متجر سوق تولز يحتاج حساباً؟",
    a: "لا. الروابط تفتح صفحة المنتج لدى المتجر المصدر مباشرة دون إنشاء حساب على سوق تولز.",
  },
  {
    q: "هل سوق تولز يحصل على عمولة من هذه الروابط حالياً؟",
    a: "لا. الروابط حالياً روابط عرض عامة فقط. لا يوجد حساب عمولة مفعّل حتى تكتمل موافقة حساب الشريك.",
  },
  {
    q: "هل تبيعون أكواداً أو ملفات للتحميل؟",
    a: "لا. الصفحة تعرض منتجات رقمية مختارة بروابط شراء مباشرة من متاجر موثوقة، وليست سوقاً لبيع ملفات كود.",
  },
];

function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: STORE_FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

function storeJsonLd(products: StoreProduct[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "متجر سوق تولز",
    url: `${SITE_URL}/store`,
    inLanguage: "ar",
    description: "منتجات رقمية مختارة بروابط شراء مباشرة من متاجر موثوقة.",
    image: OG_IMAGE,
    mainEntity: {
      "@type": "ItemList",
      name: "متجر سوق تولز",
      numberOfItems: products.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: products.slice(0, 40).map((p, i) => {
        const url = isHttpUrl(p.affiliate_url) ? p.affiliate_url : `${SITE_URL}/store`;
        const product: Record<string, unknown> = {
          "@type": "Product",
          name: p.title_ar,
          url,
          category: p.category,
        };
        if (p.description_ar) product.description = p.description_ar;
        if (isHttpUrl(p.image_url)) product.image = p.image_url;
        if (p.price_display) {
          const numeric = String(p.price_display).replace(/[^0-9.]/g, "");
          product.offers = {
            "@type": "Offer",
            url,
            availability: "https://schema.org/InStock",
            priceCurrency: "USD",
            ...(numeric ? { price: numeric } : {}),
          };
        }
        return {
          "@type": "ListItem",
          position: i + 1,
          name: p.title_ar,
          url,
          item: product,
        };
      }),
    },
  };
}

export default async function StorePage() {
  const products = await getProducts();
  const groups = groupByCategory(products);

  return (
    <main className="relative mx-auto max-w-6xl px-4 pb-20 pt-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(storeJsonLd(products)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />
      <SectionBackdrop tone="store" />

      <nav className="mb-4 text-xs text-slate-500" aria-label="مسار التنقل">
        <a href="/" className="hover:text-slate-800">الرئيسية</a>
        <span className="px-1.5">/</span>
        <span className="font-semibold text-slate-700">المتجر</span>
      </nav>

      <div className="mb-8 text-center">
        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">🛝 متجر سوق تولز</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
          منتجات رقمية مختارة بروابط شراء مباشرة من متاجر موثوقة — بدون حساب وبدون كود للبيع.
        </p>
        {products.length > 0 && (
          <p className="mt-2 text-xs font-semibold text-slate-400">
            {products.length} منتج مختار في {groups.length} أقسام
          </p>
        )}
        <p className="mx-auto mt-3 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          تنبيه: روابط المتجر حالياً روابط عرض عامة فقط. لا يوجد حساب عمولة مفعّل (لا tag=
          أمازون ولا deeplink Admitad)، لذلك أي شراء عبر هذه الصفحة لا يولّد عمولة للموقع
          حتى تكتمل موافقة الحساب.
        </p>
      </div>

      <AdSlot position="header-banner" label="أعلى صفحة المتجر" />

      {groups.length > 1 && (
        <nav className="mt-6 flex flex-wrap justify-center gap-2" aria-label="أقسام المتجر">
          {groups.map((g) => (
            <a
              key={g.category}
              href={`#${categoryAnchor(g.category)}`}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:border-slate-400"
            >
              {g.category} ({g.items.length})
            </a>
          ))}
        </nav>
      )}

      {groups.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <div className="text-4xl">🛒</div>
          <p className="mt-3 font-bold text-slate-700">المنتجات قادمة قريباً</p>
          <p className="mt-1 text-sm text-slate-500">نعمل على إضافة أول دفعة من المنتجات المختارة.</p>
        </div>
      ) : (
        groups.map((group, idx) => (
          <section key={group.category} id={categoryAnchor(group.category)} className="mt-10 scroll-mt-24">
            <h2 className="mb-4 text-xl font-bold text-slate-900">{group.category}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((p) => (
                <StoreProductCard key={p.id} p={p} />
              ))}
            </div>
            {idx % 2 === 1 && <AdSlot position="in-content" label={`بين أقسام المتجر (بعد ${group.category})`} />}
          </section>
        ))
      )}

      <section className="mt-14 rounded-3xl border border-slate-200 bg-white p-6" aria-labelledby="store-faq">
        <h2 id="store-faq" className="text-lg font-extrabold text-slate-900">
          أسئلة شائعة عن المتجر
        </h2>
        <dl className="mt-4 space-y-4">
          {STORE_FAQ.map((item) => (
            <div key={item.q}>
              <dt className="font-bold text-slate-800">{item.q}</dt>
              <dd className="mt-1 text-sm leading-6 text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-10">
        <AdSlot position="footer-banner" label="أسفل صفحة المتجر" />
      </div>
    </main>
  );
}
