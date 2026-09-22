import type { Metadata } from "next";
import { supabasePublic } from "@/lib/supabase";
import type { StoreProduct } from "@/types";
import { getCategoryTheme } from "@/lib/categoryTheme";
import SectionBackdrop from "@/components/SectionBackdrop";
import AdSlot from "@/components/AdSlot";

export const revalidate = 30;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

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
    url: "/store",
    siteName: "سوق تولز",
    title: "متجر منتجات رقمية مختارة — سوق تولز",
    description: "منتجات مختارة بروابط شراء مباشرة من متاجر موثوقة.",
  },
};

async function getProducts(): Promise<StoreProduct[]> {
  const db = supabasePublic();
  const { data } = await db
    .from("store_products")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return (data as StoreProduct[]) || [];
}

/** Groups products by category, preserving the order each category first
 * appears in (itself driven by sort_order) rather than alphabetizing --
 * lets whoever manages the products (owner or the engineer) control
 * category order the same way they control product order. */
function groupByCategory(products: StoreProduct[]): { category: string; items: StoreProduct[] }[] {
  const groups: { category: string; items: StoreProduct[] }[] = [];
  for (const p of products) {
    const group = groups.find((g) => g.category === p.category);
    if (group) group.items.push(p);
    else groups.push({ category: p.category, items: [p] });
  }
  return groups;
}

function storeJsonLd(products: StoreProduct[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "متجر سوق تولز",
    url: `${SITE_URL}/store`,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 40).map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: p.title_ar,
      url: p.affiliate_url || `${SITE_URL}/store`,
    })),
  };
}

export default async function StorePage() {
  const products = await getProducts();
  const groups = groupByCategory(products);

  return (
    <main className="relative mx-auto max-w-6xl px-4 pb-20 pt-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(storeJsonLd(products)) }}
      />
      <SectionBackdrop tone="store" />

      <div className="mb-8 text-center">
        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">🛍️ متجر سوق تولز</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
          منتجات رقمية مختارة بروابط شراء مباشرة من متاجر موثوقة — بدون حساب وبدون كود للبيع.
        </p>
      </div>

      <AdSlot position="header-banner" label="أعلى صفحة المتجر" />

      {groups.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <div className="text-4xl">🛒</div>
          <p className="mt-3 font-bold text-slate-700">المنتجات قادمة قريباً</p>
          <p className="mt-1 text-sm text-slate-500">نعمل على إضافة أول دفعة من المنتجات المختارة.</p>
        </div>
      ) : (
        groups.map((group, idx) => {
          const theme = getCategoryTheme(group.category);
          return (
            <section key={group.category} className="mt-10">
              <h2 className="mb-4 text-xl font-bold text-slate-900">{group.category}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.items.map((p) => (
                  <a
                    key={p.id}
                    href={p.affiliate_url}
                    target="_blank"
                    rel="sponsored nofollow noopener"
                    className={`group flex flex-col overflow-hidden rounded-2xl border ${theme.border} bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg`}
                  >
                    <div className="aspect-square w-full overflow-hidden bg-slate-50">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt={p.title_ar} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-4xl">🛍️</div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-4">
                      <h3 className="font-bold text-slate-900">{p.title_ar}</h3>
                      {p.description_ar && <p className="line-clamp-2 text-xs text-slate-500">{p.description_ar}</p>}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        {p.price_display && <span className="font-extrabold text-slate-900">{p.price_display}</span>}
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${theme.badgeBg} ${theme.badgeText}`}>
                          عرض المنتج ←
                        </span>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
              {idx % 2 === 1 && <AdSlot position="in-content" label={`بين أقسام المتجر (بعد ${group.category})`} />}
            </section>
          );
        })
      )}

      <div className="mt-10">
        <AdSlot position="footer-banner" label="أسفل صفحة المتجر" />
      </div>
    </main>
  );
}
