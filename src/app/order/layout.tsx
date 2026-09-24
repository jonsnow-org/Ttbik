import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";

// Per-customer order-tracking pages — thin, private, no SEO value, and an
// indexed /order/[code] page could leak an order's existence via search.
// Covers /order/[code] and /order/lookup from this one file.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <div className="mx-auto max-w-2xl px-4 pb-6">
        <AdSlot position="in-content" label="أسفل تتبع الطلب" />
      </div>
    </>
  );
}
