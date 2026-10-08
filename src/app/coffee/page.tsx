import type { Metadata } from "next";
import { EDITORIAL_TABS } from "@/config/navigation";

export const metadata: Metadata = {
  title: "قهوة للموقع | شام AI",
  description: "تبرع اختياري بقيمة فنجان قهوة لدعم شام AI. ليس استثماراً ولا يمنح ميزة داخل الموقع.",
  alternates: { canonical: "/coffee" },
};

const WIDGET_SRC =
  "https://nowpayments.io/embeds/donation-widget?api_key=bf92c613-36ef-4e53-b43d-337698c76642";

export default function CoffeePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-zinc-100">
      <p className="text-sm text-amber-200">دعم اختياري</p>
      <h1 className="mt-1 text-2xl font-extrabold">قهوة للموقع</h1>
      <p className="mt-3 text-sm leading-7 text-zinc-300">
        تبرع بقيمة فنجان قهوة لاستمرار الموقع. ليس شراء خدمة، ولا استثماراً، ولا يمنح صلاحية أو ربحاً.
        الدفع يتم عبر NOWPayments.
      </p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white">
        <iframe
          src={WIDGET_SRC}
          title="تبرع قهوة"
          width="346"
          height="623"
          className="mx-auto block max-w-full"
          style={{ border: 0, overflowY: "hidden" }}
        />
      </div>
      <nav className="mt-8 flex flex-wrap gap-2 text-sm">
        {EDITORIAL_TABS.map((tab) => (
          <a key={tab.id} href={tab.href} className="rounded-full border border-white/15 px-3 py-1">
            {tab.label}
          </a>
        ))}
      </nav>
    </main>
  );
}
