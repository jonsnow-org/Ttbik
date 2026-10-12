import type { Metadata } from "next";
import AdvertiseForm from "@/components/AdvertiseForm";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "الإعلان على الموقع",
  description: "احجز بنر يظهر في كل صفحات شام AI لسبعة أو خمسة عشر أو ثلاثين يوماً بسعر ثابت، وادفع بالعملة الرقمية.",
  alternates: { canonical: `${SITE_URL}/advertise`, languages: { ar: `${SITE_URL}/advertise`, en: `${SITE_URL}/en/advertise` } },
};

export default function AdvertisePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">الإعلان على الموقع</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">مكان واحد في كل الصفحات. السعر ثابت: 7 أيام 15 دولاراً، 15 يوماً 25، 30 يوماً 40. بعد الدفع يصل الطلب إلى تلجرام للموافقة بنقرة، ثم يظهر البنر.</p>
      <div className="mt-6"><AdvertiseForm locale="ar" /></div>
    </main>
  );
}
