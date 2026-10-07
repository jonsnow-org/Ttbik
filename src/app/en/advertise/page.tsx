import type { Metadata } from "next";
import AdvertiseForm from "@/components/AdvertiseForm";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "Advertise on the site",
  description: "Book a sitewide banner on Sham AI for 7, 15, or 30 days at a fixed price and pay in crypto.",
  alternates: { canonical: `${SITE_URL}/en/advertise`, languages: { ar: `${SITE_URL}/advertise`, en: `${SITE_URL}/en/advertise` } },
};

export default function AdvertiseEnPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">Advertise with us</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">One banner on every page. Fixed price: 7 days $15, 15 days $25, 30 days $40. After payment the order goes to Telegram for one-click approval.</p>
      <div className="mt-6"><AdvertiseForm locale="en" /></div>
    </main>
  );
}
