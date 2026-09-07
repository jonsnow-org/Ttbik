import NovaPayClient from "./NovaPayClient";

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
  const plans = await fetchPlans();
  return <NovaPayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} plans={plans} />;
}
