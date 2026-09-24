import NovaPayClient from "./NovaPayClient";
import { NOVA_PAUSED, NOVA_PAUSED_TEXT } from "@/lib/novaPause";

// Server component: fetches the live plan catalog from the FastAPI
// backend (single source of truth — ai-system/app/quota.py's PLANS
// dict) at request time, so a price/limit change there never needs a
// redeploy here. Falls back to an empty object (client shows a
// friendly "unavailable" message) if the backend can't be reached.
const FASTAPI_URL = process.env.NOVA_FASTAPI_URL || "";

type Plan = {
  label: string;
  daily_text: number;
  daily_image: number;
  weekly_text: number;
  weekly_image: number;
  price_usd: number;
};

async function fetchPlans(): Promise<Record<string, Plan>> {
  if (!FASTAPI_URL) return {};
  try {
    const res = await fetch(`${FASTAPI_URL}/plans`, { cache: "no-store" });
    if (!res.ok) return {};
    const data = await res.json();
    return data.plans || {};
  } catch {
    return {};
  }
}

export default async function NovaPayPage({ searchParams }: { searchParams: { uid?: string; paid?: string } }) {
  if (NOVA_PAUSED) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center" dir="rtl">
        <p className="text-4xl">⏸️</p>
        <p className="mt-3 text-lg font-bold text-slate-800">{NOVA_PAUSED_TEXT}</p>
        <p className="mt-2 text-sm text-slate-500">لا يمكن الاشتراك في «نوفا» حالياً.</p>
      </main>
    );
  }
  const plans = await fetchPlans();
  return <NovaPayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} plans={plans} />;
}
