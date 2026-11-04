import { NextResponse } from "next/server";

export const revalidate = 60;

const SOURCE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,bitcoin,ethereum,tether&vs_currencies=usd,sar";

type Price = { usd: number; sar: number };
type Rates = {
  ton: Price;
  btc: Price;
  eth: Price;
  usdt: Price;
};

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parsePrice(
  payload: Record<string, unknown>,
  id: string,
): Price | null {
  const value = payload[id];
  if (!value || typeof value !== "object") return null;

  const item = value as Record<string, unknown>;
  if (!positiveNumber(item.usd) || !positiveNumber(item.sar)) return null;
  return { usd: item.usd, sar: item.sar };
}

export async function GET() {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "تعذّر الوصول إلى مصدر أسعار العملات حالياً." },
        { status: 502 },
      );
    }

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { error: "استجابة مصدر الأسعار غير صالحة." },
        { status: 502 },
      );
    }

    const data = payload as Record<string, unknown>;
    const ton = parsePrice(data, "the-open-network");
    const btc = parsePrice(data, "bitcoin");
    const eth = parsePrice(data, "ethereum");
    const usdtFromSource = parsePrice(data, "tether");

    if (!ton || !btc || !eth) {
      return NextResponse.json(
        { error: "بيانات الأسعار الواردة غير مكتملة." },
        { status: 502 },
      );
    }

    const rates: Rates = {
      ton,
      btc,
      eth,
      usdt: usdtFromSource ?? { usd: 1, sar: 3.75 },
    };

    return NextResponse.json(
      { rates, updatedAt: new Date().toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "تعذّر جلب أسعار العملات حالياً." },
      { status: 502 },
    );
  }
}
